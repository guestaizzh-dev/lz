import {request} from './api';
export type DigitalFile={id:string;name:string;mime:string;bytes:number};
export type DigitalPack={title:string;description:string;files:DigitalFile[]};
export type DigitalOrder={id:string;orderNo:string;state:string;createdAt:string;expiresAt:string;paidAt:string|null;payableTotal:string;paidTotal:string;refundedTotal:string;pack:DigitalPack|null;canRefund:boolean;canReceive:boolean;refundPolicy:string;delivery:{id:string;firstAccessAt:string|null;expiresAt:string|null;revokedAt:string|null}|null;refunds:{id:string;state:string;description:string;reviewNote:string|null}[]};
export type DigitalQuote={skuId:string;title:string;price:string;description:string;releaseNo:number;accessDays:number|null;quoteHash:string;refundPolicy:string;paymentEnabled:boolean;unavailableReason:string;channels:{channel:string;label:string;enabled:boolean}[]};
export const digitalState=(row:DigitalOrder)=>Number(row.refundedTotal)>0?'已退款':({PENDING:'待付款',COMPLETED:row.canReceive?'可领取资料':'查看交付状态',CLOSED:'已关闭'} as Record<string,string>)[row.state]??'处理中';
export async function payDigitalOrder(order:DigitalOrder){
  const payment=await request<{provider:string;orderInfo:string}>('/commerce/digital-orders/'+order.id+'/payment',{method:'POST'});let notice='';
  // #ifdef APP
  await new Promise<void>(resolve=>uni.requestPayment({provider:payment.provider,orderInfo:payment.orderInfo,success:()=>resolve(),fail:()=>{notice='支付结果待确认，请查询订单，勿重复付款。';resolve();}}));
  // #endif
  // #ifndef APP
  notice='请在App内完成支付。';
  // #endif
  return{order:await request<DigitalOrder>('/commerce/digital-orders/'+order.id+'/refresh',{method:'POST'}),notice};
}
