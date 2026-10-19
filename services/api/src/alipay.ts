import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AlipaySdk } from 'alipay-sdk';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { WechatRefund, WechatTransaction } from './wechat-pay.js';

type RefundContext = { transactionId:string; orderNo:string; total:number };
type Config = { appid:string; mchid:string; sdk:AlipaySdk; verifiers:AlipaySdk[]; notifyUrl:string };
type Result = Record<string,unknown>;
export function alipayCents(value:unknown):number {
  if(typeof value!=='string'||!/^\d{1,9}(\.\d{1,2})?$/.test(value))throw new UnauthorizedException('支付宝金额无效');
  const [yuan,fraction='']=value.split('.'),amount=Number(yuan)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000)throw new UnauthorizedException('支付宝金额超出允许范围');
  return amount;
}
function chinaTime(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)||!Number.isFinite(Date.parse(value.replace(' ','T')+'+08:00')))throw new UnauthorizedException('支付宝交易时间无效');
  return value.replace(' ','T')+'+08:00';
}
function yuan(amount:number){if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000)throw new Error('Invalid payment amount');return Math.floor(amount/100)+'.'+String(amount%100).padStart(2,'0');}

@Injectable()
export class AlipayService {
  private config():Config {
    if(process.env.COURSE_ALIPAY_ENABLED!=='true')throw new ServiceUnavailableException('支付宝课程支付尚未开放');
    try {
      for(const name of ['ALIPAY_APP_ID','ALIPAY_SELLER_ID','ALIPAY_PRIVATE_KEY_FILE','ALIPAY_PUBLIC_KEYS_FILE','PUBLIC_API_URL'])if(!process.env[name]||/CHANGE_ME|REPLACE_ME/.test(process.env[name]!))throw new Error('Missing configuration');
      const appid=process.env.ALIPAY_APP_ID!,mchid=process.env.ALIPAY_SELLER_ID!;
      if(!/^\d{16}$/.test(appid)||!/^\d{16}$/.test(mchid))throw new Error('Invalid identity');
      const url=new URL(process.env.PUBLIC_API_URL!);
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.replace(/\/$/,'').endsWith('/api/v1'))throw new Error('Invalid callback');
      const privateKey=createPrivateKey(readFileSync(process.env.ALIPAY_PRIVATE_KEY_FILE!));
      if(privateKey.asymmetricKeyType!=='rsa'||(privateKey.asymmetricKeyDetails?.modulusLength??0)<2048)throw new Error('Invalid private key');
      // Key IDs and the active key come only from this operator-controlled file, never the notification.
      const ring=JSON.parse(readFileSync(process.env.ALIPAY_PUBLIC_KEYS_FILE!,'utf8')) as {active:string;keys:Record<string,string>};
      if(!ring.keys||!Object.hasOwn(ring.keys,ring.active)||Object.keys(ring.keys).length>3)throw new Error('Invalid trusted key ring');
      const verifiers=Object.entries(ring.keys).map(([id,pem])=>{
        const key=createPublicKey(pem);
        if(!/^[\w-]{1,80}$/.test(id)||key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)throw new Error('Invalid verification key');
        return new AlipaySdk({appId:appid,privateKey:privateKey.export({type:'pkcs8',format:'pem'}).toString(),keyType:'PKCS8',alipayPublicKey:pem,signType:'RSA2',timeout:10000,camelcase:false});
      });
      const sdk=verifiers[Object.keys(ring.keys).indexOf(ring.active)]!,checks=verifiers.map(v=>v.checkResponseSign.bind(v));
      sdk.checkResponseSign=(...args:Parameters<AlipaySdk['checkResponseSign']>)=>{
        for(const check of checks){try{check(...args);return;}catch{/* Only locally pinned keys can validate a rotating response. */}}
        throw new UnauthorizedException('支付宝响应签名无效');
      };
      return{appid,mchid,sdk,verifiers,notifyUrl:url.toString().replace(/\/$/,'')+'/payments/alipay/notify'};
    }catch{throw new ServiceUnavailableException('支付宝支付配置未就绪，请稍后重试');}
  }
  identity(){const c=this.config();return{appid:c.appid,mchid:c.mchid};}
  availability(){try{this.config();return{enabled:true,reason:''};}catch{return{enabled:false,reason:'支付宝课程支付尚未开放，请先试听或查看已有课程。'};}}
  async prepay(orderNo:string,title:string,amount:number,expiresAt:Date){
    const c=this.config();if(expiresAt<=new Date())throw new ServiceUnavailableException('订单已超过付款期限');
    return c.sdk.sdkExecute('alipay.trade.app.pay',{notifyUrl:c.notifyUrl,bizContent:{out_trade_no:orderNo,product_code:'QUICK_MSECURITY_PAY',subject:title.slice(0,128),seller_id:c.mchid,total_amount:yuan(amount),time_expire:new Date(expiresAt.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ')}});
  }
  private async request(method:string,biz:Result):Promise<Result>{
    const c=this.config();
    try {
      // The official SDK validates the raw signed v2 response. v2 is retained for App trade APIs.
      const result=await c.sdk.exec(method,{bizContent:biz},{validateSign:true});
      if(result.code==='40004'&&result.sub_code==='ACQ.TRADE_NOT_EXIST')return{trade_status:'NOTFOUND'};
      if(result.code!=='10000')throw new Error('Provider rejected request');
      return result;
    }catch{throw new ServiceUnavailableException('支付宝暂时无法确认，请查询订单，勿重复付款');}
  }
  private transaction(result:Result,c:Config):WechatTransaction {
    const status=String(result.trade_status);
    if(!['TRADE_SUCCESS','TRADE_FINISHED','WAIT_BUYER_PAY','TRADE_CLOSED','NOTFOUND'].includes(status))throw new ServiceUnavailableException('支付宝返回未知交易状态');
    return{appid:c.appid,mchid:c.mchid,out_trade_no:String(result.out_trade_no??''),trade_type:'APP',trade_state:['TRADE_SUCCESS','TRADE_FINISHED'].includes(status)?'SUCCESS':status==='WAIT_BUYER_PAY'?'NOTPAY':status==='TRADE_CLOSED'?'CLOSED':'NOTFOUND',...(['TRADE_SUCCESS','TRADE_FINISHED'].includes(status)?{transaction_id:String(result.trade_no??''),success_time:chinaTime(result.gmt_payment??result.send_pay_date),amount:{total:alipayCents(result.total_amount),currency:'CNY'}}:{})};
  }
  async query(orderNo:string){
    const c=this.config(),result=await this.request('alipay.trade.query',{out_trade_no:orderNo});
    if(result.trade_status==='NOTFOUND')return{appid:c.appid,mchid:c.mchid,out_trade_no:orderNo,trade_state:'NOTFOUND'};
    if(result.out_trade_no!==orderNo||(result.seller_id&&result.seller_id!==c.mchid))throw new ServiceUnavailableException('支付宝查单结果与原订单不一致');
    return this.transaction(result,c);
  }
  close(orderNo:string){return this.request('alipay.trade.close',{out_trade_no:orderNo});}
  async refund(transactionId:string,refundNo:string,amount:number,total:number,orderNo?:string){
    await this.request('alipay.trade.refund',{trade_no:transactionId,out_request_no:refundNo,refund_amount:yuan(amount),refund_reason:'课程退课退款'});
    return this.queryRefund(refundNo,{transactionId,total,orderNo:orderNo??''});
  }
  async queryRefund(refundNo:string,context?:RefundContext):Promise<WechatRefund>{
    if(!context?.transactionId||!context.orderNo)throw new ServiceUnavailableException('退款缺少原收款记录，请联系书院核查');
    const c=this.config(),result=await this.request('alipay.trade.fastpay.refund.query',{trade_no:context.transactionId,out_request_no:refundNo,query_options:['gmt_refund_pay']});
    if(result.trade_no!==context.transactionId||result.out_trade_no!==context.orderNo||result.out_request_no!==refundNo)throw new ServiceUnavailableException('支付宝退款查单与原申请不一致');
    const succeeded=result.refund_status==='REFUND_SUCCESS';
    return{mchid:c.mchid,out_trade_no:context.orderNo,transaction_id:context.transactionId,out_refund_no:refundNo,refund_id:context.transactionId+':'+refundNo,status:succeeded?'SUCCESS':'PROCESSING',...(succeeded?{success_time:chinaTime(result.gmt_refund_pay)}:{}),amount:{refund:alipayCents(result.refund_amount),total:context.total,currency:'CNY'}};
  }
  notification(raw:Buffer){
    const c=this.config();if(!raw?.length||raw.length>65536)throw new UnauthorizedException('支付宝通知无效');
    const pairs=new URLSearchParams(raw.toString('utf8')),data:Record<string,string>={};
    for(const [key,value] of pairs){if(Object.hasOwn(data,key)||key==='__proto__'||key.length>80||value.length>12000)throw new UnauthorizedException('支付宝通知字段无效');Object.defineProperty(data,key,{value,enumerable:true});}
    if(data.sign_type!=='RSA2'||!data.sign||!c.verifiers.some(sdk=>sdk.checkNotifySignV2(data))||data.app_id!==c.appid||data.seller_id!==c.mchid||!data.notify_id||data.notify_id.length>128)throw new UnauthorizedException('支付宝通知签名或商户无效');
    if(!['TRADE_SUCCESS','TRADE_FINISHED','WAIT_BUYER_PAY','TRADE_CLOSED'].includes(data.trade_status??''))throw new UnauthorizedException('支付宝通知状态无效');
    return{id:data.notify_id,data:this.transaction(data,c)};
  }
}
