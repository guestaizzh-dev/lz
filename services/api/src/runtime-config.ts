import {socialLoginConfig} from './login-providers.js';
import {offlineSigningConfig} from './offline-licenses.js';
import {pushConfiguration} from './notifications.js';
import { previewLoginConfig } from './preview-login.js';
import { smsProvider } from './sms.js';

export function validateProductionConfig(env:NodeJS.ProcessEnv){
  const provider = smsProvider(env);
  previewLoginConfig(env);
  socialLoginConfig('WECHAT',env);socialLoginConfig('APPLE',env);
  offlineSigningConfig(env);
  pushConfiguration(env);
  for(const key of ['RTC_NATIVE_PUBLISH_READY','OFFLINE_NATIVE_PLAYBACK_READY','GIFT_SALES_ENABLED','APPLE_GIFT_SALES_ENABLED','ZEGO_LOCAL_RECORDING_ENABLED','ZEGO_RTC_ENABLED','ZEGO_ROOM_TOKEN_AUTH_ENABLED','ZEGO_ALLOW_UNVERIFIED_TOKEN_AUTH'])if(env[key]!==undefined&&!['true','false'].includes(env[key]!))throw new Error(key+' must be true or false');
  if(env.ZEGO_RTC_ENABLED==='true'){
    const id=Number(env.ZEGO_APP_ID);
    if(!Number.isInteger(id)||id<=0||id>0xffffffff||Buffer.byteLength(env.ZEGO_SERVER_SECRET??'')!==32||!(env.ZEGO_CALLBACK_SECRET??'').length||!/^wss:\/\/[a-z0-9.-]+\.(zego\.im|zego\.com|zegocloud\.com)(\/[^?#]*)?$/i.test(env.ZEGO_RTC_SERVER??''))throw new Error('ZEGO RTC requires AppID, server address and server-only secrets');
  }
  if(env.LOGISTICS_TRACKING_ENABLED!==undefined&&!['true','false'].includes(env.LOGISTICS_TRACKING_ENABLED))throw new Error('LOGISTICS_TRACKING_ENABLED must be true or false');
  if(env.LOGISTICS_TRACKING_ENABLED==='true'&&(!env.KUAIDI100_CUSTOMER||!env.KUAIDI100_KEY))throw new Error('Real logistics tracking requires Kuaidi100 enterprise credentials');
  if(env.NODE_ENV!=='production')return;
  if(env.APPLE_GIFT_SALES_ENABLED==='true'&&(env.GIFT_SALES_ENABLED!=='true'||env.APPLE_IAP_ENABLED!=='true'||env.APPLE_NATIVE_PURCHASE_READY!=='true'))throw new Error('Apple gift sales require verified identity, native readiness and gift sales');
  if(env.COHORT_SALES_ENABLED!==undefined&&!['true','false'].includes(env.COHORT_SALES_ENABLED))throw new Error('COHORT_SALES_ENABLED must be true or false');
  if(env.COHORT_SALES_ENABLED==='true'&&env.COHORT_PAYMENT_WORKER_ENABLED==='false')throw new Error('Cohort sales require payment recovery');
  if(env.PRODUCT_SALES_ENABLED!==undefined&&!['true','false'].includes(env.PRODUCT_SALES_ENABLED))throw new Error('PRODUCT_SALES_ENABLED must be true or false');
  if(env.PRODUCT_SALES_ENABLED==='true'&&env.COURSE_PAYMENT_WORKER_ENABLED==='false')throw new Error('Product sales require payment recovery');
  if(env.APPLE_MEMBERSHIP_SALES_ENABLED!==undefined&&!['true','false'].includes(env.APPLE_MEMBERSHIP_SALES_ENABLED))throw new Error('APPLE_MEMBERSHIP_SALES_ENABLED must be true or false');
  if(env.APPLE_MEMBERSHIP_SALES_ENABLED==='true'&&(env.APPLE_IAP_ENABLED!=='true'||env.APPLE_NATIVE_PURCHASE_READY!=='true'||env.COURSE_PAYMENT_WORKER_ENABLED==='false'))throw new Error('Apple membership sales require verified Apple identity, native purchase readiness and receipt recovery');
  if(env.DEV_OTP_CODE||env.ORDER_RESERVATION_PREVIEW==='true')throw new Error('Production forbids DEV_OTP_CODE and ORDER_RESERVATION_PREVIEW');
  if(env.SMS_ENABLED!==undefined&&!['true','false'].includes(env.SMS_ENABLED))throw new Error('SMS_ENABLED must be true or false');
  const smsFields=env.SMS_ENABLED==='false'?[]:provider==='aliyun'?['ALIBABA_CLOUD_ACCESS_KEY_ID','ALIBABA_CLOUD_ACCESS_KEY_SECRET','ALIYUN_SMS_TEMPLATE_CODE','ALIYUN_SMS_SIGN_NAME']:['SMS_SECRET_ID','SMS_SECRET_KEY','SMS_SDK_APP_ID','SMS_TEMPLATE_ID','SMS_SIGN_NAME'];
  for(const name of ['DATABASE_URL','CORS_ORIGINS','PUBLIC_API_URL','OTP_HASH_SECRET','DOMAIN_ENCRYPTION_KEY','MEDIA_TOKEN_SECRET',...smsFields]){
    const value=env[name];if(!value||/CHANGE_ME|REPLACE_ME/.test(value))throw new Error('Production requires '+name);
  }
  if(env.SMS_ENABLED!=='false'&&provider==='aliyun'&&!/^SMS_\d+$/.test(env.ALIYUN_SMS_TEMPLATE_CODE!))throw new Error('ALIYUN_SMS_TEMPLATE_CODE must be SMS_ followed by digits');
  for(const name of ['DOMAIN_ENCRYPTION_KEY','MEDIA_TOKEN_SECRET'])if(!/^[a-fA-F0-9]{64}$/.test(env[name]!))throw new Error(name+' must be a 32-byte hex key');
  if(Buffer.byteLength(env.OTP_HASH_SECRET!)<32)throw new Error('OTP_HASH_SECRET must contain at least 32 bytes');
  const db=new URL(env.DATABASE_URL!);if(!['postgres:','postgresql:'].includes(db.protocol)||!db.username||!db.password||db.pathname==='/')throw new Error('Invalid production DATABASE_URL');
  const publicUrl=new URL(env.PUBLIC_API_URL!);if(publicUrl.protocol!=='https:'||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash||!publicUrl.pathname.replace(/\/$/,'').endsWith('/api/v1'))throw new Error('PUBLIC_API_URL must use HTTPS and end with /api/v1');
  for(const value of env.CORS_ORIGINS!.split(',')){const origin=new URL(value);if(origin.protocol!=='https:'||origin.origin!==value)throw new Error('CORS_ORIGINS must contain exact HTTPS origins');}
  for(const key of ['PUBLIC_APP_URL','PUBLIC_ANDROID_DOWNLOAD_URL','PUBLIC_IOS_DOWNLOAD_URL'])if(env[key]){
    let url:URL;try{url=new URL(env[key]!);}catch{throw new Error(key+' must be a valid HTTPS URL');}
    if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error(key+' must use HTTPS without credentials or fragments');
    if(key==='PUBLIC_APP_URL'&&url.search)throw new Error(key+' must not include a query');
  }
  if(env.TRUST_PROXY==='true'||env.TRUST_PROXY==='*')throw new Error('TRUST_PROXY must name the proxy address or subnet');
}
