import type {Database} from './database.js';
import type {Prisma} from './generated/prisma/client.js';
import {benefitWindow,membershipRefundHolds} from './membership-benefits.js';
import {discountedAmount,memberPriceSources} from './member-pricing.js';

type Store=Database|Prisma.TransactionClient;
export type BookingMemberPrice={periodId:string;planVersionId:string;benefitId:string;basisPoints:number;endsAt:string;savings:string};
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
  await tx.benefitUsage.create({data:{userId,periodId:member.id,definitionId:benefit.definitionId,...benefitWindow(member.startsAt,member.endsAt,'MEMBERSHIP',new Date()),quantity:1,businessKey,state,parametersSnapshot:{code:'EVENT_DISCOUNT',...source,attendees:quantity,parameters:benefit.parameters}}});
}
export async function bookingMemberPriceReady(store:Store,userId:string,businessKey:string,source:BookingMemberPrice|undefined|null,at=new Date()){
  if(!source)return true;
  if((await membershipRefundHolds(userId,store)).includes(source.periodId))return false;
  return !!await store.benefitUsage.findFirst({where:{userId,periodId:source.periodId,businessKey,state:'HELD'}})&&!!await store.membership.findFirst({where:{id:source.periodId,userId,startsAt:{lte:at},endsAt:{gt:at},OR:[{revokedAt:null},{revokedAt:{gt:at}}]}});
}
export async function finishBookingMemberPrice(tx:Prisma.TransactionClient,businessKey:string,state:'CONSUMED'|'RELEASED'|'REVERSED'){
  await tx.benefitUsage.updateMany({where:{businessKey,state:state==='REVERSED'?'CONSUMED':'HELD'},data:{state,updatedAt:new Date(),version:{increment:1}}});
}
export async function reverseFreeEventPrices(tx:Prisma.TransactionClient,ticketIds:string[]){
  const rows=await tx.eventRegistration.findMany({where:{ticketTypeId:{in:ticketIds},orderItemId:null,state:{in:['CONFIRMED','COMPLETED']}},select:{id:true}});
  await tx.benefitUsage.updateMany({where:{businessKey:{in:rows.map(r=>'event.price:'+r.id)},state:'CONSUMED'},data:{state:'REVERSED',updatedAt:new Date(),version:{increment:1}}});
}
