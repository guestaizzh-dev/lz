import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness(){
  let include=true;
  const source=readFileSync(new URL('../../../apps/mobile/lib/forum-media.ts',import.meta.url),'utf8').split('\n').filter(line=>{const platform=line.match(/\/\/ #ifdef (\w+)/)?.[1];if(platform){include=platform==='APP';return false;}if(line.includes('// #endif')){include=true;return false;}return include;}).join('\n');
  const bytes=Buffer.from('abcdefghijklmnopqrst'),files=new Map(),currentUser={value:{id:'account-a'}},calls=[],uploads=[],tasks=[];let generation=1,token='old',closed=0,failure='',switchOnChunk=false,chosen=null;
  const task={id:'upload-a',sectionId:'section',name:'read.wav',mime:'audio/wav',bytes:bytes.length,receivedBytes:0,chunkBytes:8,state:'UPLOADING',assetId:null},control={stopped:false},file={name:'read.wav',mime:'audio/wav',bytes:bytes.length,path:'content://source/read.wav',requestKey:'key'};
  const copy=()=>JSON.parse(JSON.stringify(task));
  const request=async(path,options)=>{calls.push({path,options});if(path==='/auth/me'){token='fresh';return{};}if(path.endsWith('/complete')){task.state='PROCESSING';task.assetId='asset-a';}return copy();};
  const fs={mkdirSync(){},open:o=>o.success({fd:'fd-a'}),read:o=>{assert.equal(o.fd,'fd-a');const slice=bytes.subarray(o.position,o.position+o.length);new Uint8Array(o.arrayBuffer).set(slice);o.success({bytesRead:slice.length});},writeFile:o=>{files.set(o.filePath,Buffer.from(o.data));o.success();},closeSync:o=>{assert.equal(o.fd,'fd-a');closed++;},unlinkSync:path=>files.delete(path)};
  const uni={env:{CACHE_PATH:'/cache'},getFileSystemManager:()=>fs,chooseFile:o=>{if(chosen instanceof Error)o.fail({errCode:1101001,errMsg:chosen.message});else o.success({tempFiles:[chosen]});},uploadFile:o=>{
    let aborted=false,progress;uploads.push({path:o.filePath,authorization:o.header.Authorization,bytes:files.get(o.filePath)});
    setImmediate(()=>{if(failure){const mode=failure;failure='';if(mode==='401')o.success({statusCode:401,data:'{"message":"expired"}'});else o.fail({errMsg:'network failure'});return;}progress?.({progress:50});if(aborted){o.fail({errMsg:'aborted'});return;}if(switchOnChunk){currentUser.value={id:'account-b'};generation++;}const offset=Number(o.url.split('/').pop()),data=files.get(o.filePath);assert.deepEqual(data,bytes.subarray(offset,offset+data.length));task.receivedBytes=offset+data.length;o.success({statusCode:201,data:JSON.stringify(copy())});});
    return{abort:()=>{aborted=true;},onProgressUpdate:cb=>{progress=cb;}};
  }};
  const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,uni,console,require:id=>id==='./api'?{apiBase:'https://academy.test/api/v1',request}:id==='./session'?{currentUser,sessionGeneration:()=>generation,accessToken:()=>token}:{studyEventId:()=> 'new-key'}});
  return{exports,file,control,task,files,calls,uploads,tasks,closed:()=>closed,setFailure:mode=>{failure=mode;},switchDuringChunk:()=>{switchOnChunk=true;},choose:value=>{chosen=value;},run:(initial=null,onProgress=()=>{})=>exports.uploadForumMedia(file,'section',initial,control,t=>tasks.push(t),onProgress)};
}

test('native upload reads bounded chunks and removes its per-user staging file',async()=>{
  const h=harness(),result=await h.run();assert.equal(result.state,'PROCESSING');assert.deepEqual(h.uploads.map(u=>u.bytes.length),[8,8,4]);assert.ok(h.uploads.every(u=>u.path==='/cache/academy-forum-account-a/upload-a.chunk'));assert.equal(h.files.size,0);assert.equal(h.closed(),1);assert.equal(h.calls.filter(c=>c.path.endsWith('/complete')).length,1);
});
test('native 401 refreshes through the existing session flow and retries only that chunk',async()=>{
  const h=harness();h.setFailure('401');await h.run();assert.deepEqual(h.uploads.slice(0,2).map(u=>u.authorization),['Bearer old','Bearer fresh']);assert.equal(h.calls.filter(c=>c.path==='/auth/me').length,1);assert.equal(h.files.size,0);
});
test('native network failure keeps an acknowledged task and resumes from server progress',async()=>{
  const h=harness();h.task.receivedBytes=8;h.setFailure('network');await assert.rejects(h.run(h.task),/网络中断/);assert.equal(h.files.size,0);assert.equal(h.task.receivedBytes,8);await h.run(h.task);assert.equal(h.uploads[1].bytes.toString(),'ijklmnop');assert.equal(h.task.state,'PROCESSING');
});
test('account switch or explicit pause never completes or publishes a stale upload',async()=>{
  const h=harness();h.switchDuringChunk();await assert.rejects(h.run(),/账号已变化/);assert.equal(h.files.size,0);assert.equal(h.calls.some(c=>c.path.endsWith('/complete')),false);
  const paused=harness();await assert.rejects(paused.run(null,()=>{paused.control.stopped=true;paused.control.abort();}),/已暂停/);assert.equal(paused.files.size,0);assert.equal(paused.calls.some(c=>c.path.endsWith('/complete')),false);
});
test('file selection cancellation is quiet and invalid type or oversized files are rejected',async()=>{
  const h=harness();h.choose(new Error('cancel'));assert.equal(await h.exports.chooseForumMedia('video'),null);h.choose({name:'not-video.html',path:'file',size:10});await assert.rejects(h.exports.chooseForumMedia('video'),/MP4/);h.choose({name:'long.mp4',path:'file',size:268435457});await assert.rejects(h.exports.chooseForumMedia('video'),/256MiB/);
});
