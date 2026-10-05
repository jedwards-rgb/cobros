import { NextRequest,NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { cookieName,currentActor } from '@/lib/auth';
import { checkOrigin,login,sha,safeEqual,rateLimit } from '@/lib/security';
import { DomainError } from '@/lib/domain';
import { mutate } from '@/lib/collections';
import { db } from '@/lib/db';
import { boundedBody } from '@/lib/request';
export const runtime='nodejs';
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string}>}) {
  try {
    checkOrigin(request);
    if(Number(request.headers.get('content-length')||0)>20000)throw new DomainError('Solicitud demasiado grande.',413);
    const raw=new TextDecoder().decode(await boundedBody(request,20000));
    const input=JSON.parse(raw);const {action}=await params;
    if(action==='login') {
      const v=z.object({school:z.string().trim().min(1).max(60),email:z.email().max(180),password:z.string().min(1).max(128)}).parse(input);
      // Global cap bounds attacks that rotate account names; configure edge IP limits as well.
      await rateLimit('login:global',200);
      const {token}=await login(v.school,v.email,v.password);
      (await cookies()).set(cookieName,token,{httpOnly:true,secure:process.env.NODE_ENV==='production'&&process.env.ALLOW_LOCAL_PREVIEW!=='true',sameSite:'lax',path:'/',maxAge:28800});
      return NextResponse.json({ok:true});
    }
    const actor=await currentActor();if(!actor)throw new DomainError('Inicia sesión nuevamente.',401);
    if(!safeEqual(request.headers.get('x-csrf-token')||'',actor.csrf||''))throw new DomainError('Sesión del formulario inválida. Recarga la página.',403);
    if(action==='logout') {
      const jar=await cookies();const token=jar.get(cookieName)?.value;
      if(token)await db.run('DELETE FROM ce_sessions WHERE token_hash=?',[sha(token)]);jar.delete(cookieName);return NextResponse.json({ok:true});
    }
    await rateLimit(`write:${actor.id}`,150);
    const result=await mutate(actor,action,input);return NextResponse.json({ok:true,id:result});
  } catch(error) {
    if(error instanceof z.ZodError)return NextResponse.json({error:error.issues.map(i=>i.message).join(' · ')},{status:400});
    if(error instanceof DomainError)return NextResponse.json({error:error.message},{status:error.status});
    if(error instanceof SyntaxError)return NextResponse.json({error:'Datos inválidos.'},{status:400});
    const code=(error as {code?:string}).code;
    if(code==='23505'||code?.startsWith('SQLITE_CONSTRAINT'))return NextResponse.json({error:'El código, referencia o solicitud ya existe. Revisa los datos antes de guardar.'},{status:409});
    console.error('collections_action_failed',{code:code||'INTERNAL'});
    return NextResponse.json({error:'No se pudo completar la operación. Intenta nuevamente o consulta al administrador.'},{status:500});
  }
}
