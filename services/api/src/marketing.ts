import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Injectable,NotFoundException,Param,ParseUUIDPipe,Post,Query,Req,UseGuards} from '@nestjs/common';
import {Type} from 'class-transformer';
import {ArrayMaxSize,ArrayUnique,IsArray,IsBoolean,IsIn,IsInt,IsISO8601,IsOptional,IsString,IsUUID,Length,Matches,Max,Min} from 'class-validator';
import {createHash,randomUUID} from 'node:crypto';
import {AdminGuard,OptionalUserGuard,UserGuard,type AuthRequest,requireRoles} from './auth.js';
import {Database} from './database.js';
import {Prisma} from './generated/prisma/client.js';
export const marketingHash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x)).digest('hex');
export const marketingSafe=(v:unknown)=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x));
type Store=Database|Prisma.TransactionClient;
export class MarketingPage {@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;}
class CouponDto {
  @IsOptional() @IsIn(['PUBLIC','POINTS']) claimPolicy?:string;
  @IsString() @Length(2,80) @Matches(/\S/) title!:string;
  @IsIn(['FIXED','PERCENT']) discountKind!:string;
  @IsInt() @Min(1) @Max(100000000) discountValue!:number;
  @IsInt() @Min(0) @Max(100000000) threshold!:number;
  @IsOptional() @IsInt() @Min(1) @Max(100000000) maxDiscount?:number;
  @IsISO8601() startsAt!:string; @IsISO8601() endsAt!:string;
  @IsInt() @Min(1) @Max(1000000) totalLimit!:number;
  @IsInt() @Min(1) @Max(20) perUserLimit!:number;
  @IsOptional() @IsInt() @Min(1) @Max(366) validDays?:number;
  @IsArray() @ArrayMaxSize(2) @ArrayUnique() @IsIn(['WECHAT_APP','ALIPAY_APP'],{each:true}) allowedChannels!:string[];
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID(undefined,{each:true}) courseIds!:string[];
  @IsBoolean() active!:boolean;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class ClaimDto {@IsUUID() requestKey!:string;}
class CouponStateDto {@IsInt() @Min(1) expectedVersion!:number;@IsBoolean() active!:boolean;@IsString() @Length(2,500) reason!:string;}
type Terms={title:string;discountKind:string;discountValue:string;threshold:string;maxDiscount:string|null;allowedChannels:string[];courseIds:string[]};
export function couponDiscount(amount:bigint,terms:Terms){
  if(amount<BigInt(terms.threshold))return 0n;
  let discount=terms.discountKind==='FIXED'?BigInt(terms.discountValue):amount*(10000n-BigInt(terms.discountValue))/10000n;
  if(terms.maxDiscount!==null&&discount>BigInt(terms.maxDiscount))discount=BigInt(terms.maxDiscount);
  // A channel payment must remain positive; zero-price enrolment has its own workflow.
  return discount>amount-1n?amount-1n:discount;
}
@Injectable() export class MarketingService {
  constructor(private readonly db:Database){}
  async courseOptions(){return this.db.course.findMany({where:{status:'PUBLISHED',isDemo:false,teacher:{isDemo:false,status:'PUBLISHED'}},select:{id:true,title:true},orderBy:{title:'asc'},take:1000});}
  async createCoupon(actorId:string,dto:CouponDto){
    if(Date.parse(dto.endsAt)<=Math.max(Date.now(),Date.parse(dto.startsAt))||!dto.allowedChannels.length||dto.discountKind==='PERCENT'&&dto.discountValue>=10000)throw new BadRequestException('请检查有效期、支付渠道及折扣（实付万分比，须小于10000）');
    if(dto.courseIds.length&&await this.db.course.count({where:{id:{in:dto.courseIds},isDemo:false}})!==dto.courseIds.length)throw new BadRequestException('优惠券范围包含无效或示例课程');
    return this.db.$transaction(async tx=>{const row=await tx.couponTemplate.create({data:{code:'C'+randomUUID().replaceAll('-',''),claimPolicy:dto.claimPolicy??'PUBLIC',title:dto.title.trim(),discountKind:dto.discountKind,discountValue:BigInt(dto.discountValue),threshold:BigInt(dto.threshold),maxDiscount:dto.maxDiscount===undefined?null:BigInt(dto.maxDiscount),startsAt:new Date(dto.startsAt),endsAt:new Date(dto.endsAt),validDays:dto.validDays,totalLimit:dto.totalLimit,perUserLimit:dto.perUserLimit,allowedChannels:dto.allowedChannels,scope:{kind:'COURSE',courseIds:dto.courseIds},stackingPolicy:'BEST_ONLY',active:dto.active}});await tx.auditLog.create({data:{actorId,action:'marketing.coupon.create',resource:'coupon_template',resourceId:row.id,reason:dto.reason,changes:marketingSafe(dto)}});return marketingSafe(row);});
  }
  async couponState(id:string,actorId:string,dto:CouponStateDto){return this.db.$transaction(async tx=>{const changed=await tx.couponTemplate.updateMany({where:{id,version:dto.expectedVersion},data:{active:dto.active,version:{increment:1},updatedAt:new Date()}});if(!changed.count)throw new ConflictException('优惠券已变化，请刷新');await tx.auditLog.create({data:{actorId,action:'marketing.coupon.state',resource:'coupon_template',resourceId:id,reason:dto.reason,changes:{active:dto.active}}});return{success:true};});}
  async coupons(userId:string|undefined,q:MarketingPage,admin=false){
    const now=new Date(),where=admin?{}:{active:true,claimPolicy:'PUBLIC',startsAt:{lte:now},endsAt:{gt:now}};
    const [rows,total]=await this.db.$transaction([this.db.couponTemplate.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size,skip:(q.page-1)*q.size}),this.db.couponTemplate.count({where})]);
    const owned=userId?await this.db.userCoupon.groupBy({by:['templateId'],where:{userId,templateId:{in:rows.map(r=>r.id)}},_count:true}):[];
    return marketingSafe({items:rows.map(r=>({...r,remaining:Math.max(0,r.totalLimit-r.issuedCount),claimed:owned.find(c=>c.templateId===r.id)?._count??0})),total});
  }
  async claim(id:string,userId:string,key:string,store?:Prisma.TransactionClient,source='PUBLIC'){
    const run=async(tx:Prisma.TransactionClient)=>{
      if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`).length)throw new ForbiddenException('账号不可用，不能领取优惠券');
      const claimKey='coupon:'+userId+':'+key,old=await tx.userCoupon.findUnique({where:{claimKey}});if(old){if(old.templateId!==id)throw new ConflictException('领取编号已用于其他优惠券');if((await tx.couponTemplate.findUniqueOrThrow({where:{id}})).claimPolicy!==source)throw new ConflictException('此优惠券须从积分商城兑换');return marketingSafe(old);}
      await tx.$queryRaw`SELECT id FROM "CouponTemplate" WHERE id=${id} FOR UPDATE`;
      const row=await tx.couponTemplate.findUnique({where:{id}}),now=new Date();if(row&&row.claimPolicy!==source)throw new ConflictException('此优惠券须从对应的领券或积分兑换入口领取');if(!row?.active||row.startsAt>now||row.endsAt<=now)throw new ConflictException('优惠券尚未开始、已结束或已停领');
      if(row.issuedCount>=row.totalLimit||await tx.userCoupon.count({where:{userId,templateId:id}})>=row.perUserLimit)throw new ConflictException('优惠券已领完或已达到领取上限');
      const scope=row.scope as {kind?:string;courseIds?:string[]};if(scope.kind!=='COURSE'||row.stackingPolicy!=='BEST_ONLY')throw new ConflictException('此优惠券尚未配置有效课程范围');
      const terms:Terms={title:row.title,discountKind:row.discountKind,discountValue:String(row.discountValue),threshold:String(row.threshold),maxDiscount:row.maxDiscount===null?null:String(row.maxDiscount),allowedChannels:row.allowedChannels,courseIds:scope.courseIds??[]};
      await tx.couponTemplate.update({where:{id},data:{issuedCount:{increment:1},version:{increment:1},updatedAt:now}});
      const coupon=await tx.userCoupon.create({data:{userId,templateId:id,claimKey,state:'AVAILABLE',expiresAt:new Date(Math.min(row.endsAt.getTime(),row.validDays?Date.now()+row.validDays*86400000:row.endsAt.getTime())),termsSnapshot:terms}});
      await tx.auditLog.create({data:{actorId:userId,action:'marketing.coupon.claim',resource:'user_coupon',resourceId:coupon.id,changes:{templateId:id}}});return marketingSafe(coupon);
    };return store?run(store):this.db.$transaction(run);
  }
  async wallet(userId:string,q:MarketingPage){const where={userId};const[rows,total]=await this.db.$transaction([this.db.userCoupon.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size,skip:(q.page-1)*q.size}),this.db.userCoupon.count({where})]);return marketingSafe({items:rows.map(r=>({...r,state:r.state==='AVAILABLE'&&r.expiresAt<=new Date()?'EXPIRED':r.state})),total});}
  async coursePrice(tx:Store,userId:string|undefined,courseId:string,amount:bigint,platform:string,channel:string){
    if(!userId||platform!=='ANDROID')return {payable:amount,discount:0n,coupon:null};
    const rows=await tx.userCoupon.findMany({where:{userId,state:'AVAILABLE',expiresAt:{gt:new Date()}},orderBy:[{expiresAt:'asc'},{id:'asc'}]});
    let discount=0n,chosen:typeof rows[number]|null=null;
    for(const row of rows){const terms=row.termsSnapshot as Terms;if(!terms.allowedChannels?.includes(channel)||terms.courseIds?.length&&!terms.courseIds.includes(courseId))continue;const current=couponDiscount(amount,terms);if(current>discount){discount=current;chosen=row;}}
    return{payable:amount-discount,discount,coupon:chosen?{id:chosen.id,version:chosen.version,expiresAt:chosen.expiresAt.toISOString(),terms:chosen.termsSnapshot as Terms}:null};
  }
  async freeze(tx:Prisma.TransactionClient,userId:string,orderId:string,coupon:{id:string;version:number}|null){if(!coupon)return;if((await tx.userCoupon.updateMany({where:{id:coupon.id,userId,version:coupon.version,state:'AVAILABLE',expiresAt:{gt:new Date()}},data:{state:'LOCKED',lockedOrderId:orderId,version:{increment:1},updatedAt:new Date()}})).count!==1)throw new ConflictException('优惠券状态已变化，请刷新报价');}
  async finishCoupon(tx:Prisma.TransactionClient,orderId:string,action:'USED'|'RELEASED'|'REFUNDED'){
    const row=await tx.userCoupon.findFirst({where:action==='REFUNDED'?{usedOrderId:orderId,state:'USED'}:{lockedOrderId:orderId,state:'LOCKED'}});if(!row)return;
    const state=action==='USED'?'USED':row.expiresAt>new Date()?'AVAILABLE':'EXPIRED';
    await tx.userCoupon.update({where:{id:row.id},data:{state,lockedOrderId:null,usedOrderId:action==='USED'?orderId:null,version:{increment:1},updatedAt:new Date()}});
  }
}
@Controller('marketing') @UseGuards(OptionalUserGuard) export class MarketingCatalogController {
  constructor(private readonly service:MarketingService){}
  @Get('coupons') list(@Req() req:AuthRequest,@Query() q:MarketingPage){return this.service.coupons(req.actor?.id,q);}
}
@Controller('me/marketing') @UseGuards(UserGuard) export class MarketingController {
  constructor(private readonly service:MarketingService){}
  @Post('coupons/:id/claim') claim(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ClaimDto){return this.service.claim(id,req.actor.id,dto.requestKey);}
  @Get('coupons') wallet(@Req() req:AuthRequest,@Query() q:MarketingPage){return this.service.wallet(req.actor.id,q);}
}
@Controller('admin/marketing') @UseGuards(AdminGuard) export class MarketingAdminController {
  constructor(private readonly service:MarketingService){}
  @Get('course-options') async courses(){return {items:await this.service.courseOptions()};}
  @Get('coupons') list(@Query() q:MarketingPage){return this.service.coupons(undefined,q,true);}
  @Post('coupons') create(@Req() req:AuthRequest,@Body() dto:CouponDto){requireRoles(req,['OPERATOR']);return this.service.createCoupon(req.actor.id,dto);}
  @Post('coupons/:id/state') state(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:CouponStateDto){requireRoles(req,['OPERATOR']);return this.service.couponState(id,req.actor.id,dto);}
}
