import type { DB } from './db';

// Additive migration shared by the CLI and the standalone Neon SQL generator.
export const profileTables = [
`CREATE TABLE IF NOT EXISTS ce_guardian_contacts (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL, guardian_id TEXT NOT NULL,
 name TEXT NOT NULL, relationship TEXT NOT NULL CHECK(relationship IN ('madre','padre','otro')),
 email TEXT, phone TEXT, is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
 email_consent INTEGER NOT NULL DEFAULT 0 CHECK(email_consent IN (0,1)),
 whatsapp_consent INTEGER NOT NULL DEFAULT 0 CHECK(whatsapp_consent IN (0,1)),
 consent_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(email_consent=0 OR (email IS NOT NULL AND length(email)>0)),
 CHECK(whatsapp_consent=0 OR (phone IS NOT NULL AND length(phone)>0)),
 CHECK((email_consent=0 AND whatsapp_consent=0) OR length(COALESCE(consent_note,''))>=5),
 UNIQUE(school_id,id), FOREIGN KEY(school_id,guardian_id) REFERENCES ce_guardians(school_id,id))`,
`CREATE UNIQUE INDEX IF NOT EXISTS ce_one_primary_contact ON ce_guardian_contacts(school_id,guardian_id) WHERE is_primary=1`,
`CREATE INDEX IF NOT EXISTS ce_contact_family ON ce_guardian_contacts(school_id,guardian_id)`,
`CREATE TABLE IF NOT EXISTS ce_profile_history (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES ce_schools(id), actor_id TEXT,
 entity_type TEXT NOT NULL CHECK(entity_type IN ('guardian','student')), entity_id TEXT NOT NULL,
 action TEXT NOT NULL, reason TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(school_id,actor_id) REFERENCES ce_users(school_id,id))`,
`CREATE INDEX IF NOT EXISTS ce_profile_history_entity ON ce_profile_history(school_id,entity_type,entity_id,created_at,id)`,
`CREATE INDEX IF NOT EXISTS ce_student_family ON ce_students(school_id,guardian_id)`,
`CREATE INDEX IF NOT EXISTS ce_invoice_student ON ce_invoices(school_id,student_id)`,
];
export const profileBackfill = `INSERT INTO ce_guardian_contacts
 (id,school_id,guardian_id,name,relationship,email,phone,is_primary,email_consent,whatsapp_consent,consent_note,created_at,updated_at)
 SELECT g.id,g.school_id,g.id,g.name,'otro',g.email,g.phone,1,
 CASE WHEN g.email_consent=1 AND length(COALESCE(g.email,''))>0 AND length(COALESCE(g.consent_note,''))>=5 THEN 1 ELSE 0 END,
 CASE WHEN g.whatsapp_consent=1 AND length(COALESCE(g.phone,''))>0 AND length(COALESCE(g.consent_note,''))>=5 THEN 1 ELSE 0 END,
 g.consent_note,g.created_at,g.created_at FROM ce_guardians g
 WHERE NOT EXISTS(SELECT 1 FROM ce_guardian_contacts c WHERE c.school_id=g.school_id AND c.guardian_id=g.id)`;
export const profileColumns = {version:'INTEGER NOT NULL DEFAULT 1',archived_at:'TEXT'};
export const profileProjection = `UPDATE ce_guardians SET
 email=(SELECT c.email FROM ce_guardian_contacts c WHERE c.school_id=ce_guardians.school_id AND c.guardian_id=ce_guardians.id AND c.is_primary=1),
 phone=(SELECT c.phone FROM ce_guardian_contacts c WHERE c.school_id=ce_guardians.school_id AND c.guardian_id=ce_guardians.id AND c.is_primary=1),
 email_consent=(SELECT c.email_consent FROM ce_guardian_contacts c WHERE c.school_id=ce_guardians.school_id AND c.guardian_id=ce_guardians.id AND c.is_primary=1),
 whatsapp_consent=(SELECT c.whatsapp_consent FROM ce_guardian_contacts c WHERE c.school_id=ce_guardians.school_id AND c.guardian_id=ce_guardians.id AND c.is_primary=1),
 consent_note=(SELECT c.consent_note FROM ce_guardian_contacts c WHERE c.school_id=ce_guardians.school_id AND c.guardian_id=ce_guardians.id AND c.is_primary=1)
 WHERE EXISTS(SELECT 1 FROM ce_guardian_contacts c WHERE c.school_id=ce_guardians.school_id AND c.guardian_id=ce_guardians.id AND c.is_primary=1)`;
export async function migrateProfiles(tx:DB,postgres:boolean) {
 for(const table of ['ce_guardians','ce_students']) {
  const existing=postgres?[]:await tx.query<{name:string}>(`PRAGMA table_info(${table})`);
  for(const [column,type] of Object.entries(profileColumns)) {
   if(postgres)await tx.run(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
   else if(!existing.some(c=>c.name===column))await tx.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
 }
 for(const sql of profileTables)await tx.run(sql);
 await tx.run(profileBackfill);
 await tx.run(profileProjection);
}
