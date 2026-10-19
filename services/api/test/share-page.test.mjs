import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSharePage, publicShareUrl } from '../dist/share-page.js';
import {validateProductionConfig} from '../dist/runtime-config.js';

test('public share reader escapes every field and never renders unsafe URLs or member blocks',()=>{
  const item={resourceType:'ARTICLE',resourceId:'id',title:'<script>alert(1)</script>',description:'<img onerror=alert(1)>'};
  const article={author:'<b>编者</b>',source:'<svg>',access:'PUBLIC',isDemo:true,blocks:[{type:'paragraph',text:'<script>secret</script>'},{type:'quote',text:'原文\n注释'},{type:'image',url:'javascript:alert(1)',caption:'坏图'},{type:'image',url:'https://example.org/cover.png',caption:'" onerror="evil'},{type:'video',mediaId:'private-asset-id',caption:'视频介绍'}]};
  const html=renderSharePage(item,'ARTICLE_id',article,[{id:'related',type:'COURSE',title:'<script>课</script>'}]);
  assert.ok(html.includes('&lt;script&gt;secret&lt;/script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('javascript:'));assert.ok(!html.includes('private-asset-id'));assert.ok(html.includes('loading="lazy"'));assert.ok(html.includes('相关研习'));assert.ok(html.includes('视频介绍'));
  const restricted=renderSharePage(item,'ARTICLE_id',{...article,access:'MEMBERSHIP_REQUIRED'},[]);assert.ok(!restricted.includes('secret'));assert.ok(!restricted.includes('cover.png'));assert.ok(restricted.includes('会员专属内容'));
  for(const url of ['javascript:evil','//example.org','https://user:pass@example.org','invalid'])assert.equal(publicShareUrl(url),null);
});
test('share channels use only configured published URLs and forbid insecure production configuration',()=>{
  const keys=['NODE_ENV','PUBLIC_APP_URL','PUBLIC_ANDROID_DOWNLOAD_URL','PUBLIC_IOS_DOWNLOAD_URL'],previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    process.env.NODE_ENV='production';process.env.PUBLIC_APP_URL='https://app.example.org';process.env.PUBLIC_ANDROID_DOWNLOAD_URL='https://downloads.example.org/app.apk';process.env.PUBLIC_IOS_DOWNLOAD_URL='javascript:bad';
    const html=renderSharePage({resourceType:'COURSE',resourceId:'id',title:'课程',description:'简介'},'COURSE_id',null,[]);
    assert.ok(html.includes('下载 Android App'));assert.ok(html.includes('https://downloads.example.org/app.apk'));assert.ok(html.includes('/#/pages/shared/index?code=COURSE_id'));assert.ok(!html.includes('下载 iOS App'));assert.equal(publicShareUrl('http://example.org'),null);
    const env={NODE_ENV:'production',SMS_ENABLED:'false',DATABASE_URL:'postgresql://app:example@database/academy',CORS_ORIGINS:'https://admin.example.org',PUBLIC_API_URL:'https://api.example.org/api/v1',OTP_HASH_SECRET:'a'.repeat(32),DOMAIN_ENCRYPTION_KEY:'ab'.repeat(32),MEDIA_TOKEN_SECRET:'cd'.repeat(32)};
    for(const key of keys.slice(1))for(const url of ['http://example.org','https://user:pass@example.org','javascript:bad','https://example.org/#bad'])assert.throws(()=>validateProductionConfig({...env,[key]:url}),new RegExp(key));
  }finally{for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
