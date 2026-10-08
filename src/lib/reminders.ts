import { lockSchool } from './profiles';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { db,transaction,type DB } from './db';
import { money,plusDays,today } from './domain';
export interface Delivery {channel:string;to:string;body:string;name:string;date:string;amount:string;}
export type Transport=(delivery:Delivery)=>Promise<string>;
export async function transport(d:Delivery):Promise<string> {
  if(d.channel==='email') {
    if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD||!process.env.MAIL_FROM)throw new Error('CONFIG_EMAIL');
    const port=Number(process.env.SMTP_PORT||465);
    const mail=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},connectionTimeout:8000,socketTimeout:10000,tls:{rejectUnauthorized:true}});
    const result=await mail.sendMail({from:process.env.MAIL_FROM,to:d.to,subject:'CobroEdu · Recordatorio / reporte de cobranza',text:d.body});
    if(!result.accepted.length)throw new Error('EMAIL_NO_ACCEPTED');return String(result.messageId);
  }
  const {WHATSAPP_TOKEN:token,WHATSAPP_PHONE_ID:phone,WHATSAPP_API_VERSION:version,WHATSAPP_TEMPLATE:template}=process.env;
  if(!token||!phone||!version||!template||!/^v\d+\.\d+$/.test(version)||!/^\d+$/.test(phone))throw new Error('CONFIG_WHATSAPP');
  const response=await fetch(`https://graph.facebook.com/${version}/${phone}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:d.to.replace('+',''),type:'template',template:{name:template,language:{code:process.env.WHATSAPP_LANGUAGE||'es'},components:[{type:'body',parameters:[d.name,d.date,d.amount].map(text=>({type:'text',text}))}]}}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('WHATSAPP_PROVIDER_ERROR');const body=await response.json();if(!body.messages?.[0]?.id)throw new Error('WHATSAPP_NO_ID');return body.messages[0].id;
}
async function enqueue(tx:DB,school:string,key:string,channel:string,promise:string|null,user:string|null,body:string|null,now:string) {
  await tx.run('INSERT INTO ce_outbox(id,school_id,dedupe_key,promise_id,user_id,channel,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(school_id,dedupe_key) DO NOTHING',[randomUUID(),school,key,promise,user,channel,body,now,now]);
}
export async function prepareReminders(now=new Date()) {
  const day=today(now);const timestamp=now.toISOString();
  const promises=await db.query<{id:string;school_id:string;due_date:string}>("SELECT p.id,p.school_id,p.due_date FROM ce_promises p JOIN ce_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id JOIN ce_students st ON st.school_id=i.school_id AND st.id=i.student_id JOIN ce_guardians g ON g.school_id=st.school_id AND g.id=st.guardian_id WHERE st.archived_at IS NULL AND g.archived_at IS NULL AND p.status='pendiente' AND p.due_date>=? AND p.due_date<=? AND i.amount_cents+i.late_fee_cents>i.paid_cents",[day,plusDays(day,3)]);
  await transaction(async(tx)=>{for(const p of promises)for(const channel of ['email','whatsapp'])await enqueue(tx,p.school_id,`promise:${p.id}:${channel}`,channel,p.id,null,null,timestamp);});
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Panama',hour:'2-digit',hourCycle:'h23'}).format(now));
  if(hour>=17) {
    const directors=await db.query<{id:string;school_id:string}>("SELECT id,school_id FROM ce_users WHERE role='directora' AND active=1");
    for(const director of directors) {
      const [totals]=await db.query<{pending:number}>("SELECT COALESCE(SUM(amount_cents+late_fee_cents-paid_cents),0) AS pending FROM ce_invoices WHERE school_id=?",[director.school_id]);
      const [paid]=await db.query<{paid:number}>("SELECT COALESCE(SUM(amount_cents),0) AS paid FROM ce_payments WHERE school_id=? AND paid_on=?",[director.school_id,day]);
      const start=`${day}T05:00:00.000Z`,end=`${plusDays(day,1)}T05:00:00.000Z`;
      const calls=await db.query<{name:string;total:number}>('SELECT u.name,COUNT(*) AS total FROM ce_calls c JOIN ce_users u ON u.id=c.created_by AND u.school_id=c.school_id WHERE c.school_id=? AND c.created_at>=? AND c.created_at<? GROUP BY u.id,u.name',[director.school_id,start,end]);
      const body=`Resumen de cobranza · ${day}\nSaldo pendiente: ${money(Number(totals.pending))}\nPagos/abonos con fecha de hoy: ${money(Number(paid.paid))}\nGestiones:\n${calls.map(c=>`${c.name}: ${c.total} llamadas`).join('\n')||'Sin llamadas registradas.'}\nDetalle de familias, abonos y promesas (requiere iniciar sesión): ${process.env.APP_URL}/reportes\nCorte: ${timestamp}.`;
      await transaction(tx=>enqueue(tx,director.school_id,`report:${day}:${director.id}`,'email',null,director.id,body,timestamp));
    }
  }
  await db.run('DELETE FROM ce_sessions WHERE expires_at<? OR absolute_expires_at<?',[timestamp,timestamp]);
  await db.run('DELETE FROM ce_login_attempts WHERE reset_at<?',[timestamp]);
}
export async function dispatchReminders(send:Transport=transport,now=new Date()) {
  if(process.env.SEND_ENABLED!=='true')return {accepted:0,disabled:true};
  const pending=await db.query<{id:string;school_id:string;promise_id:string|null;user_id:string|null;channel:string;body:string|null}>("SELECT * FROM ce_outbox WHERE status='pendiente' ORDER BY created_at LIMIT 5");
  let accepted=0;
  for(const message of pending) {
    const claimed=await db.run("UPDATE ce_outbox SET status='procesando',updated_at=? WHERE id=? AND status='pendiente'",[now.toISOString(),message.id]);if(!claimed)continue;
    try {
      await transaction(async(tx)=>{
        await lockSchool(tx,message.school_id);
        let delivery:Delivery|null=null;
        if(message.promise_id) {
          const [link]=await tx.query<{invoice_id:string}>('SELECT invoice_id FROM ce_promises WHERE id=? AND school_id=?',[message.promise_id,message.school_id]);
          if(link)await tx.run('UPDATE ce_invoices SET paid_cents=paid_cents WHERE school_id=? AND id=?',[message.school_id,link.invoice_id]);
          const [p]=await tx.query<{status:string;due_date:string;amount_cents:number;baseline_paid_cents:number;paid_cents:number;balance:number;guardian_id:string;archived_at:string|null}>("SELECT p.*,i.paid_cents,(i.amount_cents+i.late_fee_cents-i.paid_cents) AS balance,st.guardian_id,st.archived_at FROM ce_promises p JOIN ce_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id JOIN ce_students st ON st.id=i.student_id AND st.school_id=i.school_id WHERE p.id=? AND p.school_id=?",[message.promise_id,message.school_id]);
          if(p)await tx.run('UPDATE ce_guardians SET name=name WHERE school_id=? AND id=?',[message.school_id,p.guardian_id]);
          const [g]=p?await tx.query<{name:string;email:string;phone:string;email_consent:number;whatsapp_consent:number;archived_at:string|null}>('SELECT c.name,c.email,c.phone,c.email_consent,c.whatsapp_consent,g.archived_at FROM ce_guardians g JOIN ce_guardian_contacts c ON c.school_id=g.school_id AND c.guardian_id=g.id AND c.is_primary=1 WHERE g.school_id=? AND g.id=?',[message.school_id,p.guardian_id]):[];
          if(p&&g&&!p.archived_at&&!g.archived_at&&p.status==='pendiente'&&p.due_date>=today(now)&&p.due_date<=plusDays(today(now),3)&&p.balance>0) {
            const consent=message.channel==='email'?g.email_consent:g.whatsapp_consent;
            const to=message.channel==='email'?g.email:g.phone;
            const remaining=Math.min(p.balance,Math.max(0,p.amount_cents-(p.paid_cents-p.baseline_paid_cents)));
            if(consent&&to&&remaining>0)delivery={channel:message.channel,to,name:g.name,date:p.due_date,amount:money(remaining),body:`Estimado/a ${g.name}: le recordamos su promesa de pago para el ${p.due_date} por ${money(remaining)}. Si ya realizó el pago, comuníquese con cobranza para verificarlo. Departamento de Cobros.`};
          }
        } else if(message.user_id) {
          const [user]=await tx.query<{email:string;name:string}>("SELECT email,name FROM ce_users WHERE school_id=? AND id=? AND role='directora' AND active=1",[message.school_id,message.user_id]);
          if(user)delivery={channel:'email',to:user.email,name:user.name,date:today(now),amount:'',body:message.body||''};
        }
        if(!delivery) {await tx.run("UPDATE ce_outbox SET status='cancelado',updated_at=? WHERE id=?",[now.toISOString(),message.id]);return;}
        const providerId=await send(delivery);
        await tx.run("UPDATE ce_outbox SET status='aceptado_proveedor',provider_id=?,updated_at=? WHERE id=?",[providerId,now.toISOString(),message.id]);accepted++;
      });
    } catch {
      // A timeout may occur after provider acceptance. Never retry blindly.
      await db.run("UPDATE ce_outbox SET status='requiere_revision',error_code='VERIFICAR_PROVEEDOR',updated_at=? WHERE id=?",[now.toISOString(),message.id]);
    }
  }
  return {accepted,disabled:false};
}
