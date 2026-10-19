import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='outputs/cohort-compensation-2026-10-13/',read=name=>readFileSync(root+name,'utf8'),json=name=>JSON.parse(read(name));
const before=json('local-before.json'),after=json('local-after.json');
assert.equal(before.migrations,39);assert.equal(after.migrations,40);
for(const key of Object.keys(before).filter(k=>k!=='migrations'))assert.deepEqual(after[key],before[key],'Local data changed: '+key);
const counts=[];for(const name of ['api-tests.log','related-tests.log']){const log=read(name),tests=Number(log.match(/tests (\d+)/)?.[1]),passed=Number(log.match(/pass (\d+)/)?.[1]);assert.ok(tests>0);assert.equal(passed,tests);assert.match(log,/fail 0/);counts.push({log:name,tests,passed});}
const browser=json('browser-checks.json');assert.equal(browser.status,'passed');assert.equal(browser.checks.length,9);assert.deepEqual(browser.errors,[]);
assert.match(read('api-build.log'),/tsc -p tsconfig.json/);assert.match(read('admin-typecheck.log'),/tsc --noEmit/);assert.match(read('admin-build.log'),/Build index.html/);assert.match(read('app-web-build.log'),/编译成功/);
const hash=createHash('sha256').update(readFileSync('docs/25-commercial-readiness-review.md')).digest('hex');assert.equal(hash,'c24a94ff6fb6e1735cc85b57a0412a249858dd2d77d1cfd46edf771958222d04');
const plan=readFileSync('docs/26-remaining-development-plan.md','utf8'),rows=[...plan.matchAll(/^\| ([A-Z]\d{2}) \| (已完成|实现完成·待验证|待验收|进行中|阻塞|待执行) \|/gm)];assert.equal(rows.length,110);
const statuses={};for(const r of rows)statuses[r[2]]=(statuses[r[2]]??0)+1;
const result={stage:'cohort-schedule-and-compensation-53',date:'2026-10-13',status:'local-validation-passed',apiTests:counts,totalTests:counts.reduce((n,v)=>n+v.tests,0),browserFlows:browser.checks.length,builds:{api:true,adminTypes:true,adminProduction:true,appWeb:true,appCompiler:'HBuilderX 5.26 VDOM'},localDatabase:{migration:40,tableCount:after.tables,models:(readFileSync('services/api/prisma/schema.prisma','utf8').match(/^model /gm)??[]).length,dataPreserved:true,before,after},planStatuses:statuses,snapshot25Unchanged:true,commercialReadiness:{completed:38,total:131,percentage:29.0,changed:false},deployed:false,newApk:false,nativeAcceptance:false,realPaymentEvidence:false,next:'A05 paid actual fulfilment and revenue/settlement/points; iOS cohort and A01/M07/A07/A08 follow'};
writeFileSync(root+'validation.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({tests:result.totalTests,browserFlows:result.browserFlows,migration:40,dataPreserved:true,planStatuses:statuses}));
