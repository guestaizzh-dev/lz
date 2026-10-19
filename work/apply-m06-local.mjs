import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../services/api/package.json',import.meta.url)),{Pool}=require('pg');
const url=new URL(process.env.DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&process.env.NODE_ENV!=='production');
const pool=new Pool({connectionString:url.toString()}),tables=['User','Article','Teacher','Course','Product','Event','Note','PracticeLog','TradeOrder','Enrollment','ForumThread','Feedback','Membership','Notification','DeviceToken'];
async function snapshot(){const out={};for(const table of tables)out[table]=Number((await pool.query('SELECT count(*) n FROM "'+table+'"')).rows[0].n);return out;}
try{const before=await snapshot();await new Promise((ok,no)=>{const p=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:new URL('../services/api/',import.meta.url),env:process.env,stdio:'ignore',windowsHide:true});p.on('error',no);p.on('exit',code=>code===0?ok():no(Error('Local migration failed')));});const after=await snapshot();assert.deepEqual(after,before);const migrations=Number((await pool.query('SELECT count(*) n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].n);await writeFile(new URL('../outputs/content-m06-share-2026-10-15/local-migration.json',import.meta.url),JSON.stringify({localOnly:true,migrations,before,after,countsPreserved:true},null,2));console.log(JSON.stringify({localOnly:true,migrations,countsPreserved:true}));}finally{await pool.end();}
