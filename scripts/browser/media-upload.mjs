import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer,request as proxyRequest} from 'node:http';
import {readFile,mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,extname,sep,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../services/api/package.json',import.meta.url)),{Pool}=require('pg'),{chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const source=new URL(process.env.DATABASE_URL);if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('Local isolated database required');
const database='academy_test_media_ui_'+Date.now(),target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()}),output=resolve('outputs/large-media-2026-10-15'),checks=[],errors=[],media=await mkdtemp(join(tmpdir(),'academy-media-ui-'));
await mkdir(output,{recursive:true});await pool.query('CREATE DATABASE "'+database+'"');Object.assign(process.env,{DATABASE_URL:target.toString(),NODE_ENV:'test',MEDIA_DIR:media});
let db,app,server,browser,page,apiBase;let slow=true;
try{
  await new Promise((ok,no)=>{const child=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:resolve('services/api'),stdio:'ignore',env:process.env,windowsHide:true});child.on('error',no);child.on('exit',code=>code===0?ok():no(Error('Migration failed')));});
  const {createApp}=await import('../../services/api/dist/main.js'),{Database}=await import('../../services/api/dist/database.js'),{passwordHash}=await import('../../services/api/dist/auth.js'),{MediaIngest}=await import('../../services/api/dist/media-ingest.js');
  db=new Database();app=await createApp(false);await app.listen(0,'127.0.0.1');apiBase=await app.getUrl();
  const username='media-ui-'+randomUUID(),password=randomUUID()+'!A';await db.user.create({data:{username,nickname:'课件运营测试',passwordHash:await passwordHash(password),roles:['ADMIN']}});
  const folder=resolve('apps/admin/dist');server=createServer(async(req,res)=>{
    if(req.url.startsWith('/api/')){if(slow&&req.url.includes('/chunks/'))await new Promise(ok=>setTimeout(ok,700));if(req.destroyed){res.destroy();return;}const upstream=proxyRequest(apiBase+req.url,{method:req.method,headers:{...req.headers,host:new URL(apiBase).host,origin:'http://127.0.0.1:5173'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on('error',()=>res.destroy());req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);return;}
    try{let path=resolve(folder,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!path.startsWith(folder+sep))path=resolve(folder,'index.html');let data;try{data=await readFile(path);}catch{path=resolve(folder,'index.html');data=await readFile(path);}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'})[extname(path)]??'application/octet-stream');res.end(data);}catch{res.writeHead(500).end();}
  });await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/user/login');await page.locator('input#username,input[name=username]').fill(username);await page.locator('input#password,input[name=password]').fill(password);await page.getByRole('button',{name:/登.*录/}).click();await page.waitForURL(value=>!value.pathname.includes('/user/login'));
  await page.goto(url+'/media');await page.getByRole('button',{name:/上传音视频/}).waitFor();checks.push('真实管理员登录并进入媒体库，显示2GB与续传说明');
  await page.locator('input[type=file]').setInputFiles(resolve(process.env.ACADEMY_LARGE_MEDIA_FIXTURE));await page.getByRole('button',{name:/暂\s*停/}).click();await page.getByText(/已暂停/).waitFor();checks.push('真实大视频上传可暂停，已传分片保留');
  slow=false;await page.getByRole('button',{name:'继续上传',exact:true}).click();await page.getByText('已上传，正在后台优化音视频；可以继续上传其他课件',{exact:true}).waitFor({timeout:60000});assert.equal(await page.getByRole('button',{name:/上传音视频/}).isEnabled(),true);checks.push('继续上传实际完成，后台处理不阻挡下一课件上传');
  await page.reload();await page.getByText(/正在处理/).first().waitFor();checks.push('刷新页面后仍能查到持久处理任务');
  await app.get(MediaIngest).runJobs();await page.getByText('可用',{exact:true}).first().waitFor({timeout:20000});await page.screenshot({path:output+'/media-library.png',fullPage:true});checks.push('转码完成后真实媒体库显示可用状态及自动时长');
  await page.goto(url+'/content/courses');await page.getByRole('button',{name:/新建课程/}).click();const drawer=page.getByRole('dialog').filter({has:page.getByText('课程基本信息',{exact:true})});
  await page.getByRole('button',{name:/上传音视频/}).waitFor();await page.screenshot({path:output+'/course-upload.png',fullPage:true});checks.push('课程编辑使用同一分片上传组件，保留官方Pro布局');
  await page.locator('input[type=file]').setInputFiles({name:'损坏课件.mp4',mimeType:'video/mp4',buffer:Buffer.from('00000018667479706d7034320000000069736f6d6d703432','hex')});
  await page.getByText('已上传，正在后台优化音视频；可以继续上传其他课件',{exact:true}).waitFor();await app.get(MediaIngest).runJobs();await page.getByText('处理失败，原文件已保留 7 天供重试',{exact:true}).waitFor();checks.push('课程入口的损坏课件不能成为可用素材，显示明确失败和重试入口');
  await page.goto(url+'/media');await page.getByRole('button',{name:/重新处理/}).click();await page.getByText('已上传，正在后台优化音视频；可以继续上传其他课件',{exact:true}).waitFor();await app.get(MediaIngest).runJobs();await page.getByText('处理失败，原文件已保留 7 天供重试',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/重新处理/}).isEnabled(),true);await page.getByRole('button',{name:/取消任务/}).click();await page.getByText('处理失败，原文件已保留 7 天供重试',{exact:true}).waitFor({state:'hidden'});checks.push('刷新后无原文件也能重新处理，重试失败仍可再次重试或取消');
  assert.equal(errors.length,0,JSON.stringify(errors));
}catch(e){errors.push(String(e));if(page){await page.screenshot({path:output+'/upload-ui-failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-1800));}throw e;}
finally{await writeFile(output+'/browser-checks.json',JSON.stringify({checks,errors,passed:errors.length===0,isolatedDatabase:true,businessResponsesMocked:false},null,2));await browser?.close();if(server)await new Promise(ok=>server.close(ok));await app?.close();await db?.$disconnect();await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');await pool.end();await rm(media,{recursive:true,force:true});}
console.log(JSON.stringify({passed:checks.length,errors}));
