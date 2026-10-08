import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const base=process.env.PROFILES_TEST_URL||'http://localhost:3106';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Solo admite una prueba local.');
const database=new DatabaseSync('data/profiles-qa.sqlite',{readOnly:true});
const school=database.prepare("SELECT id FROM ce_schools WHERE slug='pruebas-locales'").get();
const g=database.prepare('SELECT id FROM ce_guardians WHERE school_id=? LIMIT 1').get(school.id);
const st=database.prepare('SELECT id FROM ce_students WHERE school_id=? LIMIT 1').get(school.id);
let checks=0;function equal(actual,expected){assert.equal(actual,expected);checks++;}
equal((await fetch(base+'/api/profile-guardians')).status,401);
for(const role of ['seguimiento','cobranza','directora']){
 const login=await fetch(base+'/api/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({school:'pruebas-locales',email:role+'@prueba.invalid',password:'Prueba-Local-Perfil-2026!'})});equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];const session=database.prepare('SELECT csrf FROM ce_sessions WHERE token_hash=?').get(createHash('sha256').update(cookie.split('=')[1]).digest('hex'));
 for(const path of ['/acudientes','/estudiantes',`/acudientes/${g.id}`,`/estudiantes/${st.id}`]){
  const response=await fetch(base+path,{headers:{cookie}});equal(response.status,200);const html=await response.text();assert.ok(!html.includes('Only plain objects')&&!html.includes('Application error:'));checks++;
  if(path.includes(g.id)||path.includes(st.id))equal(html.includes('>Editar</button>'),role!=='directora');
 }
 const lookup=await fetch(base+'/api/profile-guardians?q=Rivera',{headers:{cookie}});equal(lookup.status,200);assert.match(lookup.headers.get('cache-control'),/no-store/);checks++;
 for(const action of ['guardian-update','student-update','profile-remove','profile-restore']){
  const blocked=await fetch(base+'/api/'+action,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:'{}'});equal(blocked.status,403);
 }
 const headers={cookie,origin:base,'content-type':'application/json','x-csrf-token':session.csrf};
 equal((await fetch(base+'/api/guardian-update',{method:'POST',headers:{...headers,origin:'https://malicioso.invalid'},body:'{}'})).status,403);
 if(role==='directora')equal((await fetch(base+'/api/guardian-update',{method:'POST',headers,body:'{}'})).status,403);
 else {
  const current=database.prepare('SELECT * FROM ce_guardians WHERE school_id=? AND id=?').get(school.id,g.id);
  const contacts=database.prepare('SELECT * FROM ce_guardian_contacts WHERE school_id=? AND guardian_id=?').all(school.id,g.id).map(c=>({id:c.id,name:c.name,relationship:c.relationship,email:c.email||'',phone:c.phone||'',is_primary:!!c.is_primary,email_consent:!!c.email_consent,whatsapp_consent:!!c.whatsapp_consent,consent_note:c.consent_note||''}));
  const body={id:g.id,version:current.version,name:current.name,reason:'Validación HTTP local de permisos',contacts};
  equal((await fetch(base+'/api/guardian-update',{method:'POST',headers,body:JSON.stringify(body)})).status,200);
  equal((await fetch(base+'/api/guardian-update',{method:'POST',headers,body:JSON.stringify(body)})).status,409);
  equal((await fetch(base+'/api/guardian-update',{method:'POST',headers,body:JSON.stringify({...body,school_id:'intruso'})})).status,400);
 }
 equal((await fetch(base+'/api/logout',{method:'POST',headers,body:'{}'})).status,200);
 equal((await fetch(base+'/api/profile-guardians',{headers:{cookie}})).status,401);
}
database.close();console.log(`${checks} verificaciones HTTP aprobadas: fichas, roles, sesión, CSRF, origen, versión y rechazo de colegio enviado por el cliente.`);
