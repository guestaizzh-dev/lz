import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';

// Visual audit against the live HTTPS API; read-only requests, no fixtures.
const require=createRequire(new URL('../../services/api/package.json',import.meta.url));
const {chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const api='https://academy.43-160-229-173.sslip.io/api/v1';
const output=resolve(process.env.UI_AUDIT_OUTPUT??'outputs/ui-audit-2026-10-19');
const web=resolve('apps/mobile/unpackage/dist/build/web');
const routes=(process.env.UI_AUDIT_ROUTES??[
  'pages/index/index',
  'pages/academy/index',
  'pages/discover/index',
  'pages/shop/index',
  'pages/profile/index',
  'pages/product/detail?id=a82ad172-4b8e-4a85-80c6-9928be6ce79c',
  'pages/article/detail?id=7a61ae4e-621a-4bc9-a07a-36d5e90a6811',
  'pages/course/detail?id=e45ec267-d345-4eb0-a8fe-a973326a43ef',
  'pages/teacher/detail?id=c432b13a-ddf1-4a0c-a71e-ab43ba917320',
  'pages/event/detail?id=5143e2e9-bfc9-4b57-9095-7530f594468e',
  'pages/live/index',
  'pages/community/index',
  'pages/search/index?q=道德经',
  'pages/membership/index',
  'pages/membership/orders',
  'pages/shop/cart',
  'pages/shop/orders',
  'pages/course/library',
  'pages/profile/library?kind=notes',
  'pages/profile/messages',
  'pages/profile/settings',
  'pages/profile/progression',
  'pages/order/detail'
].join(',')).split(',');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{
  const path=resolve(web,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(path!==web&&!path.startsWith(web+sep)){res.writeHead(403).end();return;}
  const file=path===web?resolve(web,'index.html'):path;
  res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf','.otf':'font/otf','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');
  res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'msedge'});
const [vw,vh]=(process.env.UI_AUDIT_VIEWPORT??'390x844').split('x').map(Number);
const page=await browser.newPage({viewport:{width:vw,height:vh},deviceScaleFactor:2,isMobile:true,hasTouch:true});
page.setDefaultTimeout(15000);
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()===404)console.log('404',r.url());});
await page.route('**/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  const cors={'access-control-allow-origin':base,'access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'};
  if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
  const headers={...req.headers(),origin:'https://academy.43-160-229-173.sslip.io'};delete headers.host;
  const response=await page.request.fetch(api+url.pathname.replace('/api/v1','')+url.search,{method:req.method(),headers,data:req.postData()??undefined});
  await route.fulfill({response,headers:{...response.headers(),...cors}});
});
if(process.env.UI_AUDIT_LOGIN==='1'){
  await page.goto(base+'/#/pages/auth/login',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  await page.screenshot({path:output+'/auth-login.png',animations:'disabled'});
  await page.locator('input').nth(0).fill('19900001002');
  await page.locator('.send-code').click();
  await page.getByText(/秒后重发/).waitFor();
  await page.locator('input').nth(1).fill('123456');
  await page.locator('.consent-touch').click();
  await page.locator('.login-submit').click();
  await page.locator('.login-submit').waitFor({state:'hidden',timeout:20000});
  console.log('logged in');
}
for(const routePath of routes){
  const before=errors.length;
  const [path,query]=routePath.split('?');
  await page.goto(base+'/#/'+path+(query?'?'+query:''),{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);
  await page.waitForFunction(()=>![...document.querySelectorAll('.state-title')].some(e=>e.textContent==='正在整理内容'),{timeout:12000}).catch(()=>{});
  await page.evaluate(()=>document.fonts.ready);
  const name=routePath.replace(/[?&=]/g,'-').replace(/[\/]/g,'-').slice(0,80);
  await page.screenshot({path:output+'/'+name+'.png',animations:'disabled'});
  console.log(name,JSON.stringify(await page.evaluate(()=>({url:location.hash,w:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1}))));
  if(errors.length>before)console.log('ERR@'+name,JSON.stringify([...new Set(errors.slice(before))]));
}
console.log(JSON.stringify({errors:[...new Set(errors)]}));
await browser.close();server.close();
