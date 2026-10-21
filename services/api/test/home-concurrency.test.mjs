import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogService} from '../dist/catalog.js';
test('simultaneous public home reads share work, but never retain a completed or failed snapshot',async()=>{
 const service=new CatalogService({},{});let calls=0,finish;
 service.loadHome=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 const requests=Array.from({length:100},()=>service.home());assert.equal(calls,1);finish({title:'第一版'});assert.ok((await Promise.all(requests)).every(r=>r.title==='第一版'));
 const next=service.home();assert.equal(calls,2);finish({title:'第二版'});assert.equal((await next).title,'第二版');
 const old=service.home(),completeOld=finish;service.invalidateHome();const revised=service.home(),completeNew=finish;completeOld({title:'修改前'});await old;
 assert.equal(service.home(),revised);completeNew({title:'修改后'});assert.equal((await revised).title,'修改后');
 service.loadHome=()=>Promise.reject(Error('database unavailable'));await assert.rejects(service.home(),/database unavailable/);
 service.loadHome=async()=>({title:'数据库恢复'});assert.equal((await service.home()).title,'数据库恢复');
});
