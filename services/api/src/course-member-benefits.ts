import type {Database} from './database.js';
import type {Prisma,CourseRelease,TradeOrder} from './generated/prisma/client.js';
import {benefitWindow,membershipRefundHolds} from './membership-benefits.js';
import {discountedAmount,memberPriceSources} from './member-pricing.js';

type Store=Database|Prisma.TransactionClient;
export type CourseMemberPrice={periodId:string;planVersionId:string;benefitId:string;basisPoints:number;endsAt:string;savings:string};
export type CourseMemberPolicy={discountEligible?:boolean;category?:string;earlyAccessAt?:string|null;publicOpenAt?:string|null};
export const courseMemberPolicy=(release:Pick<CourseRelease,'memberPolicySnapshot'>)=>release.memberPolicySnapshot as CourseMemberPolicy;
export async function courseMemberPrice(store:Store,userId:string|undefined,release:CourseRelease,offerId:string,amount:bigint,platform:string){
  const policy=courseMemberPolicy(release);
  if(!userId||platform!=='ANDROID'||policy.discountEligible!==true)return null;
  let price=amount,selected:CourseMemberPrice|null=null;
  for(const source of await memberPriceSources(userId,store,['COURSE_DISCOUNT'])){
    if(source.scopes.length&&!source.scopes.some(s=>s.resourceId===release.courseId||s.offerId===offerId||s.categoryCode===policy.category))continue;
    const rate=(source.parameters as {basisPoints?:number}).basisPoints;
    if(!Number.isInteger(rate)||rate!<1000||rate!>=10000)continue;
    const candidate=BigInt(discountedAmount(Number(amount),rate!));
    if(candidate<price){price=candidate;selected={periodId:source.periodId,planVersionId:source.planVersionId,benefitId:source.benefitId,basisPoints:rate!,endsAt:source.endsAt.toISOString(),savings:String(amount-candidate)};}
  }
  return selected;
}
export async function freezeCourseMemberPrice(tx:Prisma.TransactionClient,userId:string,orderId:string,source:CourseMemberPrice|null){
  if(!source)return;
  const benefit=await tx.planBenefit.findUniqueOrThrow({where:{id:source.benefitId}}),member=await tx.membership.findUniqueOrThrow({where:{id:source.periodId}});
  await tx.benefitUsage.create({data:{userId,periodId:member.id,definitionId:benefit.definitionId,...benefitWindow(member.startsAt,member.endsAt,'MEMBERSHIP',new Date()),quantity:1,businessKey:'course.price:'+orderId,state:'HELD',parametersSnapshot:{code:'COURSE_DISCOUNT',orderId,...source}}});
}
export async function courseMemberPriceReady(store:Store,order:TradeOrder,at=new Date()){
  const source=(order.pricingSnapshot as {memberBenefit?:CourseMemberPrice}).memberBenefit;
  if(!source)return true;
  if((await membershipRefundHolds(order.userId,store)).includes(source.periodId))return false;
  return !!await store.benefitUsage.findFirst({where:{userId:order.userId,periodId:source.periodId,businessKey:'course.price:'+order.id,state:'HELD'}})&&!!await store.membership.findFirst({where:{id:source.periodId,userId:order.userId,startsAt:{lte:at},endsAt:{gt:at},OR:[{revokedAt:null},{revokedAt:{gt:at}}]}});
}
export async function finishCourseMemberPrice(tx:Prisma.TransactionClient,orderId:string,state:'CONSUMED'|'RELEASED'|'REVERSED'){
  await tx.benefitUsage.updateMany({where:{businessKey:'course.price:'+orderId,state:state==='REVERSED'?'CONSUMED':'HELD'},data:{state,updatedAt:new Date(),version:{increment:1}}});
}
export async function courseReleaseWindow(store:Store,release:Pick<CourseRelease,'memberPolicySnapshot'|'courseId'>,userId?:string){
  const policy=courseMemberPolicy(release),time=Date.now(),open=policy.publicOpenAt?Date.parse(policy.publicOpenAt):0,early=policy.earlyAccessAt?Date.parse(policy.earlyAccessAt):0;
  const phase=!open||time>=open?'PUBLIC':time<early?'UPCOMING':'EARLY';
  let memberEarlyAccess=false;
  if(phase==='EARLY'&&userId)for(const source of await memberPriceSources(userId,store,['COURSE_EARLY_ACCESS'])){
    if((source.parameters as {enabled?:boolean}).enabled===true&&(!source.scopes.length||source.scopes.some(s=>s.resourceId===release.courseId||s.categoryCode===policy.category))){memberEarlyAccess=true;break;}
  }
  return {earlyAccessAt:policy.earlyAccessAt??null,publicOpenAt:policy.publicOpenAt??null,phase,memberEarlyAccess,lockedReason:phase==='PUBLIC'||memberEarlyAccess?null:phase==='UPCOMING'?'新课尚未开放研习，可先试听。':'新课处于会员提前研习期，完整学习须同时具备本课内容权益与提前学习权益。'};
}
