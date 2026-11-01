import { Injectable, ServiceUnavailableException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createDecipheriv, createPrivateKey, createPublicKey, createHmac, timingSafeEqual, randomBytes, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';

export type WechatTransaction = { appid:string; mchid:string; out_trade_no:string; transaction_id?:string; trade_type?:string; trade_state:string; success_time?:string; amount?:{total:number;currency:string} };
export type WechatRefund = { mchid?:string; out_trade_no:string; transaction_id:string; out_refund_no:string; refund_id:string; status?:string; refund_status?:string; success_time?:string; amount:{refund:number;total:number;currency?:string} };
type PayConfig = { appid:string; mchid:string; serial:string; apiKey:Buffer; privateKey:ReturnType<typeof createPrivateKey>; publicKeys:Record<string,string>; notifyUrl:string };

@Injectable()
export class WechatPayService {
  private config(mode:'APP'|'NATIVE'|'NOTIFY'='APP'):PayConfig {
    if((mode==='APP'?process.env.COURSE_WECHAT_ENABLED!=='true':mode==='NATIVE'?process.env.WECHAT_NATIVE_ENABLED!=='true':process.env.COURSE_WECHAT_ENABLED!=='true'&&process.env.WECHAT_NATIVE_ENABLED!=='true'))throw new ServiceUnavailableException('课程支付尚未开放');
    try {
      const names=['WECHAT_PAY_APP_ID','WECHAT_PAY_MCH_ID','WECHAT_PAY_SERIAL','WECHAT_PAY_API_V3_KEY','WECHAT_PAY_PRIVATE_KEY_FILE','WECHAT_PAY_PUBLIC_KEYS_FILE','PUBLIC_API_URL'];
      if(names.some(name=>!process.env[name]||/CHANGE_ME|REPLACE_ME/.test(process.env[name]!)))throw new Error('Missing payment configuration');
      const url=new URL(process.env.PUBLIC_API_URL!);
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.replace(/\/$/,'').endsWith('/api/v1'))throw new Error('HTTPS callback required');
      const apiKey=Buffer.from(process.env.WECHAT_PAY_API_V3_KEY!,'utf8');if(apiKey.length!==32)throw new Error('Invalid API v3 key');
      const privateKey=createPrivateKey(readFileSync(process.env.WECHAT_PAY_PRIVATE_KEY_FILE!));
      const publicKeys=JSON.parse(readFileSync(process.env.WECHAT_PAY_PUBLIC_KEYS_FILE!,'utf8')) as Record<string,string>;
      if(privateKey.asymmetricKeyType!=='rsa'||(privateKey.asymmetricKeyDetails?.modulusLength??0)<2048||!publicKeys||!Object.keys(publicKeys).length)throw new Error('Invalid payment keys');
      for(const [id,pem] of Object.entries(publicKeys)){const key=createPublicKey(pem);if(!/^[A-Za-z0-9_]+$/.test(id)||key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)throw new Error('Invalid verification key');}
      if(!/^[a-zA-Z0-9]+$/.test(process.env.WECHAT_PAY_APP_ID!)||!/^\d+$/.test(process.env.WECHAT_PAY_MCH_ID!)||!/^\w+$/.test(process.env.WECHAT_PAY_SERIAL!))throw new Error('Invalid merchant identifiers');
      return{appid:process.env.WECHAT_PAY_APP_ID!,mchid:process.env.WECHAT_PAY_MCH_ID!,serial:process.env.WECHAT_PAY_SERIAL!,apiKey,privateKey,publicKeys,notifyUrl:url.toString().replace(/\/$/,'')+'/payments/wechat/notify'};
    }catch{throw new ServiceUnavailableException('课程支付配置未就绪，请稍后重试');}
  }
  availability(mode:'APP'|'NATIVE'='APP'){try{this.config(mode);return{enabled:true,reason:''};}catch{return{enabled:false,reason:'微信课程支付尚未开放，请先试听或查看已有课程。'};}}
  identity(mode:'APP'|'NATIVE'='APP'){const c=this.config(mode);return{appid:c.appid,mchid:c.mchid};}
  private verifyMessage(headers:{get:(name:string)=>string|null},body:string,c:PayConfig){
    const serial=headers.get('wechatpay-serial'),timestamp=headers.get('wechatpay-timestamp'),nonce=headers.get('wechatpay-nonce'),signature=headers.get('wechatpay-signature');
    if(!serial||!timestamp||!/^\d+$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||!nonce||nonce.length>128||!signature||signature.length>1024||!Object.hasOwn(c.publicKeys,serial))throw new UnauthorizedException('支付签名无效');
    if(!verify('RSA-SHA256',Buffer.from(timestamp+'\n'+nonce+'\n'+body+'\n'),c.publicKeys[serial]!,Buffer.from(signature,'base64')))throw new UnauthorizedException('支付签名无效');
  }
  async notification(headers:Record<string,string|string[]|undefined>,raw:Buffer){
    const c=this.config('NOTIFY');if(!raw?.length||raw.length>65536)throw new UnauthorizedException('支付通知无效');
    const text=raw.toString('utf8');this.verifyMessage({get:name=>typeof headers[name]==='string'?headers[name] as string:null},text,c);
    try {
      const envelope=JSON.parse(text),r=envelope.resource;
      if(!envelope.id||typeof envelope.id!=='string'||envelope.id.length>128||!['TRANSACTION.SUCCESS','REFUND.SUCCESS','REFUND.ABNORMAL','REFUND.CLOSED'].includes(envelope.event_type)||r?.algorithm!=='AEAD_AES_256_GCM'||typeof r.nonce!=='string'||typeof r.ciphertext!=='string')throw new Error('Invalid notification');
      const encrypted=Buffer.from(r.ciphertext,'base64');if(encrypted.length<17)throw new Error('Invalid ciphertext');
      const decipher=createDecipheriv('aes-256-gcm',c.apiKey,Buffer.from(r.nonce));decipher.setAuthTag(encrypted.subarray(-16));decipher.setAAD(Buffer.from(r.associated_data??''));
      const data=JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]).toString());
      if(data.mchid!==c.mchid)throw new Error('Wrong merchant');
      return{id:envelope.id as string,eventType:envelope.event_type as string,data};
    }catch{throw new UnauthorizedException('支付通知解密或商户核验失败');}
  }
  private async request<T>(method:'GET'|'POST',path:string,data?:unknown,mode:'APP'|'NATIVE'='APP'):Promise<T>{
    const c=this.config(mode),timestamp=Math.floor(Date.now()/1000).toString(),nonce=randomBytes(16).toString('hex'),body=data===undefined?'':JSON.stringify(data);
    const signature=sign('RSA-SHA256',Buffer.from(method+'\n'+path+'\n'+timestamp+'\n'+nonce+'\n'+body+'\n'),c.privateKey).toString('base64');
    try {
      const response=await fetch('https://api.mch.weixin.qq.com'+path,{method,headers:{Accept:'application/json','Content-Type':'application/json','Wechatpay-Serial':Object.keys(c.publicKeys)[0]!,Authorization:`WECHATPAY2-SHA256-RSA2048 mchid="${c.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${c.serial}"`},...(body?{body}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
      const text=await response.text();
      this.verifyMessage(response.headers,text,c);
      if(response.status===204&&text==='')return{} as T;
      const result=JSON.parse(text);
      if(!response.ok){if(response.status===404&&['ORDER_NOT_EXIST','ORDERNOTEXIST'].includes(result.code))return{trade_state:'NOTFOUND'} as T;throw new Error('Provider rejected request');}
      return result as T;
    }catch{throw new ServiceUnavailableException('支付渠道暂时无法确认，请稍后查询订单，勿重复付款');}
  }
  async prepay(orderNo:string,title:string,amount:number,expiresAt:Date){
    const c=this.config(),result=await this.request<{prepay_id:string}>('POST','/v3/pay/transactions/app',{appid:c.appid,mchid:c.mchid,description:title.slice(0,120),out_trade_no:orderNo,time_expire:expiresAt.toISOString(),notify_url:c.notifyUrl,amount:{total:amount,currency:'CNY'}});
    if(typeof result.prepay_id!=='string'||!result.prepay_id||result.prepay_id.length>128)throw new ServiceUnavailableException('支付渠道未返回有效凭证');
    const timestamp=Math.floor(Date.now()/1000),noncestr=randomBytes(16).toString('hex');
    return JSON.stringify({appid:c.appid,partnerid:c.mchid,prepayid:result.prepay_id,package:'Sign=WXPay',noncestr,timestamp,sign:sign('RSA-SHA256',Buffer.from(c.appid+'\n'+timestamp+'\n'+noncestr+'\n'+result.prepay_id+'\n'),c.privateKey).toString('base64')});
  }
  async nativePrepay(orderNo:string,title:string,amount:number,expiresAt:Date){
    if(!/^[A-Za-z0-9_-]{6,32}$/.test(orderNo)||!Number.isSafeInteger(amount)||amount<=0||amount>100000000||!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=Date.now())throw new BadRequestException('订单金额或付款期限无效');
    const c=this.config('NATIVE'),result=await this.request<{code_url:string}>('POST','/v3/pay/transactions/native',{appid:c.appid,mchid:c.mchid,description:Array.from(title).slice(0,31).join(''),out_trade_no:orderNo,time_expire:expiresAt.toISOString(),notify_url:c.notifyUrl,amount:{total:amount,currency:'CNY'}},'NATIVE');
    if(typeof result.code_url!=='string'||!/^weixin:\/\/wxpay\/bizpayurl\?pr=[A-Za-z0-9_-]+$/.test(result.code_url)||result.code_url.length>512)throw new ServiceUnavailableException('微信未返回有效付款码，请查询原订单后重试');
    const expires=Math.min(expiresAt.getTime(),Date.now()+15*60000),payload=Buffer.from(JSON.stringify({url:result.code_url,expires})).toString('base64url'),signature=createHmac('sha256',c.apiKey).update('native-qr:'+payload).digest('base64url');
    return JSON.stringify({codeUrl:result.code_url,qrImageUrl:c.notifyUrl.replace('/notify','/native-qr')+'?ticket='+payload+'.'+signature,expiresAt:new Date(expires).toISOString(),merchantName:process.env.WECHAT_PAY_MERCHANT_NAME||'北京华夏知古文化院'});
  }
  async nativeQr(ticket:string){
    const c=this.config('NATIVE');
    if(typeof ticket!=='string'||ticket.length>1500)throw new UnauthorizedException('付款码无效或已过期');
    try{
      const [payload,signature,...extra]=ticket.split('.');if(!payload||!signature||extra.length)throw Error();
      const expected=createHmac('sha256',c.apiKey).update('native-qr:'+payload).digest(),actual=Buffer.from(signature,'base64url');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error();
      const data=JSON.parse(Buffer.from(payload,'base64url').toString());if(typeof data.url!=='string'||!/^weixin:\/\/wxpay\/bizpayurl\?pr=[A-Za-z0-9_-]+$/.test(data.url)||!Number.isFinite(data.expires)||data.expires<=Date.now()||data.expires>Date.now()+16*60000)throw Error();
      return await QRCode.toBuffer(data.url,{type:'png',width:720,margin:4,errorCorrectionLevel:'M'});
    }catch{throw new UnauthorizedException('付款码无效或已过期，请返回订单刷新');}
  }
  async query(orderNo:string,mode:'APP'|'NATIVE'='APP'){const c=this.config(mode),result=await this.request<WechatTransaction>('GET','/v3/pay/transactions/out-trade-no/'+encodeURIComponent(orderNo)+'?mchid='+encodeURIComponent(c.mchid),undefined,mode);if(result.trade_state!=='NOTFOUND'&&(result.out_trade_no!==orderNo||result.appid!==c.appid||result.mchid!==c.mchid))throw new ServiceUnavailableException('支付查单结果与原订单不一致');return result;}
  close(orderNo:string,mode:'APP'|'NATIVE'='APP'){const c=this.config(mode);return this.request('POST','/v3/pay/transactions/out-trade-no/'+encodeURIComponent(orderNo)+'/close',{mchid:c.mchid},mode);}
  refund(transactionId:string,refundNo:string,amount:number,total:number,mode:'APP'|'NATIVE'='APP'){const c=this.config(mode);return this.request<WechatRefund>('POST','/v3/refund/domestic/refunds',{transaction_id:transactionId,out_refund_no:refundNo,reason:'课程退课退款',notify_url:c.notifyUrl,amount:{refund:amount,total,currency:'CNY'}},mode);}
  queryRefund(refundNo:string,mode:'APP'|'NATIVE'='APP'){return this.request<WechatRefund>('GET','/v3/refund/domestic/refunds/'+encodeURIComponent(refundNo),undefined,mode);}
}
