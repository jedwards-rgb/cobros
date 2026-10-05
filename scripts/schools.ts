import './env';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db,closeDB } from '../src/lib/db';
const [slug,name]=process.argv.slice(2);z.string().regex(/^[a-z0-9-]{2,40}$/).parse(slug);z.string().min(2).max(100).parse(name);
await db.run('INSERT INTO ce_schools(id,name,slug,created_at) VALUES (?,?,?,?)',[randomUUID(),name,slug,new Date().toISOString()]);console.log('Colegio creado.');await closeDB();
