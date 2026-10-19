import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base='https://academy.43-160-229-173.sslip.io/api/v1',checks=[],output='outputs/admin-operations-2026-10-14';
await mkdir(output,{recursive:true});
const login=await fetch(base+'/admin/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://academy.43-160-229-173.sslip.io'},body:JSON.stringify({username:process.env.ACADEMY_ADMIN_USER??'admin',password:process.env.ACADEMY_ADMIN_PASSWORD})});
assert.equal(login.status,200);const session=await login.json(),cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
checks.push('实际HTTPS管理员登录成功');
async function get(path,authorized=true){const response=await fetch(base+path,{headers:authorized?{Cookie:cookie}:{} });const body=await response.json();return {status:response.status,body};}
try{
 const health=await get('/health',false);assert.equal(health.status,200);assert.equal(health.body.status,'ok');checks.push('数据库/API健康');
 const actor=await get('/admin/auth/session');for(const p of ['finance.read','operations.read','operations.retry'])assert.ok(actor.body.user.permissions.includes(p));checks.push('真实管理员会话有新增能力');
 for(const path of ['/admin/finance/summary','/admin/finance/payments','/admin/finance/refunds','/admin/finance/journals','/admin/operations/summary','/admin/operations/jobs']){
  const response=await get(path);assert.equal(response.status,200,JSON.stringify(response.body));
  if(path.endsWith('/summary')){if(path.includes('/finance/'))assert.ok(Array.isArray(response.body.currencies));else for(const state of ['READY','RUNNING','DEAD','DONE'])assert.equal(typeof response.body.counts[state],'number');}
  else{assert.ok(Array.isArray(response.body.items));assert.equal(typeof response.body.total,'number');}
  checks.push('公网真实接口 '+path+' 可用');
 }
 for(const path of ['/admin/finance/summary','/admin/operations/jobs'])assert.equal((await get(path,false)).status,401);checks.push('未登录新增接口拒绝访问');
 assert.equal((await get('/admin/finance/summary?from=2026-01-01&to=2025-01-01')).status,400);checks.push('公网日期验证生效');
 for(const path of ['/admin/course-orders?page=1&size=1','/admin/membership-orders?page=1&size=1','/admin/product-orders?page=1&size=1','/admin/booking-orders?page=1&size=1','/admin/cohort-orders?page=1&size=1'])assert.equal((await get(path)).status,200);checks.push('五个原业务订单接口兼容');
 assert.equal((await get('/catalog/home',false)).status,200);checks.push('App原首页API兼容');
 console.log(JSON.stringify({passed:checks.length}));
}finally{
 await fetch(base+'/admin/auth/logout',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':session.csrfToken,Origin:'https://academy.43-160-229-173.sslip.io'}}).catch(()=>{});
 await writeFile(output+'/online-http.json',JSON.stringify({environment:base,checks,readOnlyBusinessChecks:true,noProductionRetry:true},null,2));
}
