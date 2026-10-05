import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const base=process.env.TEST_APP_URL||'http://localhost:3100';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Esta prueba solo admite una demo local.');
if(!process.env.DEMO_PASSWORD)throw new Error('Define DEMO_PASSWORD con la clave generada de la demo.');
const database=new DatabaseSync('data/cobroedu.sqlite');
const checks=[];
const ok=(name)=>{checks.push(name);console.log('OK '+name);};
assert.equal((await fetch(base+'/api/export')).status,401);ok('Exportación protegida sin sesión');
assert.equal((await fetch(base+'/api/cron',{method:'POST'})).status,401);ok('Cron protegido sin secreto');
for(const role of ['cobranza','seguimiento','directora']) {
 const response=await fetch(base+'/api/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({school:'jover',email:role+'@jover.example',password:process.env.DEMO_PASSWORD})});
 assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly/i);const token=cookie.split('=')[1];const tokenHash=createHash('sha256').update(token).digest('hex');const session=database.prepare('SELECT csrf FROM ce_sessions WHERE token_hash=?').get(tokenHash);
 for(const page of ['','cobros','acudientes','estudiantes','pagos','promesas','llamadas','recordatorios','reportes']) {
  const pageResponse=await fetch(`${base}/${page}`,{headers:{cookie}});assert.equal(pageResponse.status,200);assert.match(pageResponse.headers.get('content-security-policy'),/nonce-/);assert.match(pageResponse.headers.get('cache-control'),/no-store/);const html=await pageResponse.text();assert.ok(!html.includes('Application error:'));
 }
 const noCsrf=await fetch(base+'/api/guardian',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:'{}'});assert.equal(noCsrf.status,403);
 const foreign=await fetch(base+'/api/guardian',{method:'POST',headers:{cookie,origin:'https://attacker.invalid','content-type':'application/json','x-csrf-token':session.csrf},body:'{}'});assert.equal(foreign.status,403);
 if(role!=='cobranza') {const denied=await fetch(base+'/api/payment',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json','x-csrf-token':session.csrf},body:'{}'});assert.equal(denied.status,403);}
 if(role==='cobranza') {
  const template=await fetch(base+'/api/export?template=true',{headers:{cookie}});assert.equal(template.status,200);const bytes=await template.arrayBuffer();assert.ok(bytes.byteLength>1000);
  const form=new FormData();form.append('file',new Blob([bytes]),'plantilla.xlsx');
  const preview=await fetch(base+'/api/import',{method:'POST',headers:{cookie,origin:base,'x-csrf-token':session.csrf},body:form});assert.equal(preview.status,200);const body=await preview.json();assert.equal(body.rows.length,1);assert.equal(body.rows[0].monto,'400.00');
  ok('Plantilla XLSX exportada y validada por importación de vista previa');
 }
 const csv=await fetch(base+'/api/export?format=csv',{headers:{cookie}});assert.equal(csv.status,200);assert.match(await csv.text(),/Referencia/);
 const logout=await fetch(base+'/api/logout',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json','x-csrf-token':session.csrf},body:'{}'});assert.equal(logout.status,200);assert.equal((await fetch(base+'/api/export',{headers:{cookie}})).status,401);
 ok(`Perfil ${role}: nueve páginas, CSP, CSRF, origen, CSV y revocación de sesión`);
}
database.close();console.log(JSON.stringify({checks,completed:new Date().toISOString()},null,2));

