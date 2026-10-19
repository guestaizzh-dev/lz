import {request} from './api';
export type ProductLine={promotion?:{title:string;endsAt:string}|null;id:string;skuId:string;title:string;skuTitle:string;cover:string;unitPrice:number;quantity:number;subtotal:number;payable:string;shipping:string;shippedQuantity:number;refundedQuantity:number;refundOnlyQuantity:number;refundMoneyQuantity:number;refundedAmount:string};
export type ProductQuote={shippingMode:string;priorityAvailable:boolean;priorityFee:number;priorityOptionFee:number|null;priorityDescription:string|null;quoteHash:string;items:ProductLine[];address:{recipient:string;phone:string;province:string;city:string;district:string;detail:string};subtotal:number;shipping:number;total:number;discount:number;shippingDiscount:number;shippingSurcharge:number;paymentEnabled:boolean;refundPolicy:string;unavailableReason:string;channels:{channel:string;provider:string;label:string;enabled:boolean}[]};
export type ProductRefund={id:string;version:number;kind:string;state:string;amount:string;reason:string;reviewNote:string|null;returnInstructions:string|null;automatic:boolean;items:{orderItemId:string;quantity:number}[]};
export type ProductShipment={id:string;refundId:string|null;kind:string;state:string;carrierCode:string;carrier:string;trackingNo:string;shippedAt:string;deliveredAt:string|null;items:{orderItemId:string;quantity:number}[]};
export type ProductOrder={memberGift?:{id:string;state:string}|null;pointsRedemption?:{id:string;state:string;points:string}|null;shippingMode:string;priorityFee:number;priorityDescription:string|null;id:string;orderNo:string;state:string;version:number;subtotal:string;discount:string;shipping:string;amount:string;paidAmount:string;refundedAmount:string;channel:string;createdAt:string;expiresAt:string;paidAt:string|null;canPay:boolean;paymentNotice?:string;closeReason:string|null;address:ProductQuote['address']|null;refundPolicy:string;items:ProductLine[];shipments:ProductShipment[];refunds:ProductRefund[]};
export const productOrderLabel=(order:ProductOrder)=>Number(order.refundedAmount)===Number(order.paidAmount)&&Number(order.paidAmount)>0?'已全额退款':({PENDING:'待付款',PAID:'等待发货',FULFILLING:'配送中',COMPLETED:'已签收',CLOSED:'已关闭'} as Record<string,string>)[order.state]??'处理中';
export const productRefundLabel=(state:string)=>({APPROVED:'换货待发出',REQUESTED:'待审核',RETURNING:'请寄回商品',REVIEW:'退货已收，等待财务核查',REFUNDING:'原路退款中',SUCCEEDED:'退款成功',FAILED:'退款处理中，请联系书院',REJECTED:'申请未通过',CANCELLED:'已取消'} as Record<string,string>)[state]??'处理中';
export const carrierChoices=[{value:'shunfeng',label:'顺丰速运'},{value:'zhongtong',label:'中通快递'},{value:'yuantong',label:'圆通速递'},{value:'shentong',label:'申通快递'},{value:'yunda',label:'韵达快递'},{value:'ems',label:'邮政EMS'},{value:'jd',label:'京东物流'}];
export async function payProductOrder(order:ProductOrder):Promise<{order:ProductOrder;notice:string}>{
  const payment=await request<{provider:string;orderInfo:string}>('/commerce/product-orders/'+order.id+'/payment',{method:'POST'});let hint='';
  // #ifdef APP
  await new Promise<void>(resolve=>{uni.requestPayment({provider:payment.provider,orderInfo:payment.orderInfo,success:()=>resolve(),fail:e=>{hint=e.errCode===700601?'已取消支付，请先查询订单。':'支付结果待确认，请先查询订单，勿重复付款。';resolve();}});});
  // #endif
  // #ifndef APP
  hint='请在App内完成支付。';
  // #endif
  try{return{order:await request<ProductOrder>('/commerce/product-orders/'+order.id+'/refresh',{method:'POST'}),notice:hint};}catch{return{order,notice:hint||'已保留订单，请稍后查询付款结果。'};}
}
