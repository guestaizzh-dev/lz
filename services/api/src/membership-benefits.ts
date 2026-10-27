import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { membershipPlanView } from './membership-terms.js';
import type { Prisma } from './generated/prisma/client.js';

const chinaDay=(date:Date)=>new Date(new Date(date.getTime()+8*3600000).toISOString().slice(0,10)+'T00:00:00Z');
export function benefitWindow(startsAt:Date,endsAt:Date,periodKind:string,now:Date){
  const first=chinaDay(startsAt),last=chinaDay(new Date(endsAt.getTime()-1)),today=chinaDay(now);
  if(periodKind==='MEMBERSHIP')return{windowStart:first,windowEnd:last};
  if(periodKind==='DAY')return{windowStart:today,windowEnd:today};
  if(periodKind==='MONTH')return{windowStart:new Date(Math.max(first.getTime(),Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1))),windowEnd:new Date(Math.min(last.getTime(),Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+1,0)))};
  throw new ConflictException('权益额度周期配置无效，请联系书院');
}
export async function membershipContentTier(versionId:string|null,store:Pick<Database,'$queryRaw'>){
  if(!versionId)return 0;
  const rows=await store.$queryRaw<{parameters:unknown}[]>`SELECT b.parameters FROM "PlanBenefit" b JOIN "BenefitDefinition" d ON d.id=b."definitionId" WHERE b."planVersionId"=${versionId} AND d.code='CONTENT_ACCESS' AND NOT EXISTS(SELECT 1 FROM "BenefitScope" s WHERE s."planBenefitId"=b.id)`;
  const tier=(rows[0]?.parameters as {contentTier?:number}|undefined)?.contentTier;
  return Number.isInteger(tier)&&tier!>=0&&tier!<=4?tier!:0;
}
// A pending refund suspends only its purchased period, without rewriting its dates or grant source.
export async function membershipRefundHolds(userId:string,store:Pick<Database,'$queryRaw'>){
  const rows=await store.$queryRaw<{id:string}[]>`SELECT DISTINCT m.id FROM "Membership" m JOIN "TradeOrderItem" i ON i.id=m."orderItemId" JOIN "RefundItem" ri ON ri."orderItemId"=i.id JOIN "Refund" r ON r.id=ri."refundId" JOIN "PaymentTransaction" p ON p.id=r."paymentTransactionId" WHERE m."userId"=${userId} AND m.source='PURCHASE' AND m."grantKey"='membership.payment:'||p.id AND p.disposition='ACCEPTED' AND ri."revokeQuantity">0 AND r.state IN ('APPROVED','REFUNDING','FAILED')`;
  return rows.map(row=>row.id);
}
export async function eventPrioritySource(store:Database|Prisma.TransactionClient,userId:string|undefined,eventId:string,now=new Date()){
  if(!userId)return null;
  const event=await store.event.findUnique({where:{id:eventId},select:{studyTour:true}});const definitions=await store.benefitDefinition.findMany({where:{code:{in:event?.studyTour?['STUDY_TOUR_PRIORITY','EVENT_PRIORITY']:['EVENT_PRIORITY']},active:true,kind:'PRIORITY'},orderBy:{code:'desc'}});for(const definition of definitions){
  const suspended=await membershipRefundHolds(userId,store),members=await store.membership.findMany({where:{userId,revokedAt:null,id:{notIn:suspended},startsAt:{lte:now},endsAt:{gt:now}},orderBy:[{endsAt:'asc'},{id:'asc'}]});
  for(const member of members){
    const benefit=await store.planBenefit.findFirst({where:{planVersionId:member.planVersionId!,definitionId:definition.id}});if((benefit?.parameters as {enabled?:boolean}|undefined)?.enabled!==true)continue;
    const scopes=await store.benefitScope.findMany({where:{planBenefitId:benefit!.id}});if(scopes.length&&!scopes.some(s=>s.resourceId===eventId))continue;
    return {periodId:member.id,planVersionId:member.planVersionId,planBenefitId:benefit!.id,definitionId:definition.id,startsAt:member.startsAt.toISOString(),endsAt:member.endsAt.toISOString(),eventId};
  }
  const grants=await store.benefitGrant.findMany({where:{userId,definitionId:definition.id,revokedAt:null,startsAt:{lte:now},endsAt:{gt:now},offerId:null,OR:[{resourceId:null},{resourceId:eventId}]},orderBy:[{endsAt:'asc'},{id:'asc'}]});
  const grant=grants.find(g=>(g.parametersSnapshot as {enabled?:boolean}).enabled===true);
  if(grant)return {periodId:null,grantId:grant.id,planVersionId:null,planBenefitId:null,definitionId:definition.id,startsAt:grant.startsAt.toISOString(),endsAt:grant.endsAt.toISOString(),eventId};
  }return null;
}
class PageQuery { @IsOptional() @Type(()=>Number) @IsInt() @Min(1) page=1; @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20; }
class ContentBenefitsDto { @IsInt() @Min(1) expectedVersion!:number; @IsInt() @Min(0) @Max(4) contentTier!:number; @IsOptional() @IsBoolean() micPriority?:boolean; @IsString() @Length(2,500) @Matches(/\S/) reason!:string; }
class CommerceBenefitsDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsInt() @Min(1000) @Max(10000) productBasisPoints!:number;
  @IsBoolean() shippingWaiver!:boolean;
  @IsInt() @Min(0) @Max(100000000) minimumSubtotal!:number;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class CourseBenefitsDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsInt() @Min(1000) @Max(10000) courseBasisPoints!:number;
  @IsBoolean() earlyAccess!:boolean;
  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined,{each:true}) courseIds!:string[];
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class EventBenefitsDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsBoolean() eventPriority!:boolean;
  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined,{each:true}) eventIds!:string[];
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class EventPricingDto {@IsInt() @Min(1) expectedVersion!:number;@IsInt() @Min(0) @Max(10000) basisPoints!:number;@IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined,{each:true}) eventIds!:string[];@IsString() @Length(2,500) @Matches(/\S/) reason!:string;}
class ConsultationBenefitsDto {@IsInt() @Min(1) expectedVersion!:number;@IsInt() @Min(0) @Max(100) monthlyConsultations!:number;@IsInt() @Min(0) @Max(100000000) amountMinor!:number;@IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined,{each:true}) serviceIds!:string[];@IsString() @Length(2,500) @Matches(/\S/) reason!:string;}
class QuestionBenefitsDto { @IsInt() @Min(1) expectedVersion!:number; @IsInt() @Min(0) @Max(100) monthlyQuestions!:number; @IsBoolean() priority!:boolean; @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined,{each:true}) teacherIds!:string[]; @IsString() @Length(2,500) @Matches(/\S/) reason!:string; }
class CommunityBenefitsDto {@IsInt() @Min(1) expectedVersion!:number;@IsInt() @Min(0) @Max(10) monthlyPins!:number;@IsInt() @Min(1) @Max(7) pinDays!:number;@IsString() @Length(2,500) reason!:string;}
type QuotaSource={periodId:string|null;grantId:string|null;definitionId:string;parameters:Prisma.JsonValue;quota:number;periodKind:string;startsAt:Date;endsAt:Date;planVersionId:string|null;planBenefitId:string|null;resourceId:string|null;offerId:string|null};

@Injectable()
export class MembershipBenefitsService {
  constructor(private readonly db:Database){}
  private async sources(tx:Prisma.TransactionClient,userId:string,definitionId:string,now:Date){
    const suspended=await membershipRefundHolds(userId,tx);
    const members=await tx.membership.findMany({where:{userId,revokedAt:null,id:{notIn:suspended},startsAt:{lte:now},endsAt:{gt:now}},orderBy:{endsAt:'asc'}}),sources:QuotaSource[]=[];
    for(const member of members){const benefit=await tx.planBenefit.findFirst({where:{planVersionId:member.planVersionId!,definitionId}});if(benefit?.quota!==null&&benefit?.quota!==undefined)sources.push({periodId:member.id,grantId:null,definitionId,parameters:benefit.parameters,quota:benefit.quota,periodKind:benefit.periodKind,startsAt:member.startsAt,endsAt:member.endsAt,planVersionId:member.planVersionId,planBenefitId:benefit.id,resourceId:null,offerId:null});}
    const grants=await tx.benefitGrant.findMany({where:{userId,definitionId,revokedAt:null,startsAt:{lte:now},endsAt:{gt:now}},orderBy:{endsAt:'asc'}});
    for(const grant of grants)sources.push({periodId:null,grantId:grant.id,definitionId,parameters:grant.parametersSnapshot,quota:grant.quota,periodKind:'MEMBERSHIP',startsAt:grant.startsAt,endsAt:grant.endsAt,planVersionId:null,planBenefitId:null,resourceId:grant.resourceId,offerId:grant.offerId});
    return sources;
  }
  private async used(tx:Prisma.TransactionClient,userId:string,source:QuotaSource,window:ReturnType<typeof benefitWindow>){
    return (await tx.benefitUsage.aggregate({where:{userId,periodId:source.periodId,grantId:source.grantId,definitionId:source.definitionId,...window,state:{in:['HELD','CONSUMED']}},_sum:{quantity:true}}))._sum.quantity??0;
  }
  private async applies(tx:Prisma.TransactionClient,source:QuotaSource,scope:{resourceId?:string|null;offerId?:string|null;categoryCode?:string|null}){
    if(source.resourceId&&source.resourceId!==scope.resourceId||source.offerId&&source.offerId!==scope.offerId)return false;
    if(!source.planBenefitId)return true;
    const scopes=await tx.benefitScope.findMany({where:{planBenefitId:source.planBenefitId}});
    return !scopes.length||scopes.some(s=>!!s.resourceId&&s.resourceId===scope.resourceId||!!s.offerId&&s.offerId===scope.offerId||!!s.categoryCode&&s.categoryCode===scope.categoryCode);
  }
  async available(userId:string,code:string,context:{resourceId?:string;offerId?:string;categoryCode?:string}={}){return this.db.$transaction(async tx=>{
    const definition=await tx.benefitDefinition.findUnique({where:{code}});if(!definition?.active||definition.kind!=='QUOTA')return{remaining:0};
    const now=new Date();let remaining=0;
    for(const source of await this.sources(tx,userId,definition.id,now))if(await this.applies(tx,source,context))remaining+=Math.max(0,source.quota-await this.used(tx,userId,source,benefitWindow(source.startsAt,source.endsAt,source.periodKind,now)));
    return{remaining};
  },{isolationLevel:'RepeatableRead'});}
  // The owning business workflow supplies its transaction. There is no client endpoint that can fabricate usage.
  async hold(tx:Prisma.TransactionClient,userId:string,code:string,businessKey:string,quantity=1,context:{resourceId?:string;offerId?:string;categoryCode?:string}={}){
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000||!businessKey.trim()||businessKey.length>200)throw new BadRequestException('权益用量或业务编号无效');
    if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`).length)throw new ForbiddenException('账号不可用');
    const definition=await tx.benefitDefinition.findUnique({where:{code}});if(!definition?.active||definition.kind!=='QUOTA')throw new BadRequestException('此权益不支持额度占用');
    const scope={resourceId:context.resourceId??null,offerId:context.offerId??null,categoryCode:context.categoryCode??null},old=await tx.benefitUsage.findFirst({where:{userId,businessKey}});
    if(old){const prior=(old.parametersSnapshot as {scope?:typeof scope}).scope;if(old.definitionId!==definition.id||old.quantity!==quantity||prior?.resourceId!==scope.resourceId||prior?.offerId!==scope.offerId||prior?.categoryCode!==scope.categoryCode)throw new ConflictException('同一业务编号不能改变权益、范围或数量');return old;}
    const now=new Date();
    for(const source of await this.sources(tx,userId,definition.id,now)){
      if(!await this.applies(tx,source,scope))continue;
      const window=benefitWindow(source.startsAt,source.endsAt,source.periodKind,now),used=await this.used(tx,userId,source,window);
      if(source.quota-used<quantity)continue;
      return tx.benefitUsage.create({data:{userId,periodId:source.periodId,grantId:source.grantId,definitionId:definition.id,...window,quantity,businessKey,state:'HELD',parametersSnapshot:{code,scope,parameters:source.parameters,quota:source.quota,periodKind:source.periodKind,planVersionId:source.planVersionId,startsAt:source.startsAt.toISOString(),endsAt:source.endsAt.toISOString()}}});
    }
    throw new ConflictException('此权益当前不可用或剩余额度不足');
  }
  async finish(tx:Prisma.TransactionClient,userId:string,id:string,action:'CONSUMED'|'RELEASED'|'REVERSED'){
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const row=await tx.benefitUsage.findFirst({where:{id,userId}});if(!row)throw new NotFoundException('权益用量记录不存在');
    if(row.state===action)return row;
    if(!(row.state==='HELD'&&['CONSUMED','RELEASED'].includes(action)||row.state==='CONSUMED'&&action==='REVERSED'))throw new ConflictException('权益已经处理，不能重复消费或恢复');
    // Confirmed reservations survive period expiry; cancellation/refund belongs to the reserving workflow.
    return tx.benefitUsage.update({where:{id},data:{state:action,updatedAt:new Date(),version:{increment:1}}});
  }
  private async attach(versionIds:string[],store:Database|Prisma.TransactionClient=this.db){
    const benefits=await store.planBenefit.findMany({where:{planVersionId:{in:versionIds}},orderBy:{createdAt:'asc'}}),definitions=await store.benefitDefinition.findMany({where:{id:{in:benefits.map(b=>b.definitionId)}}});
    const scopes=await store.benefitScope.findMany({where:{planBenefitId:{in:benefits.map(b=>b.id)}}});
    return benefits.map(b=>({...b,definition:definitions.find(d=>d.id===b.definitionId)!,scopes:scopes.filter(scope=>scope.planBenefitId===b.id)}));
  }
  async versions(planId:string,q:PageQuery){
    if(!await this.db.membershipPlan.findUnique({where:{id:planId}}))throw new NotFoundException('会员套餐不存在');
    return this.db.$transaction(async tx=>{const plan=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}}),rows=await tx.membershipPlanVersion.findMany({where:{planId},orderBy:{releaseNo:'desc'},take:q.size,skip:(q.page-1)*q.size}),current=plan.currentVersionId?await tx.membershipPlanVersion.findUnique({where:{id:plan.currentVersionId}}):null,benefits=await this.attach([...rows.map(v=>v.id),...(current?[current.id]:[])],tx);return{items:rows.map(v=>({...v,benefits:benefits.filter(b=>b.planVersionId===v.id)})),current:current?{...current,benefits:benefits.filter(b=>b.planVersionId===current.id)}:null,total:await tx.membershipPlanVersion.count({where:{planId}})};},{isolationLevel:'RepeatableRead'});
  }
  async changeContent(planId:string,req:AuthRequest,dto:ContentBenefitsDto){
    requireRoles(req,['ADMIN']);
    return this.db.$transaction(async tx=>{
      const initial=await tx.membershipPlan.findUnique({where:{id:planId}});if(!initial)throw new NotFoundException('会员套餐不存在');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership.plan:${initial.tier}:${initial.days}`},0))`;
      const plan=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});if(plan.version!==dto.expectedVersion)throw new ConflictException('套餐版本已变化，请刷新');
      if(dto.contentTier>plan.tier)throw new BadRequestException('内容访问层级不能超过套餐层级');
      const original=await tx.membershipPlanVersion.findUniqueOrThrow({where:{id:plan.currentVersionId!}}),benefits=await tx.planBenefit.findMany({where:{planVersionId:original.id}}),definition=await tx.benefitDefinition.findUniqueOrThrow({where:{code:'CONTENT_ACCESS'}});
      const micPriority=dto.micPriority??(original.termsSnapshot as {micPriority?:boolean}).micPriority??false;
      if(micPriority&&(plan.tier!==3||process.env.RTC_NATIVE_PUBLISH_READY!=='true'))throw new BadRequestException('连麦优先仅供名师会员；须完成原生实时互动验收后才能对外售卖');
      const range=['不包含会员文章与课程','铜牌及以下会员文章与课程','银牌及以下会员文章与课程','金牌及以下会员文章与课程','钻石及以下会员文章与课程'][dto.contentTier];
      const description=`有效期${plan.days}天。此版本内容权益：${range}，以实际会员内容目录为准；独立付费内容、咨询、直播、实物和活动不包含在基础内容权益中。`+(micPriority?'\n互动权益：连麦申请优先排列，仍须主播批准，不保证每场获得连麦。':'')+original.description.split('\n').filter(line=>line.startsWith('商城权益：')||line.startsWith('活动权益：')||line.startsWith('社区权益：')||line.startsWith('实物权益：')||line.startsWith('研学权益：')||line.startsWith('课程权益：')||line.startsWith('问答权益：')||line.startsWith('活动票价权益：')).map(line=>'\n'+line).join('');
      const latest=await tx.membershipPlanVersion.aggregate({where:{planId},_max:{releaseNo:true}});
      const next=await tx.membershipPlanVersion.create({data:{planId,releaseNo:(latest._max.releaseNo??0)+1,tier:plan.tier,days:plan.days,description,termsSnapshot:{...original.termsSnapshot as object,title:plan.title,price:plan.price,currency:'CNY',durationDays:plan.days,contentTier:dto.contentTier,micPriority},publishedAt:new Date()}});
      await tx.planBenefit.createMany({data:[...benefits.filter(b=>b.definitionId!==definition.id).map(b=>({planVersionId:next.id,definitionId:b.definitionId,parameters:b.parameters as Prisma.InputJsonValue,quota:b.quota,periodKind:b.periodKind})),{planVersionId:next.id,definitionId:definition.id,parameters:{contentTier:dto.contentTier},quota:null,periodKind:'MEMBERSHIP'}]});
      await tx.$executeRaw`INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode") SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=${next.id} AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=${original.id}`;
      const updated=await tx.membershipPlan.update({where:{id:planId},data:{description,currentVersionId:next.id,version:{increment:1},updatedAt:new Date()}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.benefits.version',resource:'membershipPlan',resourceId:planId,reason:dto.reason,changes:{oldVersion:original.id,newVersion:next.id,contentTier:dto.contentTier}}});return updated;
    });
  }
  async changeCommerce(planId:string,req:AuthRequest,dto:CommerceBenefitsDto){
    requireRoles(req,['ADMIN']);
    return this.db.$transaction(async tx=>{
      const initial=await tx.membershipPlan.findUnique({where:{id:planId}});if(!initial)throw new NotFoundException('会员套餐不存在');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership.plan:${initial.tier}:${initial.days}`},0))`;
      const plan=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});if(plan.version!==dto.expectedVersion)throw new ConflictException('套餐版本已变化，请刷新');
      const original=await tx.membershipPlanVersion.findUniqueOrThrow({where:{id:plan.currentVersionId!}}),definitions=await tx.benefitDefinition.findMany({where:{code:{in:['PRODUCT_DISCOUNT','SHIPPING_WAIVER']}}});
      if(definitions.length!==2)throw new ConflictException('请先应用会员商城权益迁移');
      const old=await tx.planBenefit.findMany({where:{planVersionId:original.id}}),excluded=definitions.map(d=>d.id),latest=await tx.membershipPlanVersion.aggregate({where:{planId},_max:{releaseNo:true}});
      const contentDescription=original.description.split('\n').filter(line=>!line.startsWith('商城权益：')).join('\n'),description=contentDescription+'\n商城权益：'+(dto.productBasisPoints<10000?'参与会员折扣的实物商品按原价'+dto.productBasisPoints/100+'%计费。':'不包含商品折扣。')+(dto.shippingWaiver?'折后商品金额满¥'+(dto.minimumSubtotal/100).toFixed(2)+'减免基础配送费，特殊地区附加运费仍收取。':'不包含运费减免。');
      const next=await tx.membershipPlanVersion.create({data:{planId,releaseNo:(latest._max.releaseNo??0)+1,tier:plan.tier,days:plan.days,description,termsSnapshot:{...original.termsSnapshot as object,title:plan.title,price:plan.price},publishedAt:new Date()}});
      await tx.planBenefit.createMany({data:[...old.filter(b=>!excluded.includes(b.definitionId)).map(b=>({planVersionId:next.id,definitionId:b.definitionId,parameters:b.parameters as Prisma.InputJsonValue,quota:b.quota,periodKind:b.periodKind})),...(dto.productBasisPoints<10000?[{planVersionId:next.id,definitionId:definitions.find(d=>d.code==='PRODUCT_DISCOUNT')!.id,parameters:{basisPoints:dto.productBasisPoints},quota:null,periodKind:'MEMBERSHIP'}]:[]),...(dto.shippingWaiver?[{planVersionId:next.id,definitionId:definitions.find(d=>d.code==='SHIPPING_WAIVER')!.id,parameters:{minimumSubtotal:dto.minimumSubtotal},quota:null,periodKind:'MEMBERSHIP'}]:[])]});
      await tx.$executeRaw`INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode") SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=${next.id} AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=${original.id} AND ob."definitionId" NOT IN (${definitions[0]!.id},${definitions[1]!.id})`;
      const updated=await tx.membershipPlan.update({where:{id:planId},data:{description,currentVersionId:next.id,version:{increment:1},updatedAt:new Date()}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.commerce.version',resource:'membershipPlan',resourceId:planId,reason:dto.reason.trim(),changes:{oldVersion:original.id,newVersion:next.id,productBasisPoints:dto.productBasisPoints,shippingWaiver:dto.shippingWaiver,minimumSubtotal:dto.minimumSubtotal}}});return updated;
    });
  }
  async summary(userId:string,q:PageQuery){
    return this.db.$transaction(async tx=>{
      const now=new Date(),suspended=await membershipRefundHolds(userId,tx),members=await tx.membership.findMany({where:{userId,revokedAt:null,endsAt:{gt:now}},include:{plan:true},orderBy:{startsAt:'asc'},take:50}),versions=await tx.membershipPlanVersion.findMany({where:{id:{in:members.flatMap(m=>m.planVersionId?[m.planVersionId]:[])}}}),benefits=await this.attach(versions.map(v=>v.id),tx);
      const items=await tx.benefitUsage.findMany({where:{userId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size,skip:(q.page-1)*q.size}),grants=await tx.benefitGrant.findMany({where:{userId,revokedAt:null,startsAt:{lte:now},endsAt:{gt:now}}}),definitions=await tx.benefitDefinition.findMany({where:{id:{in:[...items.map(u=>u.definitionId),...benefits.map(b=>b.definitionId),...grants.map(g=>g.definitionId)]}}}),quotas=[];
      for(const definition of definitions.filter(d=>d.kind==='QUOTA'))for(const source of await this.sources(tx,userId,definition.id,now)){
        const window=benefitWindow(source.startsAt,source.endsAt,source.periodKind,now),used=await this.used(tx,userId,source,window);
        quotas.push({name:definition.name,code:definition.code,periodId:source.periodId,grantId:source.grantId,quota:source.quota,used,remaining:Math.max(0,source.quota-used),periodKind:source.periodKind,...window});
      }
      return{memberships:members.map(m=>({id:m.id,source:m.source,startsAt:m.startsAt,endsAt:m.endsAt,state:suspended.includes(m.id)?'REFUND_PENDING':m.startsAt>now?'QUEUED':'ACTIVE',planVersionId:m.planVersionId,plan:membershipPlanView(m.plan,versions.find(v=>v.id===m.planVersionId)),benefits:benefits.filter(b=>b.planVersionId===m.planVersionId).map(b=>({code:b.definition.code,name:b.definition.name,parameters:b.parameters,quota:b.quota,periodKind:b.periodKind}))})),membershipTotal:await tx.membership.count({where:{userId,revokedAt:null,endsAt:{gt:now}}}),quotas,usage:{items:items.map(u=>({...u,name:definitions.find(d=>d.id===u.definitionId)?.name??'历史权益'})),total:await tx.benefitUsage.count({where:{userId}})}};
    },{isolationLevel:'RepeatableRead'});
  }
  async changeCommunity(planId:string,req:AuthRequest,dto:CommunityBenefitsDto){requireRoles(req,['ADMIN']);return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${planId} FOR UPDATE`;const plan=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});if(plan.version!==dto.expectedVersion)throw new ConflictException('会员套餐已变化');
    const definition=await tx.benefitDefinition.findUniqueOrThrow({where:{code:'FORUM_PIN'}}),original=await tx.membershipPlanVersion.findUniqueOrThrow({where:{id:plan.currentVersionId!}}),benefits=await tx.planBenefit.findMany({where:{planVersionId:original.id}}),latest=await tx.membershipPlanVersion.aggregate({where:{planId},_max:{releaseNo:true}}),description=original.description.split('\n').filter(l=>!l.startsWith('社区权益：')).join('\n')+'\n社区权益：'+(dto.monthlyPins?'每北京时间自然月可申请'+dto.monthlyPins+'次公共帖子置顶，经审核最长'+dto.pinDays+'天，且不晚于权益到期；拒绝退还用量，不保证通过。':'不包含论坛置顶申请。');
    const next=await tx.membershipPlanVersion.create({data:{planId,releaseNo:(latest._max.releaseNo??0)+1,tier:original.tier,days:original.days,description,termsSnapshot:{...original.termsSnapshot as object,title:plan.title,price:plan.price},publishedAt:new Date()}});
    await tx.planBenefit.createMany({data:[...benefits.filter(b=>b.definitionId!==definition.id).map(b=>({planVersionId:next.id,definitionId:b.definitionId,parameters:b.parameters as Prisma.InputJsonValue,quota:b.quota,periodKind:b.periodKind})),...(dto.monthlyPins?[{planVersionId:next.id,definitionId:definition.id,parameters:{pinDays:dto.pinDays},quota:dto.monthlyPins,periodKind:'MONTH'}]:[])]});
    await tx.$executeRaw`INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode") SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=${next.id} AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=${original.id} AND ob."definitionId"<>${definition.id}`;
    const result=await tx.membershipPlan.update({where:{id:planId},data:{description,currentVersionId:next.id,version:{increment:1},updatedAt:new Date()}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.community.version',resource:'membershipPlan',resourceId:planId,reason:dto.reason,changes:{oldVersion:original.id,newVersion:next.id,monthlyPins:dto.monthlyPins,pinDays:dto.pinDays}}});return result;
  });}
  async changeEventPricing(planId:string,req:AuthRequest,dto:EventPricingDto){requireRoles(req,['ADMIN']);return this.db.$transaction(async tx=>{
    const initial=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership.plan:${initial.tier}:${initial.days}`},0))`;
    await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${planId} FOR UPDATE`;
    const plan=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});if(plan.version!==dto.expectedVersion)throw new ConflictException('套餐已变化，请刷新');
    if(dto.basisPoints===10000&&dto.eventIds.length)throw new BadRequestException('关闭活动优惠时请清空适用范围');
    if(dto.eventIds.length&&await tx.event.count({where:{id:{in:dto.eventIds},status:'PUBLISHED'}})!==dto.eventIds.length)throw new BadRequestException('请选择已发布活动');
    const definition=await tx.benefitDefinition.findUniqueOrThrow({where:{code:'EVENT_DISCOUNT'}}),original=await tx.membershipPlanVersion.findUniqueOrThrow({where:{id:plan.currentVersionId!}}),old=await tx.planBenefit.findMany({where:{planVersionId:original.id}}),latest=await tx.membershipPlanVersion.aggregate({where:{planId},_max:{releaseNo:true}});
    const description=original.description.split('\n').filter(l=>!l.startsWith('活动票价权益：')).join('\n')+'\n活动票价权益：'+(dto.basisPoints<10000?(dto.basisPoints===0?'参与票种可免费报名，无需付款。':'参与票种按原价'+dto.basisPoints/100+'%计费。')+'共享实际库存及每人上限，确认报名后不因会员到期取消；取消按报名规则办理。'+(dto.eventIds.length?'仅适用于指定活动。':'适用于书院启用会员优惠的票种。'):'不含活动票价减免。');
    const next=await tx.membershipPlanVersion.create({data:{planId,releaseNo:(latest._max.releaseNo??0)+1,tier:original.tier,days:original.days,description,termsSnapshot:{...original.termsSnapshot as object,title:plan.title,price:plan.price},publishedAt:new Date()}});
    await tx.planBenefit.createMany({data:[...old.filter(b=>b.definitionId!==definition.id).map(b=>({planVersionId:next.id,definitionId:b.definitionId,parameters:b.parameters as Prisma.InputJsonValue,quota:b.quota,periodKind:b.periodKind})),...(dto.basisPoints<10000?[{planVersionId:next.id,definitionId:definition.id,parameters:{basisPoints:dto.basisPoints},quota:null,periodKind:'MEMBERSHIP'}]:[])]});
    await tx.$executeRaw`INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode") SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=${next.id} AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=${original.id} AND ob."definitionId"<>${definition.id}`;
    if(dto.basisPoints<10000&&dto.eventIds.length){const b=await tx.planBenefit.findFirstOrThrow({where:{planVersionId:next.id,definitionId:definition.id}});await tx.benefitScope.createMany({data:dto.eventIds.map(resourceId=>({planBenefitId:b.id,resourceId}))});}
    const result=await tx.membershipPlan.update({where:{id:planId},data:{description,currentVersionId:next.id,version:{increment:1},updatedAt:new Date()}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.event-pricing.version',resource:'membershipPlan',resourceId:planId,reason:dto.reason.trim(),changes:{oldVersion:original.id,newVersion:next.id,basisPoints:dto.basisPoints,eventIds:dto.eventIds}}});return result;
  });}
  async changeQuestions(planId:string,req:AuthRequest,dto:QuestionBenefitsDto){requireRoles(req,['ADMIN']);return this.db.$transaction(async tx=>{
    const initial=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership.plan:${initial.tier}:${initial.days}`},0))`;
    await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${planId} FOR UPDATE`;
    const plan=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});if(plan.version!==dto.expectedVersion)throw new ConflictException('套餐已变化，请刷新');
    if(!dto.monthlyQuestions&&(dto.priority||dto.teacherIds.length))throw new BadRequestException('关闭问答额度时请同时关闭优先并清空名师范围');
    if(dto.teacherIds.length&&await tx.teacher.count({where:{id:{in:dto.teacherIds},status:'PUBLISHED',userId:{not:null}}})!==dto.teacherIds.length)throw new BadRequestException('请选择已发布且关联答复账号的名师');
    if(dto.teacherIds.length){const teachers=await tx.teacher.findMany({where:{id:{in:dto.teacherIds}}}),staff=await tx.user.count({where:{id:{in:teachers.flatMap(t=>t.userId?[t.userId]:[])},status:'ACTIVE',roles:{has:'TEACHER'}}});if(staff!==new Set(teachers.map(t=>t.userId)).size)throw new BadRequestException('名师答复账号尚未就绪，请先完成账号关联');}
    const definition=await tx.benefitDefinition.findUniqueOrThrow({where:{code:'TEACHER_QUESTION'}}),original=await tx.membershipPlanVersion.findUniqueOrThrow({where:{id:plan.currentVersionId!}}),old=await tx.planBenefit.findMany({where:{planVersionId:original.id}}),latest=await tx.membershipPlanVersion.aggregate({where:{planId},_max:{releaseNo:true}});
    const description=original.description.split('\n').filter(l=>!l.startsWith('问答权益：')).join('\n')+'\n问答权益：'+(dto.monthlyQuestions?'每北京时间自然月'+dto.monthlyQuestions+'次专属提问，提交预占，私人答复或公开答复通过审核后计次；答复前取消或老师拒绝退回预占。'+(dto.priority?'待答问题优先排列，不承诺即时答复。':'按提交顺序处理。')+(dto.teacherIds.length?'仅适用于指定名师。':'适用于已开放问答的名师。'):'不含会员专属问答额度。');
    const next=await tx.membershipPlanVersion.create({data:{planId,releaseNo:(latest._max.releaseNo??0)+1,tier:original.tier,days:original.days,description,termsSnapshot:{...original.termsSnapshot as object,title:plan.title,price:plan.price},publishedAt:new Date()}});
    await tx.planBenefit.createMany({data:[...old.filter(b=>b.definitionId!==definition.id).map(b=>({planVersionId:next.id,definitionId:b.definitionId,parameters:b.parameters as Prisma.InputJsonValue,quota:b.quota,periodKind:b.periodKind})),...(dto.monthlyQuestions?[{planVersionId:next.id,definitionId:definition.id,parameters:{priority:dto.priority},quota:dto.monthlyQuestions,periodKind:'MONTH'}]:[])]});
    await tx.$executeRaw`INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode") SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=${next.id} AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=${original.id} AND ob."definitionId"<>${definition.id}`;
    if(dto.monthlyQuestions&&dto.teacherIds.length){const b=await tx.planBenefit.findFirstOrThrow({where:{planVersionId:next.id,definitionId:definition.id}});await tx.benefitScope.createMany({data:dto.teacherIds.map(resourceId=>({planBenefitId:b.id,resourceId}))});}
    const result=await tx.membershipPlan.update({where:{id:planId},data:{description,currentVersionId:next.id,version:{increment:1},updatedAt:new Date()}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.questions.version',resource:'membershipPlan',resourceId:planId,reason:dto.reason.trim(),changes:{oldVersion:original.id,newVersion:next.id,monthlyQuestions:dto.monthlyQuestions,priority:dto.priority,teacherIds:dto.teacherIds}}});return result;
  });}
  async changeConsultations(planId:string,req:AuthRequest,dto:ConsultationBenefitsDto){requireRoles(req,['ADMIN']);return this.db.$transaction(async tx=>{
    const initial=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership.plan:${initial.tier}:${initial.days}`},0))`;
    await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${planId} FOR UPDATE`;
    const plan=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});if(plan.version!==dto.expectedVersion)throw new ConflictException('套餐已变化，请刷新');
    if(dto.monthlyConsultations===0&&(dto.amountMinor||dto.serviceIds.length)||dto.monthlyConsultations>0&&(dto.amountMinor<=0||!dto.serviceIds.length))throw new BadRequestException('请同时设置月额度、单次抵扣上限和适用服务；关闭时全部清空');
    if(dto.serviceIds.length&&await tx.serviceOffering.count({where:{id:{in:dto.serviceIds},active:true}})!==dto.serviceIds.length)throw new BadRequestException('请选择已开放的实际咨询服务');
    const definition=await tx.benefitDefinition.findUniqueOrThrow({where:{code:'CONSULTATION_CREDIT'}}),original=await tx.membershipPlanVersion.findUniqueOrThrow({where:{id:plan.currentVersionId!}}),old=await tx.planBenefit.findMany({where:{planVersionId:original.id}}),latest=await tx.membershipPlanVersion.aggregate({where:{planId},_max:{releaseNo:true}});
    const description=original.description.split('\n').filter(l=>!l.startsWith('咨询权益：')).join('\n')+'\n咨询权益：'+(dto.monthlyConsultations?'每北京时间自然月'+dto.monthlyConsultations+'次，每次抵扣最多'+(dto.amountMinor/100).toFixed(2)+'元，仅限指定服务；预约预占，实际履约计次，取消或未交付返还原份额，部分退款不额外增加使用次数；不折现，不影响已确认预约。':'不含会员咨询抵扣。');
    const next=await tx.membershipPlanVersion.create({data:{planId,releaseNo:(latest._max.releaseNo??0)+1,tier:original.tier,days:original.days,description,termsSnapshot:{...original.termsSnapshot as object,title:plan.title,price:plan.price},publishedAt:new Date()}});
    await tx.planBenefit.createMany({data:[...old.filter(b=>b.definitionId!==definition.id).map(b=>({planVersionId:next.id,definitionId:b.definitionId,parameters:b.parameters as Prisma.InputJsonValue,quota:b.quota,periodKind:b.periodKind})),...(dto.monthlyConsultations?[{planVersionId:next.id,definitionId:definition.id,parameters:{amountMinor:String(dto.amountMinor),serviceIds:dto.serviceIds},quota:dto.monthlyConsultations,periodKind:'MONTH'}]:[])]});
    await tx.$executeRaw`INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode") SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=${next.id} AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=${original.id} AND ob."definitionId"<>${definition.id}`;
    const result=await tx.membershipPlan.update({where:{id:planId},data:{description,currentVersionId:next.id,version:{increment:1},updatedAt:new Date()}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.consultations.version',resource:'membershipPlan',resourceId:planId,reason:dto.reason.trim(),changes:{oldVersion:original.id,newVersion:next.id,monthlyConsultations:dto.monthlyConsultations,amountMinor:dto.amountMinor,serviceIds:dto.serviceIds}}});return result;
  });}
  async changeCourses(planId:string,req:AuthRequest,dto:CourseBenefitsDto){requireRoles(req,['ADMIN']);return this.db.$transaction(async tx=>{
    const initial=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership.plan:${initial.tier}:${initial.days}`},0))`;
    const plan=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});if(plan.version!==dto.expectedVersion)throw new ConflictException('套餐已更新，请刷新');
    if(dto.courseIds.length&&dto.courseBasisPoints===10000&&!dto.earlyAccess)throw new BadRequestException('未启用课程权益时请清空适用范围');
    if(dto.courseIds.length&&await tx.course.count({where:{id:{in:dto.courseIds},status:'PUBLISHED',format:{in:['VIDEO','AUDIO']}}})!==dto.courseIds.length)throw new BadRequestException('请选择已发布的录播课程');
    const definitions=await tx.benefitDefinition.findMany({where:{code:{in:['COURSE_DISCOUNT','COURSE_EARLY_ACCESS']}}});if(definitions.length!==2)throw new ConflictException('请先应用课程会员权益迁移');
    const original=await tx.membershipPlanVersion.findUniqueOrThrow({where:{id:plan.currentVersionId!}}),old=await tx.planBenefit.findMany({where:{planVersionId:original.id}}),excluded=definitions.map(d=>d.id),latest=await tx.membershipPlanVersion.aggregate({where:{planId},_max:{releaseNo:true}});
    const description=original.description.split('\n').filter(l=>!l.startsWith('课程权益：')).join('\n')+'\n课程权益：'+(dto.courseBasisPoints<10000?'参与录播课程按原价'+dto.courseBasisPoints/100+'%计费，与优惠券及公益价择优、不叠加；拼团按团价。':'不含购课折扣。')+(dto.earlyAccess?'可在公布的提前窗口研习适用课程，仍须具备本课程内容权限。':'不含新课提前研习。')+(dto.courseIds.length?'仅适用于指定课程。':'以课程实际启用范围为准。');
    const next=await tx.membershipPlanVersion.create({data:{planId,releaseNo:(latest._max.releaseNo??0)+1,tier:original.tier,days:original.days,description,termsSnapshot:{...original.termsSnapshot as object,title:plan.title,price:plan.price},publishedAt:new Date()}});
    await tx.planBenefit.createMany({data:[...old.filter(b=>!excluded.includes(b.definitionId)).map(b=>({planVersionId:next.id,definitionId:b.definitionId,parameters:b.parameters as Prisma.InputJsonValue,quota:b.quota,periodKind:b.periodKind})),...(dto.courseBasisPoints<10000?[{planVersionId:next.id,definitionId:definitions.find(d=>d.code==='COURSE_DISCOUNT')!.id,parameters:{basisPoints:dto.courseBasisPoints},quota:null,periodKind:'MEMBERSHIP'}]:[]),...(dto.earlyAccess?[{planVersionId:next.id,definitionId:definitions.find(d=>d.code==='COURSE_EARLY_ACCESS')!.id,parameters:{enabled:true},quota:null,periodKind:'MEMBERSHIP'}]:[])]});
    await tx.$executeRaw`INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode") SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=${next.id} AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=${original.id} AND ob."definitionId" NOT IN (${excluded[0]!},${excluded[1]!})`;
    const fresh=await tx.planBenefit.findMany({where:{planVersionId:next.id,definitionId:{in:excluded}}});
    if(dto.courseIds.length)await tx.benefitScope.createMany({data:fresh.flatMap(b=>dto.courseIds.map(resourceId=>({planBenefitId:b.id,resourceId})))});
    const result=await tx.membershipPlan.update({where:{id:planId},data:{description,currentVersionId:next.id,version:{increment:1},updatedAt:new Date()}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.courses.version',resource:'membershipPlan',resourceId:planId,reason:dto.reason.trim(),changes:{oldVersion:original.id,newVersion:next.id,courseBasisPoints:dto.courseBasisPoints,earlyAccess:dto.earlyAccess,courseIds:dto.courseIds}}});return result;
  });}
  async changeEvents(planId:string,req:AuthRequest,dto:EventBenefitsDto){requireRoles(req,['ADMIN']);return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${planId} FOR UPDATE`;
    const plan=await tx.membershipPlan.findUniqueOrThrow({where:{id:planId}});if(plan.version!==dto.expectedVersion)throw new ConflictException('套餐已更新，请刷新');
    if(!dto.eventPriority&&dto.eventIds.length)throw new BadRequestException('关闭优先权益时不能保留活动范围');
    if(dto.eventIds.length&&await tx.event.count({where:{id:{in:dto.eventIds},status:'PUBLISHED'}})!==dto.eventIds.length)throw new BadRequestException('请选择已发布的有效活动');
    const definition=await tx.benefitDefinition.findUniqueOrThrow({where:{code:'EVENT_PRIORITY'}}),original=await tx.membershipPlanVersion.findUniqueOrThrow({where:{id:plan.currentVersionId!}}),old=await tx.planBenefit.findMany({where:{planVersionId:original.id}}),latest=await tx.membershipPlanVersion.aggregate({where:{planId},_max:{releaseNo:true}});
    const description=original.description.split('\n').filter(line=>!line.startsWith('活动权益：')).join('\n')+'\n活动权益：'+(dto.eventPriority?(dto.eventIds.length?'指定活动':'书院活动')+'在已公布的会员优先窗口可提前报名，名额与公众共用；不包含票价减免或免费咨询。':'不包含活动优先报名。');
    const next=await tx.membershipPlanVersion.create({data:{planId,releaseNo:(latest._max.releaseNo??0)+1,tier:plan.tier,days:plan.days,description,termsSnapshot:{...original.termsSnapshot as object,title:plan.title,price:plan.price},publishedAt:new Date()}});
    await tx.planBenefit.createMany({data:[...old.filter(b=>b.definitionId!==definition.id).map(b=>({planVersionId:next.id,definitionId:b.definitionId,parameters:b.parameters as Prisma.InputJsonValue,quota:b.quota,periodKind:b.periodKind})),...(dto.eventPriority?[{planVersionId:next.id,definitionId:definition.id,parameters:{enabled:true},quota:null,periodKind:'MEMBERSHIP'}]:[])]});
    await tx.$executeRaw`INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode") SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=${next.id} AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=${original.id} AND ob."definitionId"<>${definition.id}`;
    if(dto.eventPriority&&dto.eventIds.length){const benefit=await tx.planBenefit.findFirstOrThrow({where:{planVersionId:next.id,definitionId:definition.id}});await tx.benefitScope.createMany({data:dto.eventIds.map(resourceId=>({planBenefitId:benefit.id,resourceId}))});}
    const result=await tx.membershipPlan.update({where:{id:planId},data:{description,currentVersionId:next.id,version:{increment:1},updatedAt:new Date()}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.events.version',resource:'membershipPlan',resourceId:planId,reason:dto.reason.trim(),changes:{oldVersion:original.id,newVersion:next.id,eventPriority:dto.eventPriority,eventIds:dto.eventIds}}});return result;
  });}
}
@Controller('learning/benefits') @UseGuards(UserGuard) export class MembershipBenefitsController {
  constructor(private readonly benefits:MembershipBenefitsService){}
  @Get() summary(@Req() req:AuthRequest,@Query() q:PageQuery){return this.benefits.summary(req.actor.id,q);}
}
@Controller('admin/membership-benefits') @UseGuards(AdminGuard) export class MembershipBenefitsAdminController {
  constructor(private readonly benefits:MembershipBenefitsService){}
  @Get('plans/:id') versions(@Param('id',ParseUUIDPipe) id:string,@Query() q:PageQuery){return this.benefits.versions(id,q);}
  @Post('plans/:id/content') change(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ContentBenefitsDto){return this.benefits.changeContent(id,req,dto);}
  @Post('plans/:id/commerce') commerce(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:CommerceBenefitsDto){return this.benefits.changeCommerce(id,req,dto);}
  @Post('plans/:id/community') community(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:CommunityBenefitsDto){return this.benefits.changeCommunity(id,req,dto);}
  @Post('plans/:id/event-pricing') eventPricing(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:EventPricingDto){return this.benefits.changeEventPricing(id,req,dto);}
  @Post('plans/:id/consultations') consultations(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ConsultationBenefitsDto){return this.benefits.changeConsultations(id,req,dto);}
  @Post('plans/:id/questions') questions(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:QuestionBenefitsDto){return this.benefits.changeQuestions(id,req,dto);}
  @Post('plans/:id/courses') courses(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:CourseBenefitsDto){return this.benefits.changeCourses(id,req,dto);}
  @Post('plans/:id/events') events(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:EventBenefitsDto){return this.benefits.changeEvents(id,req,dto);}
  @Get('users/:id') summary(@Param('id',ParseUUIDPipe) id:string,@Query() q:PageQuery){return this.benefits.summary(id,q);}
}
