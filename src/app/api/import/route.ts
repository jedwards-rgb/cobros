import { NextRequest,NextResponse } from 'next/server';
import { currentActor } from '@/lib/auth';
import { checkOrigin,safeEqual,rateLimit } from '@/lib/security';
import { DomainError,allow } from '@/lib/domain';
import { parseWorkbook,importRows } from '@/lib/imports';
import { boundedBody } from '@/lib/request';
export const runtime='nodejs';
export async function POST(request:NextRequest) {
 try {
  checkOrigin(request);const actor=await currentActor();if(!actor)throw new DomainError('Inicia sesión.',401);allow(actor,['cobranza']);
  if(!safeEqual(request.headers.get('x-csrf-token')||'',actor.csrf||''))throw new DomainError('Formulario inválido.',403);
  await rateLimit(`import:${actor.id}`,15);
  if(Number(request.headers.get('content-length')||0)>2200000)throw new DomainError('Máximo 2 MB.',413);
  if(request.headers.get('content-type')?.includes('application/json')) {
    const raw=new TextDecoder().decode(await boundedBody(request,1000000));
    const count=await importRows(actor,JSON.parse(raw).rows);return NextResponse.json({ok:true,count});
  }
  const bytes=await boundedBody(request,2200000);
  const form=await new Response(bytes as BodyInit,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData(),file=form.get('file');if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.xlsx')||file.size>2097152)throw new DomainError('Selecciona un .xlsx de hasta 2 MB.');
  const rows=await parseWorkbook(Buffer.from(await file.arrayBuffer()));return NextResponse.json({rows});
 }catch(e){if(e instanceof DomainError)return NextResponse.json({error:e.message},{status:e.status});return NextResponse.json({error:'Archivo o datos inválidos. Verifica la plantilla y las referencias; no se guardaron cambios.'},{status:400});}
}
