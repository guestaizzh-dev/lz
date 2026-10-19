import {spawn} from 'node:child_process';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Pool} from 'pg';

const source=new URL(process.env.DATABASE_URL??'');
if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('Tests require a local development database server');
const requested=process.argv.slice(2);
const known=(await readdir('test')).filter(name=>name.endsWith('.test.mjs'));
if(requested.some(name=>!known.includes(name)))throw Error('Unknown test file; pass test filenames without paths');
const selected=requested.length?requested:known.sort();
const database='academy_test_'+process.pid+'_'+Date.now();
const target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()}),media=await mkdtemp(join(tmpdir(),'academy-test-'));
const env={...process.env,NODE_ENV:'test',DATABASE_URL:target.toString(),MEDIA_DIR:media,ORDER_RESERVATION_PREVIEW:'false'};
let created=false;
function run(args){return new Promise((resolveRun,reject)=>{
  const child=spawn(process.execPath,args,{env,stdio:'inherit',windowsHide:true});
  child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolveRun():reject(Error('Test command failed: '+(signal??code))));
});}
try{
  await pool.query('CREATE DATABASE "'+database+'"');created=true;
  console.log('Running tests in an isolated temporary database.');
  await run(['node_modules/prisma/build/index.js','migrate','deploy']);
  const files=selected.map(name=>'test/'+name);
  await run(['--test','--test-timeout=60000','--test-concurrency=1',...files]);
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
  try{if(created)await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');}
  finally{await pool.end();if(!resolve(media).startsWith(resolve(tmpdir())+sep))throw Error('Unexpected test media path');await rm(media,{recursive:true,force:true});}
}
