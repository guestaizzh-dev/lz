import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire(new URL('../../services/api/package.json',import.meta.url));
const {Client}=require('pg');
const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
const output={date:'2026-10-09',mode:'read-only',liveDatabaseVerified:false};
try{
  await client.connect();await client.query('BEGIN READ ONLY');
  output.columns=(await client.query("SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  output.constraints=(await client.query("SELECT c.relname AS table_name, con.conname AS name,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname")).rows;
  output.indexes=(await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
  output.migrations=(await client.query('SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  output.liveDatabaseVerified=true;await client.query('ROLLBACK');
}catch(error){output.errorCode=error.code??'UNAVAILABLE';output.note='Current database metadata could not be verified. Source schema and migration files remain authoritative for this static audit.';}
finally{await client.end().catch(()=>{});await writeFile(new URL('../../outputs/audit-2026-10-09/database-evidence.json',import.meta.url),JSON.stringify(output,null,2));console.log(JSON.stringify({verified:output.liveDatabaseVerified,tables:output.columns?new Set(output.columns.map(row=>row.table_name)).size:0,errorCode:output.errorCode}));}
