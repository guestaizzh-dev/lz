import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { WechatPayService } from './wechat-pay.js';
import { AlipayService } from './alipay.js';
import type { WechatRefund, WechatTransaction } from './wechat-pay.js';

export type AppPaymentChannel = 'WECHAT_APP'|'ALIPAY_APP';
export type RefundContext = {transactionId:string;orderNo:string;total:number};
export interface AppPaymentAdapter {
  identity():{appid:string;mchid:string};
  availability():{enabled:boolean;reason:string};
  prepay(orderNo:string,title:string,amount:number,expiresAt:Date):Promise<string>;
  query(orderNo:string):Promise<WechatTransaction>;
  close(orderNo:string):Promise<unknown>;
  refund(transactionId:string,refundNo:string,amount:number,total:number,orderNo?:string):Promise<WechatRefund>;
  queryRefund(refundNo:string,context?:RefundContext):Promise<WechatRefund>;
}

// Only verified adapters are registered. An unknown stored channel must never fall back to another merchant.
@Injectable()
export class PaymentChannels {
  constructor(private readonly wechat: WechatPayService, private readonly alipay:AlipayService) {}
  resolve(channel: string): AppPaymentAdapter {
    if (channel === 'WECHAT_APP') return this.wechat;
    if (channel === 'ALIPAY_APP') return this.alipay;
    throw new ServiceUnavailableException('此订单的支付渠道尚未接入，请联系书院核查，勿重复付款');
  }
  choices(){return (['WECHAT_APP','ALIPAY_APP'] as const).map(channel=>({channel,provider:channel==='WECHAT_APP'?'wxpay':'alipay',label:channel==='WECHAT_APP'?'微信支付':'支付宝',...this.resolve(channel).availability()}));}
  wechatNotification(headers:Record<string,string|string[]|undefined>,raw:Buffer){return this.wechat.notification(headers,raw);}
  alipayNotification(raw:Buffer){return this.alipay.notification(raw);}
}
