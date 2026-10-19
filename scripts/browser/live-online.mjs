import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../services/api/package.json',import.meta.url)),{WebSocket}=require('ws'),{chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const origin='https://academy.43-160-229-173.sslip.io',base=origin+'/api/v1',checks=[];
async function get(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);return r;}
assert.equal((await (await get('/health')).json()).status,'ok');checks.push('公网HTTPS数据库健康');
const player=await get('/live/player');assert.equal(player.headers.get('x-frame-options'),null);assert.ok(player.headers.get('content-security-policy').includes('coolgcloud.com'));checks.push('双层代理允许受控iframe且保留播放器CSP');
assert.ok((await (await get('/live/player/client.js')).text()).includes('muted:true'));assert.ok((await (await get('/live/player/sdk.js')).text()).length>100000);checks.push('正式ZEGO SDK与最新静音播放器发布');
const callback=await fetch(base+'/live/zego/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(callback.status,401);checks.push('公网回调路由及验签拒绝无签名请求（不等于服务商回调验收）');
await new Promise((ok,fail)=>{const socket=new WebSocket(origin.replace('https:','wss:')+'/api/v1/live/socket',{origin,handshakeTimeout:10000});const timer=setTimeout(()=>{socket.terminate();fail(Error('WebSocket timeout'));},10000);socket.on('open',()=>{checks.push('公网两层WebSocket升级通过');socket.send(JSON.stringify({type:'auth',key:'x'.repeat(43)}));});socket.on('close',code=>{clearTimeout(timer);try{assert.equal(code,4401);checks.push('讨论Socket拒绝无效观看凭据');ok();}catch(e){fail(e);}});socket.on('error',fail);});
let browser;try{
 browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/user/login');await page.getByPlaceholder('请输入管理账号').fill('admin');await page.getByPlaceholder('请输入密码').fill(process.env.ACADEMY_ADMIN_PASSWORD);await page.getByRole('button',{name:'登 录',exact:true}).click();await page.waitForURL(url=>['/workspace','/dashboard/analysis'].includes(url.pathname));checks.push('admin现有密码实际后台登录');
 const options=await page.evaluate(async()=>{const r=await fetch('/api/v1/admin/live/options');return {status:r.status,value:await r.json()};});assert.equal(options.status,200);assert.equal(options.value.rtcReady,true);assert.equal('secret' in options.value,false);checks.push('线上RTC已按用户决定启用，管理响应不含密钥');
 for(const [path,label]of [['/live-host','我的开播安排'],['/content/live','场次管理'],['/content/courses','课程与研习']]){await page.goto(origin+path);await page.getByText(label,{exact:true}).first().waitFor();assert.equal((await page.locator('.ant-alert-error').count()),0);checks.push('实际Pro页面 '+label);}
 await page.screenshot({path:'outputs/zego-rtc-r1-2026-10-13/online-admin.png'});assert.equal(errors.length,0,JSON.stringify(errors));
 await writeFile('outputs/zego-rtc-r1-2026-10-13/online-checks.json',JSON.stringify({status:'passed',checkedAt:new Date().toISOString(),release:'20261014-live-r1-01',checks,providerPublicCallbackAcceptance:false,nativeAcceptance:false,productionBusinessFixturesCreated:false},null,2));
}finally{await browser?.close();}
console.log(JSON.stringify({passed:checks.length}));
