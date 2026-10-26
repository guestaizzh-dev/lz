import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {aliyunSmsRequest,sendSms,smsProvider} from '../dist/sms.js';

const configuration={accessKeyId:'test-id',accessKeySecret:'test-secret',signName:'北京华夏知古文化院',templateCode:'SMS_512591994'};
const environment={NODE_ENV:'production',SMS_ENABLED:'true',SMS_PROVIDER:'aliyun',ALIBABA_CLOUD_ACCESS_KEY_ID:configuration.accessKeyId,ALIBABA_CLOUD_ACCESS_KEY_SECRET:configuration.accessKeySecret,ALIYUN_SMS_SIGN_NAME:configuration.signName,ALIYUN_SMS_TEMPLATE_CODE:configuration.templateCode};
function setup(){
  const previous=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]])),fetch=globalThis.fetch;
  Object.assign(process.env,environment);
  return()=>{globalThis.fetch=fetch;for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;};
}

test('Aliyun ACS3 signs the exact encoded query, UTC time and optional STS token',()=>{
  const date='2026-10-25T12:00:00Z',nonce='test-nonce';
  const request=aliyunSmsRequest('19900001001','123456',{...configuration,securityToken:'test-sts'},date,nonce);
  const url=new URL(request.url),hash=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(url.origin,'https://dysmsapi.aliyuncs.com');
  assert.equal(url.searchParams.get('PhoneNumbers'),'19900001001');
  assert.equal(url.searchParams.get('SignName'),configuration.signName);
  assert.equal(url.searchParams.get('TemplateCode'),configuration.templateCode);
  assert.equal(url.searchParams.get('TemplateParam'),'{"code":"123456"}');
  const keys=['host','x-acs-action','x-acs-content-sha256','x-acs-date','x-acs-security-token','x-acs-signature-nonce','x-acs-version'];
  const canonical=['POST','/',url.search.slice(1),`host:dysmsapi.aliyuncs.com\nx-acs-action:SendSms\nx-acs-content-sha256:${hash('')}\nx-acs-date:${date}\nx-acs-security-token:test-sts\nx-acs-signature-nonce:${nonce}\nx-acs-version:2017-05-25\n`,keys.join(';'),hash('')].join('\n');
  const signature=createHmac('sha256','test-secret').update('ACS3-HMAC-SHA256\n'+hash(canonical)).digest('hex');
  assert.equal(request.headers.Authorization,`ACS3-HMAC-SHA256 Credential=test-id,SignedHeaders=${keys.join(';')},Signature=${signature}`);
  assert.notEqual(aliyunSmsRequest('19900001001','123456',configuration).headers['x-acs-signature-nonce'],aliyunSmsRequest('19900001001','123456',configuration).headers['x-acs-signature-nonce']);
  assert.equal(smsProvider({}),'tencent');
  assert.throws(()=>smsProvider({SMS_PROVIDER:'unknown'}),/SMS_PROVIDER/);
});

test('Aliyun delivery uses the approved template, bounded POST and only accepts OK',async()=>{
  const restore=setup();let calls=0;
  try{
    globalThis.fetch=async(url,options)=>{
      calls++;assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      assert.equal(new URL(url).searchParams.get('TemplateCode'),'SMS_512591994');
      return new Response('{"Code":"OK","BizId":"test"}',{status:200});
    };
    assert.equal(await sendSms('19900001001','123456'),'SMS');assert.equal(calls,1);
    for(const response of [()=>new Response('{"Code":"isv.BUSINESS_LIMIT_CONTROL","Message":"private details"}'),()=>new Response('{"Code":"OK"}',{status:503}),()=>new Response('invalid json'),()=>new Response('null')]){
      globalThis.fetch=async()=>response();
      await assert.rejects(()=>sendSms('19900001001','123456'),error=>error.getStatus()===503&&error.message==='短信服务暂不可用，请稍后再试');
    }
    calls=0;globalThis.fetch=async()=>{calls++;throw new DOMException('private endpoint detail','TimeoutError');};
    await assert.rejects(()=>sendSms('19900001001','123456'),error=>error.getStatus()===503);assert.equal(calls,1);
    delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;calls=0;
    await assert.rejects(()=>sendSms('19900001001','123456'),error=>error.getStatus()===503);assert.equal(calls,0);
  }finally{restore();}
});
