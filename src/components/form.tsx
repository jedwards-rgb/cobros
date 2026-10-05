'use client';
import { useState,type ReactNode,type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
export function Form({action,csrf,children,label='Guardar',destination}:{action:string;csrf?:string;children:ReactNode;label?:string;destination?:string}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);const router=useRouter();
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;setBusy(true);setError('');setSuccess(false);
    const form=event.currentTarget;const data:Record<string,unknown>=Object.fromEntries(new FormData(form));
    for(const box of form.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))data[box.name]=box.checked;
    try {const response=await fetch(`/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf||''},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'No se pudo guardar.');setSuccess(true);form.reset();if(destination)router.push(destination);router.refresh();}
    catch(e){setError(e instanceof Error?e.message:'No se pudo conectar.');}finally{setBusy(false);}
  }
  return <form onSubmit={submit} className="entry-form">{children}{error&&<p className="error" role="alert">{error}</p>}{success&&!destination&&<p className="success" role="status">Registro guardado.</p>}<button disabled={busy} className="button" type="submit">{busy?'Guardando…':label}</button></form>;
}
export function Field({label,name,type='text',required=true,defaultValue,placeholder}:{label:string;name:string;type?:string;required?:boolean;defaultValue?:string;placeholder?:string}) {return <label className="field">{label}<input name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} maxLength={type==='password'?128:180} step={type==='number'?'0.01':undefined}/></label>;}
export function Select({label,name,options}:{label:string;name:string;options:{value:string;label:string}[]}) {return <label className="field">{label}<select name={name} required defaultValue=""><option value="" disabled>Selecciona una opción</option>{options.map(o=><option value={o.value} key={o.value}>{o.label}</option>)}</select></label>;}
