import {FileInterceptor} from '@nestjs/platform-express';
import {MediaService} from './media.js';
import { encryptPrivate, personalAddress, orderAddress } from './private-data.js';
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile,UseInterceptors,ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional,IsISO8601, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { createHash } from 'node:crypto';
import { Database } from './database.js';
import { AdminGuard, UserGuard, requireRoles } from './auth.js';
import type { AuthRequest } from './auth.js';
import type { Prisma } from './generated/prisma/client.js';

class OrderQuery {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) size=20;
  @IsOptional() @IsIn(['PENDING','CLOSED']) status?:'PENDING'|'CLOSED';
}

class LineDto {
  @IsUUID() skuId!: string;
  @IsInt() @Min(1) @Max(99) quantity!: number;
}
class QuoteDto {
  @IsUUID() addressId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>LineDto) items!: LineDto[];
}
class OrderDto extends QuoteDto {
  @IsUUID() requestId!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) quoteId!: string;
}
class DeliveryDto {
  @IsOptional() @IsInt() @Min(0) @Max(1000000) priorityFee?:number|null;
  @IsOptional() @IsString() @Length(5,500) priorityDescription?:string|null;
  @IsOptional() @IsISO8601() priorityUntil?:string|null;
  @IsOptional() @IsUUID() priorityProofAssetId?:string|null;
  @IsInt() @Min(0) @Max(100000000) fee!: number;
  @IsInt() @Min(0) @Max(100000000) surcharge!: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) freeAbove?: number | null;
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @Length(1,500) @Matches(/\S/) reason!: string;
}
type Tx=Prisma.TransactionClient;
const hash=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const include={items:{orderBy:{skuId:'asc' as const}}};
const previewEnabled=()=>process.env.NODE_ENV!=='production'&&process.env.ORDER_RESERVATION_PREVIEW==='true';

@Injectable()
export class OrdersService implements OnModuleInit,OnModuleDestroy {
  constructor(private readonly db:Database){}
  private timer?:NodeJS.Timeout;
  private expiring=false;
  private readonly logger=new Logger(OrdersService.name);
  onModuleInit(){
    // Pending preview orders have no payment attempts. Replace this sweep with
    // channel query/close + durable jobs before enabling real transactions.
    if(previewEnabled())this.timer=setInterval(()=>{void this.expire().catch(()=>this.logger.error('Pending reservation sweep failed'));},30000).unref();
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private lines(dto:QuoteDto){
    const items=[...dto.items].sort((a,b)=>a.skuId.localeCompare(b.skuId));
    if(new Set(items.map(row=>row.skuId)).size!==items.length)throw new BadRequestException('同一规格请合并数量');
    return items;
  }
  private async lockUser(tx:Tx,userId:string){
    if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`).length)throw new UnauthorizedException('请重新登录');
  }
  private async quotation(tx:Tx,userId:string,dto:QuoteDto,lock=false){
    const lines=this.lines(dto),skuIds=lines.map(row=>row.skuId);
    const storedAddress=await tx.address.findFirst({where:{id:dto.addressId,userId}});
    if(!storedAddress)throw new NotFoundException('请选择自己的收货地址');
    const address=personalAddress(storedAddress);
    if(lock){
      // Match SKU administration's Product -> SKU lock order; sort all rows
      // to avoid opposite-order deadlocks during multi-SKU checkout.
      const products=await tx.productSku.findMany({where:{id:{in:skuIds}},select:{productId:true}});
      for(const id of [...new Set(products.map(row=>row.productId))].sort())await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${id} FOR UPDATE`;
      for(const id of skuIds)await tx.$queryRaw`SELECT id FROM "ProductSku" WHERE id=${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT province FROM "DeliveryZone" WHERE province=${address.province} FOR SHARE`;
    }
    const zone=await tx.deliveryZone.findUnique({where:{province:address.province}});
    if(!zone?.enabled)throw new BadRequestException('此地区暂未开放配送');
    const skus=await tx.productSku.findMany({where:{id:{in:skuIds}},include:{product:true}});
    const items=lines.map(line=>{
      const sku=skus.find(row=>row.id===line.skuId);
      if(!sku||!sku.active||sku.product.status!=='PUBLISHED'||sku.product.type!=='PHYSICAL'||(process.env.NODE_ENV==='production'&&sku.product.isDemo))throw new ConflictException('商品或规格不可购买，请刷新');
      if(sku.stock-sku.reserved<line.quantity)throw new ConflictException('库存不足，请调整数量');
      return {skuId:sku.id,productId:sku.productId,title:sku.product.title,skuTitle:sku.title,cover:sku.product.cover,unitPrice:sku.price,quantity:line.quantity,subtotal:sku.price*line.quantity};
    });
    const subtotal=items.reduce((sum,row)=>sum+row.subtotal,0);
    const shipping=(zone.freeAbove!==null&&subtotal>=zone.freeAbove?0:zone.fee)+zone.surcharge;
    const total=subtotal+shipping;
    if(total>1000000000)throw new BadRequestException('订单金额超过允许范围，请减少数量');
    const destination={recipient:address.recipient,phone:address.phone,province:address.province,city:address.city,district:address.district,detail:address.detail};
    const quoteId=hash({userId,addressId:address.id,destination,items,zone,total});
    return {quoteId,items,address:destination,subtotal,shipping,total,paymentEnabled:false,discountsEnabled:false,reservationPreviewEnabled:previewEnabled()};
  }
  quote(userId:string,dto:QuoteDto){return this.db.$transaction(tx=>this.quotation(tx,userId,dto));}
  async create(userId:string,dto:OrderDto){
    if(!previewEnabled())throw new ServiceUnavailableException('订单及支付尚未开放');
    const requestHash=hash({addressId:dto.addressId,items:this.lines(dto),quoteId:dto.quoteId});
    return this.db.$transaction(async tx=>{
      await this.lockUser(tx,userId);
      const existing=await tx.order.findUnique({where:{userId_requestId:{userId,requestId:dto.requestId}},include});
      if(existing){if(existing.requestHash!==requestHash)throw new ConflictException('请求编号已用于不同订单');return this.safe(existing);}
      if(await tx.order.count({where:{userId,status:'PENDING'}})>=10)throw new BadRequestException('请先取消已有待处理订单');
      const quote=await this.quotation(tx,userId,dto,true);
      if(quote.quoteId!==dto.quoteId)throw new ConflictException('价格或配送信息已变化，请重新确认');
      for(const item of quote.items){
        const updated=await tx.$executeRaw`UPDATE "ProductSku" SET reserved=reserved+${item.quantity},version=version+1 WHERE id=${item.skuId} AND stock-reserved>=${item.quantity}`;
        if(updated!==1)throw new ConflictException('库存不足，请重新确认');
      }
      const order=await tx.order.create({data:{userId,requestId:dto.requestId,requestHash,address:{cipher:encryptPrivate(JSON.stringify(quote.address))},subtotal:quote.subtotal,shipping:quote.shipping,total:quote.total,quoteId:quote.quoteId,expiresAt:new Date(Date.now()+15*60000),items:{create:quote.items}},include});
      await tx.auditLog.create({data:{actorId:userId,action:'order.reserve.preview',resource:'order',resourceId:order.id,changes:{total:order.total}}});
      return this.safe(order);
    },{timeout:15000});
  }
  private safe<T extends {requestHash:string;requestId:string;userId:string;address:unknown}>(order:T){const {requestHash,requestId,userId,...row}=order;return {...row,address:orderAddress(order.address),paymentEnabled:false};}
  async list(userId:string,query:OrderQuery){const where={userId,...(query.status?{status:query.status}:{})};const [rows,total]=await this.db.$transaction([this.db.order.findMany({where,include,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size}),this.db.order.count({where})]);return {items:rows.map(row=>this.safe(row)),total};}
  async detail(userId:string,id:string){const row=await this.db.order.findFirst({where:{id,userId},include});if(!row)throw new NotFoundException('订单不存在');return this.safe(row);}
  private async close(tx:Tx,id:string,reason:string,actorId:string,userId?:string,deadline?:Date){
    const locked=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Order" WHERE id=${id} FOR UPDATE`;
    if(!locked.length)throw new NotFoundException('订单不存在');
    const order=await tx.order.findUniqueOrThrow({where:{id},include});
    if(userId&&order.userId!==userId)throw new NotFoundException('订单不存在');
    if(order.status==='CLOSED'||(deadline&&order.expiresAt>deadline))return this.safe(order);
    for(const item of order.items){
      const released=await tx.$executeRaw`UPDATE "ProductSku" SET reserved=reserved-${item.quantity},version=version+1 WHERE id=${item.skuId} AND reserved>=${item.quantity}`;
      if(released!==1)throw new ConflictException('库存预占记录异常，请联系运营处理');
    }
    const row=await tx.order.update({where:{id},data:{status:'CLOSED',closedAt:new Date(),closeReason:reason},include});
    await tx.auditLog.create({data:{actorId,action:'order.close',resource:'order',resourceId:id,changes:{reason}}});
    return this.safe(row);
  }
  cancel(userId:string,id:string){return this.db.$transaction(async tx=>{await this.lockUser(tx,userId);return this.close(tx,id,'用户取消',userId,userId);});}
  async expire(){
    if(this.expiring)return {processed:0};this.expiring=true;
    try{const now=new Date(),rows=await this.db.order.findMany({where:{status:'PENDING',expiresAt:{lte:now}},orderBy:{expiresAt:'asc'},take:100});
      const system = await this.db.user.upsert({ where: { id: 'system-order-expiry' }, create: { id: 'system-order-expiry', nickname: '系统关单任务', status: 'FROZEN', roles: ['USER'] }, update: {} });
      for(const row of rows)await this.db.$transaction(tx=>this.close(tx,row.id,'付款超时（开发预占）',system.id,undefined,now));
      return {processed:rows.length};
    }finally{this.expiring=false;}
  }
  zones(){return this.db.deliveryZone.findMany({orderBy:{province:'asc'}});}
  async zone(req:AuthRequest,province:string,dto:DeliveryDto){
    requireRoles(req,['OPERATOR']);if(!province.trim()||province.length>30)throw new BadRequestException('省份名称无效');
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${province}))`;
      const prior=await tx.deliveryZone.findUnique({where:{province}});
      if((prior?.version??0)!==dto.expectedVersion)throw new ConflictException('配送配置版本已变化');
      const priority=dto.priorityFee===undefined?{priorityFee:prior?.priorityFee??null,priorityDescription:prior?.priorityDescription??null,priorityUntil:prior?.priorityUntil??null,priorityProofAssetId:prior?.priorityProofAssetId??null}:dto.priorityFee===null?{priorityFee:null,priorityDescription:null,priorityUntil:null,priorityProofAssetId:null}:{priorityFee:dto.priorityFee,priorityDescription:dto.priorityDescription?.trim()??null,priorityUntil:dto.priorityUntil?new Date(dto.priorityUntil):null,priorityProofAssetId:dto.priorityProofAssetId??null};
      if(priority.priorityFee!==null&&(!priority.priorityDescription||priority.priorityDescription.length<5||!priority.priorityUntil||priority.priorityUntil<=new Date()||!priority.priorityProofAssetId||!await tx.mediaAsset.findFirst({where:{id:priority.priorityProofAssetId,status:'READY',visibility:'PRIVATE',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}})))throw new BadRequestException('优先配送须提供真实覆盖与服务说明、有效截止及私有合同凭证');
      const data={...priority,fee:dto.fee,surcharge:dto.surcharge,freeAbove:dto.freeAbove??null,enabled:dto.enabled};
      const row=await tx.deliveryZone.upsert({where:{province},create:{province,...data},update:{...data,version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'delivery.configure',resource:'deliveryZone',resourceId:province,changes:{...data,priorityUntil:data.priorityUntil?.toISOString()??null,version:row.version,reason:dto.reason.trim()}}});return row;
    });
  }
}
@Controller('orders') @UseGuards(UserGuard)
export class OrdersController {
  constructor(private readonly orders:OrdersService){}
  @Post('quote') quote(@Req() req:AuthRequest,@Body() dto:QuoteDto){return this.orders.quote(req.actor.id,dto);}
  @Post() create(@Req() req:AuthRequest,@Body() dto:OrderDto){return this.orders.create(req.actor.id,dto);}
  @Get() list(@Req() req:AuthRequest,@Query() dto:OrderQuery){return this.orders.list(req.actor.id,dto);}
  @Get(':id') detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.orders.detail(req.actor.id,id);}
  @Post(':id/cancel') cancel(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.orders.cancel(req.actor.id,id);}
}
@Controller('admin') @UseGuards(AdminGuard)
export class OrdersAdminController {
  constructor(private readonly orders:OrdersService,private readonly db:Database,private readonly media:MediaService){}
  @Post('delivery-zones/proof') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024}})) proof(@Req() req:AuthRequest,@UploadedFile() file:{originalname:string;mimetype:string;size:number;buffer:Buffer}){requireRoles(req,['OPERATOR']);return this.media.upload(req,file,true,'EVIDENCE_FILE');}
  @Get('delivery-zones') zones(@Req() req:AuthRequest){requireRoles(req,['OPERATOR']);return this.orders.zones();}
  @Put('delivery-zones/:province') zone(@Req() req:AuthRequest,@Param('province') province:string,@Body() dto:DeliveryDto){return this.orders.zone(req,province,dto);}
  @Get('orders') async list(@Req() req:AuthRequest,@Query() query:OrderQuery){requireRoles(req,['SUPPORT','FINANCE']);const where=query.status?{status:query.status}:{};const [items,total]=await this.db.$transaction([this.db.order.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size,select:{id:true,status:true,total:true,shipping:true,createdAt:true,expiresAt:true,closeReason:true,items:include.items}}),this.db.order.count({where})]);return {items,total,paymentEnabled:false};}
}
