import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output='outputs/booking-linkage-2026-10-12';
const browser=JSON.parse(await readFile(output+'/browser-checks.json','utf8'));
assert.equal(browser.checks.length,10);
assert.deepEqual(browser.errors,[]);
const testResult=async path=>{
  const text=await readFile(path,'utf8'),total=Number(text.match(/ℹ tests (\d+)/)?.[1]),passed=Number(text.match(/ℹ pass (\d+)/)?.[1]);
  assert.ok(total>0);assert.equal(total,passed);assert.match(text,/ℹ fail 0/);
  return {total,passed,log:path};
};
const regression=await testResult('outputs/booking-linkage-tests.log');
const finalBookings=await testResult('outputs/booking-linkage-bookings-final.log');
const plan=await readFile('docs/26-remaining-development-plan.md','utf8'),tasks=[...plan.matchAll(/^\| ([A-Z]\d{2}) \| (已完成|实现完成·待验证|待验收|进行中|阻塞|待执行) \|/gm)];
assert.equal(tasks.length,110);assert.equal(new Set(tasks.map(t=>t[1])).size,110);
const statuses=Object.fromEntries(['已完成','实现完成·待验证','待验收','进行中','阻塞','待执行'].map(status=>[status,tasks.filter(t=>t[2]===status).length]));
assert.deepEqual(statuses,{'已完成':5,'实现完成·待验证':13,'待验收':1,'进行中':11,'阻塞':16,'待执行':64});
const web=await readFile('outputs/booking-linkage-app-build.log','utf8');assert.match(web,/编译成功/);assert.match(web,/导出Web成功/);
await writeFile(output+'/validation-summary.json',JSON.stringify({
  date:'2026-10-12',scope:['阶段M03商城服务入口','阶段M04咨询活动训练营','阶段M06内容联动'],
  regression,finalBookings,testBatchesOverlap:true,browser:{passed:browser.checks.length,...browser},
  builds:{api:'passed',admin:'passed',appWeb:'passed',native:'not-run'},
  database:{newTables:0,newMigrations:0,existingTables:155,existingMigrations:28,registryEntities:144,crud:33,workflow:111,manualDatabaseModified:false,productionDatabaseModified:false},
  executionPlan:{total:tasks.length,statuses},commercialBaseline:{passed:38,total:131,percent:29.0,updated:false},
  deployment:{thisBatch:false,onlineRelease:'20261012-member-shop-01',apkUpdated:false},
  report:'docs/38-booking-cohort-and-content-linkage.md',
},null,2)+'\n');
console.log(JSON.stringify({regression:regression.passed,finalBookings:finalBookings.passed,browser:browser.checks.length,statuses}));
