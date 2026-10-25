export type CourseMemberBenefit={basisPoints:number;endsAt:string;savings:string};
export type PublicCharityPrice={programId:string;title:string;price:string};
export type CoursePurchase = {liveSessions?:{id:string;title:string;scheduledAt:string}[];courseId:string;releaseId:string;title:string;cover:string;teacherName:string;format:string;contentFormats?:string[];lessons:number;durationSeconds:number;accessDays:number|null;refundPolicy:string;refundDays:number};
export type CoursePaymentChoice = {channel:string;provider:string;label:string;enabled:boolean;reason:string};
export type CourseQuote = CoursePurchase & {memberBenefit?:CourseMemberBenefit|null;window?:{phase:string;publicOpenAt:string|null;earlyAccessAt:string|null};charity?:PublicCharityPrice|null;group:{groupId:string|null;title:string}|null;groupOptions:{id:string;title:string;price:string}[];originalPrice:string;discount:string;coupon:{id:string;terms:{title:string}}|null;price:string;currency:string;quoteHash:string;alreadyAccessible:boolean;pendingOrderId:string|null;paymentEnabled:boolean;unavailableReason:string;channels:CoursePaymentChoice[]};
export type CourseRefund = {id:string;state:string;version:number;amount:string;reason:string;reviewNote:string|null;createdAt:string;automatic:boolean};
export type CourseOrder = {memberBenefit?:CourseMemberBenefit|null;charity?:PublicCharityPrice|null;group:{id:string;state:string;expiresAt:string;paidMembers:number;requiredMembers:number}|null;originalPrice:string;discount:string;coupon:{id:string;terms:{title:string}}|null;id:string;orderNo:string;state:string;version:number;amount:string;paidAmount:string;refundedAmount:string;createdAt:string;expiresAt:string;paidAt:string|null;closeReason:string|null;course:CoursePurchase;channel:string;canPay:boolean;paymentStatus:string;canRefund:boolean;refundUnavailableReason:string;refunds:CourseRefund[];access:boolean;deliveryBlocked:boolean;deliveryReason:string|null};
export function purchasePlatform():string {
  let platform='WEB';
  // #ifdef APP-ANDROID
  platform='ANDROID';
  // #endif
  // #ifdef APP-IOS
  platform='IOS';
  // #endif
  return platform;
}
export const orderLabel=(order:CourseOrder):string=>Number(order.refundedAmount)>0?'已退款':order.state==='COMPLETED'?'已支付':order.state==='CLOSED'?'已关闭':order.paymentStatus==='EXPIRED'?'支付已超时':'待支付';
export const refundLabel=(state:string):string=>({REQUESTED:'待审核',APPROVED:'方案待本人确认',REFUNDING:'原路退款中',SUCCEEDED:'退款已完成',REVERSED:'Apple已撤回退款',FAILED:'退款需人工处理',REJECTED:'申请未通过',CANCELLED:'已取消'} as Record<string,string>)[state]??'处理中';
export const paymentChannelLabel=(channel:string):string=>channel==='APPLE_IAP'?'Apple内购':channel==='ALIPAY_APP'?'支付宝':channel==='WECHAT_APP'?'微信支付':'待核查渠道';
export function coursePurchaseAction(order:CourseOrder|null,quote:CourseQuote|null,canPay:boolean,agreed:boolean,clock:number):{kind:string;label:string;enabled:boolean}{
  if(order){
    if(order.refunds.some(r=>r.state==='REFUNDING'))return{kind:'QUERY',label:'查询退课进度',enabled:true};
    if(order.state==='CLOSED'||Number(order.refundedAmount)>0)return{kind:'DETAIL',label:'返回课程',enabled:true};
    if(order.deliveryBlocked)return{kind:'VERSION',label:'查看课程处理方案',enabled:true};
    if(order.access)return{kind:'LEARN',label:'开始研习',enabled:true};
    if(order.group&&order.group.state!=='SUCCEEDED'&&order.state==='COMPLETED')return{kind:'GROUP',label:'查看拼团进度',enabled:true};
    if(order.state==='COMPLETED')return{kind:'LIBRARY',label:'查看学习档案',enabled:true};
    if(!order.canPay||Date.parse(order.expiresAt)<=clock||!canPay)return{kind:'QUERY',label:'查询订单状态',enabled:true};
    return{kind:'PAY',label:'继续支付',enabled:true};
  }
  if(quote?.alreadyAccessible)return{kind:'LEARN',label:'开始研习',enabled:true};
  if(quote?.pendingOrderId)return{kind:'PENDING',label:'查看待支付订单',enabled:true};
  return{kind:'BUY',label:canPay?'确认购买':'购买暂未开放',enabled:canPay&&agreed};
}
