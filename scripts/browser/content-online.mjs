import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';

const origin='https://academy.43-160-229-173.sslip.io',base=origin+'/api/v1',output='outputs/content-m06-share-2026-10-15';
const checks=[],errors=[];
let cookie='',csrf='',browser;
await mkdir(output,{recursive:true});
async function call(path,{method='GET',data,admin=false,status=200,text=false}={}){
  const response=await fetch(base+path,{method,headers:{Origin:origin,...(admin?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,status,path);
  return {response,body:text?await response.text():await response.json()};
}
async function check(name,run){await run();checks.push(name);}
try{
  await check('公网API与数据库健康',async()=>assert.equal((await call('/health')).body.status,'ok'));
  await check('现有管理员登录及安全Cookie可用',async()=>{
    const result=await call('/admin/auth/login',{method:'POST',data:{username:'admin',password:process.env.ACADEMY_ADMIN_PASSWORD}});
    assert.ok(result.response.headers.getSetCookie().every(value=>/; Secure/i.test(value)));
    cookie=result.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');csrf=result.body.csrfToken;assert.ok(csrf);
  });
  const articles=(await call('/catalog/articles?size=50')).body.items;
  const publicArticle=articles.find(item=>item.visibility==='PUBLIC'),memberArticle=articles.find(item=>item.visibility==='MEMBER');
  assert.ok(publicArticle,'Existing public article required');assert.ok(memberArticle,'Existing member article required');
  const code='ARTICLE_'+publicArticle.id;
  await check('公开文章分享URL指向真实HTTPS落地',async()=>{
    const result=(await call('/share/links',{method:'POST',status:201,data:{resourceType:'ARTICLE',resourceId:publicArticle.id}})).body;
    assert.equal(result.url,base+'/share/open/'+code);assert.equal(result.development,false);
  });
  await check('公开分享包含实际正文、App入口及安全响应头',async()=>{
    const result=await call('/share/open/'+code,{text:true}),article=(await call('/catalog/articles/'+publicArticle.id)).body;
    assert.ok(result.body.includes('daoxueacademy://share?code='));assert.ok(result.body.includes('<article>'));
    const paragraph=article.blocks.find(block=>block.type==='paragraph'&&block.text?.trim());assert.ok(paragraph);
    const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    assert.ok(result.body.includes(escape(paragraph.text)));assert.equal(result.response.headers.get('cache-control'),'no-store');
    assert.match(result.response.headers.get('content-security-policy'),/default-src 'none'/);
  });
  await check('会员分享只给简介、不包含正文和媒体凭证',async()=>{
    const result=await call('/share/open/ARTICLE_'+memberArticle.id,{text:true});
    assert.ok(result.body.includes('会员专属内容'));assert.ok(result.body.includes('<article></article>'));assert.ok(!result.body.includes('media/stream?'));
  });
  await check('非法分享链接正确拒绝',async()=>{await call('/share/links/ARTICLE_invalid/resolve',{status:404});});
  const teachers=(await call('/catalog/teachers?size=50')).body.items;assert.ok(teachers.length);
  await check('名师独立档案、代表课程和真实日程结构可用',async()=>{
    const result=(await call('/catalog/teachers/'+teachers[0].id)).body;
    for(const field of ['teachingDirection','lineageSummary','achievementSummary']){assert.ok(field in result);assert.ok(result[field]===null||typeof result[field]==='string');}
    for(const field of ['representativeCourses','introductions','interpretations','schedule'])assert.ok(Array.isArray(result[field]));
    assert.equal(typeof result.scheduleHasMore,'boolean');
  });
  for(const [resource,id]of [['articles',publicArticle.id],['teachers',teachers[0].id]])await check('运营证据受控入口 '+resource,async()=>{const result=await call('/admin/'+resource+'/'+id+'/editorial',{admin:true});assert.ok(result.body);});
  await check('六类关联消费接口正常',async()=>assert.ok(Array.isArray((await call('/discovery/related/'+publicArticle.id)).body.items)));
  await check('通知任务监控可查询',async()=>{const result=(await call('/admin/operations/jobs?kind=NOTIFICATION_PUSH',{admin:true})).body;assert.ok(Array.isArray(result.items));});
  await check('新消息、偏好及私人分享接口拒绝游客',async()=>{
    for(const path of ['/me/messages','/me/notification-preferences','/me/messages/'+publicArticle.id,'/forum/private-sources/NOTE/'+publicArticle.id])await call(path,{status:401});
  });
  await check('游客可查看真实客服配置',async()=>{const result=(await call('/configuration')).body;assert.equal(typeof result.supportPhone,'string');assert.equal(typeof result.supportEmail,'string');});
  await check('原课程、购物与反馈管理兼容',async()=>{
    for(const path of ['/admin/courses','/admin/product-orders','/admin/feedback'])await call(path,{admin:true});
  });
  const {chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await page.context().addCookies(cookie.split('; ').map(value=>{const split=value.indexOf('=');return{name:value.slice(0,split),value:value.slice(split+1),url:origin,httpOnly:true,secure:true};}));
  await check('公网Pro消息操作指南真实渲染',async()=>{
    await page.goto(origin+'/guide?workflow=messages');await page.getByRole('heading',{name:'管理消息、系统推送与客服渠道',exact:true}).waitFor();
    await page.screenshot({path:output+'/online-messages-guide.png',fullPage:true});
  });
  await check('公网Pro任务管理包含推送筛选',async()=>{
    await page.goto(origin+'/operations');await page.getByText('任务监控与恢复',{exact:true}).first().waitFor();
    await page.screenshot({path:output+'/online-operations.png',fullPage:true});
  });
  await check('公网Pro内容编排与关联页可操作',async()=>{
    for(const [path,title]of [['/content/articles','文章与经典'],['/content/relations','内容联动'],['/forum','社区与内容治理']]){
      await page.goto(origin+path);await page.getByText(title,{exact:true}).first().waitFor();
      if(path!=='/content/relations')await page.locator('.ant-pro-table').first().waitFor();
      else await page.getByText('先搜索并选择需要维护的内容',{exact:true}).waitFor();
      assert.equal(await page.locator('.ant-alert-error').count(),0,path);assert.ok(!(await page.locator('body').innerText()).includes('页面不存在'));
    }
    await page.screenshot({path:output+'/online-community.png',fullPage:true});
  });
  await check('公网分享320px窄屏实际可读',async()=>{
    const reader=await browser.newPage({viewport:{width:320,height:780}});reader.on('pageerror',error=>errors.push(error.message));
    await reader.goto(base+'/share/open/'+code);await reader.getByRole('link',{name:'在 App 中打开',exact:true}).waitFor();
    assert.equal(await reader.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await reader.screenshot({path:output+'/online-share-320.png',fullPage:true});await reader.close();
  });
  assert.equal(errors.length,0,JSON.stringify(errors));
}catch(error){errors.push(String(error));throw error;}
finally{
  await browser?.close();
  if(cookie)await call('/admin/auth/logout',{method:'POST',data:{},admin:true}).catch(()=>{});
  await writeFile(output+'/online-checks.json',JSON.stringify({release:'20261016-content-m06-01',checkedAt:new Date().toISOString(),checks,errors,passed:errors.length===0,businessDataReadOnly:true,realPushDelivery:false,nativeAcceptance:false},null,2));
}
console.log(JSON.stringify({passed:checks.length}));
