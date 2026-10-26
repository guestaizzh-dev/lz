import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProductionConfig} from '../dist/runtime-config.js';
import {sendSms} from '../dist/sms.js';

const configured=()=>({NODE_ENV:'production',DATABASE_URL:'postgresql://app:example@database/academy',CORS_ORIGINS:'https://admin.example.com',PUBLIC_API_URL:'https://api.example.com/api/v1',OTP_HASH_SECRET:'a'.repeat(32),DOMAIN_ENCRYPTION_KEY:'ab'.repeat(32),MEDIA_TOKEN_SECRET:'cd'.repeat(32),SMS_SECRET_ID:'example',SMS_SECRET_KEY:'example',SMS_SDK_APP_ID:'example',SMS_TEMPLATE_ID:'example',SMS_SIGN_NAME:'书院'});

test('Aliyun validates its own credentials and template without requiring Tencent configuration',()=>{
  const env={...configured(),SMS_PROVIDER:'aliyun',ALIBABA_CLOUD_ACCESS_KEY_ID:'test-id',ALIBABA_CLOUD_ACCESS_KEY_SECRET:'test-secret',ALIYUN_SMS_TEMPLATE_CODE:'SMS_512591994',ALIYUN_SMS_SIGN_NAME:'北京华夏知古文化院'};
  for(const key of ['SMS_SECRET_ID','SMS_SECRET_KEY','SMS_SDK_APP_ID','SMS_TEMPLATE_ID','SMS_SIGN_NAME'])delete env[key];
  assert.doesNotThrow(()=>validateProductionConfig(env));
  for(const key of ['ALIBABA_CLOUD_ACCESS_KEY_ID','ALIBABA_CLOUD_ACCESS_KEY_SECRET','ALIYUN_SMS_TEMPLATE_CODE','ALIYUN_SMS_SIGN_NAME'])assert.throws(()=>validateProductionConfig({...env,[key]:''}),new RegExp(key));
  assert.throws(()=>validateProductionConfig({...env,ALIYUN_SMS_TEMPLATE_CODE:'invalid'}),/ALIYUN_SMS_TEMPLATE_CODE/);
  assert.throws(()=>validateProductionConfig({...env,SMS_PROVIDER:'unknown'}),/SMS_PROVIDER/);
  assert.doesNotThrow(()=>validateProductionConfig({...configured(),SMS_ENABLED:'false',SMS_PROVIDER:'aliyun'}));
});
test('production fails closed without required integrations or valid secrets',()=>{
  assert.doesNotThrow(()=>validateProductionConfig(configured()));
  for(const key of ['DATABASE_URL','CORS_ORIGINS','PUBLIC_API_URL','OTP_HASH_SECRET','DOMAIN_ENCRYPTION_KEY','MEDIA_TOKEN_SECRET','SMS_SECRET_ID','SMS_TEMPLATE_ID']){const env=configured();delete env[key];assert.throws(()=>validateProductionConfig(env),new RegExp(key));}
  for(const changes of [{DEV_OTP_CODE:'123456'},{ORDER_RESERVATION_PREVIEW:'true'},{OTP_HASH_SECRET:'short'},{DOMAIN_ENCRYPTION_KEY:'invalid'},{PUBLIC_API_URL:'http://api.example.com/api/v1'},{PUBLIC_API_URL:'https://api.example.com/'},{CORS_ORIGINS:'https://admin.example.com/'},{TRUST_PROXY:'true'}])assert.throws(()=>validateProductionConfig({...configured(),...changes}));
  assert.doesNotThrow(()=>validateProductionConfig({NODE_ENV:'development',DEV_OTP_CODE:'123456'}));
});

test('explicitly disabled SMS permits admin-only deployment and cannot issue a code',async()=>{
  const env={...configured(),SMS_ENABLED:'false'};
  for(const key of ['SMS_SECRET_ID','SMS_SECRET_KEY','SMS_SDK_APP_ID','SMS_TEMPLATE_ID','SMS_SIGN_NAME'])delete env[key];
  assert.doesNotThrow(()=>validateProductionConfig(env));
  assert.throws(()=>validateProductionConfig({...env,SMS_ENABLED:'invalid'}),/SMS_ENABLED/);
  assert.throws(()=>validateProductionConfig({...env,SMS_ENABLED:'true'}),/SMS_SECRET_ID/);
  const previous=process.env.SMS_ENABLED;process.env.SMS_ENABLED='false';
  try{await assert.rejects(()=>sendSms('19900001001','123456'),error=>error.getStatus()===503);}
  finally{if(previous===undefined)delete process.env.SMS_ENABLED;else process.env.SMS_ENABLED=previous;}
});

test('cohort sales require an explicit boolean and durable payment recovery in production',()=>{
  assert.doesNotThrow(()=>validateProductionConfig({...configured(),COHORT_SALES_ENABLED:'false',COHORT_PAYMENT_WORKER_ENABLED:'false'}));
  assert.throws(()=>validateProductionConfig({...configured(),COHORT_SALES_ENABLED:'invalid'}),/COHORT_SALES_ENABLED/);
  assert.throws(()=>validateProductionConfig({...configured(),COHORT_SALES_ENABLED:'true',COHORT_PAYMENT_WORKER_ENABLED:'false'}),/Cohort sales require payment recovery/);
});
test('ZEGO configuration rejects invalid flags, untrusted servers and missing server credentials',()=>{
  const zego={ZEGO_RTC_ENABLED:'true',ZEGO_ROOM_TOKEN_AUTH_ENABLED:'false',ZEGO_APP_ID:'123',ZEGO_SERVER_SECRET:'12345678901234567890123456789012',ZEGO_CALLBACK_SECRET:'test-callback',ZEGO_RTC_SERVER:'wss://accesshub-wss.zego.im/accesshub'};
  assert.doesNotThrow(()=>validateProductionConfig({...configured(),...zego}));
  for(const changes of [{ZEGO_RTC_ENABLED:'yes'},{ZEGO_ROOM_TOKEN_AUTH_ENABLED:'yes'},{ZEGO_SERVER_SECRET:''},{ZEGO_CALLBACK_SECRET:''},{ZEGO_APP_ID:'0'},{ZEGO_RTC_SERVER:'wss://zego.im.attacker.example/ws'}])assert.throws(()=>validateProductionConfig({...configured(),...zego,...changes}),/ZEGO/);
});

test('native and gift rollout flags fail closed on malformed values and missing Apple readiness',()=>{for(const key of ['RTC_NATIVE_PUBLISH_READY','OFFLINE_NATIVE_PLAYBACK_READY','GIFT_SALES_ENABLED','APPLE_GIFT_SALES_ENABLED'])assert.throws(()=>validateProductionConfig({...configured(),[key]:'yes'}),new RegExp(key));assert.throws(()=>validateProductionConfig({...configured(),APPLE_GIFT_SALES_ENABLED:'true'}),/Apple gift sales/);});
