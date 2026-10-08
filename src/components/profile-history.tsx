import Link from 'next/link';
import type { ProfileChange } from '@/lib/types';
function describe(raw:string|null):string {
 if(!raw)return 'Sin ficha';
 try {
  const v=JSON.parse(raw);const parts:string[]=[];
  for(const [field,label] of Object.entries({name:'Nombre',code:'Código',grade:'Grado',archived_at:'Archivado',email:'Correo principal',phone:'Teléfono principal',estudiante:'Estudiante',email_consent:'Autoriza correo',whatsapp_consent:'Autoriza WhatsApp',consent_note:'Evidencia'}))
   if(field in v)parts.push(`${label}: ${field.endsWith('_consent')?(v[field]?'Sí':'No'):v[field]||'—'}`);
  if(Array.isArray(v.contacts))for(const c of v.contacts)parts.push(`${c.is_primary?'Principal':'Adicional'} · ${c.name} (${c.relationship}) · ${c.email||'Sin correo'} · ${c.phone||'Sin teléfono'} · correo autorizado: ${c.email_consent?'sí':'no'} · WhatsApp autorizado: ${c.whatsapp_consent?'sí':'no'} · evidencia: ${c.consent_note||'—'}`);
  return parts.join('\n')||'Cambio de asociación registrado';
 }catch{return 'Registro histórico';}
}
export function ProfileHistory({rows,page,more,href}:{rows:ProfileChange[];page:number;more:boolean;href:string}) {
 return <section className="card detail-card profile-section" id="historial"><h2>Historial de cambios</h2>{!rows.length&&<p>No hay modificaciones registradas desde esta actualización.</p>}{rows.map(h=><article className="profile-change" key={h.id}><strong>{h.action}</strong><p>{h.author||'Sistema'} · {new Intl.DateTimeFormat('es-PA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Panama'}).format(new Date(h.created_at))}</p><p>Motivo: {h.reason}</p><details><summary>Ver información anterior y posterior</summary><div className="history-comparison"><div><h3>Antes</h3><p>{describe(h.before_json)}</p></div><div><h3>Después</h3><p>{describe(h.after_json)}</p></div></div></details></article>)}<nav className="profile-actions" aria-label="Páginas del historial">{page>1&&<Link href={`${href}?history=${page-1}#historial`}>Más recientes</Link>}{more&&<Link href={`${href}?history=${page+1}#historial`}>Más antiguos</Link>}</nav></section>;
}
