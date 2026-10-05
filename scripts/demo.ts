import './env';
import { randomUUID,randomBytes } from 'node:crypto';
import { db,closeDB } from '../src/lib/db';
import { migrate } from '../src/lib/schema';
import { passwordHash } from '../src/lib/security';
import { mutate } from '../src/lib/collections';
import { today,plusDays } from '../src/lib/domain';
import { prepareReminders } from '../src/lib/reminders';
import type { Actor,Role } from '../src/lib/types';
if(process.env.NODE_ENV==='production'||process.env.DATABASE_URL)throw new Error('La demo solo se crea en SQLite local, sin datos de producción.');
await migrate();if((await db.query("SELECT id FROM ce_schools WHERE slug='jover'")).length)throw new Error('La demo ya existe. No se sobrescribieron datos.');
const school=randomUUID(),timestamp=new Date().toISOString(),password=randomBytes(18).toString('base64url'),encoded=await passwordHash(password);
await db.run('INSERT INTO ce_schools(id,name,slug,created_at) VALUES (?,?,?,?)',[school,'Jover Academy','jover',timestamp]);
const actors={} as Record<Role,Actor>;
for(const [role,name] of [['cobranza','Ana Martínez'],['seguimiento','María González'],['directora','Isabel Rodríguez']] as const) {
 const actor:Actor={id:randomUUID(),school_id:school,name,email:`${role}@jover.example`,role,school_name:'Jover Academy'};actors[role]=actor;
 await db.run('INSERT INTO ce_users(id,school_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)',[actor.id,school,name,actor.email,encoded,role,timestamp]);
}
const names=[['Carlos López','Daniel López','10° A'],['María Pérez','Ana Pérez','8° B'],['José Díaz','Andrés Díaz','11° A'],['Laura Gómez','Sofía Gómez','6° A'],['Ana Torres','Mateo Torres','9° A'],['Luis Castillo','Valentina Castillo','7° B'],['Carmen Ruiz','Diego Ruiz','12° A'],['Roberto Mora','Lucía Mora','5° A'],['Patricia Vega','Samuel Vega','10° B'],['David Ríos','Emma Ríos','4° A']];
const due=[-95,-38,-72,-12,3,-28,-65,5,-19,-8];
for(let i=0;i<names.length;i++) {
 const [guardian,student,grade]=names[i];
 const guardianId=await mutate(actors.cobranza,'guardian',{name:guardian,email:`familia${i+1}@example.invalid`,phone:`+50760000${String(i).padStart(3,'0')}`,email_consent:false,whatsapp_consent:false,consent_note:''}) as string;
 const studentId=await mutate(actors.cobranza,'student',{guardian_id:guardianId,code:`JA-${String(i+1).padStart(3,'0')}`,name:student,grade}) as string;
 const invoiceId=await mutate(actors.cobranza,'invoice',{student_id:studentId,reference:`MEN-${String(i+1).padStart(4,'0')}`,concept:'Mensualidad escolar',due_date:plusDays(today(),due[i]),amount:['800.00','450.00','700.00','400.00','350.00'][i%5],late_fee:due[i]<-30?'25.00':'0.00'}) as string;
 if(i!==4&&i!==7)await mutate(actors.seguimiento,'call',{guardian_id:guardianId,outcome:i%2?'Contestó':'No contestó',notes:'Registro ficticio para probar el flujo de seguimiento.',next_contact:today()});
 if([0,1,5].includes(i))await mutate(actors.seguimiento,'promise',{invoice_id:invoiceId,amount:'300.00',due_date:plusDays(today(),i===0?3:1),notes:'Compromiso de demostración.'});
 if(i===1||i===2||i===3)await mutate(actors.cobranza,'payment',{invoice_id:invoiceId,request_key:randomUUID(),reference:`REC-DEMO-${i}`,amount:i===3?'400.00':'100.00',method:'Transferencia',paid_on:today()});
}
await prepareReminders();
console.log(`DEMO LOCAL · Datos ficticios · Envíos desactivados\nColegio: jover\nUsuarios: cobranza@jover.example / seguimiento@jover.example / directora@jover.example\nContraseña aleatoria compartida solo para esta demo: ${password}`);
await closeDB();
