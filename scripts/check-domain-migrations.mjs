import {createRequire} from 'node:module';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
const {Client}=createRequire(new URL('../services/api/package.json',import.meta.url))('pg');
const url=new URL(process.env.DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(url.hostname)||process.env.NODE_ENV==='production')throw new Error('Only loopback development databases are allowed.');
const database='daoxue_schema_check';
const management=new Client({connectionString:process.env.DATABASE_URL});
await management.connect();
try{
  await management.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,[database]);
  await management.query(`DROP DATABASE IF EXISTS ${database}`);
  await management.query(`CREATE DATABASE ${database}`);
}finally{await management.end();}
url.pathname='/'+database;
const client=new Client({connectionString:url.toString()});await client.connect();
const migrations=readdirSync(new URL('../services/api/prisma/migrations/',import.meta.url)).filter(x=>/^\d/.test(x)).sort();
let current;
try{
  for(const migration of migrations){
    current=migration;
    await client.query('BEGIN');
    await client.query(readFileSync(new URL(`../services/api/prisma/migrations/${migration}/migration.sql`,import.meta.url),'utf8'));
    await client.query('COMMIT');
  }
  const tables=await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  const constraints=await client.query("SELECT contype,count(*)::int FROM pg_constraint JOIN pg_namespace ON pg_namespace.oid=connamespace WHERE nspname='public' GROUP BY contype");
  mkdirSync(new URL('../outputs/crud-2026-10-09/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../outputs/crud-2026-10-09/schema-check.json',import.meta.url),JSON.stringify({database,migrations,tables:tables.rows[0].count,constraints:constraints.rows},null,2));
  console.log(JSON.stringify({migrations:migrations.length,tables:tables.rows[0].count,constraints:constraints.rows}));
}catch(error){await client.query('ROLLBACK');console.error(JSON.stringify({migration:current,code:error.code,message:error.message}));process.exitCode=1;}
finally{await client.end();}
