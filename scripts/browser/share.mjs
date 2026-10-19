import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../services/api/package.json',import.meta.url)),{Pool}=require('pg'),{chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const source=new URL(process.env.DATABASE_URL);if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('Local isolated database required');
const database='academy_test_share_ui_'+Date.now(),target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()}),output=resolve('outputs/content-m06-share-2026-10-15'),checks=[],errors=[];
await mkdir(output,{recursive:true});await pool.query('CREATE DATABASE "'+database+'"');Object.assign(process.env,{DATABASE_URL:target.toString(),NODE_ENV:'test',PUBLIC_APP_URL:'',PUBLIC_ANDROID_DOWNLOAD_URL:'',PUBLIC_IOS_DOWNLOAD_URL:''});
let db,app,browser;
try{
  await new Promise((ok,no)=>{const child=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:resolve('services/api'),stdio:'ignore',env:process.env,windowsHide:true});child.on('error',no);child.on('exit',code=>code===0?ok():no(Error('Migration failed')));});
  const {createApp}=await import('../../services/api/dist/main.js'),{Database}=await import('../../services/api/dist/database.js');db=new Database();app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1';process.env.PUBLIC_API_URL=base;
  const common={title:'道德经 · 水之德与日常研习',summary:'从经典出发，体会水的柔和与坚韧。',category:'经典原文',author:'书院编者',source:'自动化隔离样例，非正式出版物',cover:'/static/art/books.svg',status:'PUBLISHED',tags:['经典研习'],blocks:[{id:'p1',type:'paragraph',text:'上善若水。水善利万物而不争。'},{id:'q1',type:'quote',text:'柔和不是放弃原则，而是在相处中留有余地。'},{id:'p2',type:'paragraph',text:'<script>window.evil=true</script>'},{id:'a1',type:'audio',caption:'水之德 · 音频讲解'}]};
  const article=await db.article.create({data:common}),member=await db.article.create({data:{...common,title:'会员独家研习',visibility:'MEMBER',membershipTier:3,blocks:[{id:'private',type:'paragraph',text:'这一段会员全文不可公开'}]}});
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
  const url=base+'/share/open/ARTICLE_'+article.id;await page.goto(url);await page.getByText('上善若水。水善利万物而不争。',{exact:true}).waitFor();await page.getByText('柔和不是放弃原则，而是在相处中留有余地。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.evil),undefined);checks.push('真实分享落地展示公开正文与引用，恶意文字不执行');
  assert.match(await page.getByRole('link',{name:'在 App 中打开',exact:true}).getAttribute('href'),/^daoxueacademy:\/\/share\?code=ARTICLE_/);assert.equal(await page.getByRole('link',{name:/下载/}).count(),0);checks.push('明确App回跳，无未发布的虚假下载按钮');
  await page.screenshot({path:output+'/share-public.png',fullPage:true});await page.setViewportSize({width:320,height:720});await page.evaluate(()=>document.querySelector('article').style.fontSize='32px');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks.push('320px窄屏及正文大字无横向溢出');await page.screenshot({path:output+'/share-large-text.png',fullPage:true});
  await page.goto(base+'/share/open/ARTICLE_'+member.id);await page.getByText(/本文为会员专属内容/).waitFor();assert.ok(!(await page.locator('body').innerText()).includes('这一段会员全文不可公开'));checks.push('会员分享只有公开简介，全文未进入页面');await page.screenshot({path:output+'/share-member.png',fullPage:true});
  await db.article.update({where:{id:article.id},data:{status:'ARCHIVED'}});const response=await page.goto(url);assert.equal(response.status(),404);assert.equal(response.headers()['cache-control'],'no-store');checks.push('同一旧分享链接在下架后立即404且禁止缓存');assert.equal(errors.length,0,JSON.stringify(errors));
}catch(e){errors.push(String(e));throw e;}
finally{await writeFile(output+'/browser-checks.json',JSON.stringify({checks,errors,passed:errors.length===0,isolatedDatabase:true,businessResponsesMocked:false},null,2));await browser?.close();await app?.close();await db?.$disconnect();await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');await pool.end();}
console.log(JSON.stringify({passed:checks.length,errors}));
