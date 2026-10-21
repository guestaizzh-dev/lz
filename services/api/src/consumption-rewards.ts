import {ConflictException,Controller,Get,Injectable,Logger,NotFoundException,OnModuleDestroy,OnModuleInit,Query,Req,UseGuards} from '@nestjs/common';
import {Type} from 'class-transformer';import {IsIn,IsInt,IsOptional,IsString,Length,Max,Min} from 'class-validator';
import {AdminGuard,type AuthRequest} from './auth.js';
import {createHash} from 'node:crypto';
import {Database} from './database.js';import type {Prisma,TradeOrder} from './generated/prisma/client.js';
import {changePoints,pointsDay} from './points-accounting.js';import {consumptionPolicy,consumptionRuleText,dailyGrowthAllocated,validConsumptionPolicy} from './consumption-policy.js';
type Tx=Prisma.TransactionClient;
const safe=(v:unknown)=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(safe(v),(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x)).digest('hex');
const min=(a:bigint,b:bigint)=>a<b?a:b;
const ruleOf=(order:TradeOrder)=>(order.pricingSnapshot as {consumptionRule?:Prisma.JsonValue}).consumptionRule;
const delay=consumptionPolicy.observationDays*86400000;
const statusText=(reward:{peakAmount:bigint;currentAmount:bigint},state:string)=>reward.peakAmount===0n&&(state==='CLOSED'||state==='COMPLETED'&&reward.currentAmount===0n)?'此单未产生消费奖励':null;

async function source(tx:Tx,order:TradeOrder,at:Date){
 const payments=await tx.paymentTransaction.findMany({where:{orderId:order.id,disposition:'ACCEPTED'}}),items=await tx.tradeOrderItem.findMany({where:{orderId:order.id},orderBy:{lineNo:'asc'}}),title=String((items[0]?.itemSnapshot as {title?:string}|undefined)?.title??'书院订单');
 if(payments.length>1)throw new ConflictException('原订单正常收款不唯一，请先核查财务事实');const payment=payments[0];
 if(!payment)return{amount:0n,readyAt:null,pending:false,delivered:false,title,itemId:items[0]?.id,proof:{kind:order.kind,reason:'NO_VERIFIED_PAYMENT'}};
 if(order.currency!=='CNY'||payment.currency!=='CNY'||!payment.verifiedAt||order.paidTotal!==payment.amount)throw new ConflictException('原订单与可信收款不一致，请先核查财务事实');
 const refunds=await tx.refund.findMany({where:{orderId:order.id,paymentTransactionId:payment.id,state:{notIn:['REJECTED','CANCELLED','REVERSED']}}}),apple=await tx.appleTransactionState.findFirst({where:{paymentId:payment.id}});
 const pending=refunds.some(r=>r.state!=='SUCCEEDED')||apple?.state==='REVIEW';let amount=0n,delivered=false,deliveredAt:Date|null=null,readyAt:Date|null=null;
 if(order.kind==='PHYSICAL'){
  const shipments=await tx.shipment.findMany({where:{orderId:order.id,kind:{in:['OUTBOUND','EXCHANGE']}}}),successful=refunds.filter(r=>r.state==='SUCCEEDED'&&r.kind!=='EXCHANGE'&&r.reasonCode==='PRODUCT_RETURN'),lines=await tx.refundItem.findMany({where:{refundId:{in:successful.map(r=>r.id)}}});
  for(const item of items){const quantity=lines.filter(r=>r.orderItemId===item.id).reduce((n,r)=>n+r.quantity,0);if(quantity>item.quantity)throw new ConflictException('商品已退款数量超过原购买数量');const base=item.payable-item.shippingAllocated;amount+=base-base*BigInt(quantity)/BigInt(item.quantity);}
  delivered=!!order.completedAt&&shipments.length>0&&shipments.every(s=>s.state==='DELIVERED'&&!!s.deliveredAt);if(delivered)deliveredAt=new Date(Math.max(+order.completedAt!,...shipments.map(s=>+s.deliveredAt!)));
 }else{
  const revenue=order.kind==='COURSE'?'COURSE_REVENUE':order.kind==='MEMBERSHIP'?'MEMBERSHIP_REVENUE':order.kind==='COHORT'?'COHORT_REVENUE':order.kind==='DIGITAL'?'PRODUCT_REVENUE':'BOOKING_REVENUE';
  const rows=await tx.$queryRaw<{amount:bigint;deliveredAt:Date|null}[]>`SELECT coalesce(sum(e.credit-e.debit),0)::bigint AS amount,max(j."postedAt") FILTER(WHERE e.credit>0) AS "deliveredAt" FROM "FinanceEntry" e JOIN "FinanceJournal" j ON j.id=e."journalId" WHERE j."orderId"=${order.id} AND j."transactionId"=${payment.id} AND e."accountCode"=${revenue} AND j.currency='CNY'`;
  amount=rows[0]?.amount??0n;if(amount<0n)throw new ConflictException('原消费净收入为负，请先核查原收退款');deliveredAt=rows[0]?.deliveredAt??null;delivered=!!deliveredAt&&items.length>0;
  if(order.kind==='DIGITAL'){
   const delivery=await tx.digitalDelivery.findFirst({where:{orderItemId:{in:items.map(i=>i.id)}}});if(!delivery?.firstAccessAt||delivery.revokedAt&&order.refundedTotal<order.paidTotal)delivered=false;else if(deliveredAt)deliveredAt=new Date(Math.max(+deliveredAt,+delivery.firstAccessAt));
  }
  if(order.kind==='MEMBERSHIP'){
   const member=await tx.membership.findFirst({where:{orderItemId:{in:items.map(i=>i.id)},source:'PURCHASE'},orderBy:{createdAt:'asc'}});if(!member)delivered=false;else if(deliveredAt)deliveredAt=new Date(Math.max(+deliveredAt,+member.startsAt));
  }
  if(['CONSULTATION','EVENT','COHORT'].includes(order.kind))delivered=delivered&&!!await tx.serviceDelivery.findFirst({where:{orderId:order.id,state:'APPROVED'}});
 }
 const net=order.paidTotal-order.refundedTotal;if(net<0n||amount>net)throw new ConflictException('消费奖励基数超过实际保留金额，请核查原账务');
 if(deliveredAt&&delivered)readyAt=new Date(+deliveredAt+delay);
 return{amount,readyAt,pending:!!pending,delivered,title,itemId:items[0]?.id,proof:{kind:order.kind,paymentId:payment.id,paidAmount:String(payment.amount),refundedAmount:String(order.refundedTotal),amount:String(amount),delivered,readyAt:readyAt?.toISOString()??null,refunds:refunds.map(r=>({id:r.id,state:r.state,amount:String(r.approvedAmount??r.requestedAmount)})).sort((a,b)=>a.id.localeCompare(b.id)),appleState:apple?.state??null,matured:!!readyAt&&readyAt<=at}};
}

async function reconcileOrder(tx:Tx,order:TradeOrder,at:Date){
 if(!validConsumptionPolicy(ruleOf(order)))return{nextAt:null};const s=await source(tx,order,at),matured=!!s.readyAt&&s.readyAt<=at;
 let row=await tx.consumptionReward.findUnique({where:{orderId:order.id}});if(!row)row=await tx.consumptionReward.create({data:{userId:order.userId,orderId:order.id,ruleSnapshot:ruleOf(order)!}});
 const sourceHash=hash(s.proof);if(sourceHash===row.sourceHash)return{nextAt:s.pending?new Date(+at+3600000):!matured?s.readyAt:null};
 let peak=row.peakAmount;
 if(matured&&!s.pending&&s.delivered&&s.amount>peak){
  const day=pointsDay(s.readyAt!),used=await tx.consumptionAward.aggregate({where:{userId:order.userId,businessDay:day},_sum:{points:true}}),growthUsed=await dailyGrowthAllocated(tx,order.userId,day);
  const desired=s.amount/BigInt(consumptionPolicy.pointsUnit)-peak/BigInt(consumptionPolicy.pointsUnit),remaining=BigInt(consumptionPolicy.pointsDailyLimit)-(used._sum.points??0n),points=min(desired,remaining>0n?remaining:0n),growth=Math.max(0,Math.min(Number(s.amount/BigInt(consumptionPolicy.growthUnit)-peak/BigInt(consumptionPolicy.growthUnit)),consumptionPolicy.growthDailyLimit-growthUsed));
  await tx.consumptionAward.create({data:{userId:order.userId,rewardId:row.id,eventKey:'consumption.allocate:'+row.id+':'+s.amount,amount:s.amount-peak,points,growth,businessDay:day,ruleSnapshot:{...consumptionPolicy,previousPeak:String(peak),newPeak:String(s.amount),source:s.proof}}});peak=s.amount;
 }
 const allocated=await tx.consumptionAward.aggregate({where:{rewardId:row.id},_sum:{points:true,growth:true}}),pointBase=peak/BigInt(consumptionPolicy.pointsUnit),growthBase=peak/BigInt(consumptionPolicy.growthUnit),current=min(s.amount,peak),points=pointBase?(allocated._sum.points??0n)*(current/BigInt(consumptionPolicy.pointsUnit))/pointBase:0n,growth=growthBase?Number(BigInt(allocated._sum.growth??0)*(current/BigInt(consumptionPolicy.growthUnit))/growthBase):0;
 const version=row.version+1,pointDelta=points-row.points,growthDelta=growth-row.growth,eventKey='consumption.adjust:'+row.id+':'+version,ruleSnapshot={orderId:order.id,orderKind:order.kind,rewardId:row.id,version:consumptionPolicy.version,previousAmount:String(row.currentAmount),currentAmount:String(s.amount),peakAmount:String(peak),source:s.proof};
 if(pointDelta)await changePoints(tx,order.userId,pointDelta,eventKey,pointDelta>0n?'消费结算奖励：'+s.title:'退款或履约更正，冲回消费积分：'+s.title,{orderItemId:s.itemId,ruleSnapshot,businessDay:pointsDay(at)});
 if(growthDelta)await tx.growthLedger.create({data:{userId:order.userId,eventKey,delta:growthDelta,businessDay:pointsDay(at),reason:growthDelta>0?'消费结算成长：'+s.title:'退款或履约更正，冲回消费成长：'+s.title,ruleSnapshot}});
 const held=s.pending||(peak>0n&&!s.delivered),state=held?'HELD':peak>0n&&s.amount===0n?'REVERSED':!s.delivered?'WAIT_DELIVERY':!matured&&s.amount>peak?'OBSERVATION':'SETTLED';
 await tx.consumptionReward.update({where:{id:row.id},data:{peakAmount:peak,currentAmount:s.amount,points,growth,state,eligibleAt:s.readyAt,pendingRefund:held,sourceHash,sourceSnapshot:s.proof,version,updatedAt:at}});
 await tx.auditLog.create({data:{actorId:order.userId,action:'consumption.reconcile',resource:'consumption_reward',resourceId:row.id,changes:{automatic:true,orderId:order.id,pointDelta:String(pointDelta),growthDelta,points:String(points),state,sourceHash}}});
 return{nextAt:held?new Date(+at+3600000):!matured?s.readyAt:null};
}

// Hold the account last; callers already own the user's lock and any redemption target locks.
export async function reconcileConsumption(tx:Tx,userId:string,at=new Date(),focusOrderId?:string){
 await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR NO KEY UPDATE`;
 const dirty=focusOrderId?[{id:focusOrderId}]:await tx.$queryRaw<{id:string}[]>`SELECT o.id FROM "TradeOrder" o JOIN "OutboxJob" j ON j."eventKey"='consumption.sync:'||o.id WHERE o."userId"=${userId} AND j.kind='CONSUMPTION_SYNC' AND j.state IN ('READY','RUNNING','DEAD') AND (j.payload @> '{"dirty":true}'::jsonb OR j."availableAt"<=${at} OR j.state='DEAD') ORDER BY o."createdAt",o.id LIMIT 100`;
 for(const id of dirty.map(o=>o.id).sort())await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${id} FOR UPDATE`;
 await tx.pointsAccount.upsert({where:{userId},create:{userId},update:{}});await tx.$queryRaw`SELECT id FROM "PointsAccount" WHERE "userId"=${userId} FOR UPDATE`;
 const account=await tx.pointsAccount.findUniqueOrThrow({where:{userId}}),reservations=await tx.pointsReservation.findMany({where:{accountId:account.id,state:'HELD',requestKey:{startsWith:'consumption.hold:'}}}),oldReserved=reservations.reduce((n,r)=>n+r.points,0n);
 if(oldReserved)await tx.pointsAccount.update({where:{id:account.id},data:{reserved:{decrement:oldReserved},version:{increment:1},updatedAt:at}});
 for(const candidate of dirty){
  const before=await tx.tradeOrder.findFirst({where:{id:candidate.id,userId}});if(!before)throw new ConflictException('消费奖励来源不属于本人');
  const order=before,job=await tx.outboxJob.findUnique({where:{eventKey:'consumption.sync:'+order.id}}),result=await reconcileOrder(tx,order,at);
  if(job)await tx.outboxJob.updateMany({where:{id:job.id,version:job.version},data:{state:result.nextAt?'READY':'DONE',payload:{dirty:false},availableAt:result.nextAt??at,completedAt:result.nextAt?null:at,lockedUntil:null,lastErrorCode:null,attempts:0}});
 }
 const pending=await tx.consumptionReward.findMany({where:{userId,pendingRefund:true,points:{gt:0}},orderBy:[{createdAt:'asc'},{id:'asc'}]}),latest=await tx.pointsAccount.findUniqueOrThrow({where:{userId}});let available=latest.balance-latest.reserved,newReserved=0n;const retained=new Set<string>();
 for(const row of pending){const amount=min(row.points,available),key='consumption.hold:'+row.orderId;available-=amount;newReserved+=amount;retained.add(key);const existing=await tx.pointsReservation.findUnique({where:{requestKey:key}});if(amount>0n&&(!existing||existing.state!=='HELD'||existing.points!==amount))await tx.pointsReservation.upsert({where:{requestKey:key},create:{accountId:account.id,requestKey:key,points:amount,state:'HELD',expiresAt:new Date('9999-01-01T00:00:00Z')},update:{points:amount,state:'HELD',version:{increment:1},updatedAt:at}});else if(!amount&&existing?.state==='HELD')await tx.pointsReservation.update({where:{id:existing.id},data:{state:'RELEASED',version:{increment:1},updatedAt:at}});}
 for(const previous of reservations)if(!retained.has(previous.requestKey))await tx.pointsReservation.update({where:{id:previous.id},data:{state:'RELEASED',version:{increment:1},updatedAt:at}});
 if(newReserved)await tx.pointsAccount.update({where:{id:account.id},data:{reserved:{increment:newReserved},version:{increment:1},updatedAt:at}});
 if(oldReserved!==newReserved)await tx.auditLog.create({data:{actorId:userId,action:'consumption.freeze',resource:'points_account',resourceId:account.id,changes:{automatic:true,previous:String(oldReserved),current:String(newReserved)}}});
 const remaining=await tx.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM "OutboxJob" j JOIN "TradeOrder" o ON o.id=j."aggregateId" WHERE o."userId"=${userId} AND j.kind='CONSUMPTION_SYNC' AND j.state IN ('READY','RUNNING','DEAD') AND (j.payload @> '{"dirty":true}'::jsonb OR j."availableAt"<=${at} OR j.state='DEAD')`;
 return{processing:remaining[0]!.count>0n};
}

@Injectable() export class ConsumptionRewards implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;private working=false;private readonly logger=new Logger(ConsumptionRewards.name);
 constructor(private readonly db:Database){}
 onModuleInit(){if(process.env.NODE_ENV!=='test'&&process.env.CONSUMPTION_WORKER_ENABLED!=='false'){this.timer=setInterval(()=>void this.runJobs().catch(()=>this.logger.error('Consumption reward worker failed; durable jobs remain queued')),20000);this.timer.unref();}}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async refresh(userId:string){return this.db.$transaction(tx=>reconcileConsumption(tx,userId),{timeout:30000});}
 async order(userId:string,id:string){
  const order=await this.db.tradeOrder.findFirst({where:{id,userId}});if(!order)throw new NotFoundException('订单不存在');
  await this.db.$transaction(tx=>reconcileConsumption(tx,userId,new Date(),id),{timeout:30000});const reward=await this.db.consumptionReward.findUnique({where:{orderId:id}});
  return safe({enabled:validConsumptionPolicy(ruleOf(order)),rule:ruleOf(order)??null,text:validConsumptionPolicy(ruleOf(order))?consumptionRuleText:'此订单未承诺消费奖励，原条款不变。',reward:reward?{...reward,statusText:statusText(reward,order.state)}:null});
 }
 async list(query:ConsumptionPage,userId?:string){
  const where:Prisma.ConsumptionRewardWhereInput={...(userId?{userId}:{}),...(query.state?{state:query.state}:{}),...(query.q?{orderId:{in:(await this.db.tradeOrder.findMany({where:{orderNo:{contains:query.q}},select:{id:true},take:100})).map(o=>o.id)}}:{})};
  const[items,total]=await this.db.$transaction([this.db.consumptionReward.findMany({where,skip:(query.page-1)*query.size,take:query.size,orderBy:[{createdAt:'desc'},{id:'desc'}]}),this.db.consumptionReward.count({where})]);
  const orders=await this.db.tradeOrder.findMany({where:{id:{in:items.map(r=>r.orderId)}},select:{id:true,kind:true,orderNo:true,state:true}}),users=userId?[]:await this.db.user.findMany({where:{id:{in:items.map(r=>r.userId)}},select:{id:true,nickname:true}});
  return safe({items:items.map(({sourceHash,sourceSnapshot,...r})=>({...r,statusText:statusText(r,orders.find(o=>o.id===r.orderId)!.state),order:orders.find(o=>o.id===r.orderId),userName:users.find(u=>u.id===r.userId)?.nickname})),total,rule:consumptionRuleText});
 }
 async runJobs(){if(this.working)return;this.working=true;try{for(let i=0;i<10;i++){
  const jobs=await this.db.$queryRaw<{id:string;aggregateId:string;version:number}[]>`UPDATE "OutboxJob" SET state='RUNNING',"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1,version=version+1,"updatedAt"=now() WHERE id=(SELECT id FROM "OutboxJob" WHERE kind='CONSUMPTION_SYNC' AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt",id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,"aggregateId",version`;if(!jobs.length)break;const job=jobs[0]!;
  try{const order=await this.db.tradeOrder.findUniqueOrThrow({where:{id:job.aggregateId}});await this.db.$transaction(async tx=>{const current=await tx.outboxJob.findUniqueOrThrow({where:{id:job.id}});if(current.version!==job.version||current.state!=='RUNNING')return;await reconcileConsumption(tx,order.userId,new Date(),order.id);},{timeout:30000});}
  catch{const current=await this.db.outboxJob.findUniqueOrThrow({where:{id:job.id}});await this.db.outboxJob.updateMany({where:{id:job.id,version:job.version,state:'RUNNING'},data:{state:current.attempts>=8?'DEAD':'READY',lockedUntil:null,lastErrorCode:'CONSUMPTION_SOURCE_UNAVAILABLE',availableAt:new Date(Date.now()+Math.min(3600000,30000*2**Math.min(current.attempts,7)))}});}
 }}finally{this.working=false;}}
}

export class ConsumptionPage {
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
 @IsOptional() @IsIn(['WAIT_DELIVERY','OBSERVATION','HELD','SETTLED','REVERSED']) state?:string;
 @IsOptional() @IsString() @Length(1,80) q?:string;
}
@Controller('catalog/consumption-rule') export class ConsumptionRuleController {
 @Get() rule(){return{rule:consumptionPolicy,text:consumptionRuleText};}
}
@Controller('admin/points/consumption') @UseGuards(AdminGuard) export class ConsumptionAdminController {
 constructor(private readonly rewards:ConsumptionRewards){}
 @Get() list(@Query() query:ConsumptionPage,@Req() _req:AuthRequest){return this.rewards.list(query);}
}
