import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { WechatPayService } from './wechat-pay.js';
import { AlipayService } from './alipay.js';
import type { WechatRefund, WechatTransaction } from './wechat-pay.js';

export type AppPaymentChannel = 'WECHAT_APP'|'ALIPAY_APP'|'SIMULATED';
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

const simulationOn = () => process.env.PAYMENT_SIMULATION_ENABLED === 'true';

/** 模拟渠道：只在显式开启时存在，资金事实一律标记 SIMULATED，不能用于真实收款。 */
class SimulatedAdapter implements AppPaymentAdapter {
  identity() { return { appid: 'SIMULATED', mchid: 'SIMULATED' }; }
  availability() { return simulationOn() ? { enabled: true, reason: '模拟收款：后台人工触发，不产生真实资金' } : { enabled: false, reason: '模拟收款未开启' }; }
  async prepay(): Promise<string> { throw new ServiceUnavailableException('模拟收款不需要预下单，请在后台订单中触发'); }
  async query(): Promise<WechatTransaction> { throw new ServiceUnavailableException('模拟收款不支持查单'); }
  async close(): Promise<unknown> { return {}; }
  async refund(): Promise<WechatRefund> { throw new ServiceUnavailableException('模拟退款请使用后台退款核查流程'); }
  async queryRefund(): Promise<WechatRefund> { throw new ServiceUnavailableException('模拟退款不支持查单'); }
}

// Only verified adapters are registered. An unknown stored channel must never fall back to another merchant.
@Injectable()
export class PaymentChannels {
  private readonly simulated = new SimulatedAdapter();
  constructor(private readonly wechat: WechatPayService, private readonly alipay:AlipayService) {}
  resolve(channel: string): AppPaymentAdapter {
    if (channel === 'WECHAT_APP') return this.wechat;
    if (channel === 'ALIPAY_APP') return this.alipay;
    if (channel === 'SIMULATED' && simulationOn()) return this.simulated;
    throw new ServiceUnavailableException('此订单的支付渠道尚未接入，请联系书院核查，勿重复付款');
  }
  choices(){const rows=(['WECHAT_APP','ALIPAY_APP'] as const).map(channel=>({channel,provider:channel==='WECHAT_APP'?'wxpay':'alipay',label:channel==='WECHAT_APP'?'微信支付':'支付宝',...this.resolve(channel).availability()}));return simulationOn()?[...rows,{channel:'SIMULATED',provider:'simulated',label:'模拟支付（演示）',...this.simulated.availability()}]:rows;}
  wechatNotification(headers:Record<string,string|string[]|undefined>,raw:Buffer){return this.wechat.notification(headers,raw);}
  alipayNotification(raw:Buffer){return this.alipay.notification(raw);}
}

