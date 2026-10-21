import type {Database} from './database.js';
import type {Prisma} from './generated/prisma/client.js';
import {benefitWindow,membershipRefundHolds} from './membership-benefits.js';
import {discountedAmount,memberPriceSources} from './member-pricing.js';
import {ConflictException} from '@nestjs/common';

type Store=Database|Prisma.TransactionClient;
export type BookingMemberPrice={periodId:string;planVersionId:string;benefitId:string;basisPoints:number;endsAt:string;savings:string;code?:string;windowStart?:string;windowEnd?:string;quota?:number};
export async function consultationCredit(store:Store,userId:string,offeringId:string,offerId:string,amount:bigint){
 let selected:BookingMemberPrice|null=null;
 for(const source of await memberPriceSources(userId,store,['CONSULTATION_CREDIT'])){
  const serviceIds=(source.parameters as {serviceIds?:string[]}).serviceIds;if(!Array.isArray(serviceIds)||!serviceIds.includes(offeringId))continue;
  const benefit=await store.planBenefit.findUniqueOrThrow({where:{id:source.benefitId}}),member=await store.membership.findUniqueOrThrow({where:{id:source.periodId}}),limit=(source.parameters as {amountMinor?:string}).amountMinor;
  if(!benefit.quota||!limit||!/^\d{1,12}$/.test(limit))continue;
  const window=benefitWindow(member.startsAt,member.endsAt,benefit.periodKind,new Date()),used=await store.benefitUsage.aggregate({where:{userId,periodId:member.id,definitionId:benefit.definitionId,windowStart:window.windowStart,windowEnd:window.windowEnd,state:{in:['HELD','CONSUMED']}},_sum:{quantity:true}});
  if((used._sum.quantity??0)>=benefit.quota)continue;const savings=BigInt(limit)<amount?BigInt(limit):amount;
  if(savings>0n&&(!selected||savings>BigInt(selected.savings)))selected={periodId:member.id,planVersionId:source.planVersionId,benefitId:benefit.id,basisPoints:0,endsAt:member.endsAt.toISOString(),savings:String(savings),code:'CONSULTATION_CREDIT',windowStart:window.windowStart.toISOString(),windowEnd:window.windowEnd.toISOString(),quota:benefit.quota};
 }
 return selected;
}
export async function eventMemberPrice(store:Store,userId:string|undefined,eventId:string,category:string,offerId:string,eligible:boolean,amount:bigint){
  if(!userId||!eligible||amount<=0n)return null;
  let payable=amount,selected:BookingMemberPrice|null=null;
  for(const source of await memberPriceSources(userId,store,['EVENT_DISCOUNT'])){
    if(source.scopes.length&&!source.scopes.some(s=>s.resourceId===eventId||s.offerId===offerId||s.categoryCode===category))continue;
    const rate=(source.parameters as {basisPoints?:number}).basisPoints;
    if(!Number.isInteger(rate)||rate!<0||rate!>=10000)continue;
    const price=BigInt(discountedAmount(Number(amount),rate!));
    if(price<payable){payable=price;selected={periodId:source.periodId,planVersionId:source.planVersionId,benefitId:source.benefitId,basisPoints:rate!,endsAt:source.endsAt.toISOString(),savings:String(amount-price)};}
  }
  return selected;
}
export async function freezeBookingMemberPrice(tx:Prisma.TransactionClient,userId:string,businessKey:string,source:BookingMemberPrice|null,quantity:number,state:'HELD'|'CONSUMED'='HELD'){
  if(!source)return;
  const member=await tx.membership.findUniqueOrThrow({where:{id:source.periodId}}),benefit=await tx.planBenefit.findUniqueOrThrow({where:{id:source.benefitId}});
  const window=source.windowStart&&source.windowEnd?{windowStart:new Date(source.windowStart),windowEnd:new Date(source.windowEnd)}:benefitWindow(member.startsAt,member.endsAt,'MEMBERSHIP',new Date());
  if(source.code==='CONSULTATION_CREDIT'){const used=await tx.benefitUsage.aggregate({where:{userId,periodId:member.id,definitionId:benefit.definitionId,...window,state:{in:['HELD','CONSUMED']}},_sum:{quantity:true}});if((used._sum.quantity??0)>=benefit.quota!)throw new ConflictException('本期咨询额度已使用，请重新确认');}
  await tx.benefitUsage.create({data:{userId,periodId:member.id,definitionId:benefit.definitionId,...window,quantity:1,businessKey,state,parametersSnapshot:{code:source.code??'EVENT_DISCOUNT',...source,attendees:quantity,parameters:benefit.parameters}}});
}
export async function bookingMemberPriceReady(store:Store,userId:string,businessKey:string,source:BookingMemberPrice|undefined|null,at=new Date()){
  if(!source)return true;
  if((await membershipRefundHolds(userId,store)).includes(source.periodId))return false;
  return !!await store.benefitUsage.findFirst({where:{userId,periodId:source.periodId,businessKey,state:'HELD'}})&&!!await store.membership.findFirst({where:{id:source.periodId,userId,startsAt:{lte:at},endsAt:{gt:at},OR:[{revokedAt:null},{revokedAt:{gt:at}}]}});
}
export async function finishBookingMemberPrice(tx:Prisma.TransactionClient,businessKey:string,state:'CONSUMED'|'RELEASED'|'REVERSED'){
  if(state==='REVERSED')await tx.benefitUsage.updateMany({where:{businessKey,state:'HELD'},data:{state:'RELEASED',updatedAt:new Date(),version:{increment:1}}});
  await tx.benefitUsage.updateMany({where:{businessKey,state:state==='REVERSED'?'CONSUMED':'HELD',...(state==='CONSUMED'?{NOT:{parametersSnapshot:{path:['code'],equals:'CONSULTATION_CREDIT'}}}:{})},data:{state,updatedAt:new Date(),version:{increment:1}}});
}
export async function syncConsultationCredit(tx:Prisma.TransactionClient,id:string){
 const appointment=await tx.appointment.findUniqueOrThrow({where:{id}}),item=appointment.orderItemId?await tx.tradeOrderItem.findUniqueOrThrow({where:{id:appointment.orderItemId}}):null,order=item?await tx.tradeOrder.findUniqueOrThrow({where:{id:item.orderId}}):null,businessKey=order?'booking.price:'+order.id:'consult.price:'+id,usage=await tx.benefitUsage.findFirst({where:{businessKey}});
 if(!usage||(usage.parametersSnapshot as {code?:string}).code!=='CONSULTATION_CREDIT')return;
 const refund=!!order&&order.paidTotal>0n&&order.refundedTotal>=order.paidTotal,state=refund?usage.state==='CONSUMED'?'REVERSED':'RELEASED':appointment.state==='COMPLETED'?'CONSUMED':['CANCELLED','NO_SHOW','REFUNDED'].includes(appointment.state)?usage.state==='CONSUMED'?'REVERSED':'RELEASED':null;
 if(state&&state!==usage.state)await tx.benefitUsage.update({where:{id:usage.id},data:{state,updatedAt:new Date(),version:{increment:1}}});
}
export async function reverseFreeEventPrices(tx:Prisma.TransactionClient,ticketIds:string[]){
  const rows=await tx.eventRegistration.findMany({where:{ticketTypeId:{in:ticketIds},orderItemId:null,state:{in:['CONFIRMED','COMPLETED']}},select:{id:true}});
  await tx.benefitUsage.updateMany({where:{businessKey:{in:rows.map(r=>'event.price:'+r.id)},state:'CONSUMED'},data:{state:'REVERSED',updatedAt:new Date(),version:{increment:1}}});
}
