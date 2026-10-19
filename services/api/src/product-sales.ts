import {consumptionPolicy} from './consumption-policy.js';
import {ProductPromotions} from './product-promotions.js';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { decryptPrivate, encryptPrivate, personalAddress } from './private-data.js';
import { demoContentVisible } from './public-content.js';
import { PaymentChannels, type AppPaymentChannel } from './payment-channels.js';
import type { WechatRefund, WechatTransaction } from './wechat-pay.js';
import {memberPriceSources,productMemberPrice,sourceApplies} from './member-pricing.js';
import {benefitWindow,membershipRefundHolds} from './membership-benefits.js';
import { Prisma, type TradeOrder } from './generated/prisma/client.js';

class LineDto { @IsUUID() skuId!:string; @IsInt() @Min(1) @Max(99) quantity!:number; }
class QuoteDto {
  @IsOptional() @IsIn(['STANDARD','PRIORITY']) shippingMode='STANDARD';
  @IsUUID() addressId!:string;
  @IsIn(['ANDROID','IOS','WEB']) platform='WEB';
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({each:true}) @Type(()=>LineDto) items!:LineDto[];
}
class CheckoutDto extends QuoteDto {
  @IsUUID() requestKey!:string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash!:string;
  @IsIn(['WECHAT_APP','ALIPAY_APP']) channel:AppPaymentChannel='WECHAT_APP';
}
class OrderPage {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
  @IsOptional() @IsIn(['PENDING','PAID','FULFILLING','COMPLETED','CLOSED']) state?:string;
  @IsOptional() @IsString() @Length(0,80) q?:string;
}
class VersionDto { @IsInt() @Min(1) expectedVersion!:number; }
class ShipmentLine { @IsUUID() orderItemId!:string; @IsInt() @Min(1) @Max(99) quantity!:number; }
class ShipmentDto extends VersionDto {
  @IsUUID() requestKey!:string;
  @IsIn(['shunfeng','zhongtong','yuantong','shentong','yunda','ems','jd']) carrierCode!:string;
  @IsString() @Matches(/^[A-Za-z0-9-]{6,40}$/) trackingNo!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({each:true}) @Type(()=>ShipmentLine) items!:ShipmentLine[];
}
class RefundDto {
  @IsUUID() requestKey!:string;
  @IsIn(['REFUND_ONLY','RETURN_REFUND','EXCHANGE']) kind!:string;
  @IsString() @Length(2,1000) @Matches(/\S/) reason!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({each:true}) @Type(()=>ShipmentLine) items!:ShipmentLine[];
}
class ReviewDto extends VersionDto {
  @IsIn(['APPROVE','REJECT','RETRY','RECEIVED']) action!:string;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
  @IsOptional() @IsString() @Length(2,500) returnInstructions?:string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({each:true}) @Type(()=>ShipmentLine) restockItems?:ShipmentLine[];
}
class ReturnDto {
  @IsIn(['shunfeng','zhongtong','yuantong','shentong','yunda','ems','jd']) carrierCode!:string;
  @IsString() @Matches(/^[A-Za-z0-9-]{6,40}$/) trackingNo!:string;
  @IsInt() @Min(1) expectedVersion!:number;
}
const now=()=>new Date();
const hash=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const safe=(data:unknown)=>JSON.parse(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v));
export const productSalesEnabled=()=>process.env.PRODUCT_SALES_ENABLED==='true';
export const carriers={shunfeng:'顺丰速运',zhongtong:'中通快递',yuantong:'圆通速递',shentong:'申通快递',yunda:'韵达快递',ems:'邮政EMS',jd:'京东物流'};
export const productReturnPolicy='发货前可按商品数量申请原路退款，包含对应运费；签收后7日内可申请退货，商品须完整并符合售前规则。发货后的默认退货不退原配送费用；质量问题请联系书院核查。审核通过后按书院给出的地址寄回，仓库确认收货后交财务原路退款。退款以渠道确认为准。';

@Injectable()
export class ProductSalesService implements OnModuleInit,OnModuleDestroy {
  constructor(private readonly db:Database,private readonly channels:PaymentChannels,private readonly promotions:ProductPromotions){}
  private timer?:ReturnType<typeof setInterval>;
  private working=false;
  private readonly logger=new Logger(ProductSalesService.name);
  async onModuleInit(){
    if(productSalesEnabled()){
      if(!this.channels.choices().some(c=>c.enabled))throw new Error('Product sales require a configured verified App payment channel');
      if(await this.db.financeAccount.count({where:{code:{in:['PRODUCT_REVENUE','PRODUCT_REFUND_PAYABLE']}}})!==2)throw new Error('Apply product sales migrations before enabling sales');
      if(process.env.NODE_ENV==='production'&&process.env.COURSE_PAYMENT_WORKER_ENABLED==='false')throw new Error('Product sales require payment recovery');
    }
    if(process.env.NODE_ENV!=='test'&&process.env.COURSE_PAYMENT_WORKER_ENABLED!=='false')this.timer=setInterval(()=>void this.runJobs().catch(()=>this.logger.error('Product recovery failed; jobs remain queued')),20000).unref();
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private lines<T extends {quantity:number}>(items:T[],key:(item:T)=>string){
    const rows=[...items].sort((a,b)=>key(a).localeCompare(key(b)));
    if(new Set(rows.map(key)).size!==rows.length)throw new BadRequestException('同一规格或订单项请合并数量');
    return rows;
  }
  private async lockUser(tx:Prisma.TransactionClient,userId:string,active=false){
    const rows=await tx.$queryRaw<{status:string}[]>`SELECT status FROM "User" WHERE id=${userId} FOR UPDATE`;
    if(!rows.length||active&&rows[0]!.status!=='ACTIVE')throw new ForbiddenException('账号不可用，请重新登录');
  }
  private async lock(tx:Prisma.TransactionClient,order:TradeOrder){await this.lockUser(tx,order.userId);await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${order.id} FOR UPDATE`;}
  private async lockSkus(tx:Prisma.TransactionClient,skuIds:string[]){
    const products=await tx.productSku.findMany({where:{id:{in:skuIds}},select:{productId:true}});
    for(const id of [...new Set(products.map(p=>p.productId))].sort())await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${id} FOR UPDATE`;
    for(const id of [...new Set(skuIds)].sort())await tx.$queryRaw`SELECT id FROM "ProductSku" WHERE id=${id} FOR UPDATE`;
  }
  private async quotation(store:Database|Prisma.TransactionClient,userId:string,dto:QuoteDto){
    const rows=this.lines(dto.items,i=>i.skuId),addressRow=await store.address.findFirst({where:{id:dto.addressId,userId}});
    if(!addressRow)throw new NotFoundException('请选择自己的收货地址');
    const address=personalAddress(addressRow),zone=await store.deliveryZone.findUnique({where:{province:address.province}});
    if(!zone?.enabled)throw new BadRequestException('此地区暂不配送，请选择其他收货地址');
    const priorityAvailable=zone.priorityFee!==null&&zone.priorityUntil!==null&&zone.priorityUntil>now()&&!!zone.priorityDescription&&!!zone.priorityProofAssetId&&!!await store.mediaAsset.findFirst({where:{id:zone.priorityProofAssetId,status:'READY',visibility:'PRIVATE',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}});
    if(dto.shippingMode==='PRIORITY'&&!priorityAvailable)throw new ConflictException('该地区优先配送当前不可用，请选择普通配送并重新确认');
    const priorityFee=dto.shippingMode==='PRIORITY'?zone.priorityFee!:0;
    const showDemo=await demoContentVisible(store),skus=await store.productSku.findMany({where:{id:{in:rows.map(r=>r.skuId)}},include:{product:true}}),sources=await memberPriceSources(userId,store);
    const baseItems=rows.map(line=>{
      const sku=skus.find(s=>s.id===line.skuId);
      if(!sku||!sku.active||sku.product.status!=='PUBLISHED'||sku.product.type!=='PHYSICAL'||sku.product.isDemo&&!showDemo)throw new ConflictException('商品或规格已失效，请返回重新选择');
      if(sku.price<=0)throw new ConflictException('库存不足或价格尚未配置，请调整数量');
      const subtotal=sku.price*line.quantity,pricing=productMemberPrice(subtotal,sku.product,sources);
      return{skuId:sku.id,skuVersion:sku.version,productId:sku.productId,title:sku.product.title,skuTitle:sku.title,cover:sku.product.cover,unitPrice:sku.price,quantity:line.quantity,subtotal,discount:pricing.discount,goodsPayable:pricing.payable,memberBenefit:pricing.source,basisPoints:pricing.basisPoints,isDemo:sku.product.isDemo,refundPolicy:productReturnPolicy,afterSalesPolicy:sku.product.afterSalesPolicy};
    });
    const items=await this.promotions.price(store,userId,baseItems);for(const line of items){const sku=skus.find(s=>s.id===line.skuId)!;if(!line.promotion&&sku.stock-sku.reserved<line.quantity)throw new ConflictException('普通库存不足或活动已达限购，请调整数量');}
    const subtotal=items.reduce((sum,i)=>sum+i.subtotal,0),discount=items.reduce((sum,i)=>sum+i.discount,0),goodsTotal=subtotal-discount,baseShipping=zone.freeAbove!==null&&goodsTotal>=zone.freeAbove?0:zone.fee;
    const waiver=sources.find(s=>s.code==='SHIPPING_WAIVER'&&Number.isInteger((s.parameters as {minimumSubtotal?:number}).minimumSubtotal)&&(s.parameters as {minimumSubtotal:number}).minimumSubtotal>=0&&goodsTotal>=(s.parameters as {minimumSubtotal:number}).minimumSubtotal&&skus.every(sku=>sourceApplies(s,sku.productId,sku.product.category)));
    const shippingBenefit=baseShipping>0&&waiver?{periodId:waiver.periodId,planVersionId:waiver.planVersionId,benefitId:waiver.benefitId,endsAt:waiver.endsAt.toISOString()}:null;
    const shippingDiscount=shippingBenefit?baseShipping:0,shipping=baseShipping-shippingDiscount+zone.surcharge+priorityFee,total=goodsTotal+shipping;
    if(!Number.isSafeInteger(total)||total<=0||total>100000000)throw new BadRequestException('订单金额超出范围，请减少购买数量');
    const destination={recipient:address.recipient,phone:address.phone,province:address.province,city:address.city,district:address.district,detail:address.detail};
    const quoteHash=hash({consumptionRule:consumptionPolicy,userId,addressId:address.id,platform:dto.platform,items,destination,zoneVersion:zone.version,...(dto.shippingMode==='PRIORITY'?{shippingMode:dto.shippingMode,priorityFee,priorityUntil:zone.priorityUntil?.toISOString()}:{}),shipping,total,shippingBenefit,shippingDiscount});
    const demo=items.some(i=>i.isDemo),enabled=productSalesEnabled()&&!demo&&dto.platform!=='WEB';
    const channels=this.channels.choices().map(c=>({...c,enabled:c.enabled&&enabled}));
    return{shippingMode:dto.shippingMode,priorityFee,priorityAvailable,priorityDescription:priorityAvailable?zone.priorityDescription:null,priorityOptionFee:priorityAvailable?zone.priorityFee:null,priorityUntil:dto.shippingMode==='PRIORITY'?zone.priorityUntil?.toISOString()??null:null,quoteHash,items,address:destination,subtotal,shipping,total,discount,shippingDiscount,shippingSurcharge:zone.surcharge,shippingBenefit,paymentEnabled:channels.some(c=>c.enabled),channels,refundPolicy:productReturnPolicy,unavailableReason:demo?'示例商品仅供查看，不会收取费用。':dto.platform==='WEB'?'请在App内完成支付。':!enabled?'商城收款尚未开放。':'支付渠道暂不可用。'};
  }
  quote(userId:string,dto:QuoteDto){return this.db.$transaction(tx=>this.quotation(tx,userId,dto),{isolationLevel:'RepeatableRead'});}
  async checkout(userId:string,dto:CheckoutDto){
    if(!productSalesEnabled()||dto.platform==='WEB')throw new ServiceUnavailableException('商城App支付尚未开放');
    this.channels.resolve(dto.channel).identity();
    const requestHash=hash({...dto,items:this.lines(dto.items,i=>i.skuId),requestKey:undefined});
    const order=await this.db.$transaction(async tx=>{
      await this.lockUser(tx,userId,true);
      const existing=await tx.tradeOrder.findFirst({where:{userId,requestKey:dto.requestKey}});
      if(existing){if(existing.kind!=='PHYSICAL'||existing.requestHash!==requestHash)throw new ConflictException('请求编号已用于不同订单');return existing;}
      if(await tx.tradeOrder.count({where:{userId,kind:'PHYSICAL',state:'PENDING'}})>=10)throw new ConflictException('请先处理已有待支付商品订单');
      await this.lockSkus(tx,dto.items.map(i=>i.skuId));
      await tx.$queryRaw`SELECT id FROM "Address" WHERE id=${dto.addressId} FOR SHARE`;
      const address=await tx.address.findFirst({where:{id:dto.addressId,userId}});if(!address)throw new NotFoundException('收货地址不存在');
      await tx.$queryRaw`SELECT province FROM "DeliveryZone" WHERE province=${address.province} FOR SHARE`;
      const quote=await this.quotation(tx,userId,dto);
      if(quote.items.some(i=>i.isDemo))throw new BadRequestException('示例商品不能真实购买');
      if(quote.quoteHash!==dto.quoteHash)throw new ConflictException('商品、价格、库存或收货信息已变化，请重新确认');
      const benefits=[...quote.items.flatMap(i=>i.memberBenefit?[i.memberBenefit]:[]),...(quote.shippingBenefit?[quote.shippingBenefit]:[])];
      const expiresAt=new Date(Math.min(Date.now()+15*60000,...benefits.map(b=>Date.parse(b.endsAt)),...(quote.priorityUntil?[Date.parse(quote.priorityUntil)]:[]),...quote.items.flatMap(i=>i.promotion?[Date.parse(i.promotion.endsAt)]:[]))),row=await tx.tradeOrder.create({data:{orderNo:'S'+randomUUID().replaceAll('-','').slice(0,31),kind:'PHYSICAL',userId,requestKey:dto.requestKey,requestHash,currency:'CNY',subtotal:BigInt(quote.subtotal),discountTotal:BigInt(quote.discount),shippingTotal:BigInt(quote.shipping),payableTotal:BigInt(quote.total),addressSnapshotCipher:encryptPrivate(JSON.stringify(quote.address)),pricingSnapshot:{platform:dto.platform,channel:dto.channel,refundPolicy:quote.refundPolicy,memberBenefits:benefits,shippingDiscount:quote.shippingDiscount,shippingSurcharge:quote.shippingSurcharge,shippingMode:quote.shippingMode,priorityFee:quote.priorityFee,priorityDescription:quote.priorityDescription},quoteHash:quote.quoteHash,expiresAt}});
      // Exact cumulative allocation avoids losing cents across multiple SKU lines.
      let allocated=0,weighted=0;
      for(let index=0;index<quote.items.length;index++){
        const line=quote.items[index]!;weighted+=line.goodsPayable;const next=Number(BigInt(quote.shipping)*BigInt(weighted)/BigInt(quote.subtotal-quote.discount)),shipping=next-allocated;allocated=next;
        const offer=await tx.saleOffer.create({data:{kind:'PHYSICAL',skuId:line.skuId,price:BigInt(line.unitPrice),active:false,quantityLimit:99,policySnapshot:{refundPolicy:line.refundPolicy,afterSalesPolicy:line.afterSalesPolicy}}});
        const item=await tx.tradeOrderItem.create({data:{orderId:row.id,lineNo:index+1,offerId:offer.id,quantity:line.quantity,unitPrice:BigInt(line.unitPrice),subtotal:BigInt(line.subtotal),discountAllocated:BigInt(line.discount),shippingAllocated:BigInt(shipping),payable:BigInt(line.goodsPayable+shipping),itemSnapshot:line,benefitSnapshot:{memberBenefit:line.memberBenefit},state:'PENDING'}});
        const reservation=await tx.inventoryReservation.create({data:{orderItemId:item.id,skuId:line.skuId,quantity:line.quantity,promotionOfferId:line.promotion?.offerId,expiresAt,requestKey:'product.reserve:'+item.id}});
        if(line.promotion)await this.promotions.hold(tx,line.promotion.offerId,line.quantity);else await this.stock(tx,reservation.id,item.id,line.skuId,0,line.quantity,'RESERVE',userId);
      }
      for(const source of [...new Map(benefits.map(b=>[b.periodId+':'+b.benefitId,b])).values()]){
        const benefit=await tx.planBenefit.findUniqueOrThrow({where:{id:source.benefitId}}),member=await tx.membership.findUniqueOrThrow({where:{id:source.periodId}}),definition=await tx.benefitDefinition.findUniqueOrThrow({where:{id:benefit.definitionId}});
        const savings=quote.items.filter(i=>i.memberBenefit?.benefitId===source.benefitId&&i.memberBenefit.periodId===source.periodId).reduce((n,i)=>n+i.discount,0)+(quote.shippingBenefit?.benefitId===source.benefitId&&quote.shippingBenefit.periodId===source.periodId?quote.shippingDiscount:0);
        await tx.benefitUsage.create({data:{userId,periodId:source.periodId,definitionId:benefit.definitionId,...benefitWindow(member.startsAt,member.endsAt,'MEMBERSHIP',now()),quantity:1,businessKey:'product.price:'+row.id+':'+source.benefitId,state:'HELD',parametersSnapshot:{code:definition.code,orderId:row.id,savings,parameters:benefit.parameters,planVersionId:source.planVersionId}}});
      }
      await tx.outboxJob.create({data:{eventKey:'product.expire:'+row.id,kind:'PRODUCT_PAYMENT_CHECK',aggregateType:'PRODUCT_ORDER',aggregateId:row.id,payload:{},availableAt:expiresAt}});
      await tx.auditLog.create({data:{actorId:userId,action:'product.order.create',resource:'trade_order',resourceId:row.id,changes:{amount:String(row.payableTotal)}}});return row;
    },{timeout:15000});return this.detail(order.id,userId);
  }
  private async stock(tx:Prisma.TransactionClient,reservationId:string|null,orderItemId:string,skuId:string,stockDelta:number,reservedDelta:number,reason:string,actorId:string,eventKey='product.stock:'+reason+':'+orderItemId){
    if(await tx.inventoryLedger.findUnique({where:{eventKey}}))return;
    const changed=await tx.$executeRaw`UPDATE "ProductSku" SET stock=stock+${stockDelta},reserved=reserved+${reservedDelta},version=version+1 WHERE id=${skuId} AND reserved+${reservedDelta}>=0 AND stock+${stockDelta}>=reserved+${reservedDelta}`;
    if(changed!==1)throw new ConflictException('库存记录异常，已保留订单，请联系书院核查');
    const sku=await tx.productSku.findUniqueOrThrow({where:{id:skuId}});
    await tx.inventoryLedger.create({data:{reservationId,orderItemId,skuId,stockDelta:BigInt(stockDelta),reservedDelta:BigInt(reservedDelta),reason,eventKey,actorId,stockAfter:BigInt(sku.stock),reservedAfter:BigInt(sku.reserved)}});
  }
  private async release(tx:Prisma.TransactionClient,order:TradeOrder){
    await tx.benefitUsage.updateMany({where:{userId:order.userId,businessKey:{startsWith:'product.price:'+order.id+':'},state:'HELD'},data:{state:'RELEASED',updatedAt:now(),version:{increment:1}}});
    const items=await tx.tradeOrderItem.findMany({where:{orderId:order.id}}),held=await tx.inventoryReservation.findMany({where:{orderItemId:{in:items.map(i=>i.id)},state:'HELD'},orderBy:{skuId:'asc'}});
    await this.lockSkus(tx,held.map(r=>r.skuId!));
    for(const r of held){if(!await this.promotions.release(tx,r,order.userId))await this.stock(tx,r.id,r.orderItemId,r.skuId!,0,-r.quantity,'RELEASE',order.userId);await tx.inventoryReservation.update({where:{id:r.id},data:{state:'RELEASED',releasedAt:now(),version:{increment:1}}});}
  }
  private async owned(id:string,userId:string){const row=await this.db.tradeOrder.findFirst({where:{id,userId,kind:'PHYSICAL'}});if(!row)throw new NotFoundException('商品订单不存在');return row;}
  private async discountAvailable(store:Database|Prisma.TransactionClient,order:TradeOrder){
    if(!await this.promotions.ready(store,order.id))return false;
    if((order.pricingSnapshot as {shippingMode?:string}).shippingMode==='PRIORITY'){
      if(!order.addressSnapshotCipher)return false;const address=JSON.parse(decryptPrivate(order.addressSnapshotCipher)) as {province:string},zone=await store.deliveryZone.findUnique({where:{province:address.province}});if(!zone?.enabled||zone.priorityFee===null||!zone.priorityUntil||zone.priorityUntil<=now()||!zone.priorityProofAssetId||!await store.mediaAsset.findFirst({where:{id:zone.priorityProofAssetId,status:'READY',visibility:'PRIVATE',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}}))return false;
    }
    const sources=(order.pricingSnapshot as {memberBenefits?:{periodId:string;benefitId:string}[]}).memberBenefits??[];
    if(!sources.length)return true;
    const held=await store.benefitUsage.findMany({where:{userId:order.userId,businessKey:{startsWith:'product.price:'+order.id+':'},state:'HELD'}}),periods=[...new Set(sources.map(s=>s.periodId))],suspended=await membershipRefundHolds(order.userId,store);
    return sources.every(s=>held.some(u=>u.periodId===s.periodId&&u.businessKey==='product.price:'+order.id+':'+s.benefitId))&&await store.membership.count({where:{userId:order.userId,id:{in:periods,notIn:suspended},revokedAt:null,startsAt:{lte:now()},endsAt:{gt:now()}}})===periods.length;
  }
  async detail(id:string,userId:string){
    const order=await this.owned(id,userId),recovery=await this.db.outboxJob.findMany({where:{aggregateId:id,kind:'PRODUCT_PAYMENT_CHECK'},select:{state:true,attempts:true,lastErrorCode:true,availableAt:true}}),items=await this.db.tradeOrderItem.findMany({where:{orderId:id},orderBy:{lineNo:'asc'}}),shipments=await this.db.shipment.findMany({where:{orderId:id},orderBy:{createdAt:'asc'}}),refunds=await this.db.refund.findMany({where:{orderId:id},orderBy:{createdAt:'desc'}}),attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}});
    const historyItems=await this.db.refundItem.findMany({where:{refundId:{in:refunds.map(r=>r.id)}}});
    const shipmentItems=await this.db.shipmentItem.findMany({where:{shipmentId:{in:shipments.map(s=>s.id)}}}),refundItems=await this.db.refundItem.findMany({where:{refundId:{in:refunds.filter(r=>!['REJECTED','CANCELLED'].includes(r.state)).map(r=>r.id)}}});
    const discountReady=order.state!=='PENDING'||await this.discountAvailable(this.db,order);
    const channel=(order.pricingSnapshot as {channel:AppPaymentChannel}).channel,checked=!attempt||!!attempt.lastQueriedAt&&attempt.lastQueriedAt>=attempt.updatedAt&&!attempt.failureCode;
    const pointsRedemption=await this.db.pointsRedemption.findUnique({where:{orderId:id}}),memberGift=await this.db.memberGiftClaim.findUnique({where:{orderId:id}});
    return safe({memberGift:memberGift?{id:memberGift.id,state:memberGift.state}:null,pointsRedemption:pointsRedemption?{id:pointsRedemption.id,state:pointsRedemption.state,points:String(pointsRedemption.pointsCost)}:null,shippingMode:(order.pricingSnapshot as {shippingMode?:string}).shippingMode??'STANDARD',priorityFee:(order.pricingSnapshot as {priorityFee?:number}).priorityFee??0,priorityDescription:(order.pricingSnapshot as {priorityDescription?:string}).priorityDescription??null,id,recovery,orderNo:order.orderNo,state:order.state,version:order.version,subtotal:order.subtotal,discount:order.discountTotal,shipping:order.shippingTotal,amount:order.payableTotal,paidAmount:order.paidTotal,refundedAmount:order.refundedTotal,channel,createdAt:order.createdAt,expiresAt:order.expiresAt,paidAt:order.paidAt,closeReason:order.closeReason,address:order.addressSnapshotCipher?JSON.parse(decryptPrivate(order.addressSnapshotCipher)):null,refundPolicy:(order.pricingSnapshot as {refundPolicy:string}).refundPolicy,paymentNotice:discountReady?'':'原优惠或配送服务已失效，请取消后重新下单。',canPay:discountReady&&productSalesEnabled()&&order.state==='PENDING'&&order.expiresAt>now()&&checked&&this.channels.resolve(channel).availability().enabled,items:items.map(i=>({...i.itemSnapshot as object,id:i.id,payable:i.payable,shipping:i.shippingAllocated,refundedAmount:i.refundedAmount,refundOnlyQuantity:refundItems.filter(r=>r.orderItemId===i.id&&refunds.some(f=>f.id===r.refundId&&f.reasonCode==='PRODUCT_RETURN'&&f.kind==='REFUND_ONLY')).reduce((n,r)=>n+r.quantity,0),refundMoneyQuantity:refundItems.filter(r=>r.orderItemId===i.id&&refunds.some(f=>f.id===r.refundId&&f.reasonCode==='PRODUCT_RETURN'&&f.kind!=='EXCHANGE')).reduce((n,r)=>n+r.quantity,0),refundedQuantity:refundItems.filter(r=>r.orderItemId===i.id&&refunds.some(f=>f.id===r.refundId&&f.reasonCode==='PRODUCT_RETURN')&&!refunds.some(f=>f.id===r.refundId&&f.kind==='EXCHANGE'&&f.state==='SUCCEEDED')).reduce((s,r)=>s+r.quantity,0),shippedQuantity:shipmentItems.filter(si=>si.orderItemId===i.id&&shipments.some(sh=>sh.id===si.shipmentId&&sh.kind==='OUTBOUND')).reduce((sum,si)=>sum+si.quantity,0),state:i.state})),shipments:shipments.map(s=>({id:s.id,refundId:s.refundId,kind:s.kind,state:s.state,carrierCode:s.carrierCode,carrier:carriers[s.carrierCode as keyof typeof carriers]??s.carrierCode,trackingNo:s.trackingNo,shippedAt:s.shippedAt,deliveredAt:s.deliveredAt,items:shipmentItems.filter(i=>i.shipmentId===s.id).map(i=>({orderItemId:i.orderItemId,quantity:i.quantity}))})),refunds:refunds.map(r=>({id:r.id,version:r.version,kind:r.kind,state:r.state,items:historyItems.filter(i=>i.refundId===r.id).map(i=>({orderItemId:i.orderItemId,quantity:i.quantity,amount:i.amount,restockQuantity:i.returnStockQuantity})),amount:r.requestedAmount,reason:r.description,reviewNote:r.reviewNote,returnInstructions:r.returnAddressCipher?decryptPrivate(r.returnAddressCipher):null,createdAt:r.createdAt,automatic:r.reasonCode!=='PRODUCT_RETURN'}))});
  }
  async byRequest(userId:string,requestKey:string){const row=await this.db.tradeOrder.findFirst({where:{userId,requestKey,kind:'PHYSICAL'},select:{id:true}});if(!row)throw new NotFoundException('此提交尚无已确认订单');return this.detail(row.id,userId);}
  async list(userId:string,q:OrderPage){const where={kind:'PHYSICAL',userId,...(q.state?{state:q.state}:{})},[rows,total]=await this.db.$transaction([this.db.tradeOrder.findMany({where,select:{id:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size,skip:(q.page-1)*q.size}),this.db.tradeOrder.count({where})]);return{items:await Promise.all(rows.map(r=>this.detail(r.id,userId))),total};}
  async prepay(id:string,userId:string){
    if(!productSalesEnabled())throw new ServiceUnavailableException('商城收款尚未开放');
    const order=await this.owned(id,userId),channel=(order.pricingSnapshot as {channel:AppPaymentChannel}).channel,adapter=this.channels.resolve(channel);adapter.identity();
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);await this.lockUser(tx,userId,true);const row=await tx.tradeOrder.findUniqueOrThrow({where:{id}});
      if(row.state!=='PENDING'||row.expiresAt<=now())throw new ConflictException('订单已支付、关闭或超过付款期限，请刷新');
      if(!await this.discountAvailable(tx,row))throw new ConflictException('会员优惠已失效或正在办理退款，请取消后重新下单');
      const reservations=await tx.inventoryReservation.findMany({where:{orderItemId:{in:(await tx.tradeOrderItem.findMany({where:{orderId:id}})).map(i=>i.id)}}});
      const skus=await tx.productSku.findMany({where:{id:{in:reservations.map(r=>r.skuId!)}},include:{product:true}});
      if(reservations.some(r=>r.state!=='HELD')||skus.some(s=>!s.active||s.product.status!=='PUBLISHED'||s.product.isDemo))throw new ConflictException('商品已停售，请取消订单');
      const old=await tx.paymentAttempt.findFirst({where:{orderId:id}});
      if(old){if(old.state==='CREATED'||!old.lastQueriedAt||old.lastQueriedAt<old.updatedAt||old.failureCode)throw new ConflictException('支付结果待确认，请先查询订单，勿重复支付');await tx.paymentAttempt.update({where:{id:old.id},data:{state:'CREATED',failureCode:null,lastQueriedAt:null,updatedAt:now()}});}
      else await tx.paymentAttempt.create({data:{orderId:id,channel,requestKey:'product.prepay:'+id,state:'CREATED',amount:row.payableTotal,currency:'CNY',expiresAt:row.expiresAt}});
    });
    try{const orderInfo=await adapter.prepay(order.orderNo,'书院好物 '+order.orderNo,Number(order.payableTotal),order.expiresAt);await this.db.paymentAttempt.updateMany({where:{orderId:id,state:'CREATED'},data:{state:'PENDING',failureCode:'CHECK_REQUIRED',updatedAt:now()}});return{provider:channel==='WECHAT_APP'?'wxpay':'alipay',orderInfo,orderId:id};}
    catch(e){await this.db.paymentAttempt.updateMany({where:{orderId:id,state:'CREATED'},data:{state:'PENDING',failureCode:'PROVIDER_RESULT_UNKNOWN',updatedAt:now()}});throw e;}
  }
  async cancel(id:string,userId:string,reason='USER_CANCEL'){
    const order=await this.owned(id,userId);if(order.state==='CLOSED')return this.detail(id,userId);if(order.state!=='PENDING')throw new ConflictException('已付款订单请申请售后');
    const attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}});
    if(attempt){
      if(attempt.state==='CREATED'&&Date.now()-attempt.updatedAt.getTime()<30000)throw new ConflictException('支付正在发起，请稍后查询');
      const adapter=this.channels.resolve(attempt.channel),fact=await adapter.query(order.orderNo);
      if(fact.trade_state==='SUCCESS'){await this.confirmPayment(fact,undefined,attempt.channel as AppPaymentChannel);throw new ConflictException('订单已付款，已更新状态，请刷新');}
      if(!['NOTPAY','NOTFOUND','CLOSED'].includes(fact.trade_state))throw new ConflictException('渠道付款状态待确认，库存暂不释放');
      if(fact.trade_state==='NOTPAY')await adapter.close(order.orderNo);
    }
    await this.db.$transaction(async tx=>{await this.lock(tx,order);const row=await tx.tradeOrder.findUniqueOrThrow({where:{id}});if(row.state==='CLOSED')return;if(row.state!=='PENDING')throw new ConflictException('已付款，请刷新');await this.release(tx,row);await tx.tradeOrder.update({where:{id},data:{state:'CLOSED',closedAt:now(),closeReason:reason,version:{increment:1}}});await tx.tradeOrderItem.updateMany({where:{orderId:id},data:{state:'CLOSED'}});await tx.paymentAttempt.updateMany({where:{orderId:id,state:{in:['CREATED','PENDING']}},data:{state:'CLOSED'}});await tx.auditLog.create({data:{actorId:userId,action:'product.order.close',resource:'trade_order',resourceId:id,reason,changes:{state:'CLOSED'}}});});return this.detail(id,userId);
  }
  async refresh(id:string,userId:string){
    const order=await this.owned(id,userId),attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}});
    if(order.state==='PENDING'&&attempt){const fact=await this.channels.resolve(attempt.channel).query(order.orderNo);if(fact.trade_state==='SUCCESS')await this.confirmPayment(fact,undefined,attempt.channel as AppPaymentChannel);else if(['NOTPAY','NOTFOUND','CLOSED'].includes(fact.trade_state)){await this.db.paymentAttempt.updateMany({where:{id:attempt.id,updatedAt:attempt.updatedAt},data:{lastQueriedAt:now(),failureCode:null}});if(order.expiresAt<=now()||fact.trade_state==='CLOSED')await this.cancel(id,userId,'TIMEOUT');}}
    for(const refund of await this.db.refund.findMany({where:{orderId:id,state:'REFUNDING'}})){const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}});try{await this.confirmRefund(await this.channels.resolve(payment.channel).queryRefund(refund.channelRequestKey!,{transactionId:payment.externalTransactionId,orderNo:order.orderNo,total:Number(payment.amount)}),payment.channel as AppPaymentChannel);}catch{/* Durable recovery remains queued. */}}
    return this.detail(id,userId);
  }
  private async journal(tx:Prisma.TransactionClient,order:TradeOrder,paymentId:string,amount:bigint,kind:'PRODUCT_PAYMENT'|'PRODUCT_REFUND',anomaly:boolean,channel:AppPaymentChannel,refundId?:string){
    const row=await tx.financeJournal.create({data:{eventKey:kind==='PRODUCT_PAYMENT'?'product.payment:'+paymentId:'product.refunded:'+refundId,kind,orderId:order.id,transactionId:paymentId,refundId,currency:'CNY',postedAt:now(),description:kind==='PRODUCT_PAYMENT'?'好物已验证收款':'好物已验证退款'}}),incoming=kind==='PRODUCT_PAYMENT',income=anomaly?'PRODUCT_REFUND_PAYABLE':'PRODUCT_REVENUE',receivable=channel==='WECHAT_APP'?'WECHAT_RECEIVABLE':'ALIPAY_RECEIVABLE';
    await tx.financeEntry.createMany({data:[{journalId:row.id,accountCode:incoming?receivable:income,debit:amount,userId:order.userId},{journalId:row.id,accountCode:incoming?income:receivable,credit:amount,userId:order.userId}]});
  }
  async confirmPayment(data:WechatTransaction,callback?:{id:string;payloadHash:string},channel:AppPaymentChannel='WECHAT_APP'){
    const identity=this.channels.resolve(channel).identity();
    if(data.appid!==identity.appid||data.mchid!==identity.mchid||data.trade_type!=='APP'||data.trade_state!=='SUCCESS'||!data.transaction_id||data.transaction_id.length>128||!Number.isSafeInteger(data.amount?.total)||data.amount!.total<=0||data.amount!.currency!=='CNY'||!data.success_time||!Number.isFinite(Date.parse(data.success_time))||Date.parse(data.success_time)>Date.now()+300000)throw new BadRequestException('收款商户、应用、金额或时间无效');
    const initial=await this.db.tradeOrder.findUnique({where:{orderNo:data.out_trade_no}});if(initial?.kind!=='PHYSICAL')throw new NotFoundException('商品订单不存在');
    return this.db.$transaction(async tx=>{
      await this.lock(tx,initial);const order=await tx.tradeOrder.findUniqueOrThrow({where:{id:initial.id}}),items=await tx.tradeOrderItem.findMany({where:{orderId:order.id}}),reservations=await tx.inventoryReservation.findMany({where:{orderItemId:{in:items.map(i=>i.id)}}});await this.lockSkus(tx,reservations.map(r=>r.skuId!));
      const old=await tx.paymentTransaction.findFirst({where:{channel,appScope:identity.appid,externalTransactionId:data.transaction_id!}});
      if(old){if(old.orderId!==order.id||old.amount!==BigInt(data.amount!.total))throw new ConflictException('渠道交易已绑定其他收款');return{disposition:old.disposition};}
      const attempt=await tx.paymentAttempt.findFirst({where:{orderId:order.id,channel}});
      const accepted=await tx.paymentTransaction.findFirst({where:{orderId:order.id,disposition:'ACCEPTED'}}),user=await tx.user.findUniqueOrThrow({where:{id:order.userId}}),skus=await tx.productSku.findMany({where:{id:{in:reservations.map(r=>r.skuId!)}},include:{product:true}}),amount=BigInt(data.amount!.total),paidAt=new Date(data.success_time!);
      const priceUsage=await tx.benefitUsage.findMany({where:{userId:order.userId,businessKey:{startsWith:'product.price:'+order.id+':'}}}),pricePeriods=[...new Set(priceUsage.map(u=>u.periodId!))];
      const suspended=await membershipRefundHolds(order.userId,tx);
      const priceReady=!pricePeriods.some(id=>suspended.includes(id))&&priceUsage.every(u=>u.state==='HELD')&&(!pricePeriods.length||await tx.membership.count({where:{id:{in:pricePeriods},startsAt:{lte:paidAt},endsAt:{gt:paidAt},OR:[{revokedAt:null},{revokedAt:{gt:paidAt}}]}})===pricePeriods.length);
      const ready=priceReady&&reservations.length===items.length&&reservations.every(r=>r.state==='HELD')&&skus.every(s=>s.active&&s.product.status==='PUBLISHED'&&!s.product.isDemo);
      const disposition=amount!==order.payableTotal?'AMOUNT_MISMATCH':accepted?'DUPLICATE':order.state==='CLOSED'||paidAt>order.expiresAt?'LATE':user.status!=='ACTIVE'||!ready||!attempt||(order.pricingSnapshot as {channel:string}).channel!==channel?'REFUND_REQUIRED':'ACCEPTED';
      const payment=await tx.paymentTransaction.create({data:{orderId:order.id,attemptId:attempt?.id,channel,appScope:identity.appid,externalTransactionId:data.transaction_id!,amount,currency:'CNY',paidAt,verifiedAt:now(),disposition,receiptHash:hash(data)}});
      await this.journal(tx,order,payment.id,amount,'PRODUCT_PAYMENT',disposition!=='ACCEPTED',channel);
      if(attempt)await tx.paymentAttempt.update({where:{id:attempt.id},data:{state:'SUCCEEDED',updatedAt:now()}});
      if(disposition==='ACCEPTED'){
        await tx.benefitUsage.updateMany({where:{userId:order.userId,businessKey:{startsWith:'product.price:'+order.id+':'},state:'HELD'},data:{state:'CONSUMED',updatedAt:now(),version:{increment:1}}});
        for(const r of reservations){await this.promotions.convert(tx,r);await this.stock(tx,r.id,r.orderItemId,r.skuId!,-r.quantity,-r.quantity,'PAYMENT',order.userId);await tx.inventoryReservation.update({where:{id:r.id},data:{state:'CONVERTED',convertedAt:now(),version:{increment:1}}});}
        await tx.tradeOrder.update({where:{id:order.id},data:{state:'PAID',paidTotal:amount,paidAt,version:{increment:1}}});await tx.tradeOrderItem.updateMany({where:{orderId:order.id},data:{state:'PAID'}});
        await tx.cartItem.deleteMany({where:{userId:order.userId,OR:items.map(i=>({skuId:(i.itemSnapshot as {skuId:string}).skuId,quantity:i.quantity}))}});
      }else{
        if(!accepted){
          const originalAttempt=await tx.paymentAttempt.findFirst({where:{orderId:order.id,channel:(order.pricingSnapshot as {channel:string}).channel,state:{in:['CREATED','PENDING']}}});
          if(originalAttempt&&originalAttempt.id!==attempt?.id)await tx.outboxJob.upsert({where:{eventKey:'product.closed-check:'+order.id},create:{eventKey:'product.closed-check:'+order.id,kind:'PRODUCT_PAYMENT_CHECK',aggregateType:'PRODUCT_ORDER',aggregateId:order.id,payload:{},availableAt:now()},update:{state:'READY',availableAt:now(),lockedUntil:null}});
          await this.release(tx,order);await tx.tradeOrder.update({where:{id:order.id},data:{state:'CLOSED',closedAt:now(),closeReason:disposition,version:{increment:1}}});await tx.tradeOrderItem.updateMany({where:{orderId:order.id},data:{state:'CLOSED'}});}
        const refund=await tx.refund.create({data:{orderId:order.id,userId:order.userId,requestKey:'anomaly:'+payment.id,kind:'REFUND_ONLY',state:'REFUNDING',requestedAmount:amount,approvedAmount:amount,paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-',''),reasonCode:disposition,description:'异常收款原路退回，不重复扣库存或发货'}});
        await tx.refundItem.create({data:{refundId:refund.id,orderItemId:items[0]!.id,quantity:1,amount,revokeQuantity:0}});await this.refundJob(tx,refund.id);
      }
      if(callback)await tx.providerCallback.create({data:{provider:channel,appScope:identity.appid,externalEventId:callback.id,kind:'TRANSACTION.SUCCESS',payloadHash:callback.payloadHash,payloadStorageRef:'sha256:'+callback.payloadHash,signatureVerified:true,state:'HANDLED',handledAt:now()}});
      await tx.outboxJob.updateMany({where:{eventKey:'product.expire:'+order.id},data:{state:'DONE',lockedUntil:null,completedAt:now()}});
      await tx.notification.create({data:{userId:order.userId,kind:'PRODUCT_ORDER',orderId:order.id,eventKey:'product.payment:'+payment.id,title:disposition==='ACCEPTED'?'好物付款已确认':'好物收款正在原路退回',body:disposition==='ACCEPTED'?'书院将按订单收货信息安排发货，可在商品订单查看进度。':'本次收款未用于商品交付，请查看订单退款进度。'}});
      await tx.auditLog.create({data:{actorId:order.userId,action:'product.payment.confirm',resource:'trade_order',resourceId:order.id,changes:{paymentId:payment.id,disposition,amount:String(amount),source:channel+'_VERIFIED'}}});return{disposition};
    },{timeout:15000});
  }
  private async refundJob(tx:Prisma.TransactionClient,id:string){await tx.outboxJob.upsert({where:{eventKey:'product.refund:'+id},create:{eventKey:'product.refund:'+id,kind:'PRODUCT_REFUND',aggregateType:'PRODUCT_REFUND',aggregateId:id,payload:{},availableAt:now()},update:{state:'READY',attempts:0,lockedUntil:null,availableAt:now(),lastErrorCode:null}});}
  async ship(id:string,req:AuthRequest,dto:ShipmentDto){
    requireRoles(req,['OPERATOR']);const initial=await this.db.tradeOrder.findFirst({where:{id,kind:'PHYSICAL'}});if(!initial)throw new NotFoundException('商品订单不存在');
    await this.db.$transaction(async tx=>{
      await this.lock(tx,initial);const order=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),eventKey='product.ship:'+id+':'+dto.requestKey,requestHash=hash({...dto,items:this.lines(dto.items,i=>i.orderItemId),expectedVersion:undefined});
      const old=await tx.auditLog.findFirst({where:{action:'product.ship',resourceId:id,changes:{path:['eventKey'],equals:eventKey}}});if(old){if((old.changes as {requestHash:string}).requestHash!==requestHash)throw new ConflictException('请求编号不能改变发货信息');return;}
      if(order.version!==dto.expectedVersion||!['PAID','FULFILLING'].includes(order.state)||(order.refundedTotal===order.paidTotal&&!await tx.pointsRedemption.findFirst({where:{orderId:id,state:{in:['FULFILLING','COMPLETED']}}})&&!await tx.memberGiftClaim.findFirst({where:{orderId:id,state:{in:['FULFILLING','COMPLETED']}}}))||!order.addressSnapshotCipher)throw new ConflictException('订单状态已变化或尚未付款，请刷新');
      if(await tx.pointsRedemption.findFirst({where:{orderId:id,state:{in:['RETURN_REQUESTED','RETURN_APPROVED','RETURN_SHIPPED','REFUNDED']}}}))throw new ConflictException('积分兑换正在售后或已退分，不能继续发货');
      if(await tx.memberGiftClaim.count({where:{orderId:id,state:{in:['RETURN_REQUESTED','RETURN_APPROVED','RETURN_SHIPPED','CANCELLED']}}}))throw new ConflictException('会员签名商品正在售后或已取消，不能继续发货');
      const pending=await tx.refund.count({where:{orderId:id,reasonCode:'PRODUCT_RETURN',state:{notIn:['REJECTED','CANCELLED','SUCCEEDED']}}});if(pending)throw new ConflictException('订单有售后处理中，请先处理售后');
      const items=await tx.tradeOrderItem.findMany({where:{orderId:id}}),shipments=await tx.shipment.findMany({where:{orderId:id,kind:'OUTBOUND'}}),sent=await tx.shipmentItem.findMany({where:{shipmentId:{in:shipments.map(s=>s.id)}}}),returned=await tx.refundItem.findMany({where:{orderItemId:{in:items.map(i=>i.id)},refundId:{in:(await tx.refund.findMany({where:{orderId:id,state:'SUCCEEDED',kind:'REFUND_ONLY',reasonCode:'PRODUCT_RETURN'}})).map(r=>r.id)}}});
      for(const line of this.lines(dto.items,i=>i.orderItemId)){const item=items.find(i=>i.id===line.orderItemId),sentCount=sent.filter(s=>s.orderItemId===line.orderItemId).reduce((sum,s)=>sum+s.quantity,0),returnedCount=returned.filter(r=>r.orderItemId===line.orderItemId).reduce((sum,r)=>sum+r.quantity,0);if(!item||line.quantity>item.quantity-sentCount-returnedCount)throw new BadRequestException('发货数量超出未发货数量');}
      const shipment=await tx.shipment.create({data:{orderId:id,kind:'OUTBOUND',carrierCode:dto.carrierCode,trackingNo:dto.trackingNo,state:'SHIPPED',addressSnapshotCipher:order.addressSnapshotCipher,shippedAt:now(),actorId:req.actor.id}});
      await tx.shipmentItem.createMany({data:dto.items.map(i=>({...i,shipmentId:shipment.id}))});await tx.tradeOrder.update({where:{id},data:{state:'FULFILLING',version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'product.ship',resource:'trade_order',resourceId:id,changes:{eventKey,requestHash,shipmentId:shipment.id,carrierCode:dto.carrierCode,trackingNo:dto.trackingNo,items:dto.items.map(i=>({orderItemId:i.orderItemId,quantity:i.quantity}))}}});
      await tx.notification.create({data:{userId:order.userId,kind:'PRODUCT_ORDER',orderId:id,eventKey:'product.ship:'+shipment.id,title:'好物已发出',body:carriers[dto.carrierCode as keyof typeof carriers]+' '+dto.trackingNo+'；可在商品订单复制单号查询。'}});
    });return this.adminDetail(id);
  }
  private async fulfilmentComplete(tx:Prisma.TransactionClient,id:string){
    const items=await tx.tradeOrderItem.findMany({where:{orderId:id}}),shipments=await tx.shipment.findMany({where:{orderId:id,kind:{in:['OUTBOUND','EXCHANGE']}}});
    const sent=await tx.shipmentItem.findMany({where:{shipmentId:{in:shipments.filter(s=>s.kind==='OUTBOUND').map(s=>s.id)}}});
    const refunded=await tx.refund.findMany({where:{orderId:id,kind:'REFUND_ONLY',state:'SUCCEEDED',reasonCode:'PRODUCT_RETURN'}}),lines=await tx.refundItem.findMany({where:{refundId:{in:refunded.map(r=>r.id)}}});
    return shipments.length>0&&shipments.every(s=>s.state==='DELIVERED')&&items.every(i=>sent.filter(s=>s.orderItemId===i.id).reduce((n,s)=>n+s.quantity,0)+lines.filter(r=>r.orderItemId===i.id).reduce((n,r)=>n+r.quantity,0)===i.quantity);
  }
  async receive(id:string,userId:string,shipmentId:string){
    const initial=await this.owned(id,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,initial);const order=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),shipment=await tx.shipment.findFirst({where:{id:shipmentId,orderId:id,kind:{in:['OUTBOUND','EXCHANGE']}}});if(!shipment)throw new NotFoundException('发货记录不存在');if(shipment.state==='DELIVERED')return;if(shipment.state!=='SHIPPED'||!['FULFILLING','COMPLETED'].includes(order.state))throw new ConflictException('当前状态不能确认收货');
      await tx.shipment.update({where:{id:shipmentId},data:{state:'DELIVERED',deliveredAt:now(),version:{increment:1}}});
      const all=await this.fulfilmentComplete(tx,id);if(all)await tx.memberGiftClaim.updateMany({where:{orderId:id,state:'FULFILLING'},data:{state:'COMPLETED',version:{increment:1},updatedAt:now()}});if(all)await tx.pointsRedemption.updateMany({where:{orderId:id,state:'FULFILLING'},data:{state:'COMPLETED',completedAt:now(),version:{increment:1},updatedAt:now()}});
      await tx.tradeOrder.update({where:{id},data:{...(all?{state:'COMPLETED',completedAt:now()}:{}),version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:userId,action:'product.receive',resource:'shipment',resourceId:shipmentId,changes:{orderId:id,allDelivered:all}}});
    });return this.detail(id,userId);
  }
  async requestRefund(id:string,userId:string,dto:RefundDto){
    const initial=await this.owned(id,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,initial);const order=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),lines=this.lines(dto.items,i=>i.orderItemId),requestHash=hash({...dto,items:lines,requestKey:undefined});
      const old=await tx.refund.findFirst({where:{userId,requestKey:dto.requestKey}});if(old){const audit=await tx.auditLog.findFirst({where:{action:'product.refund.request',resourceId:old.id}});if(old.orderId!==id||(audit?.changes as {requestHash?:string})?.requestHash!==requestHash)throw new ConflictException('请求编号已用于不同售后申请');return;}
      const payment=await tx.paymentTransaction.findFirst({where:{orderId:id,disposition:'ACCEPTED'}});if(!payment||!['PAID','FULFILLING','COMPLETED'].includes(order.state))throw new ConflictException('当前订单未确认付款或已关闭');
      const items=await tx.tradeOrderItem.findMany({where:{orderId:id}}),shipments=await tx.shipment.findMany({where:{orderId:id,kind:'OUTBOUND'}}),sent=await tx.shipmentItem.findMany({where:{shipmentId:{in:shipments.map(s=>s.id)}}}),prior=await tx.refund.findMany({where:{orderId:id,reasonCode:'PRODUCT_RETURN',state:{notIn:['REJECTED','CANCELLED']},NOT:{kind:'EXCHANGE',state:'SUCCEEDED'}}}),priorItems=await tx.refundItem.findMany({where:{refundId:{in:prior.map(r=>r.id)}}});
      const refundLines=[];
      for(const line of lines){
        const item=items.find(i=>i.id===line.orderItemId),others=priorItems.filter(r=>r.orderItemId===line.orderItemId),quantity=others.reduce((sum,r)=>sum+r.quantity,0),sentCount=sent.filter(s=>s.orderItemId===line.orderItemId).reduce((sum,s)=>sum+s.quantity,0);
        if(!item||line.quantity>item.quantity-quantity)throw new ConflictException('所选数量已有售后或超出购买数量');
        const unshippedRefunds=others.filter(r=>prior.some(p=>p.id===r.refundId&&p.kind==='REFUND_ONLY')).reduce((n,r)=>n+r.quantity,0);
        if(dto.kind==='REFUND_ONLY'&&line.quantity>item.quantity-sentCount-unshippedRefunds)throw new ConflictException('数量超出未发货部分，已发货商品请申请退货退款');
        if(dto.kind==='RETURN_REFUND'||dto.kind==='EXCHANGE'){
          const exchangeLines=await tx.shipmentItem.findMany({where:{orderItemId:line.orderItemId}}),replacements=await tx.shipment.findMany({where:{id:{in:exchangeLines.map(l=>l.shipmentId)},orderId:id,kind:'EXCHANGE'}});
          const relevant=shipments.filter(s=>sent.some(si=>si.shipmentId===s.id&&si.orderItemId===line.orderItemId));
          if(line.quantity>sentCount-(quantity-unshippedRefunds)||replacements.some(s=>s.state!=='DELIVERED'))throw new ConflictException('换货运输中或可退已收货数量不足，请先核查包裹');
          if(!relevant.length||relevant.some(s=>s.state!=='DELIVERED'||!s.deliveredAt||Date.now()-s.deliveredAt.getTime()>7*86400000))throw new ConflictException('请先确认实际收货；超过7日或运输中售后请联系书院核查');
        }
        const moneyQuantity=others.filter(r=>prior.some(p=>p.id===r.refundId&&p.kind!=='EXCHANGE')).reduce((n,r)=>n+r.quantity,0),base=item.payable-item.shippingAllocated,divisor=BigInt(item.quantity);
        const freight=dto.kind==='REFUND_ONLY'?item.shippingAllocated*BigInt(unshippedRefunds+line.quantity)/divisor-item.shippingAllocated*BigInt(unshippedRefunds)/divisor:0n;
        const amount=dto.kind==='EXCHANGE'?0n:base*BigInt(moneyQuantity+line.quantity)/divisor-base*BigInt(moneyQuantity)/divisor+freight;
        if(dto.kind!=='EXCHANGE'&&amount<=0n||item.refundedAmount+amount>item.payable)throw new ConflictException('可退金额不足');
        refundLines.push({orderItemId:item.id,quantity:line.quantity,amount,revokeQuantity:0,returnStockQuantity:dto.kind==='REFUND_ONLY'?line.quantity:0});
      }
      const amount=refundLines.reduce((sum,r)=>sum+r.amount,0n);
      if(prior.reduce((sum,r)=>sum+r.requestedAmount,0n)+amount>order.paidTotal)throw new ConflictException('累计申请退款超出实付金额');
      const refund=await tx.refund.create({data:{orderId:id,userId,requestKey:dto.requestKey,kind:dto.kind,state:'REQUESTED',requestedAmount:amount,reasonCode:'PRODUCT_RETURN',description:dto.reason.trim(),paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','')}});
      await tx.refundItem.createMany({data:refundLines.map(r=>({...r,refundId:refund.id}))});
      await tx.auditLog.create({data:{actorId:userId,action:'product.refund.request',resource:'refund',resourceId:refund.id,changes:{orderId:id,requestHash,amount:String(amount)}}});await tx.tradeOrder.update({where:{id},data:{version:{increment:1}}});
    });return this.detail(id,userId);
  }
  async returnShipment(refundId:string,userId:string,dto:ReturnDto){
    const initial=await this.db.refund.findFirst({where:{id:refundId,userId,reasonCode:'PRODUCT_RETURN'}});if(!initial)throw new NotFoundException('售后申请不存在');const order=await this.owned(initial.orderId,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const refund=await tx.refund.findUniqueOrThrow({where:{id:refundId}}),old=await tx.shipment.findFirst({where:{refundId,kind:'RETURN'}});
      if(old){if(old.carrierCode!==dto.carrierCode||old.trackingNo!==dto.trackingNo)throw new ConflictException('退货单号已提交，请联系书院修正');return;}
      if(refund.version!==dto.expectedVersion||refund.state!=='RETURNING')throw new ConflictException('请等待售后同意退货，或刷新状态');
      if(!refund.returnAddressCipher)throw new ConflictException('书院尚未提供退货收货信息，请联系客服');
      const shipment=await tx.shipment.create({data:{orderId:order.id,refundId,kind:'RETURN',carrierCode:dto.carrierCode,trackingNo:dto.trackingNo,state:'SHIPPED',addressSnapshotCipher:refund.returnAddressCipher,shippedAt:now(),actorId:userId}});
      await tx.shipmentItem.createMany({data:(await tx.refundItem.findMany({where:{refundId}})).map(r=>({shipmentId:shipment.id,orderItemId:r.orderItemId,quantity:r.quantity}))});await tx.refund.update({where:{id:refundId},data:{version:{increment:1}}});await tx.auditLog.create({data:{actorId:userId,action:'product.return.ship',resource:'refund',resourceId:refundId,changes:{shipmentId:shipment.id}}});
    });return this.detail(order.id,userId);
  }
  async reviewRefund(id:string,req:AuthRequest,dto:ReviewDto){
    requireRoles(req,dto.action==='RECEIVED'?['OPERATOR']:['FINANCE']);const initial=await this.db.refund.findUnique({where:{id}});if(!initial)throw new NotFoundException('售后申请不存在');const order=await this.owned(initial.orderId,initial.userId);
    if(dto.action==='RETRY'&&initial.state==='FAILED'&&initial.failureCode==='CLOSED'){
      const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:initial.paymentTransactionId!}}),channel=payment.channel as AppPaymentChannel;
      const fact=await this.channels.resolve(channel).queryRefund(initial.channelRequestKey!,{transactionId:payment.externalTransactionId,orderNo:order.orderNo,total:Number(payment.amount)});
      if(fact.out_refund_no!==initial.channelRequestKey)throw new BadRequestException('渠道退款编号不一致');
      const state=this.validateRefundFact(fact,initial,order,payment,channel);
      if(state==='SUCCESS'){await this.confirmRefund(fact,channel);throw new ConflictException('原退款已成功，已更新订单，不再重发');}
      if(state!=='CLOSED')throw new ConflictException('尚未确认原退款关闭，请稍后核查，不能另发退款');
      await this.db.$transaction(async tx=>{
        await this.lock(tx,order);const current=await tx.refund.findUniqueOrThrow({where:{id}});if(current.version!==dto.expectedVersion||current.state!=='FAILED'||current.failureCode!=='CLOSED')throw new ConflictException('退款状态已变化，请刷新');
        await tx.refund.update({where:{id},data:{state:'CANCELLED',reviewNote:'渠道确认原请求关闭，已创建独立重发申请。'+dto.reason.trim(),reviewerId:req.actor.id,version:{increment:1}}});
        const replacement=await tx.refund.create({data:{orderId:order.id,userId:order.userId,requestKey:'product.reissue:'+id,kind:current.kind,state:'REFUNDING',requestedAmount:current.requestedAmount,approvedAmount:current.approvedAmount,paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-',''),reasonCode:current.reasonCode,description:current.description,reviewerId:req.actor.id,reviewNote:dto.reason.trim(),returnAddressCipher:current.returnAddressCipher}});
        const lines=await tx.refundItem.findMany({where:{refundId:id}});await tx.refundItem.createMany({data:lines.map(l=>({refundId:replacement.id,orderItemId:l.orderItemId,quantity:l.quantity,amount:l.amount,revokeQuantity:l.revokeQuantity,returnStockQuantity:l.returnStockQuantity}))});
        await this.refundJob(tx,replacement.id);await tx.outboxJob.updateMany({where:{eventKey:'product.refund:'+id},data:{state:'DONE',lockedUntil:null,completedAt:now()}});await tx.tradeOrder.update({where:{id:order.id},data:{version:{increment:1}}});
        await tx.auditLog.create({data:{actorId:req.actor.id,action:'product.refund.reissue',resource:'refund',resourceId:replacement.id,reason:dto.reason.trim(),changes:{previousRefundId:id,previousChannelRequestKey:current.channelRequestKey,verifiedClosedReceiptHash:hash(fact),amount:String(current.approvedAmount)}}});
        await tx.notification.create({data:{userId:order.userId,kind:'PRODUCT_ORDER',orderId:order.id,eventKey:'product.refund.reissue:'+id,title:'退款已重新提交',body:'原支付渠道确认前次退款请求关闭，书院已保留历史并重新提交原路退款；无需重复寄回商品。'}});
      });return this.adminDetail(order.id);
    }
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const refund=await tx.refund.findUniqueOrThrow({where:{id}});if(refund.version!==dto.expectedVersion)throw new ConflictException('售后版本已变化，请刷新');
      if(dto.action==='RECEIVED'){
        if(!['RETURN_REFUND','EXCHANGE'].includes(refund.kind)||refund.state!=='RETURNING')throw new ConflictException('此申请不在退货等待阶段');
        const shipment=await tx.shipment.findFirst({where:{refundId:id,kind:'RETURN',state:'SHIPPED'}});if(!shipment)throw new ConflictException('用户尚未提交退货单号');
        const lines=await tx.refundItem.findMany({where:{refundId:id}});
        for(const item of this.lines(dto.restockItems??[],i=>i.orderItemId)){const line=lines.find(l=>l.orderItemId===item.orderItemId);if(!line||item.quantity>line.quantity)throw new BadRequestException('质检可回库数量超出实际退货数量');await tx.refundItem.update({where:{id:line.id},data:{returnStockQuantity:item.quantity}});}
        await tx.shipment.update({where:{id:shipment.id},data:{state:'DELIVERED',deliveredAt:now(),version:{increment:1}}});await tx.refund.update({where:{id},data:{state:'REVIEW',version:{increment:1}}});
      }else{
        const expected=dto.action==='RETRY'?['FAILED']:dto.action==='REJECT'?['REQUESTED','REVIEW']:['REQUESTED','REVIEW'];
        if(!expected.includes(refund.state))throw new ConflictException('售后状态已变化，请刷新');
        let state=dto.action==='REJECT'?'REJECTED':'REFUNDING',note=dto.reason.trim();
        if(dto.action==='APPROVE'&&['RETURN_REFUND','EXCHANGE'].includes(refund.kind)&&refund.state==='REQUESTED'){if(!dto.returnInstructions?.trim())throw new BadRequestException('请填写真实退货地址、收货人和联系电话');state='RETURNING';note=dto.returnInstructions.trim();}
        if(dto.action==='APPROVE'&&refund.kind==='EXCHANGE'&&refund.state==='REVIEW')state='APPROVED';
        await tx.refund.update({where:{id},data:{state,approvedAmount:state==='REFUNDING'?refund.requestedAmount:null,reviewerId:req.actor.id,reviewNote:state==='RETURNING'?dto.reason.trim():note,...(state==='RETURNING'?{returnAddressCipher:encryptPrivate(dto.returnInstructions!.trim())}:{}),failureCode:null,version:{increment:1},updatedAt:now()}});if(state==='REFUNDING')await this.refundJob(tx,id);
      }
      await tx.tradeOrder.update({where:{id:order.id},data:{version:{increment:1}}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'product.refund.'+dto.action.toLowerCase(),resource:'refund',resourceId:id,reason:dto.reason.trim(),changes:{orderId:order.id}}});
      await tx.notification.create({data:{userId:order.userId,kind:'PRODUCT_ORDER',orderId:order.id,eventKey:'product.refund.review:'+id+':'+(refund.version+1),title:'好物售后进度已更新',body:dto.action==='RECEIVED'?(refund.kind==='EXCHANGE'?'退货已收，请等待换货审核。':'退货已收，请等待财务核查原路退款。'):dto.action==='REJECT'?dto.reason.trim():['RETURN_REFUND','EXCHANGE'].includes(refund.kind)&&refund.state==='REQUESTED'?'申请已同意，请按订单售后指引寄回商品并填写物流单号。':refund.kind==='EXCHANGE'?'换货方案已审核，请等待书院登记发出。':'退款已进入处理，结果以支付渠道确认为准。'}});
    });return this.adminDetail(order.id);
  }
  private validateRefundFact(data:WechatRefund,refund:{approvedAmount:bigint|null},order:{orderNo:string},payment:{channel:string;appScope:string;externalTransactionId:string;amount:bigint},channel:AppPaymentChannel){
    const identity=this.channels.resolve(channel).identity(),state=data.refund_status??data.status;
    if(payment.channel!==channel||payment.appScope!==identity.appid||data.mchid&&data.mchid!==identity.mchid||data.out_trade_no!==order.orderNo||data.transaction_id!==payment.externalTransactionId||!Number.isSafeInteger(data.amount?.refund)||!Number.isSafeInteger(data.amount?.total)||BigInt(data.amount.refund)!==refund.approvedAmount||BigInt(data.amount.total)!==payment.amount||data.amount.currency&&data.amount.currency!=='CNY'||!data.refund_id||data.refund_id.length>128||!['SUCCESS','PROCESSING','ABNORMAL','CLOSED'].includes(state??''))throw new BadRequestException('退款事实与原收款不一致');
    return state;
  }
  async confirmRefund(data:WechatRefund,channel:AppPaymentChannel='WECHAT_APP'){
    const refund=await this.db.refund.findUnique({where:{channelRequestKey:data.out_refund_no}});if(!refund)throw new NotFoundException('退款不存在');const order=await this.owned(refund.orderId,refund.userId),payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}}),identity=this.channels.resolve(channel).identity(),state=data.refund_status??data.status;
    this.validateRefundFact(data,refund,order,payment,channel);
    if(state==='PROCESSING')return false;
    return this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.refund.findUniqueOrThrow({where:{id:refund.id}});if(current.state==='SUCCEEDED')return true;if(!['REFUNDING','FAILED'].includes(current.state))throw new ConflictException('退款尚未批准');
      if(state!=='SUCCESS'){await tx.refund.update({where:{id:refund.id},data:{state:'FAILED',failureCode:state,version:{increment:1}}});return true;}
      if(!data.success_time||!Number.isFinite(Date.parse(data.success_time))||Date.parse(data.success_time)>Date.now()+300000)throw new BadRequestException('退款时间无效');
      await tx.refundTransaction.create({data:{refundId:refund.id,paymentTransactionId:payment.id,channel,appScope:identity.appid,externalRefundId:data.refund_id,amount:current.approvedAmount!,currency:'CNY',verifiedAt:now(),succeededAt:new Date(data.success_time),receiptHash:hash(data)}});
      await this.journal(tx,order,payment.id,current.approvedAmount!,'PRODUCT_REFUND',payment.disposition!=='ACCEPTED',channel,refund.id);
      if(payment.disposition==='ACCEPTED'){
        const lines=await tx.refundItem.findMany({where:{refundId:refund.id}}),items=await tx.tradeOrderItem.findMany({where:{id:{in:lines.map(l=>l.orderItemId)}}});await this.lockSkus(tx,items.map(i=>(i.itemSnapshot as {skuId:string}).skuId));
        for(const line of lines){const item=items.find(i=>i.id===line.orderItemId)!;if(line.returnStockQuantity)await this.stock(tx,null,item.id,(item.itemSnapshot as {skuId:string}).skuId,line.returnStockQuantity,0,'REFUND',order.userId,'product.stock.refund:'+line.id);await tx.tradeOrderItem.update({where:{id:item.id},data:{refundedAmount:{increment:line.amount},version:{increment:1}}});}
        const row=await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}}),total=row.refundedTotal+current.approvedAmount!;
        await tx.tradeOrder.update({where:{id:order.id},data:{refundedTotal:total,...(total===row.paidTotal?{state:'CLOSED',closedAt:now(),closeReason:'REFUNDED'}:{}),version:{increment:1}}});
        if(total===row.paidTotal)await tx.benefitUsage.updateMany({where:{userId:order.userId,businessKey:{startsWith:'product.price:'+order.id+':'},state:'CONSUMED'},data:{state:'REVERSED',updatedAt:now(),version:{increment:1}}});
      }
      await tx.refund.update({where:{id:refund.id},data:{state:'SUCCEEDED',succeededAt:new Date(data.success_time),failureCode:null,version:{increment:1}}});
      const latest=await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}});if(latest.state!=='CLOSED'&&payment.disposition==='ACCEPTED'&&await this.fulfilmentComplete(tx,order.id))await tx.tradeOrder.update({where:{id:order.id},data:{state:'COMPLETED',completedAt:now(),version:{increment:1}}});await tx.outboxJob.updateMany({where:{eventKey:'product.refund:'+refund.id},data:{state:'DONE',lockedUntil:null,completedAt:now()}});
      await tx.auditLog.create({data:{actorId:order.userId,action:'product.refund.confirm',resource:'refund',resourceId:refund.id,changes:{amount:String(current.approvedAmount),source:channel+'_VERIFIED'}}});await tx.notification.create({data:{userId:order.userId,kind:'PRODUCT_ORDER',orderId:order.id,eventKey:'product.refunded:'+refund.id,title:'好物退款已确认',body:'支付渠道已确认退款，请留意原付款账户。'}});return true;
    },{timeout:15000});
  }
  async shipExchange(refundId:string,req:AuthRequest,dto:ShipmentDto){
    requireRoles(req,['OPERATOR']);const initial=await this.db.refund.findFirst({where:{id:refundId,reasonCode:'PRODUCT_RETURN',kind:'EXCHANGE'}});if(!initial)throw new NotFoundException('换货申请不存在');const order=await this.owned(initial.orderId,initial.userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const refund=await tx.refund.findUniqueOrThrow({where:{id:refundId}}),lines=await tx.refundItem.findMany({where:{refundId}}),items=await tx.tradeOrderItem.findMany({where:{id:{in:lines.map(l=>l.orderItemId)}}}),requestHash=hash({...dto,items:this.lines(dto.items,i=>i.orderItemId),expectedVersion:undefined});
      const old=await tx.shipment.findFirst({where:{refundId,kind:'EXCHANGE'}});if(old){const prior=await tx.auditLog.findFirst({where:{action:'product.exchange.ship',resourceId:refundId}});if((prior?.changes as {requestHash?:string})?.requestHash!==requestHash)throw new ConflictException('换货已发出，请刷新，不得重复发货');return;}
      if(refund.version!==dto.expectedVersion||refund.state!=='APPROVED')throw new ConflictException('请先完成退货收货、质检和财务换货审核');
      const requested=this.lines(dto.items,i=>i.orderItemId);if(requested.length!==lines.length||requested.some(r=>!lines.some(l=>l.orderItemId===r.orderItemId&&l.quantity===r.quantity)))throw new BadRequestException('换货须完整发出已审核的同规格商品数量');
      if(!order.addressSnapshotCipher)throw new ConflictException('原配送信息已移除，请联系书院核查');
      await this.lockSkus(tx,items.map(i=>(i.itemSnapshot as {skuId:string}).skuId));
      for(const line of lines){const item=items.find(i=>i.id===line.orderItemId)!,skuId=(item.itemSnapshot as {skuId:string}).skuId;
        if(line.returnStockQuantity)await this.stock(tx,null,item.id,skuId,line.returnStockQuantity,0,'EXCHANGE_RETURN',req.actor.id,'product.exchange.return:'+line.id);
        await this.stock(tx,null,item.id,skuId,-line.quantity,0,'EXCHANGE_SEND',req.actor.id,'product.exchange.send:'+line.id);
      }
      const shipment=await tx.shipment.create({data:{orderId:order.id,refundId,kind:'EXCHANGE',carrierCode:dto.carrierCode,trackingNo:dto.trackingNo,state:'SHIPPED',addressSnapshotCipher:order.addressSnapshotCipher,shippedAt:now(),actorId:req.actor.id}});
      await tx.shipmentItem.createMany({data:lines.map(l=>({shipmentId:shipment.id,orderItemId:l.orderItemId,quantity:l.quantity}))});await tx.refund.update({where:{id:refundId},data:{state:'SUCCEEDED',succeededAt:now(),version:{increment:1}}});await tx.tradeOrder.update({where:{id:order.id},data:{state:'FULFILLING',completedAt:null,version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'product.exchange.ship',resource:'refund',resourceId:refundId,changes:{shipmentId:shipment.id,requestHash}}});await tx.notification.create({data:{userId:order.userId,kind:'PRODUCT_ORDER',orderId:order.id,eventKey:'product.exchange:'+refundId,title:'换货商品已发出',body:carriers[dto.carrierCode as keyof typeof carriers]+' '+dto.trackingNo+'；换货不重复收款，请查看包裹记录。'}});
    });return this.adminDetail(order.id);
  }
  async admin(q:OrderPage){const where={kind:'PHYSICAL',...(q.state?{state:q.state}:{}),...(q.q?{orderNo:{contains:q.q}}:{})},[rows,total]=await this.db.$transaction([this.db.tradeOrder.findMany({where,select:{id:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size,skip:(q.page-1)*q.size}),this.db.tradeOrder.count({where})]);return{items:await Promise.all(rows.map(r=>this.adminDetail(r.id))),total,salesEnabled:productSalesEnabled()};}
  async adminDetail(id:string){const order=await this.db.tradeOrder.findFirst({where:{id,kind:'PHYSICAL'}});if(!order)throw new NotFoundException('商品订单不存在');const detail=await this.detail(id,order.userId),user=await this.db.user.findUnique({where:{id:order.userId},select:{nickname:true}});detail.refunds=detail.refunds.map((r:Record<string,unknown>)=>({...r,returnInstructions:r.returnInstructions?'已保护，仅订单本人可见':null}));detail.address=detail.address?{recipient:'已保护',phone:detail.address.phone.slice(0,3)+'****'+detail.address.phone.slice(-4),province:detail.address.province,city:detail.address.city,district:detail.address.district,detail:'授权查看配送地址后获取'}:null;return{...detail,nickname:user?.nickname??'已注销'};}
  async adminAddress(id:string,req:AuthRequest){requireRoles(req,['OPERATOR','SUPPORT']);const order=await this.db.tradeOrder.findFirst({where:{id,kind:'PHYSICAL'}});if(!order?.addressSnapshotCipher)throw new NotFoundException('配送信息不可用');await this.db.auditLog.create({data:{actorId:req.actor.id,action:'product.address.read',resource:'trade_order',resourceId:id,changes:{purpose:'配送或售后处理'}}});return JSON.parse(decryptPrivate(order.addressSnapshotCipher));}
  async adminRefresh(id:string){const order=await this.db.tradeOrder.findFirst({where:{id,kind:'PHYSICAL'}});if(!order)throw new NotFoundException('订单不存在');await this.refresh(id,order.userId);return this.adminDetail(id);}
  async runJobs(){
    if(this.working)return;this.working=true;
    try{for(let n=0;n<20;n++){
      const jobs=await this.db.$queryRaw<{id:string;kind:string;aggregateId:string;attempts:number}[]>`UPDATE "OutboxJob" SET state='RUNNING',"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1,"updatedAt"=now() WHERE id=(SELECT id FROM "OutboxJob" WHERE kind IN ('PRODUCT_PAYMENT_CHECK','PRODUCT_REFUND','PRODUCT_PROMOTION_EXPIRE') AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,kind,"aggregateId",attempts`;
      if(!jobs.length)break;const job=jobs[0]!;
      try{let done=true;if(job.kind==='PRODUCT_PROMOTION_EXPIRE'){await this.promotions.expire(job.aggregateId);}else if(job.kind==='PRODUCT_PAYMENT_CHECK'){const order=await this.db.tradeOrder.findUniqueOrThrow({where:{id:job.aggregateId}});if(order.state==='CLOSED'){const attempt=await this.db.paymentAttempt.findFirst({where:{orderId:order.id,state:{in:['CREATED','PENDING']}}});if(attempt){if(attempt.state==='CREATED'&&Date.now()-attempt.updatedAt.getTime()<30000){done=false;}else{const adapter=this.channels.resolve(attempt.channel),fact=await adapter.query(order.orderNo);if(fact.trade_state==='SUCCESS')await this.confirmPayment(fact,undefined,attempt.channel as AppPaymentChannel);else if(['NOTPAY','NOTFOUND','CLOSED'].includes(fact.trade_state)){if(fact.trade_state==='NOTPAY')await adapter.close(order.orderNo);await this.db.paymentAttempt.updateMany({where:{id:attempt.id,updatedAt:attempt.updatedAt},data:{state:'CLOSED',lastQueriedAt:now(),failureCode:null}});}else done=false;}}}else if(order.state==='PENDING'){await this.refresh(order.id,order.userId);if((await this.db.tradeOrder.findUniqueOrThrow({where:{id:order.id}})).state==='PENDING'){if(await this.db.paymentAttempt.count({where:{orderId:order.id}}))done=false;else await this.cancel(order.id,order.userId,'TIMEOUT');}}}else{const refund=await this.db.refund.findUniqueOrThrow({where:{id:job.aggregateId}});if(refund.state==='REFUNDING'){const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}}),order=await this.db.tradeOrder.findUniqueOrThrow({where:{id:refund.orderId}});done=await this.confirmRefund(await this.channels.resolve(payment.channel).refund(payment.externalTransactionId,refund.channelRequestKey!,Number(refund.approvedAmount),Number(payment.amount),order.orderNo),payment.channel as AppPaymentChannel);}}
        await this.db.outboxJob.updateMany({where:{id:job.id,state:'RUNNING',attempts:job.attempts},data:{state:done?'DONE':'READY',completedAt:done?now():null,lockedUntil:null,availableAt:new Date(Date.now()+60000),lastErrorCode:null}});
      }catch{await this.db.outboxJob.updateMany({where:{id:job.id,state:'RUNNING',attempts:job.attempts},data:{state:job.attempts>=20?'DEAD':'READY',lockedUntil:null,availableAt:new Date(Date.now()+Math.min(3600000,30000*2**Math.min(job.attempts,7))),lastErrorCode:'PROVIDER_OR_PROCESSING_ERROR'}});}
    }}finally{this.working=false;}
  }
}
@Controller('commerce') @UseGuards(UserGuard)
export class ProductSalesController {
  constructor(private readonly sales:ProductSalesService){}
  @Post('products/quote') quote(@Req() req:AuthRequest,@Body() dto:QuoteDto){return this.sales.quote(req.actor.id,dto);}
  @Post('product-orders') checkout(@Req() req:AuthRequest,@Body() dto:CheckoutDto){return this.sales.checkout(req.actor.id,dto);}
  @Get('product-orders') list(@Req() req:AuthRequest,@Query() q:OrderPage){return this.sales.list(req.actor.id,q);}
  @Get('product-orders/request/:requestKey') byRequest(@Req() req:AuthRequest,@Param('requestKey',ParseUUIDPipe) requestKey:string){return this.sales.byRequest(req.actor.id,requestKey);}
  @Get('product-orders/:id') detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.sales.detail(id,req.actor.id);}
  @Post('product-orders/:id/payment') prepay(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.sales.prepay(id,req.actor.id);}
  @Post('product-orders/:id/refresh') refresh(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.sales.refresh(id,req.actor.id);}
  @Post('product-orders/:id/cancel') cancel(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.sales.cancel(id,req.actor.id);}
  @Post('product-orders/:id/shipments/:shipmentId/receive') receive(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Param('shipmentId',ParseUUIDPipe) shipmentId:string){return this.sales.receive(id,req.actor.id,shipmentId);}
  @Post('product-orders/:id/refund') refund(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RefundDto){return this.sales.requestRefund(id,req.actor.id,dto);}
  @Post('product-refunds/:id/return') returning(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReturnDto){return this.sales.returnShipment(id,req.actor.id,dto);}
}
@Controller('admin/product-orders') @UseGuards(AdminGuard)
export class ProductOrdersAdminController {
  constructor(private readonly sales:ProductSalesService){}
  @Get() list(@Query() q:OrderPage){return this.sales.admin(q);}
  @Get(':id') detail(@Param('id',ParseUUIDPipe) id:string){return this.sales.adminDetail(id);}
  @Post(':id/refresh') refresh(@Param('id',ParseUUIDPipe) id:string){return this.sales.adminRefresh(id);}
  @Get(':id/address') address(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.sales.adminAddress(id,req);}
  @Post(':id/ship') ship(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ShipmentDto){return this.sales.ship(id,req,dto);}
  @Post('refunds/:id/review') review(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReviewDto){return this.sales.reviewRefund(id,req,dto);}
  @Post('refunds/:id/exchange') exchange(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ShipmentDto){return this.sales.shipExchange(id,req,dto);}
}
