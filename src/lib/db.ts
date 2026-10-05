import { DatabaseSync } from 'node:sqlite';
import { Pool, type PoolClient } from 'pg';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Param = string | number | null;
export type Row = Record<string, string | number | null>;
export interface DB { query<T = Row>(sql: string, params?: Param[]): Promise<T[]>; run(sql: string, params?: Param[]): Promise<number>; }
let sqlite: DatabaseSync | undefined;
let pool: Pool | undefined;
let serial: Promise<unknown> = Promise.resolve();
function sqliteDB() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_PREVIEW !== 'true') throw new Error('Producción requiere DATABASE_URL de PostgreSQL.');
  if (!sqlite) {
    const path = process.env.SQLITE_PATH === ':memory:' ? ':memory:' : resolve(process.env.SQLITE_PATH || 'data/cobroedu.sqlite');
    if(path!==':memory:')mkdirSync(dirname(path), {recursive:true}); sqlite = new DatabaseSync(path);
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  }
  return sqlite;
}
function postgres() {
  if (!pool) pool = new Pool({connectionString:process.env.DATABASE_URL, max:5,
    ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:true,...(process.env.DATABASE_CA_FILE?{ca:readFileSync(process.env.DATABASE_CA_FILE,'utf8')}:{})}});
  return pool;
}
function pgSQL(sql:string) { let index=0; return sql.replace(/\?/g,()=>`$${++index}`); }
function adapter(client?: PoolClient): DB {
  if (process.env.DATABASE_URL) return {
    query:async <T>(sql:string,params:Param[]=[]) => (await (client || postgres()).query(pgSQL(sql),params)).rows as T[],
    run:async (sql,params=[]) => (await (client || postgres()).query(pgSQL(sql),params)).rowCount || 0,
  };
  return {
    query:async <T>(sql:string,params:Param[]=[]) => sqliteDB().prepare(sql).all(...params) as T[],
    run:async (sql,params=[]) => Number(sqliteDB().prepare(sql).run(...params).changes),
  };
}
function exclusive<T>(fn:()=>Promise<T>):Promise<T> { const result=serial.then(fn,fn); serial=result.catch(()=>{}); return result; }
export const db:DB = {
  query:<T>(sql:string,params:Param[]=[]) => process.env.DATABASE_URL?adapter().query<T>(sql,params):exclusive(()=>adapter().query<T>(sql,params)),
  run:(sql,params=[]) => process.env.DATABASE_URL?adapter().run(sql,params):exclusive(()=>adapter().run(sql,params)),
};
export async function transaction<T>(fn:(tx:DB)=>Promise<T>):Promise<T> {
  if (process.env.DATABASE_URL) {
    const client=await postgres().connect();
    try { await client.query('BEGIN'); const value=await fn(adapter(client)); await client.query('COMMIT'); return value; }
    catch(e) { await client.query('ROLLBACK'); throw e; } finally {client.release();}
  }
  return exclusive(async()=>{
    const conn=sqliteDB(); conn.exec('BEGIN IMMEDIATE');
    try {const value=await fn(adapter()); conn.exec('COMMIT'); return value;} catch(e) {conn.exec('ROLLBACK');throw e;}
  });
}
export async function closeDB() { if(pool) {await pool.end();pool=undefined;} if(sqlite) {sqlite.close();sqlite=undefined;} }
