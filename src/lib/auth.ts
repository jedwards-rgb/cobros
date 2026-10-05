import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getActor } from './security';
export const cookieName=process.env.NODE_ENV==='production'&&process.env.ALLOW_LOCAL_PREVIEW!=='true'?'__Host-cobroedu':'cobroedu';
export async function currentActor() {return getActor((await cookies()).get(cookieName)?.value);}
export async function requireActor() {const actor=await currentActor();if(!actor)redirect('/login');return actor;}
