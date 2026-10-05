import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
process.env.SQLITE_PATH=':memory:';
process.env.APP_URL='http://localhost:3000';
delete process.env.DATABASE_URL;
const { db,closeDB }=await import('../src/lib/db');
const { migrate }=await import('../src/lib/schema');
const { mutate,getData }=await import('../src/lib/collections');
const { cents,today,plusDays,DomainError }=await import('../src/lib/domain');
const { passwordHash,login,getActor,sha,checkOrigin,rateLimit }=await import('../src/lib/security');
const { prepareReminders,dispatchReminders }=await import('../src/lib/reminders');
const { importRows,parseWorkbook,columns }=await import('../src/lib/imports');
const { boundedBody }=await import('../src/lib/request');
const { staffActivity }=await import('../src/lib/reports');
import type { Actor,Role } from '../src/lib/types';
await migrate();
after(async()=>{await closeDB();});
const actor=async(school:string,role:Role):Promise<Actor>=>{
 const user:Actor={id:randomUUID(),school_id:school,name:role,email:`${randomUUID()}@example.test`,role,school_name:'Prueba'};
 await db.run('INSERT INTO ce_users(id,school_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)',[user.id,school,user.name,user.email,await passwordHash('ClaveDePrueba-MuyLarga-987'),role,new Date().toISOString()]);return user;
};
async function fixture(){const school=randomUUID();await db.run('INSERT INTO ce_schools(id,name,slug,created_at) VALUES (?,?,?,?)',[school,'Prueba',school,new Date().toISOString()]);const cashier=await actor(school,'cobranza'),followup=await actor(school,'seguimiento'),director=await actor(school,'directora');const g=await mutate(cashier,'guardian',{name:'Familia',email:'familia@example.test',phone:'+50761234567',email_consent:true,whatsapp_consent:true,consent_note:'Autorización de prueba registrada'}) as string;const s=await mutate(cashier,'student',{guardian_id:g,code:'EST-01',name:'Estudiante',grade:'10 A'}) as string;const invoice=await mutate(cashier,'invoice',{student_id:s,reference:'FAC-01',concept:'Mensualidad',due_date:today(),amount:'400.00',late_fee:'20.00'}) as string;return {school,cashier,followup,director,g,s,invoice};}
const pay=(invoice:string,value='100.00')=>({invoice_id:invoice,request_key:randomUUID(),reference:randomUUID(),amount:value,method:'Transferencia',paid_on:today()});
test('Los montos usan centavos exactos y rechazan formatos ambiguos',()=>{assert.equal(cents('0.29'),29);assert.equal(cents('400.1'),40010);for(const v of ['-1','1e3','1,000','0.001','NaN','0'])assert.throws(()=>cents(v));});
test('Roles: directora y seguimiento no pueden registrar pagos',async()=>{const f=await fixture();for(const a of [f.director,f.followup])await assert.rejects(()=>mutate(a,'payment',pay(f.invoice)),e=>e instanceof DomainError&&e.status===403);});
test('Aislamiento: un colegio no consulta ni modifica registros ajenos',async()=>{const a=await fixture(),b=await fixture();await assert.rejects(()=>mutate(a.cashier,'payment',pay(b.invoice)),e=>e instanceof DomainError&&e.status===404);await assert.rejects(()=>mutate(a.cashier,'student',{guardian_id:b.g,code:'OTRO',name:'Intruso',grade:'1'}));const data=await getData(a.cashier);assert.equal(data.invoices.length,1);assert.equal(data.invoices[0].school_id,a.school);});
test('Pago idempotente, referencia única y rechazo de sobrepagos',async()=>{const f=await fixture(),input=pay(f.invoice);const first=await mutate(f.cashier,'payment',input);assert.equal(await mutate(f.cashier,'payment',input),first);await assert.rejects(()=>mutate(f.cashier,'payment',{...input,amount:'101.00'}));await assert.rejects(()=>mutate(f.cashier,'payment',pay(f.invoice,'321.00')));await assert.rejects(()=>mutate(f.cashier,'payment',{...pay(f.invoice),reference:input.reference}));const data=await getData(f.cashier);assert.equal(data.invoices[0].paid_cents,10000);assert.equal(data.payments.length,1);});
test('Pagos concurrentes no dejan saldo negativo',async()=>{const f=await fixture();const result=await Promise.allSettled([mutate(f.cashier,'payment',pay(f.invoice,'300.00')),mutate(f.cashier,'payment',pay(f.invoice,'300.00'))]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);const data=await getData(f.cashier);assert.equal(data.invoices[0].paid_cents,30000);});
test('Promesa se cumple con suma de abonos posteriores, no pagos anteriores',async()=>{const f=await fixture();await mutate(f.cashier,'payment',pay(f.invoice));await mutate(f.followup,'promise',{invoice_id:f.invoice,amount:'200.00',due_date:plusDays(today(),3),notes:''});await assert.rejects(()=>mutate(f.followup,'promise',{invoice_id:f.invoice,amount:'100.00',due_date:today(),notes:''}));await mutate(f.cashier,'payment',pay(f.invoice));assert.equal((await getData(f.cashier)).promises[0].status,'pendiente');await mutate(f.cashier,'payment',pay(f.invoice));assert.equal((await getData(f.cashier)).promises[0].status,'cumplida');});
test('Sesión se revoca al desactivar usuario; login no revela existencia',async()=>{const f=await fixture();const {token}=await login(f.school,f.cashier.email,'ClaveDePrueba-MuyLarga-987');assert.equal((await getActor(token))?.id,f.cashier.id);await db.run('UPDATE ce_users SET active=0 WHERE id=?',[f.cashier.id]);assert.equal(await getActor(token),null);await assert.rejects(()=>login(f.school,'noexiste@example.test','incorrecta'),/incorrectos/);});
test('Sesiones vencidas y origen externo se rechazan',async()=>{const f=await fixture();const {token}=await login(f.school,f.cashier.email,'ClaveDePrueba-MuyLarga-987');await db.run('UPDATE ce_sessions SET expires_at=? WHERE token_hash=?',['2000-01-01T00:00:00.000Z',sha(token)]);assert.equal(await getActor(token),null);assert.throws(()=>checkOrigin(new Request('http://localhost:3000/api/payment',{headers:{origin:'https://malicioso.test'}})));});
test('El límite de intentos persiste cuando se bloquea',async()=>{const key=randomUUID();await rateLimit(key,2);await rateLimit(key,2);await assert.rejects(()=>rateLimit(key,2),/Demasiados/);await assert.rejects(()=>rateLimit(key,2),/Demasiados/);});
test('Importación atómica: errores revierten todas las filas',async()=>{const f=await fixture();const row={codigo_estudiante:'NUEVO',estudiante:'Nuevo',grado:'1 A',acudiente:'Padre',email:'',telefono:'',referencia:'IMPORT-01',concepto:'Mensualidad',vencimiento:today(),monto:'100.00',mora:'0.00'};await assert.rejects(()=>importRows(f.cashier,[row,{...row,referencia:'FAC-01'}]));assert.equal((await getData(f.cashier)).students.length,1);assert.equal(await importRows(f.cashier,[row]),1);const data=await getData(f.cashier);assert.equal(data.guardians.find(g=>g.name==='Padre')?.email_consent,0);});
test('Recordatorios tres días antes: deduplicación, consentimiento, saldo y no reintento ambiguo',async()=>{
 await db.run("UPDATE ce_outbox SET status='cancelado'");await db.run("UPDATE ce_promises SET status='cancelada' WHERE status='pendiente'");
 const f=await fixture();await mutate(f.followup,'promise',{invoice_id:f.invoice,amount:'200.00',due_date:plusDays(today(),3),notes:''});
 const before=new Date(`${plusDays(today(),-1)}T13:00:00Z`);await prepareReminders(before);assert.equal((await db.query('SELECT id FROM ce_outbox WHERE school_id=?',[f.school])).length,0);
 const now=new Date(today()+'T13:00:00Z');await prepareReminders(now);await prepareReminders(now);assert.equal((await db.query('SELECT id FROM ce_outbox WHERE school_id=?',[f.school])).length,2);
 process.env.SEND_ENABLED='false';let sent=0;await dispatchReminders(async()=>{sent++;return 'fake';},now);assert.equal(sent,0);
 await mutate(f.cashier,'consent',{guardian_id:f.g,email_consent:false,whatsapp_consent:true,consent_note:'Retiro de autorización para correo'});
 process.env.SEND_ENABLED='true';await dispatchReminders(async()=>{sent++;throw new Error('timeout');},now);assert.equal(sent,1);
 await dispatchReminders(async()=>{sent++;return 'fake';},now);assert.equal(sent,1);
 const states=await db.query<{status:string}>('SELECT status FROM ce_outbox WHERE school_id=?',[f.school]);assert.deepEqual(states.map(s=>s.status).sort(),['cancelado','requiere_revision']);
 const g=await fixture();await mutate(g.followup,'promise',{invoice_id:g.invoice,amount:'200.00',due_date:plusDays(today(),3),notes:''});await prepareReminders(now);await mutate(g.cashier,'payment',pay(g.invoice,'420.00'));await dispatchReminders(async()=>{sent++;return 'fake';},now);assert.equal(sent,1);process.env.SEND_ENABLED='false';
});
test('Cancelar conserva notas y permite sustituir la promesa sin afectar otro colegio',async()=>{
 const f=await fixture(),other=await fixture();const p=await mutate(f.followup,'promise',{invoice_id:f.invoice,amount:'100.00',due_date:plusDays(today(),3),notes:'Compromiso original acordado por teléfono.'}) as string;
 await assert.rejects(()=>mutate(other.followup,'cancel-promise',{promise_id:p,reason:'Intento ajeno'}),e=>e instanceof DomainError&&e.status===404);
 await mutate(f.followup,'cancel-promise',{promise_id:p,reason:'La familia solicita nueva fecha'});
 const promise=(await getData(f.cashier)).promises[0];assert.equal(promise.status,'cancelada');assert.match(promise.notes||'',/Compromiso original/);assert.match(promise.notes||'',/nueva fecha/);
 await assert.rejects(()=>mutate(f.followup,'cancel-promise',{promise_id:p,reason:'Duplicado'}));
 await mutate(f.followup,'promise',{invoice_id:f.invoice,amount:'200.00',due_date:plusDays(today(),5),notes:'Nueva promesa'});
 assert.equal((await getData(f.cashier)).promises.length,2);
});
test('Cron simultáneo no duplica envíos y usa solo el monto aún prometido',async()=>{
 await db.run("UPDATE ce_outbox SET status='cancelado'");await db.run("UPDATE ce_promises SET status='cancelada' WHERE status='pendiente'");
 const f=await fixture();await mutate(f.followup,'promise',{invoice_id:f.invoice,amount:'200.00',due_date:plusDays(today(),3),notes:''});await mutate(f.cashier,'payment',pay(f.invoice,'50.00'));
 const now=new Date(today()+'T13:00:00Z');await Promise.all([prepareReminders(now),prepareReminders(now)]);
 process.env.SEND_ENABLED='true';const sent:string[]=[];
 const send=async(d:{channel:string;amount:string})=>{sent.push(d.channel);assert.equal(d.amount,'B/. 150.00');return 'fake-'+d.channel;};
 await Promise.all([dispatchReminders(send,now),dispatchReminders(send,now)]);
 assert.deepEqual(sent.sort(),['email','whatsapp']);
 await dispatchReminders(send,now);assert.equal(sent.length,2);process.env.SEND_ENABLED='false';
});
test('Promesa cancelada antes del envío descarta los dos canales',async()=>{
 await db.run("UPDATE ce_outbox SET status='cancelado'");await db.run("UPDATE ce_promises SET status='cancelada' WHERE status='pendiente'");
 const f=await fixture(),p=await mutate(f.followup,'promise',{invoice_id:f.invoice,amount:'200.00',due_date:today(),notes:'Original'}) as string;
 const now=new Date(today()+'T13:00:00Z');await prepareReminders(now);await mutate(f.followup,'cancel-promise',{promise_id:p,reason:'Cambio de acuerdo'});
 process.env.SEND_ENABLED='true';let sent=0;await dispatchReminders(async()=>{sent++;return 'fake';},now);assert.equal(sent,0);
 assert.ok((await db.query<{status:string}>('SELECT status FROM ce_outbox WHERE school_id=?',[f.school])).every(r=>r.status==='cancelado'));process.env.SEND_ENABLED='false';
});
test('Reporte diario usa las 17:00 de Panamá y no se duplica',async()=>{
 const f=await fixture();await prepareReminders(new Date(today()+'T21:59:00.000Z'));
 assert.equal((await db.query('SELECT id FROM ce_outbox WHERE school_id=? AND user_id=?',[f.school,f.director.id])).length,0);
 await prepareReminders(new Date(today()+'T22:00:00.000Z'));await prepareReminders(new Date(today()+'T22:05:00.000Z'));
 const report=await db.query<{body:string}>('SELECT body FROM ce_outbox WHERE school_id=? AND user_id=?',[f.school,f.director.id]);assert.equal(report.length,1);assert.match(report[0].body,/420\.00/);assert.match(report[0].body,/\/reportes/);
});
test('Importación acepta 500 filas exactas y rechaza 501 sin cambios',async()=>{
 const f=await fixture();const rows=Array.from({length:500},(_,i)=>({codigo_estudiante:`IMPORT-${i}`,estudiante:`Alumno ${i}`,grado:'1 A',acudiente:`Familia ${i}`,email:'',telefono:'',referencia:`IMPORT-${i}`,concepto:'Mensualidad',vencimiento:today(),monto:'0.29',mora:'0.01'}));
 await assert.rejects(()=>importRows(f.cashier,[...rows,rows[0]]));assert.equal((await getData(f.cashier)).invoices.length,1);
 assert.equal(await importRows(f.cashier,rows),500);const data=await getData(f.cashier);assert.equal(data.students.length,501);assert.equal(data.invoices.reduce((n,i)=>n+i.amount_cents+i.late_fee_cents,0),42000+15000);
});
async function workbook(formula=false) {const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Importar');sheet.addRow([...columns]);sheet.addRow(['A1','Estudiante','1 A','Acudiente','familia@example.test','+50761234567','REF-01','Mensualidad',today(),'100.00','0.00']);if(formula)sheet.getCell('J2').value={formula:'1+1',result:2};return Buffer.from(await book.xlsx.writeBuffer());}
test('Excel válido se importa y se rechazan fórmulas, ZIP inválido y tamaños falseados',async()=>{
 const bytes=await workbook();assert.equal((await parseWorkbook(bytes))[0].monto,'100.00');
 await assert.rejects(()=>parseWorkbook(awaitableInvalid()),/XLSX/);
 await assert.rejects(()=>parseWorkbook(Buffer.alloc(2097153)),/2 MB/);
 await assert.rejects(async()=>parseWorkbook(await workbook(true)),/fórmulas/);
 const forged=Buffer.from(bytes);let changed=false;
 for(let i=0;i<forged.length-46;i++)if(forged.readUInt32LE(i)===0x02014b50&&forged.readUInt32LE(i+24)>10){forged.writeUInt32LE(1,i+24);changed=true;break;}
 assert.ok(changed);await assert.rejects(()=>parseWorkbook(forged),/Tamaño o compresión/);
});
function awaitableInvalid(){return Buffer.from('archivo inválido');}
test('Límite del cuerpo HTTP se mantiene sin Content-Length',async()=>{
 const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(8));controller.enqueue(new Uint8Array(8));controller.close();}});
 const request=new Request('http://localhost',{method:'POST',body,duplex:'half'} as RequestInit);
 await assert.rejects(()=>boundedBody(request,10),e=>e instanceof DomainError&&e.status===413);
});
test('Reportes distinguen usuarios homónimos y respetan el día de Panamá',()=>{
 const calls=[{created_by:'a',author:'María',created_at:'2026-10-05T02:00:00Z',outcome:'Contestó'},{created_by:'b',author:'María',created_at:'2026-10-04T13:00:00Z',outcome:'No contestó'},{created_by:'a',author:'María',created_at:'2026-10-05T05:00:00Z',outcome:'Contestó'}];
 const report=staffActivity(calls,'2026-10-04');assert.equal(report.length,2);assert.deepEqual(report.map(p=>[p.id,p.calls,p.contacts,p.unanswered]),[['a',1,1,0],['b',1,0,1]]);
});
