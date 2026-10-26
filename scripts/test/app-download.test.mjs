import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';

test('download preparation validates verified APK metadata and preserves fixed QR URL',async()=>{
 const runtime=resolve('.runtime'),root=await mkdtemp(join(runtime,'download-publish-test-'));
 const apk=resolve('outputs/android/daoxue-academy-0.3.18.apk'),url='https://cuecanvas.top/download/';
 const run=(version,targetUrl,out,notes='课程与阅读体验更新')=>spawnSync(process.execPath,['scripts/prepare-app-download.mjs',apk,version,'23',targetUrl,out,notes],{encoding:'utf8',windowsHide:true,env:{...process.env,ACADEMY_DOWNLOAD_DATE:'2026-10-25'}});
 try{
  const out=join(root,'valid');let result=run('0.3.18',url,out,'<script>alert(1)</script>');assert.equal(result.status,0,result.stderr);
  const metadata=JSON.parse(await readFile(join(out,'release.json'),'utf8'));
  assert.equal(metadata.sha256,'471d7f3f9bea03c3e9377c823109333a977aa23f6fbe03deb5aa41963399f4c5');assert.equal(metadata.pageUrl,url);assert.equal(metadata.androidUrl,url+'android.apk');
  const html=await readFile(join(out,'index.html'),'utf8');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('{{'));assert.ok(html.includes('2026-10-25'));
  assert.equal(run('0.3.18',url,out).status,1,'Do not overwrite an existing prepared release');
  assert.equal(run('0.3.99',url,join(root,'mismatch')).status,1,'Do not mislabel an APK version');
  for(const invalid of ['http://cuecanvas.top/download/','https://cuecanvas.top/download/?v=1','https://user:pass@cuecanvas.top/download/'])assert.equal(run('0.3.18',invalid,join(root,'invalid')).status,1);
 }finally{
  assert.ok(resolve(root).startsWith(runtime+sep));await rm(root,{recursive:true,force:true});
 }
});
