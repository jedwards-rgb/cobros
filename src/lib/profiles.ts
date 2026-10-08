import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db,transaction,type DB } from './db';
import { allow,DomainError,id,text } from './domain';
import type { Actor,Guardian,Student,Contact,ProfileChange } from './types';

export const contactSchema=z.object({
 id:id.optional(),name:text,relationship:z.enum(['madre','padre','otro']),
 email:z.union([z.email().max(180),z.literal('')]).transform(s=>s.toLowerCase()),
 phone:z.union([z.string().regex(/^\+[1-9]\d{7,14}$/,'Usa teléfono internacional, por ejemplo +50761234567.'),z.literal('')]),
 is_primary:z.boolean(),email_consent:z.boolean(),whatsapp_consent:z.boolean(),
 consent_note:z.string().trim().max(500),
}).strict().refine(c=>(!c.email_consent||!!c.email)&&(!c.whatsapp_consent||!!c.phone)&&(!(c.email_consent||c.whatsapp_consent)||c.consent_note.length>=5),'Registra el contacto y la evidencia de autorización de sus canales.');
const base={id,version:z.number().int().positive(),reason:z.string().trim().min(5,'Explica el motivo del cambio (mínimo 5 caracteres).').max(500)};
const guardianEdit=z.object({...base,name:text,contacts:z.array(contactSchema).min(1).max(10)}).strict().refine(v=>v.contacts.filter(c=>c.is_primary).length===1,'Selecciona exactamente un contacto principal.');
const studentEdit=z.object({...base,code:text.max(40),name:text,grade:text.max(60),guardian_id:id}).strict();
type Entity='guardian'|'student';
const tables={guardian:'ce_guardians',student:'ce_students'} as const;
export const canEditProfiles=(actor:Actor)=>['cobranza','seguimiento'].includes(actor.role);

// All profile/import/collection writers lock the tenant first. This prevents races
// between adding a child or debt and deleting/archiving its family, across instances.
export async function lockSchool(tx:DB,school:string) {
 if(!await tx.run('UPDATE ce_schools SET name=name WHERE id=?',[school]))throw new DomainError('Colegio no encontrado.',404);
}
export function schoolTransaction<T>(actor:Actor,fn:(tx:DB)=>Promise<T>) {
 return transaction(async tx=>{await lockSchool(tx,actor.school_id);return fn(tx);});
}
export async function activeRecord(tx:DB,school:string,entity:Entity,record:string) {
 const [r]=await tx.query<Guardian|Student>(`SELECT * FROM ${tables[entity]} WHERE school_id=? AND id=?`,[school,record]);
 if(!r)throw new DomainError('Ficha no encontrada.',404);
 if(r.archived_at)throw new DomainError('La ficha está archivada. Reactívala antes de registrar información nueva.',409);
 if(entity==='student')await activeRecord(tx,school,'guardian',(r as Student).guardian_id);
 return r;
}
export async function profileHistory(tx:DB,actor:Actor,entity:Entity,record:string,action:string,reason:string,before:unknown,after:unknown) {
 const timestamp=new Date().toISOString();
 await tx.run('INSERT INTO ce_profile_history(id,school_id,actor_id,entity_type,entity_id,action,reason,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
 [randomUUID(),actor.school_id,actor.id,entity,record,action,reason,before===null?null:JSON.stringify(before),after===null?null:JSON.stringify(after),timestamp]);
 await tx.run('INSERT INTO ce_audit(id,school_id,actor_id,action,entity_id,created_at) VALUES (?,?,?,?,?,?)',[randomUUID(),actor.school_id,actor.id,action,record,timestamp]);
}
export async function ensurePrimaryContact(tx:DB,school:string,guardian:string) {
 // Supports pre-update imports/demo and existing families without inventing consent.
 const [g]=await tx.query<Guardian>('SELECT * FROM ce_guardians WHERE school_id=? AND id=?',[school,guardian]);
 if(!g)throw new DomainError('Ficha no encontrada.',404);
 const contacts=await tx.query<Contact>('SELECT * FROM ce_guardian_contacts WHERE school_id=? AND guardian_id=?',[school,guardian]);
 if(contacts.length)return;
 const stamp=new Date().toISOString();
 await tx.run('INSERT INTO ce_guardian_contacts(id,school_id,guardian_id,name,relationship,email,phone,is_primary,email_consent,whatsapp_consent,consent_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
 [randomUUID(),school,guardian,g.name,'otro',g.email,g.phone,1,g.email&&g.consent_note&&g.consent_note.length>=5?g.email_consent:0,g.phone&&g.consent_note&&g.consent_note.length>=5?g.whatsapp_consent:0,g.consent_note,stamp,stamp]);
}
export async function syncPrimary(tx:DB,school:string,guardian:string) {
 const [c]=await tx.query<Contact>('SELECT * FROM ce_guardian_contacts WHERE school_id=? AND guardian_id=? AND is_primary=1',[school,guardian]);
 if(!c)throw new DomainError('La ficha necesita un contacto principal.');
 // Compatibility projection for the existing importer, list, and exports.
 await tx.run('UPDATE ce_guardians SET email=?,phone=?,email_consent=?,whatsapp_consent=?,consent_note=? WHERE school_id=? AND id=?',[c.email,c.phone,c.email_consent,c.whatsapp_consent,c.consent_note,school,guardian]);
}
async function snapshot(tx:DB,school:string,entity:Entity,record:string) {
 const [row]=await tx.query<Guardian&Student>(`SELECT * FROM ${tables[entity]} WHERE school_id=? AND id=?`,[school,record]);
 if(!row)throw new DomainError('Ficha no encontrada.',404);
 const contacts=entity==='guardian'?await tx.query<Contact>('SELECT * FROM ce_guardian_contacts WHERE school_id=? AND guardian_id=? ORDER BY is_primary DESC,created_at,id',[school,record]):undefined;
 return {...row,...(contacts?{contacts:contacts.map(c=>({...c}))}:{})};
}
function checkVersion(current:{version:number},version:number) {
 if(current.version!==version)throw new DomainError('Otra persona modificó esta ficha. Recarga la página y revisa los cambios antes de guardar.',409);
}
export async function removalPlan(tx:DB,school:string,entity:Entity,record:string) {
 const students=entity==='guardian'?await tx.query<Student>('SELECT * FROM ce_students WHERE school_id=? AND guardian_id=? ORDER BY id',[school,record]):[];
 const invoices=entity==='guardian'
  ?await tx.query('SELECT i.id FROM ce_invoices i JOIN ce_students st ON st.school_id=i.school_id AND st.id=i.student_id WHERE st.school_id=? AND st.guardian_id=? LIMIT 1',[school,record])
  :await tx.query('SELECT id FROM ce_invoices WHERE school_id=? AND student_id=? LIMIT 1',[school,record]);
 const calls=entity==='guardian'?await tx.query('SELECT id FROM ce_calls WHERE school_id=? AND guardian_id=? LIMIT 1',[school,record]):[];
 return {mode:invoices.length||calls.length?'archive' as const:'delete' as const,students};
}

export const profileActions=['guardian-update','student-update','profile-remove','profile-restore'] as const;
export async function mutateProfile(actor:Actor,action:string,input:unknown) {
 allow(actor,['cobranza','seguimiento']);
 if(action==='guardian-update') {
  const v=guardianEdit.parse(input);
  return schoolTransaction(actor,async tx=>{
   const before=await snapshot(tx,actor.school_id,'guardian',v.id);checkVersion(before,v.version);
   await activeRecord(tx,actor.school_id,'guardian',v.id);
   const old=before.contacts||[],ids=v.contacts.flatMap(c=>c.id?[c.id]:[]);
   if(new Set(ids).size!==ids.length)throw new DomainError('Hay contactos repetidos.');
   for(const c of v.contacts) {
    const prior=old.find(o=>o.id===c.id);
    if(c.id&&!prior)throw new DomainError('Contacto no encontrado en esta ficha.',404);
    // Consent belongs to its person and destination, never silently to a new recipient.
    if(prior&&((c.email_consent&&(c.email!==(prior.email||'')||c.name!==prior.name||c.relationship!==prior.relationship))||(c.whatsapp_consent&&(c.phone!==(prior.phone||'')||c.name!==prior.name||c.relationship!==prior.relationship)))&&c.consent_note===prior.consent_note)
     throw new DomainError('El contacto cambió. Registra una nueva evidencia para volver a autorizar mensajes.');
   }
   await tx.run('UPDATE ce_guardian_contacts SET is_primary=0 WHERE school_id=? AND guardian_id=?',[actor.school_id,v.id]);
   for(const c of old)if(!ids.includes(c.id))await tx.run('DELETE FROM ce_guardian_contacts WHERE school_id=? AND guardian_id=? AND id=?',[actor.school_id,v.id,c.id]);
   const stamp=new Date().toISOString();
   for(const c of v.contacts) {
    const values=[c.name,c.relationship,c.email||null,c.phone||null,+c.is_primary,+c.email_consent,+c.whatsapp_consent,c.consent_note||null,stamp];
    if(c.id)await tx.run('UPDATE ce_guardian_contacts SET name=?,relationship=?,email=?,phone=?,is_primary=?,email_consent=?,whatsapp_consent=?,consent_note=?,updated_at=? WHERE school_id=? AND guardian_id=? AND id=?',[...values,actor.school_id,v.id,c.id]);
    else await tx.run('INSERT INTO ce_guardian_contacts(name,relationship,email,phone,is_primary,email_consent,whatsapp_consent,consent_note,updated_at,school_id,guardian_id,id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[...values,actor.school_id,v.id,randomUUID(),stamp]);
   }
   await tx.run('UPDATE ce_guardians SET name=?,version=version+1 WHERE school_id=? AND id=?',[v.name,actor.school_id,v.id]);
   await syncPrimary(tx,actor.school_id,v.id);
   await profileHistory(tx,actor,'guardian',v.id,'Acudiente y contactos actualizados',v.reason,before,await snapshot(tx,actor.school_id,'guardian',v.id));
   return v.id;
  });
 }
 if(action==='student-update') {
  const v=studentEdit.parse(input);
  return schoolTransaction(actor,async tx=>{
   const before=await snapshot(tx,actor.school_id,'student',v.id);checkVersion(before,v.version);
   await activeRecord(tx,actor.school_id,'student',v.id);await activeRecord(tx,actor.school_id,'guardian',v.guardian_id);
   if(v.guardian_id!==before.guardian_id&&(await removalPlan(tx,actor.school_id,'student',v.id)).mode==='archive')
    throw new DomainError('Este estudiante tiene movimientos. La reasignación de su deuda a otra familia requiere una revisión; puedes editar los demás datos.');
   await tx.run('UPDATE ce_students SET code=?,name=?,grade=?,guardian_id=?,version=version+1 WHERE school_id=? AND id=?',[v.code,v.name,v.grade,v.guardian_id,actor.school_id,v.id]);
   for(const g of new Set([before.guardian_id,v.guardian_id]))await tx.run('UPDATE ce_guardians SET version=version+1 WHERE school_id=? AND id=?',[actor.school_id,g]);
   const after=await snapshot(tx,actor.school_id,'student',v.id);
   await profileHistory(tx,actor,'student',v.id,'Estudiante actualizado',v.reason,before,after);
   if(v.guardian_id!==before.guardian_id)for(const g of [before.guardian_id,v.guardian_id])await profileHistory(tx,actor,'guardian',g,'Asociación de estudiante actualizada',v.reason,{estudiante:before.name,acudiente:before.guardian_id},{estudiante:after.name,acudiente:after.guardian_id});
   return v.id;
  });
 }
 const v=z.object({...base,entity:z.enum(['guardian','student']),mode:z.enum(['archive','delete']).optional()}).strict().parse(input);
 return schoolTransaction(actor,async tx=>{
  const before=await snapshot(tx,actor.school_id,v.entity,v.id);checkVersion(before,v.version);
  const stamp=new Date().toISOString();
  if(action==='profile-restore') {
   if(!before.archived_at)throw new DomainError('La ficha ya está activa.',409);
   if(v.entity==='student')await activeRecord(tx,actor.school_id,'guardian',before.guardian_id);
   await tx.run(`UPDATE ${tables[v.entity]} SET archived_at=NULL,version=version+1 WHERE school_id=? AND id=?`,[actor.school_id,v.id]);
   await profileHistory(tx,actor,v.entity,v.id,'Ficha reactivada',v.reason,before,await snapshot(tx,actor.school_id,v.entity,v.id));
   return {mode:'restore',id:v.id};
  }
  if(action!=='profile-remove')throw new DomainError('Operación desconocida.',404);
  const plan=await removalPlan(tx,actor.school_id,v.entity,v.id);
  if(plan.mode!==v.mode)throw new DomainError('Los movimientos de la ficha cambiaron. Recarga para revisar la acción disponible.',409);
  if(plan.mode==='archive') {
   if(before.archived_at)throw new DomainError('La ficha ya está archivada.',409);
   await tx.run(`UPDATE ${tables[v.entity]} SET archived_at=?,version=version+1 WHERE school_id=? AND id=?`,[stamp,actor.school_id,v.id]);
   for(const st of plan.students)if(!st.archived_at) {
    await tx.run('UPDATE ce_students SET archived_at=?,version=version+1 WHERE school_id=? AND id=?',[stamp,actor.school_id,st.id]);
    await profileHistory(tx,actor,'student',st.id,'Estudiante archivado con su familia',v.reason,st,{...st,archived_at:stamp,version:st.version+1});
   }
   await profileHistory(tx,actor,v.entity,v.id,'Ficha archivada',v.reason,before,await snapshot(tx,actor.school_id,v.entity,v.id));
  } else {
   for(const st of plan.students) {
    await profileHistory(tx,actor,'student',st.id,'Estudiante eliminado con su familia',v.reason,st,null);
    await tx.run('DELETE FROM ce_students WHERE school_id=? AND id=?',[actor.school_id,st.id]);
   }
   if(v.entity==='guardian')await tx.run('DELETE FROM ce_guardian_contacts WHERE school_id=? AND guardian_id=?',[actor.school_id,v.id]);
   await profileHistory(tx,actor,v.entity,v.id,'Ficha eliminada sin movimientos',v.reason,before,null);
   await tx.run(`DELETE FROM ${tables[v.entity]} WHERE school_id=? AND id=?`,[actor.school_id,v.id]);
  }
  if(v.entity==='student')await tx.run('UPDATE ce_guardians SET version=version+1 WHERE school_id=? AND id=?',[actor.school_id,before.guardian_id]);
  return {mode:plan.mode,id:v.id};
 });
}

export async function getProfile(actor:Actor,entity:Entity,record:string,page=1) {
 if(!id.safeParse(record).success)return null;
 // Read a coherent snapshot using the same tenant lock as profile writers.
 return schoolTransaction(actor,async tx=>{
  const [exists]=await tx.query(`SELECT id FROM ${tables[entity]} WHERE school_id=? AND id=?`,[actor.school_id,record]);if(!exists)return null;
  const profile=await snapshot(tx,actor.school_id,entity,record),plan=await removalPlan(tx,actor.school_id,entity,record);
  const history=await tx.query<ProfileChange>('SELECT h.*,u.name AS author FROM ce_profile_history h LEFT JOIN ce_users u ON u.school_id=h.school_id AND u.id=h.actor_id WHERE h.school_id=? AND h.entity_type=? AND h.entity_id=? ORDER BY h.created_at DESC,h.id DESC LIMIT 21 OFFSET ?',[actor.school_id,entity,record,(page-1)*20]);
  return {profile,plan,history:history.slice(0,20),moreHistory:history.length>20};
 });
}
export async function listProfiles(actor:Actor,entity:Entity,query:string,archived:boolean,page:number) {
 const table=tables[entity];const term='%'+query.trim().toLowerCase().slice(0,100).replace(/[\\%_]/g,'\\$&')+'%';
 const where=`p.school_id=? AND p.archived_at IS ${archived?'NOT ':''}NULL AND (LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(${entity==='guardian'?"COALESCE(p.email,'')":"p.code"}) LIKE ? ESCAPE '\\')`;
 const args=[actor.school_id,term,term];
 const [count]=await db.query<{total:number}>(`SELECT COUNT(*) AS total FROM ${table} p WHERE ${where}`,args);
 const rows=await db.query<Guardian&Student&{guardian_name:string;student_count:number}>(entity==='guardian'
  ?`SELECT p.*,(SELECT COUNT(*) FROM ce_students s WHERE s.school_id=p.school_id AND s.guardian_id=p.id) AS student_count FROM ${table} p WHERE ${where} ORDER BY p.name,p.id LIMIT 50 OFFSET ?`
  :`SELECT p.*,g.name AS guardian_name FROM ${table} p JOIN ce_guardians g ON g.school_id=p.school_id AND g.id=p.guardian_id WHERE ${where} ORDER BY p.name,p.id LIMIT 50 OFFSET ?`,[...args,(page-1)*50]);
 return {rows,total:Number(count.total)};
}
