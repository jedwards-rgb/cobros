import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.SQLITE_PATH=':memory:';delete process.env.DATABASE_URL;
const {db,closeDB}=await import('../src/lib/db');
const {migrate}=await import('../src/lib/schema');
const {mutate}=await import('../src/lib/collections');
const {getProfile,listProfiles}=await import('../src/lib/profiles');
const {today}=await import('../src/lib/domain');
const {prepareReminders,dispatchReminders}=await import('../src/lib/reminders');
const {importRows}=await import('../src/lib/imports');
import type {Actor,Contact,Role} from '../src/lib/types';

// Upgrade an actual old table, containing a family, rather than only a fresh DB.
const legacySchool=randomUUID(),legacyGuardian=randomUUID(),stamp=new Date().toISOString();
await db.run('CREATE TABLE ce_schools(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL)');
await db.run('CREATE TABLE ce_guardians(id TEXT PRIMARY KEY,school_id TEXT NOT NULL REFERENCES ce_schools(id),name TEXT NOT NULL,email TEXT,phone TEXT,email_consent INTEGER NOT NULL DEFAULT 0,whatsapp_consent INTEGER NOT NULL DEFAULT 0,consent_note TEXT,created_at TEXT NOT NULL,UNIQUE(school_id,id))');
await db.run('INSERT INTO ce_schools VALUES (?,?,?,?)',[legacySchool,'Antes','antes',stamp]);
await db.run('INSERT INTO ce_guardians VALUES (?,?,?,?,?,?,?,?,?)',[legacyGuardian,legacySchool,'Familia anterior','anterior@example.test','+50761234567',1,0,'Autorización existente',stamp]);
await migrate();after(closeDB);
async function fixture(){
 const school=randomUUID();await db.run('INSERT INTO ce_schools VALUES (?,?,?,?)',[school,'Colegio',school,stamp]);
 const actors={} as Record<Role,Actor>;
 for(const role of ['cobranza','seguimiento','directora'] as const){const a:Actor={id:randomUUID(),school_id:school,name:role,email:`${role}@example.test`,role,school_name:'Colegio'};actors[role]=a;await db.run('INSERT INTO ce_users(id,school_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)',[a.id,school,a.name,a.email,'unused-test-hash',role,stamp]);}
 const g=await mutate(actors.cobranza,'guardian',{name:'Familia de prueba',email:'familia@example.test',phone:'+50761234567',email_consent:true,whatsapp_consent:true,consent_note:'Consentimiento inicial de prueba'}) as string;
 const s=await mutate(actors.seguimiento,'student',{guardian_id:g,name:'Estudiante',code:'EST-01',grade:'1'}) as string;
 return {school,...actors,g,s};
}
const contact=(c:Contact)=>({id:c.id,name:c.name,relationship:c.relationship,email:c.email||'',phone:c.phone||'',is_primary:!!c.is_primary,email_consent:!!c.email_consent,whatsapp_consent:!!c.whatsapp_consent,consent_note:c.consent_note||''});
async function edit(a:Actor,g:string){const d=(await getProfile(a,'guardian',g))!;return {id:g,name:d.profile.name,version:d.profile.version,reason:'Datos confirmados por la familia',contacts:d.profile.contacts!.map(contact)};}
async function operation(a:Actor,entity:'guardian'|'student',id:string){const d=(await getProfile(a,entity,id))!;return {entity,id,version:d.profile.version,mode:d.plan.mode,reason:'La familia solicitó el cambio'};}
const invoice=(s:string)=>({student_id:s,reference:randomUUID(),concept:'Mensualidad',amount:'100.00',late_fee:'0.00',due_date:today()});

test('Migración desde esquema anterior conserva familia/contacto/consentimiento y es idempotente',async()=>{
 const rows=await db.query<Contact>('SELECT * FROM ce_guardian_contacts WHERE guardian_id=?',[legacyGuardian]);assert.equal(rows.length,1);assert.equal(rows[0].is_primary,1);assert.equal(rows[0].email_consent,1);assert.equal(rows[0].whatsapp_consent,0);assert.equal(rows[0].relationship,'otro');
 await db.run('UPDATE ce_guardians SET version=7 WHERE id=?',[legacyGuardian]);await migrate();assert.equal((await db.query('SELECT version FROM ce_guardians WHERE id=?',[legacyGuardian]))[0].version,7);assert.equal((await db.query('SELECT id FROM ce_guardian_contacts WHERE guardian_id=?',[legacyGuardian])).length,1);
});
test('Cobranza y seguimiento editan contactos; dirección conserva consulta; no cambian permisos financieros',async()=>{
 const f=await fixture();for(const actor of [f.cobranza,f.seguimiento]){const v=await edit(actor,f.g);await mutate(actor,'guardian-update',{...v,name:actor.name});}
 const v=await edit(f.directora,f.g);await assert.rejects(()=>mutate(f.directora,'guardian-update',v),{status:403});await assert.rejects(()=>mutate(f.seguimiento,'invoice',invoice(f.s)),{status:403});
 const d=(await getProfile(f.cobranza,'guardian',f.g))!;assert.equal(d.profile.name,'seguimiento');assert.ok(d.history.some(h=>h.author==='seguimiento'&&h.before_json?.includes('cobranza')));
});
test('Aislamiento de colegios en lectura, búsqueda, edición, eliminación y contactos ajenos',async()=>{
 const a=await fixture(),b=await fixture();assert.equal(await getProfile(a.cobranza,'guardian',b.g),null);assert.ok(!(await listProfiles(a.cobranza,'guardian','',false,1)).rows.some(r=>r.id===b.g));
 await assert.rejects(()=>mutate(a.cobranza,'guardian-update',awaitableEditPlaceholder(b.g)),{status:404});
 await assert.rejects(()=>mutate(a.seguimiento,'profile-remove',{entity:'guardian',id:b.g,version:2,mode:'delete',reason:'Intento desde otro colegio'}),{status:404});
 const av=await edit(a.cobranza,a.g),bv=await edit(b.cobranza,b.g);await assert.rejects(()=>mutate(a.cobranza,'guardian-update',{...av,contacts:bv.contacts}),{status:404});
 await assert.rejects(()=>db.run('INSERT INTO ce_guardian_contacts(id,school_id,guardian_id,name,relationship,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[randomUUID(),a.school,b.g,'Intruso','otro',stamp,stamp]));
});
function awaitableEditPlaceholder(id:string){return {id,version:2,name:'Intruso',reason:'Prueba de aislamiento',contacts:[{name:'Intruso',relationship:'otro',email:'',phone:'',is_primary:true,email_consent:false,whatsapp_consent:false,consent_note:''}]};}
test('Ediciones simultáneas: solo una gana y un borrado con versión antigua se rechaza',async()=>{
 const f=await fixture(),v=await edit(f.cobranza,f.g),remove=await operation(f.cobranza,'guardian',f.g);
 const results=await Promise.allSettled([mutate(f.cobranza,'guardian-update',{...v,name:'Uno'}),mutate(f.seguimiento,'guardian-update',{...v,name:'Dos'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.status,409);
 await assert.rejects(()=>mutate(f.cobranza,'profile-remove',remove),{status:409});
});
test('Contacto principal único, límites y autorización ligada a persona/destino',async()=>{
 const f=await fixture(),v=await edit(f.cobranza,f.g);
 await assert.rejects(()=>mutate(f.cobranza,'guardian-update',{...v,contacts:v.contacts.map(c=>({...c,is_primary:false}))}));
 await assert.rejects(()=>mutate(f.cobranza,'guardian-update',{...v,contacts:[...v.contacts,{...v.contacts[0],id:undefined}]}));
 await assert.rejects(()=>mutate(f.cobranza,'guardian-update',{...v,contacts:v.contacts.map(c=>({...c,email:'nueva@example.test'}))}),/nueva evidencia/);
 await mutate(f.seguimiento,'guardian-update',{...v,contacts:v.contacts.map(c=>({...c,email:'nueva@example.test',email_consent:false}))});
 const d=(await getProfile(f.cobranza,'guardian',f.g))!;assert.equal(d.profile.email_consent,0);assert.equal(d.profile.whatsapp_consent,1);assert.equal(d.profile.email,'nueva@example.test');
});
test('Dos hermanos comparten una ficha y nuevas importaciones conservan sus contactos',async()=>{
 const f=await fixture(),s=await mutate(f.seguimiento,'student',{guardian_id:f.g,name:'Hermana',code:'EST-02',grade:'2'});assert.ok(s);
 await importRows(f.cobranza,[{codigo_estudiante:'EST-03',estudiante:'Hermano',grado:'3',acudiente:'Familia de prueba',email:'familia@example.test',telefono:'+50761234567',referencia:'IMP-03',concepto:'Mensualidad',vencimiento:today(),monto:'100.00',mora:'0.00'}]);
 const d=(await getProfile(f.cobranza,'guardian',f.g))!;assert.equal(d.plan.students.length,3);assert.equal(d.profile.contacts!.length,1);assert.equal((await listProfiles(f.cobranza,'guardian','',false,1)).total,1);
});
test('Sin movimientos: borra familia, contactos e hijos atómicamente y conserva auditoría',async()=>{
 const f=await fixture();await mutate(f.seguimiento,'profile-remove',await operation(f.seguimiento,'guardian',f.g));assert.equal(await getProfile(f.cobranza,'guardian',f.g),null);assert.equal(await getProfile(f.cobranza,'student',f.s),null);assert.equal((await db.query('SELECT id FROM ce_guardian_contacts WHERE school_id=?',[f.school])).length,0);
 assert.equal((await db.query("SELECT id FROM ce_profile_history WHERE school_id=? AND action LIKE '%eliminad%'",[f.school])).length,2);
});
test('Con deuda, pago, promesa y llamada: archiva sin perder importes ni registros; aún permite recibir pagos',async()=>{
 const f=await fixture(),i=await mutate(f.cobranza,'invoice',invoice(f.s)) as string;
 await mutate(f.seguimiento,'promise',{invoice_id:i,amount:'50.00',due_date:today(),notes:'Conservar'});
 await mutate(f.seguimiento,'call',{guardian_id:f.g,outcome:'Contestó',notes:'Conservar llamada',next_contact:''});
 await mutate(f.cobranza,'payment',{invoice_id:i,amount:'20.00',request_key:randomUUID(),reference:'AB-01',method:'Efectivo',paid_on:today()});
 const op=await operation(f.seguimiento,'guardian',f.g);assert.equal(op.mode,'archive');await mutate(f.seguimiento,'profile-remove',op);
 assert.ok((await getProfile(f.cobranza,'student',f.s))!.profile.archived_at);for(const table of ['ce_invoices','ce_payments','ce_promises','ce_calls'])assert.equal((await db.query(`SELECT id FROM ${table} WHERE school_id=?`,[f.school])).length,1);
 await assert.rejects(()=>mutate(f.cobranza,'invoice',invoice(f.s)),/archivada/);await assert.rejects(()=>mutate(f.seguimiento,'student',{guardian_id:f.g,name:'Otro',code:'EST-09',grade:'9'}),/archivada/);
 await mutate(f.cobranza,'payment',{invoice_id:i,amount:'10.00',request_key:randomUUID(),reference:'AB-02',method:'Efectivo',paid_on:today()});assert.equal((await db.query('SELECT paid_cents FROM ce_invoices WHERE id=?',[i]))[0].paid_cents,3000);
 await assert.rejects(()=>mutate(f.seguimiento,'profile-restore',awaitableRestore(f.s)),/acudiente|archivada/i);
 await mutate(f.seguimiento,'profile-restore',await operation(f.seguimiento,'guardian',f.g));assert.ok((await getProfile(f.seguimiento,'student',f.s))!.profile.archived_at);
 await mutate(f.seguimiento,'profile-restore',await operation(f.seguimiento,'student',f.s));assert.equal((await getProfile(f.seguimiento,'student',f.s))!.profile.archived_at,null);
});
function awaitableRestore(id:string){return {id,entity:'student',version:2,reason:'Reactivar estudiante de prueba'};}
test('Una deuda agregada después de la vista previa impide el borrado definitivo',async()=>{
 const f=await fixture(),op=await operation(f.cobranza,'student',f.s);await mutate(f.cobranza,'invoice',invoice(f.s));await assert.rejects(()=>mutate(f.seguimiento,'profile-remove',op),{status:409});assert.ok(await getProfile(f.cobranza,'student',f.s));
});
test('Edición del estudiante mantiene movimientos y no transfiere deuda a otra familia',async()=>{
 const f=await fixture();await mutate(f.cobranza,'invoice',invoice(f.s));const other=await mutate(f.seguimiento,'guardian',{name:'Otra familia',email:'',phone:'',email_consent:false,whatsapp_consent:false,consent_note:''}) as string;
 const v={id:f.s,version:1,reason:'Corregir grado y ortografía',name:'Estudiante corregido',code:'EST-01',grade:'2',guardian_id:f.g};await assert.rejects(()=>mutate(f.seguimiento,'student-update',{...v,guardian_id:other}),/movimientos/);await mutate(f.seguimiento,'student-update',v);assert.equal((await getProfile(f.cobranza,'student',f.s))!.profile.grade,'2');
});
test('Recordatorios usan solo el principal, respetan su consentimiento actual y descartan archivados',async()=>{
 await db.run("UPDATE ce_promises SET status='cancelada'");await db.run("UPDATE ce_outbox SET status='cancelado'");
 const f=await fixture(),i=await mutate(f.cobranza,'invoice',invoice(f.s)) as string;await mutate(f.seguimiento,'promise',{invoice_id:i,amount:'50.00',due_date:today(),notes:''});
 const v=await edit(f.cobranza,f.g);await mutate(f.cobranza,'guardian-update',{...v,contacts:[{...v.contacts[0],is_primary:false},{name:'Madre principal',relationship:'madre',email:'principal@example.test',phone:'+50762345678',is_primary:true,email_consent:true,whatsapp_consent:false,consent_note:'Autorización exclusiva de correo'}]});
 const now=new Date(today()+'T13:00:00Z');await prepareReminders(now);process.env.SEND_ENABLED='true';const deliveries:string[]=[];await dispatchReminders(async d=>{deliveries.push(d.to);return 'mock';},now);assert.deepEqual(deliveries,['principal@example.test']);
 const b=await fixture(),bi=await mutate(b.cobranza,'invoice',invoice(b.s)) as string;await mutate(b.seguimiento,'promise',{invoice_id:bi,amount:'50.00',due_date:today(),notes:''});await prepareReminders(now);await mutate(b.cobranza,'profile-remove',await operation(b.cobranza,'student',b.s));await dispatchReminders(async d=>{deliveries.push(d.to);return 'mock';},now);assert.deepEqual(deliveries,['principal@example.test']);process.env.SEND_ENABLED='false';
});
test('Búsqueda y paginación separan activos/archivados y tratan comodines como texto',async()=>{
 const f=await fixture();assert.equal((await listProfiles(f.cobranza,'guardian','%',false,1)).total,0);await mutate(f.cobranza,'invoice',invoice(f.s));await mutate(f.cobranza,'profile-remove',await operation(f.cobranza,'guardian',f.g));assert.equal((await listProfiles(f.cobranza,'guardian','',false,1)).total,0);assert.equal((await listProfiles(f.cobranza,'guardian','',true,1)).total,1);
});
test('Eliminar un estudiante sin movimientos conserva al acudiente y su hermano',async()=>{
 const f=await fixture(),brother=await mutate(f.seguimiento,'student',{guardian_id:f.g,name:'Hermano',code:'EST-02',grade:'2'}) as string;
 await mutate(f.cobranza,'profile-remove',await operation(f.cobranza,'student',f.s));assert.equal(await getProfile(f.cobranza,'student',f.s),null);assert.ok(await getProfile(f.cobranza,'student',brother));assert.equal((await getProfile(f.cobranza,'guardian',f.g))!.plan.students.length,1);
});
test('Una factura totalmente pagada o una llamada impiden borrar la familia',async()=>{
 const f=await fixture(),i=await mutate(f.cobranza,'invoice',invoice(f.s)) as string;
 await mutate(f.cobranza,'payment',{invoice_id:i,amount:'100.00',request_key:randomUUID(),reference:'PAGADO',method:'Efectivo',paid_on:today()});assert.equal((await operation(f.cobranza,'guardian',f.g)).mode,'archive');
 const other=await fixture();await mutate(other.seguimiento,'call',{guardian_id:other.g,outcome:'No contestó',notes:'Conservar trazabilidad',next_contact:''});assert.equal((await operation(other.seguimiento,'guardian',other.g)).mode,'archive');
});
test('Reasociar estudiante sin movimientos dentro del colegio deja historial en ambas familias',async()=>{
 const f=await fixture(),other=await mutate(f.seguimiento,'guardian',{name:'Responsable confirmado',email:'',phone:'',email_consent:false,whatsapp_consent:false,consent_note:''}) as string;
 await mutate(f.seguimiento,'student-update',{id:f.s,version:1,name:'Estudiante',grade:'1',code:'EST-01',guardian_id:other,reason:'Corregir asociación inicial sin movimientos'});
 assert.equal((await getProfile(f.cobranza,'guardian',other))!.plan.students.length,1);assert.equal((await getProfile(f.cobranza,'guardian',f.g))!.plan.students.length,0);
 assert.ok((await getProfile(f.cobranza,'guardian',f.g))!.history.some(h=>h.action==='Asociación de estudiante actualizada'));
});
test('Endpoint de consentimiento exige versión actual y rechaza formularios desactualizados',async()=>{
 const f=await fixture(),v=await edit(f.cobranza,f.g);await mutate(f.seguimiento,'guardian-update',{...v,name:'Nombre confirmado'});
 await assert.rejects(()=>mutate(f.cobranza,'consent',{guardian_id:f.g,version:v.version,email_consent:false,whatsapp_consent:false,consent_note:'Formulario anterior a la edición'}),{status:409});
 assert.equal((await getProfile(f.cobranza,'guardian',f.g))!.profile.email_consent,1);
});
test('Importar con un contacto adicional reconoce la familia aunque haya cambiado el principal',async()=>{
 const f=await fixture(),v=await edit(f.cobranza,f.g);
 await mutate(f.cobranza,'guardian-update',{...v,contacts:[{...v.contacts[0],is_primary:false},{name:'Otro responsable',relationship:'otro',email:'principal@example.test',phone:'',is_primary:true,email_consent:false,whatsapp_consent:false,consent_note:''}]});
 const row={codigo_estudiante:'EST-02',estudiante:'Hermano nuevo',grado:'2',acudiente:'Familia de prueba',email:'familia@example.test',telefono:'+50761234567',referencia:'NUEVO-02',concepto:'Mensualidad',vencimiento:today(),monto:'50.00',mora:'0.00'};
 await importRows(f.cobranza,[row,{...row,codigo_estudiante:'EST-01',estudiante:'Estudiante',grado:'1',referencia:'EXISTENTE-01'}]);
 const d=(await getProfile(f.cobranza,'guardian',f.g))!;assert.equal(d.plan.students.length,2);assert.equal(d.profile.contacts!.length,2);assert.equal(d.profile.email,'principal@example.test');assert.equal((await listProfiles(f.cobranza,'guardian','',false,1)).total,1);
});
