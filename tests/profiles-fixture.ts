// Isolated, synthetic browser fixture. Never uses application .env files or Neon.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
process.env.DATABASE_URL='';process.env.SQLITE_PATH=resolve('data/profiles-qa.sqlite');process.env.SEND_ENABLED='false';
const {db,closeDB}=await import('../src/lib/db');
const {migrate}=await import('../src/lib/schema');
const {passwordHash}=await import('../src/lib/security');
const {mutate}=await import('../src/lib/collections');
const {getProfile}=await import('../src/lib/profiles');
import type {Actor} from '../src/lib/types';
await migrate();
const prior=await db.query("SELECT id FROM ce_schools WHERE slug='pruebas-locales'");
if(!prior.length){
 const school=randomUUID(),stamp=new Date().toISOString();await db.run('INSERT INTO ce_schools VALUES (?,?,?,?)',[school,'Colegio de pruebas locales','pruebas-locales',stamp]);
 const a:Actor={id:randomUUID(),school_id:school,name:'Seguimiento de prueba',email:'seguimiento@prueba.invalid',role:'seguimiento',school_name:'Colegio de pruebas locales'};
 await db.run('INSERT INTO ce_users(id,school_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)',[a.id,school,a.name,a.email,await passwordHash('Prueba-Local-Perfil-2026!'),a.role,stamp]);
 const g=await mutate(a,'guardian',{name:'Familia de prueba Rivera',email:'familia@example.test',phone:'+50761234567',email_consent:false,whatsapp_consent:false,consent_note:''}) as string;
 for(const [code,name,grade] of [['PR-001','Estudiante de prueba A','5°'],['PR-002','Estudiante de prueba B','2°']])await mutate(a,'student',{guardian_id:g,code,name,grade});
 const d=(await getProfile(a,'guardian',g))!;
 await mutate(a,'guardian-update',{id:g,version:d.profile.version,name:d.profile.name,reason:'Configuración inicial de prueba local',contacts:d.profile.contacts!.map(c=>({id:c.id,name:'Madre de prueba',relationship:'madre',email:c.email||'',phone:c.phone||'',email_consent:false,whatsapp_consent:false,is_primary:true,consent_note:''}))});
}
const [schoolRow]=await db.query<{id:string}>("SELECT id FROM ce_schools WHERE slug='pruebas-locales'");
for(const role of ['cobranza','directora'])if(!(await db.query('SELECT id FROM ce_users WHERE school_id=? AND role=?',[schoolRow.id,role])).length)
 await db.run('INSERT INTO ce_users(id,school_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)',[randomUUID(),schoolRow.id,role+' de prueba',role+'@prueba.invalid',await passwordHash('Prueba-Local-Perfil-2026!'),role,new Date().toISOString()]);
await closeDB();console.log('Demo local aislada preparada. No se enviaron mensajes.');
