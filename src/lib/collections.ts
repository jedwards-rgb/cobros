import { schoolTransaction,activeRecord,ensurePrimaryContact,syncPrimary,profileHistory,profileActions,mutateProfile } from './profiles';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db,type DB } from './db';
import { allow,amount,balance,cents,date,DomainError,id,text,today } from './domain';
import type { Actor,Invoice,Guardian,PromiseRow,Student } from './types';

export const guardianSchema=z.object({name:text,email:z.union([z.email().max(180),z.literal('')]),phone:z.union([z.string().regex(/^\+[1-9]\d{7,14}$/,'Usa formato internacional: +50761234567'),z.literal('')]),email_consent:z.boolean(),whatsapp_consent:z.boolean(),consent_note:z.string().trim().max(500)}).refine(v=>(!v.email_consent||!!v.email)&&(!v.whatsapp_consent||!!v.phone)&&(!(v.email_consent||v.whatsapp_consent)||v.consent_note.length>=5),'Registra el contacto y la evidencia de autorización para cada canal.');
const studentSchema=z.object({guardian_id:id,code:text.max(40),name:text,grade:text.max(60)});
const invoiceSchema=z.object({student_id:id,reference:text.max(80),concept:text,due_date:date,amount,late_fee:amount});
const paymentSchema=z.object({invoice_id:id,request_key:id,reference:text.max(100),amount,method:z.enum(['Transferencia','Efectivo','Tarjeta','ACH','Yappy']),paid_on:date.refine(v=>v<=today(),'El pago no puede tener fecha futura.')});
const promiseSchema=z.object({invoice_id:id,amount,due_date:date.refine(v=>v>=today(),'La promesa debe ser para hoy o después.'),notes:z.string().max(2000)});
const callSchema=z.object({guardian_id:id,outcome:z.enum(['Contestó','No contestó','Número incorrecto','Llamar nuevamente','Promesa de pago','Acuerdo de pago']),notes:z.string().max(2000),next_contact:z.union([date.refine(v=>v>=today(),'El próximo seguimiento no puede estar en el pasado.'),z.literal('')])});
export async function audit(tx:DB,actor:Actor,action:string,entity:string) {await tx.run('INSERT INTO ce_audit(id,school_id,actor_id,action,entity_id,created_at) VALUES (?,?,?,?,?,?)',[randomUUID(),actor.school_id,actor.id,action,entity,new Date().toISOString()]);}
export async function mutate(actor:Actor,action:string,input:unknown) {
  if((profileActions as readonly string[]).includes(action))return mutateProfile(actor,action,input);
  if(action==='guardian') {
    allow(actor,['cobranza','seguimiento']);const v=guardianSchema.parse(input);const entity=randomUUID();
    return schoolTransaction(actor,async(tx)=>{await tx.run('INSERT INTO ce_guardians(id,school_id,name,email,phone,email_consent,whatsapp_consent,consent_note,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[entity,actor.school_id,v.name,v.email||null,v.phone||null,+v.email_consent,+v.whatsapp_consent,v.consent_note||null,new Date().toISOString()]);await ensurePrimaryContact(tx,actor.school_id,entity);await profileHistory(tx,actor,'guardian',entity,'Acudiente registrado','Registro inicial',null,v);return entity;});
  }
  if(action==='consent') {
    allow(actor,['cobranza','seguimiento']);const v=z.object({guardian_id:id,version:z.number().int().positive(),email_consent:z.boolean(),whatsapp_consent:z.boolean(),consent_note:z.string().trim().min(5).max(500)}).parse(input);
    return schoolTransaction(actor,async tx=>{
      const g=await activeRecord(tx,actor.school_id,'guardian',v.guardian_id) as Guardian;
      if(g.version!==v.version)throw new DomainError('La ficha cambió. Recarga antes de actualizar la autorización.',409);
      if((v.email_consent&&!g.email)||(v.whatsapp_consent&&!g.phone))throw new DomainError('Falta el contacto para ese canal.');
      await ensurePrimaryContact(tx,actor.school_id,v.guardian_id);
      await tx.run('UPDATE ce_guardian_contacts SET email_consent=?,whatsapp_consent=?,consent_note=?,updated_at=? WHERE school_id=? AND guardian_id=? AND is_primary=1',[+v.email_consent,+v.whatsapp_consent,v.consent_note,new Date().toISOString(),actor.school_id,v.guardian_id]);
      await syncPrimary(tx,actor.school_id,v.guardian_id);
      await tx.run('UPDATE ce_guardians SET version=version+1 WHERE school_id=? AND id=?',[actor.school_id,v.guardian_id]);
      await profileHistory(tx,actor,'guardian',v.guardian_id,'Autorización del contacto principal actualizada',v.consent_note,g,v);
    });
  }
  if(action==='student') {
    allow(actor,['cobranza','seguimiento']);const v=studentSchema.parse(input);const entity=randomUUID();
    return schoolTransaction(actor,async(tx)=>{await activeRecord(tx,actor.school_id,'guardian',v.guardian_id);await tx.run('INSERT INTO ce_students(id,school_id,guardian_id,code,name,grade,created_at) VALUES (?,?,?,?,?,?,?)',[entity,actor.school_id,v.guardian_id,v.code,v.name,v.grade,new Date().toISOString()]);await tx.run('UPDATE ce_guardians SET version=version+1 WHERE school_id=? AND id=?',[actor.school_id,v.guardian_id]);await profileHistory(tx,actor,'student',entity,'Estudiante registrado','Registro inicial',null,v);return entity;});
  }
  if(action==='invoice') {
    allow(actor,['cobranza']);const v=invoiceSchema.parse(input);const entity=randomUUID();
    return schoolTransaction(actor,async(tx)=>{await activeRecord(tx,actor.school_id,'student',v.student_id);await tx.run('INSERT INTO ce_invoices(id,school_id,student_id,reference,concept,due_date,amount_cents,late_fee_cents,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[entity,actor.school_id,v.student_id,v.reference,v.concept,v.due_date,cents(v.amount),cents(v.late_fee,true),actor.id,new Date().toISOString()]);await audit(tx,actor,'Cuenta por cobrar registrada',entity);return entity;});
  }
  if(action==='payment') {
    allow(actor,['cobranza']);const v=paymentSchema.parse(input);const value=cents(v.amount);
    return schoolTransaction(actor,async(tx)=>{
      // Acquires the invoice write lock on PostgreSQL; SQLite transactions are serialized.
      await tx.run('UPDATE ce_invoices SET paid_cents=paid_cents WHERE school_id=? AND id=?',[actor.school_id,v.invoice_id]);
      const [invoice]=await tx.query<Invoice>('SELECT * FROM ce_invoices WHERE school_id=? AND id=?',[actor.school_id,v.invoice_id]);if(!invoice)throw new DomainError('Cuenta no encontrada.',404);
      const [prior]=await tx.query<{id:string;invoice_id:string;amount_cents:number;reference:string;paid_on:string;method:string}>('SELECT * FROM ce_payments WHERE school_id=? AND request_key=?',[actor.school_id,v.request_key]);
      if(prior) {if(prior.invoice_id!==v.invoice_id||prior.amount_cents!==value||prior.reference!==v.reference||prior.paid_on!==v.paid_on||prior.method!==v.method)throw new DomainError('La solicitud ya se utilizó con otros datos.',409);return prior.id;}
      if(value>balance(invoice))throw new DomainError('El pago supera el saldo pendiente.');
      const entity=randomUUID();await tx.run('INSERT INTO ce_payments(id,school_id,invoice_id,request_key,reference,amount_cents,method,paid_on,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[entity,actor.school_id,v.invoice_id,v.request_key,v.reference,value,v.method,v.paid_on,actor.id,new Date().toISOString()]);
      await tx.run('UPDATE ce_invoices SET paid_cents=paid_cents+? WHERE school_id=? AND id=?',[value,actor.school_id,v.invoice_id]);
      const promises=await tx.query<PromiseRow>("SELECT * FROM ce_promises WHERE school_id=? AND invoice_id=? AND status='pendiente'",[actor.school_id,v.invoice_id]);
      for(const p of promises)if(invoice.paid_cents+value-p.baseline_paid_cents>=p.amount_cents) {await tx.run("UPDATE ce_promises SET status='cumplida' WHERE school_id=? AND id=?",[actor.school_id,p.id]);await audit(tx,actor,'Promesa cumplida',p.id);}
      await audit(tx,actor,'Pago registrado',entity);return entity;
    });
  }
  if(action==='promise') {
    allow(actor,['seguimiento']);const v=promiseSchema.parse(input);const value=cents(v.amount);
    return schoolTransaction(actor,async(tx)=>{
      await tx.run('UPDATE ce_invoices SET paid_cents=paid_cents WHERE school_id=? AND id=?',[actor.school_id,v.invoice_id]);
      const [i]=await tx.query<Invoice>('SELECT * FROM ce_invoices WHERE school_id=? AND id=?',[actor.school_id,v.invoice_id]);if(!i)throw new DomainError('Cuenta no encontrada.',404);
      await activeRecord(tx,actor.school_id,'student',i.student_id);
      if(value>balance(i))throw new DomainError('La promesa supera el saldo pendiente.');
      if((await tx.query("SELECT id FROM ce_promises WHERE school_id=? AND invoice_id=? AND status='pendiente'",[actor.school_id,i.id])).length)throw new DomainError('Ya existe una promesa abierta. Cancélala antes de sustituirla.');
      const entity=randomUUID();await tx.run('INSERT INTO ce_promises(id,school_id,invoice_id,amount_cents,baseline_paid_cents,due_date,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[entity,actor.school_id,i.id,value,i.paid_cents,v.due_date,v.notes,actor.id,new Date().toISOString()]);await audit(tx,actor,'Promesa registrada',entity);return entity;
    });
  }
  if(action==='cancel-promise') {
    allow(actor,['seguimiento']);const v=z.object({promise_id:id,reason:text.max(500)}).parse(input);
    return schoolTransaction(actor,async(tx)=>{
      const [promise]=await tx.query<{invoice_id:string}>('SELECT invoice_id FROM ce_promises WHERE school_id=? AND id=?',[actor.school_id,v.promise_id]);
      if(!promise)throw new DomainError('Registro no encontrado.',404);
      // Same lock order as payments and dispatch: invoice first, then promise.
      await tx.run('UPDATE ce_invoices SET paid_cents=paid_cents WHERE school_id=? AND id=?',[actor.school_id,promise.invoice_id]);
      const changed=await tx.run("UPDATE ce_promises SET status='cancelada',notes=COALESCE(notes,'') || ? WHERE school_id=? AND id=? AND status='pendiente'",[`\nCancelación (${new Date().toISOString()}): ${v.reason}`,actor.school_id,v.promise_id]);
      if(!changed)throw new DomainError('La promesa ya está cerrada.');
      await audit(tx,actor,'Promesa cancelada',v.promise_id);
    });
  }
  if(action==='call') {
    allow(actor,['seguimiento']);const v=callSchema.parse(input);const entity=randomUUID();
    return schoolTransaction(actor,async(tx)=>{await activeRecord(tx,actor.school_id,'guardian',v.guardian_id);await tx.run('INSERT INTO ce_calls(id,school_id,guardian_id,outcome,notes,next_contact,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)',[entity,actor.school_id,v.guardian_id,v.outcome,v.notes,v.next_contact||null,actor.id,new Date().toISOString()]);await audit(tx,actor,'Llamada registrada',entity);return entity;});
  }
  throw new DomainError('Operación desconocida.',404);
}

export async function getData(actor:Actor) {
  const school=actor.school_id;
  const [guardians,students,invoices,payments,promises,calls,outbox,auditRows]=await Promise.all([
    db.query<Guardian>('SELECT * FROM ce_guardians WHERE school_id=? ORDER BY name',[school]),
    db.query<Student&{guardian_name:string}>('SELECT st.*,g.name AS guardian_name FROM ce_students st JOIN ce_guardians g ON g.id=st.guardian_id AND g.school_id=st.school_id WHERE st.school_id=? ORDER BY st.name',[school]),
    db.query<Invoice>('SELECT i.*,st.name AS student_name,st.grade,g.name AS guardian_name,g.id AS guardian_id FROM ce_invoices i JOIN ce_students st ON st.id=i.student_id AND st.school_id=i.school_id JOIN ce_guardians g ON g.id=st.guardian_id AND g.school_id=st.school_id WHERE i.school_id=? ORDER BY i.due_date,i.reference',[school]),
    db.query<{id:string;invoice_id:string;amount_cents:number;reference:string;method:string;paid_on:string;created_at:string;author:string;student_name:string}>('SELECT p.*,u.name AS author,st.name AS student_name FROM ce_payments p JOIN ce_users u ON u.id=p.created_by AND u.school_id=p.school_id JOIN ce_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id JOIN ce_students st ON st.id=i.student_id AND st.school_id=i.school_id WHERE p.school_id=? ORDER BY p.created_at DESC',[school]),
    db.query<PromiseRow>('SELECT p.*,i.paid_cents,st.name AS student_name,g.name AS guardian_name FROM ce_promises p JOIN ce_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id JOIN ce_students st ON st.id=i.student_id AND st.school_id=i.school_id JOIN ce_guardians g ON g.id=st.guardian_id AND g.school_id=st.school_id WHERE p.school_id=? ORDER BY p.due_date',[school]),
    db.query<{id:string;guardian_id:string;guardian_name:string;outcome:string;notes:string;next_contact:string;created_at:string;created_by:string;author:string}>('SELECT c.*,g.name AS guardian_name,u.name AS author FROM ce_calls c JOIN ce_guardians g ON g.id=c.guardian_id AND g.school_id=c.school_id JOIN ce_users u ON u.id=c.created_by AND u.school_id=c.school_id WHERE c.school_id=? ORDER BY c.created_at DESC',[school]),
    db.query<{id:string;channel:string;status:string;error_code:string;created_at:string;promise_id:string|null}>('SELECT id,channel,status,error_code,created_at,promise_id FROM ce_outbox WHERE school_id=? ORDER BY created_at DESC LIMIT 200',[school]),
    db.query<{id:string;action:string;entity_id:string;created_at:string;author:string}>('SELECT a.*,u.name AS author FROM ce_audit a LEFT JOIN ce_users u ON u.id=a.actor_id AND u.school_id=a.school_id WHERE a.school_id=? ORDER BY a.created_at DESC LIMIT 100',[school]),
  ]);
  return {guardians,students,invoices,payments,promises,calls,outbox,audit:auditRows};
}
