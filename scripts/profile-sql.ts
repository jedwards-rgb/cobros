import { writeFileSync } from 'node:fs';
import { profileTables,profileColumns,profileBackfill,profileProjection } from '../src/lib/profile-migration';
const output=process.argv[2];if(!output)throw new Error('Indica el archivo SQL de salida.');
const statements=[
 '-- CobroEdu · Etapa 2: contactos, edición e historial. Migración aditiva; no elimina familias ni movimientos.',
 '-- Ejecutar en la rama de producción con respaldo previo y sin registrar datos durante la actualización.',
 'BEGIN',"SET LOCAL lock_timeout='10s'","SET LOCAL statement_timeout='120s'",'SET LOCAL search_path TO public',
 'LOCK TABLE ce_guardians,ce_students IN SHARE ROW EXCLUSIVE MODE',
 ...['ce_guardians','ce_students'].flatMap(table=>Object.entries(profileColumns).map(([name,type])=>`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${type}`)),
 ...profileTables,profileBackfill,profileProjection,
 `DO $$ DECLARE t text; r text; BEGIN FOREACH t IN ARRAY ARRAY['ce_guardian_contacts','ce_profile_history'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF; END LOOP; END LOOP; END $$`,
 'COMMIT',
 'SELECT s.name AS colegio,COUNT(g.id) AS acudientes,(SELECT COUNT(*) FROM ce_guardian_contacts c WHERE c.school_id=s.id) AS contactos FROM ce_schools s LEFT JOIN ce_guardians g ON g.school_id=s.id GROUP BY s.id,s.name ORDER BY s.name',
];
writeFileSync(output,statements.map(s=>s.startsWith('--')?s:s+';').join('\n\n')+'\n','utf8');
console.log('Migración SQL generada. No se conectó a ninguna base de datos.');
