import './env';
import { randomBytes,randomUUID } from 'node:crypto';
import { db,transaction,closeDB } from '../src/lib/db';
import { passwordHash } from '../src/lib/security';
import { z } from 'zod';
const [command,slug,email,role,name]=process.argv.slice(2);
const schoolSlug=z.string().regex(/^[a-z0-9-]{2,40}$/).parse(slug),address=z.email().parse(email).toLowerCase();
if(!['create','reset','disable'].includes(command))throw new Error('Uso: pnpm user:create create|reset|disable colegio correo rol "Nombre"');
const [school]=await db.query<{id:string}>('SELECT id FROM ce_schools WHERE slug=?',[schoolSlug]);
if(!school)throw new Error('Colegio inexistente. Créalo con el script schools.ts.');
if(command==='disable') {await db.run('UPDATE ce_users SET active=0 WHERE school_id=? AND email=?',[school.id,address]);console.log('Acceso desactivado.');}
else {
 const password=randomBytes(24).toString('base64url'),passwordHashValue=await passwordHash(password);
 if(command==='reset') {await transaction(async tx=>{const changed=await tx.run('UPDATE ce_users SET password_hash=? WHERE school_id=? AND email=?',[passwordHashValue,school.id,address]);if(!changed)throw new Error('Usuario no encontrado.');await tx.run('DELETE FROM ce_sessions WHERE user_id IN (SELECT id FROM ce_users WHERE school_id=? AND email=?)',[school.id,address]);});}
 else {const validRole=z.enum(['cobranza','seguimiento','directora']).parse(role);const validName=z.string().min(2).max(100).parse(name);await transaction(async(tx)=>{await tx.run('INSERT INTO ce_users(id,school_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)',[randomUUID(),school.id,validName,address,passwordHashValue,validRole,new Date().toISOString()]);});}
 console.log(`Cuenta: ${address}\nContraseña generada (entrégala por un canal privado): ${password}`);
}
await closeDB();
