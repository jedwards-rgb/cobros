import { randomBytes,createHash,timingSafeEqual } from 'node:crypto';
import { hash,verify } from '@node-rs/argon2';
import { db,transaction } from './db';
import { DomainError } from './domain';
import type { Actor } from './types';
export const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export const passwordHash=(password:string)=>hash(password,{memoryCost:19456,timeCost:2,parallelism:1});
export function safeEqual(a:string,b:string) {const x=Buffer.from(a);const y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
export async function rateLimit(key:string,limit=8) {
  await transaction(async(tx)=>{
    const keyHash=sha(key);const now=new Date().toISOString();
    await tx.run('INSERT INTO ce_login_attempts(key_hash,attempts,reset_at) VALUES (?,0,?) ON CONFLICT(key_hash) DO NOTHING',[keyHash,new Date(Date.now()+900000).toISOString()]);
    await tx.run('UPDATE ce_login_attempts SET attempts=attempts+1 WHERE key_hash=?',[keyHash]);
    let [r]=await tx.query<{attempts:number;reset_at:string}>('SELECT * FROM ce_login_attempts WHERE key_hash=?',[keyHash]);
    if(r.reset_at<now) {await tx.run('UPDATE ce_login_attempts SET attempts=1,reset_at=? WHERE key_hash=?',[new Date(Date.now()+900000).toISOString(),keyHash]);r={...r,attempts:1};}
    // Returning denial lets the increment commit even for blocked requests.
    return r.attempts<=limit;
  }).then(ok=>{if(!ok)throw new DomainError('Demasiados intentos. Espera 15 minutos.',429);});
}
let dummyHash:Promise<string>|undefined;
export async function login(school:string,email:string,password:string) {
  await rateLimit(`login:${school}:${email.toLowerCase()}`);
  const [user]=await db.query<Actor & {password_hash:string}>('SELECT u.*,s.name AS school_name FROM ce_users u JOIN ce_schools s ON s.id=u.school_id WHERE s.slug=? AND u.email=? AND u.active=1',[school,email.toLowerCase()]);
  dummyHash ||= passwordHash(randomBytes(32).toString('hex'));
  const valid=await verify(user?.password_hash || await dummyHash,password).catch(()=>false);
  if(!user||!valid)throw new DomainError('Colegio, correo o contraseña incorrectos.',401);
  const token=randomBytes(32).toString('hex');const csrf=randomBytes(32).toString('hex');
  await db.run('INSERT INTO ce_sessions(token_hash,user_id,csrf,expires_at,absolute_expires_at) VALUES (?,?,?,?,?)',[sha(token),user.id,csrf,new Date(Date.now()+1800000).toISOString(),new Date(Date.now()+28800000).toISOString()]);
  return {token,user};
}
export async function getActor(token:string|undefined):Promise<Actor|null> {
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const now=new Date().toISOString();
  const [actor]=await db.query<Actor>('SELECT u.id,u.school_id,u.name,u.email,u.role,s.name AS school_name,se.csrf FROM ce_sessions se JOIN ce_users u ON u.id=se.user_id JOIN ce_schools s ON s.id=u.school_id WHERE se.token_hash=? AND se.expires_at>? AND se.absolute_expires_at>? AND u.active=1',[sha(token),now,now]);
  if(actor) await db.run('UPDATE ce_sessions SET expires_at=? WHERE token_hash=?',[new Date(Date.now()+1800000).toISOString(),sha(token)]);
  return actor||null;
}
export function checkOrigin(request:Request) {
  const origin=request.headers.get('origin');
  const configured=process.env.APP_URL;
  if(!configured)throw new DomainError('Falta configurar APP_URL.',503);
  if(process.env.NODE_ENV==='production' && process.env.ALLOW_LOCAL_PREVIEW!=='true' && !configured.startsWith('https://'))throw new DomainError('Producción requiere HTTPS.',503);
  if(origin!==new URL(configured).origin)throw new DomainError('Origen no permitido.',403);
}
