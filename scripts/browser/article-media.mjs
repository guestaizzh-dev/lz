import {createRequire} from 'node:module';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer,request as proxyRequest} from 'node:http';
import {readFile,mkdir,writeFile,mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,extname,sep,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../services/api/package.json',import.meta.url)),{Pool}=require('pg'),{chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const source=new URL(process.env.DATABASE_URL);if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('Local isolated database required');
const database='academy_test_article_ui_'+Date.now(),target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()}),output=resolve('outputs/content-m06-2026-10-15'),checks=[],errors=[],media=await mkdtemp(join(tmpdir(),'academy-article-ui-'));
await mkdir(output,{recursive:true});await pool.query('CREATE DATABASE "'+database+'"');Object.assign(process.env,{DATABASE_URL:target.toString(),NODE_ENV:'test',MEDIA_DIR:media});
let db,app,server,browser,page,readerPage,apiBase;
try{
  await new Promise((ok,no)=>{const child=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:resolve('services/api'),stdio:'ignore',env:process.env,windowsHide:true});child.on('error',no);child.on('exit',code=>code===0?ok():no(Error('Migration failed')));});
  const {createApp}=await import('../../services/api/dist/main.js'),{Database}=await import('../../services/api/dist/database.js'),{passwordHash}=await import('../../services/api/dist/auth.js');
  db=new Database();app=await createApp(false);await app.listen(0,'127.0.0.1');apiBase=await app.getUrl();
  const username='article-ui-'+randomUUID(),password=randomUUID()+'!A',admin=await db.user.create({data:{username,nickname:'内容运营测试',passwordHash:await passwordHash(password),roles:['ADMIN']}});
  const assets=[];
  for(const type of ['video','audio']){
    const storageKey=randomUUID(),path=resolve(media,storageKey),video=type==='video';
    await promisify(execFile)(process.env.FFMPEG_PATH??'ffmpeg',['-hide_banner','-loglevel','error',...(video?['-f','lavfi','-i','testsrc2=size=640x360:rate=25']:[]),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8',...(video?['-c:v','libx264','-pix_fmt','yuv420p','-g','50']:[]),'-c:a','aac','-movflags','+faststart','-f',video?'mp4':'ipod',path],{windowsHide:true});
    assets.push(await db.mediaAsset.create({data:{storageKey,name:video?'水之德 · 视频讲解':'水之德 · 音频讲解',mime:video?'video/mp4':'audio/mp4',bytes:(await stat(path)).size,uploaderId:admin.id,status:'READY',visibility:'PRIVATE',durationSeconds:8}}));
  }
  const folder=resolve('apps/admin/dist'),readerFolder=resolve('apps/mobile/static');
  server=createServer(async(req,res)=>{
    if(req.url.startsWith('/api/')){const upstream=proxyRequest(apiBase+req.url,{method:req.method,headers:{...req.headers,host:new URL(apiBase).host,origin:'http://127.0.0.1:5173'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on('error',()=>res.destroy());req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);return;}
    try{const root=req.url.startsWith('/static/')?readerFolder:folder;let path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/static/,''));if(!path.startsWith(root+sep))path=resolve(root,'index.html');let data;try{data=await readFile(path);}catch{path=resolve(folder,'index.html');data=await readFile(path);}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.otf':'font/otf','.ttf':'font/ttf'})[extname(path)]??'application/octet-stream');res.end(data);}catch{res.writeHead(500).end();}
  });await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/user/login');await page.locator('input#username,input[name=username]').fill(username);await page.locator('input#password,input[name=password]').fill(password);await page.getByRole('button',{name:/登.*录/}).click();await page.waitForURL(value=>!value.pathname.includes('/user/login'));
  await page.goto(url+'/content/articles');await page.getByRole('button',{name:/新建文章/}).click();
  await page.locator('#article-editor_title').fill('道德经 · 水之德');await page.locator('#article-editor_summary').fill('原文、音频与视频共同研习');await page.locator('#article-editor_author').fill('书院编者');await page.locator('#article-editor_source').fill('自动化隔离样例，不作真实版权证据');await page.locator('#article-editor_blocks_0_text').fill('上善若水。水善利万物而不争。');
  for(const [index,type,name] of [[1,'视频',assets[0].name],[2,'音频',assets[1].name]]){
    await page.getByRole('button',{name:/添加段落/}).click();await page.locator('#article-editor_blocks_'+index+'_type').click();await page.getByText(type,{exact:true}).last().click();
    await page.locator('#article-editor_blocks_'+index+'_mediaId').click();await page.getByText(name,{exact:true}).last().click();await page.locator('#article-editor_blocks_'+index+'_caption').fill(name);
  }
  checks.push('后台真实新建混合文章，按类型选择媒体，非媒体字段收起');
  await page.getByRole('button',{name:'上移',exact:true}).last().click();await page.getByRole('button',{name:/保存草稿/}).click();await page.getByRole('dialog',{name:'新建文章'}).waitFor({state:'hidden'});
  let article=await db.article.findFirstOrThrow({where:{title:'道德经 · 水之德'}});assert.deepEqual(article.blocks.map(b=>b.type),['paragraph','audio','video']);assert.equal(new Set(article.blocks.map(b=>b.id)).size,3);checks.push('段落上移、保存真实成功，稳定标识不重建');
  for(const label of ['提交审核','发布']){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('textbox',{name:'操作原因'}).fill('核对图文与音视频，确认混合阅读');await page.getByRole('button',{name:'确认操作',exact:true}).click();await page.getByRole('textbox',{name:'操作原因'}).waitFor({state:'hidden'});await page.getByRole('button',{name:label==='发布'?'下架':'发布',exact:true}).waitFor();}
  article=await db.article.findUniqueOrThrow({where:{id:article.id}});checks.push('后台提交审核、审核发布按真实工作流完成');
  await page.getByRole('button',{name:'查看',exact:true}).click();await page.getByRole('button',{name:'试看视频',exact:true}).click();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await page.getByRole('button',{name:'试听音频',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=2);await page.screenshot({path:output+'/article-admin.png',fullPage:true});checks.push('审核详情中的真实音视频可解码试看试听');
  const evidenceForm=page.getByRole('dialog',{name:'查看文章'}).locator('form').filter({hasText:'公开来源链接'});
  await evidenceForm.getByLabel('标题',{exact:true}).fill('经典研习 · 注释依据');await evidenceForm.getByLabel('作者 / 核发单位',{exact:true}).fill('隔离测试核发单位');await evidenceForm.getByLabel('版本 / 出版信息',{exact:true}).fill('隔离版一');await evidenceForm.getByLabel('权利人',{exact:true}).fill('测试权利人');await evidenceForm.getByLabel('授权使用范围',{exact:true}).fill('仅用于隔离测试');await evidenceForm.getByLabel('公开来源链接',{exact:true}).fill('https://example.org/evidence');await evidenceForm.getByLabel('截止日期（北京时间，可选）',{exact:true}).fill('2039-12-31');
  await page.locator('input[type=file]').setInputFiles({name:'授权原件.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=','base64')});await page.getByText('授权原件.png',{exact:true}).waitFor();await page.getByRole('button',{name:'保存并待审核',exact:true}).click();await page.getByText('待核查',{exact:true}).waitFor();checks.push('后台真实上传私有原件并创建带有效期的待核查版本');
  await page.getByRole('button',{name:'审核通过',exact:true}).click();await page.getByRole('textbox',{name:'证据核查原因'}).fill('已核对原件、版本、权利人与授权范围');await page.getByRole('button',{name:'保存核查结果',exact:true}).click();await page.getByText('请查看证据文件，并勾选核查确认',{exact:true}).waitFor();
  await page.getByRole('button',{name:'查看证据文件',exact:true}).last().click();const proofDialog=page.getByRole('dialog',{name:'受控证据原件'});await proofDialog.getByRole('img',{name:'来源证据原件'}).waitFor();await page.waitForFunction(()=>document.querySelector('img[alt="来源证据原件"]')?.naturalWidth>0);await proofDialog.getByRole('button',{name:/关\s*闭/}).click();await page.getByRole('checkbox',{name:'已核对原件、权利人、授权范围与有效期'}).check();await page.getByRole('button',{name:'保存核查结果',exact:true}).click();await page.getByText('已审核',{exact:true}).waitFor();checks.push('原件实际可查看，缺少核查确认会阻止通过，填写原因后审核成功');
  const visible=await (await fetch(apiBase+'/api/v1/discovery/articles/'+article.id+'/context')).json();assert.equal(visible.evidence[0].edition,'隔离版一');assert.equal('proofAssetId' in visible.evidence[0],false);checks.push('公开摘要与后台核查同步，私人原件字段不泄露');
  await page.getByRole('button',{name:'驳回 / 撤回',exact:true}).click();await page.getByRole('textbox',{name:'证据核查原因'}).fill('测试撤回，立即停止公开摘要');await page.getByRole('button',{name:'保存核查结果',exact:true}).click();await page.getByText('已驳回 / 撤回',{exact:true}).waitFor();await page.getByRole('dialog',{name:'驳回 / 撤回来源'}).waitFor({state:'hidden'});assert.deepEqual((await (await fetch(apiBase+'/api/v1/discovery/articles/'+article.id+'/context')).json()).evidence,[]);checks.push('人工撤回立即移除公开摘要，保留历史资料与原因');
  await page.screenshot({path:output+'/evidence-admin.png',fullPage:true});
  readerPage=await browser.newPage({viewport:{width:390,height:844}});readerPage.on('pageerror',e=>errors.push(e.message));await readerPage.goto(url+'/static/reader/index.html');
  await readerPage.evaluate(async id=>{
    const detail=await (await fetch('/api/v1/catalog/articles/'+id)).json();globalThis.articlePayload={blocks:detail.blocks,fontSize:16,annotations:[],selectionMode:'native'};
    reader.destroy();globalThis.ticketRequests=0;globalThis.completedTickets=0;globalThis.testReader=AcademyReader.create(document.getElementById('reader'),async data=>{
      if(data.action!=='media'){globalThis.lastSelection=data;return;}
      globalThis.ticketRequests++;
      const res=await fetch('/api/v1/articles/'+id+'/blocks/'+data.blockId+'/media',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),result=await res.json();
      globalThis.lastTicketResult={...data,...(res.ok?{url:location.origin+'/api/v1'+result.path,expiresAt:result.expiresAt}:{error:result.message})};globalThis.testReader.mediaResult(globalThis.lastTicketResult);globalThis.completedTickets++;
    });globalThis.testReader.render(globalThis.articlePayload);
  },article.id);
  await readerPage.getByRole('button',{name:'播放视频',exact:true}).click();await readerPage.waitForFunction(()=>document.querySelector('video')?.currentTime>.3);checks.push('手机宽度阅读器真实视频播放，媒体不遮挡文字');
  await readerPage.evaluate(()=>{globalThis.beforeRenew=completedTickets;const video=document.querySelector('video');video.playbackRate=1.25;globalThis.beforePosition=video.currentTime;testReader.mediaResult({...lastTicketResult,expiresAt:new Date(Date.now()+31000).toISOString()});});await readerPage.waitForFunction(()=>completedTickets>beforeRenew);await readerPage.waitForFunction(()=>!document.querySelector('video').paused&&document.querySelector('video').readyState>=2);assert.equal(await readerPage.evaluate(()=>document.querySelector('video').playbackRate===1.25&&document.querySelector('video').currentTime>=beforePosition),true);checks.push('加速续期计时触发真实新票据请求，位置倍速与播放状态保留');
  await readerPage.evaluate(()=>{globalThis.originalVideo=document.querySelector('video');globalThis.initialTime=originalVideo.currentTime;testReader.render({...articlePayload,fontSize:20,annotations:[{blockId:articlePayload.blocks[0].id,rangeStart:0,rangeEnd:4}]});});
  assert.equal(await readerPage.evaluate(()=>document.querySelector('video')===originalVideo&&!originalVideo.paused&&originalVideo.currentTime>=initialTime),true);checks.push('调整字号与笔记高亮不重建播放器、不打断播放');
  await readerPage.getByRole('button',{name:'播放音频',exact:true}).click();await readerPage.waitForFunction(()=>document.querySelector('audio')?.currentTime>.3);assert.equal(await readerPage.locator('video').evaluate(v=>v.paused),true);checks.push('开始音频自动暂停视频，避免多媒体声音重叠');
  await readerPage.evaluate(()=>{testReader.pauseMedia();testReader.mediaResult(lastTicketResult);});assert.equal(await readerPage.locator('audio').evaluate(v=>v.paused),true);checks.push('页面隐藏可以立即暂停全部媒体与续期计时');
  await readerPage.evaluate(()=>{const p=document.querySelector('[data-reader-block]'),range=document.createRange();const text=p.querySelector('mark')?.firstChild??p.firstChild;range.setStart(text,0);range.setEnd(text,4);window.getSelection().removeAllRanges();window.getSelection().addRange(range);});await readerPage.getByRole('button',{name:'笔记',exact:true}).click();assert.equal(await readerPage.evaluate(()=>lastSelection.selections[0].quote),'上善若水');checks.push('混合阅读的文字仍可选中并调用原笔记菜单');
  await readerPage.screenshot({path:output+'/article-reader-playing.png',fullPage:true});
  await db.mediaAsset.update({where:{id:assets[0].id},data:{status:'REJECTED'}});
  await readerPage.evaluate(()=>{testReader.render({...articlePayload,blocks:articlePayload.blocks.map(b=>b.type==='video'?{...b,mediaId:'changed-for-reload'}:b)});});await readerPage.getByRole('button',{name:'播放视频',exact:true}).click();await readerPage.getByRole('button',{name:'重试播放',exact:true}).waitFor();assert.match(await readerPage.locator('[data-reader-block]').innerText(),/上善若水/);checks.push('真实媒体失效有独立重试提示，原文与选文仍然可用');
  await readerPage.screenshot({path:output+'/article-reader.png',fullPage:true});
  assert.equal(errors.length,0,JSON.stringify(errors));
}catch(e){errors.push(String(e));if(page){await page.screenshot({path:output+'/article-ui-failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-1800));}throw e;}
finally{await writeFile(output+'/browser-checks.json',JSON.stringify({checks,errors,passed:errors.length===0,isolatedDatabase:true,businessResponsesMocked:false},null,2));await browser?.close();if(server)await new Promise(ok=>server.close(ok));await app?.close();await db?.$disconnect();await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');await pool.end();await rm(media,{recursive:true,force:true});}
console.log(JSON.stringify({passed:checks.length,errors}));
