import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(resolve(process.env.ACADEMY_BROWSER_MODULE??'node_modules','package.json'));
const {chromium}=require('playwright');
const root=resolve(process.argv[2]??'outputs/app-download-0318'),output=resolve('outputs/download-page-review');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname.replace(/^\/download\//,'')||'index.html';if(!/^[\w.-]+$/.test(name))throw Error();const data=await readFile(resolve(root,name));res.setHeader('Content-Type',({'html':'text/html; charset=utf-8',css:'text/css',js:'application/javascript',svg:'image/svg+xml',png:'image/png',json:'application/json'})[name.split('.').pop()]??'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const url=`http://127.0.0.1:${server.address().port}/download/`;
const browser=await chromium.launch({channel:'msedge',headless:true});const checks=[],errors=[];
try{
 for(const [width,height]of [[320,740],[390,844],[844,390],[1280,900]]){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('.poster-qr').waitFor();
  assert.equal(await page.locator('#download').getAttribute('href'),'./android.apk');assert.ok(await page.locator('.metadata').innerText().then(x=>x.includes('0.3.18')));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${output}/${width}.png`,fullPage:true});checks.push({name:`layout-${width}`,pass:true});await page.close();
 }
 for(const [kind,ua]of [['wechat','Mozilla/5.0 (Linux; Android 13) MicroMessenger/8.0'],['ios','Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)']]){
  const page=await browser.newPage({userAgent:ua,viewport:{width:390,height:844}});await page.goto(url);
  if(kind==='wechat'){await page.locator('#download').click();assert.equal(await page.locator('#wechat').isVisible(),true);assert.ok(page.url().endsWith('/download/'));}
  else{assert.equal(await page.locator('#download').getAttribute('href'),null);assert.equal(await page.locator('#download').getAttribute('aria-disabled'),'true');}
  await page.screenshot({path:`${output}/${kind}.png`,fullPage:true});checks.push({name:kind,pass:true});await page.close();
 }
 assert.deepEqual(errors,[]);await (await import('node:fs/promises')).writeFile(`${output}/checks.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors:errors.length}));
}finally{await browser.close();await new Promise(done=>server.close(done));}
