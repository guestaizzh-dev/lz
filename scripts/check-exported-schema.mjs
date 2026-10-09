import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {Client}=createRequire(new URL('../services/api/package.json',import.meta.url))('pg');
const url=new URL(process.env.DATABASE_URL??'');
if(process.env.NODE_ENV==='production'||!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Export validation requires a local development database');
const database='daoxue_schema_export_check',management=new Client({connectionString:url.toString()});
await management.connect();
try{await management.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await management.query(`DROP DATABASE IF EXISTS ${database}`);await management.query(`CREATE DATABASE ${database}`);}finally{await management.end();}
url.pathname='/'+database;const client=new Client({connectionString:url.toString()});await client.connect();
try{
  await client.query(readFileSync(new URL('../outputs/crud-2026-10-09/database-schema.sql',import.meta.url),'utf8'));
  const tables=(await client.query("SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count;
  const foreignKeys=(await client.query("SELECT count(*)::integer AS count FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public' AND k.contype='f'")).rows[0].count;
  assert.equal(tables,148);assert.equal(foreignKeys,402);
  const result={standaloneSchemaRestored:true,tables,foreignKeys};
  writeFileSync(new URL('../outputs/crud-2026-10-09/schema-export-check.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await client.end();}
