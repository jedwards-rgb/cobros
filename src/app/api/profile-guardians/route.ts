import { NextResponse,type NextRequest } from 'next/server';
import { currentActor } from '@/lib/auth';
import { db } from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
 const actor=await currentActor();if(!actor)return NextResponse.json({error:'Inicia sesión nuevamente.'},{status:401});
 const term='%'+(request.nextUrl.searchParams.get('q')||'').trim().toLowerCase().slice(0,100).replace(/[\\%_]/g,'\\$&')+'%';
 const rows=await db.query("SELECT id,name,email,phone FROM ce_guardians WHERE school_id=? AND archived_at IS NULL AND (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(email,'')) LIKE ? ESCAPE '\\') ORDER BY name,id LIMIT 25",[actor.school_id,term,term]);
 return NextResponse.json({rows},{headers:{'Cache-Control':'private, no-store'}});
}
