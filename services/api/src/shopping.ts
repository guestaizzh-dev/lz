import {productPromotionHints} from './product-promotions.js';
import { validateEvidencePublication } from './evidence.js';
import { encryptPrivate, personalAddress } from './private-data.js';
import { demoContentVisible, publicContentScope } from './public-content.js';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, IsUUID } from 'class-validator';
import { Database } from './database.js';
import { AdminGuard, UserGuard, requireRoles } from './auth.js';
import type { AuthRequest } from './auth.js';
import type { Prisma } from './generated/prisma/client.js';
import { TableQuery, TransitionDto } from './admin.js';

class AddressDto {
  @IsString() @Length(1, 30) @Matches(/\S/) recipient!: string;
  @IsString() @Matches(/^1[3-9]\d{9}$/) phone!: string;
  @IsString() @Length(1, 30) @Matches(/\S/) province!: string;
  @IsString() @Length(1, 30) @Matches(/\S/) city!: string;
  @IsString() @Length(1, 30) @Matches(/\S/) district!: string;
  @IsString() @Length(1, 150) @Matches(/\S/) detail!: string;
  @IsBoolean() isDefault!: boolean;
}
class QuantityDto { @IsInt() @Min(1) @Max(99) quantity!: number; }
class SkuDto {
  @IsOptional() @IsUUID() serviceOfferingId?:string|null;
  @IsString() @Length(1, 80) @Matches(/\S/) title!: string;
  @IsInt() @Min(0) @Max(100000000) price!: number;
  @IsInt() @Min(0) @Max(1000000) stock!: number;
  @IsBoolean() active!: boolean;
  @IsString() @Length(1, 500) @Matches(/\S/) reason!: string;
}
class SkuEditDto extends SkuDto { @IsInt() @Min(1) expectedVersion!: number; }
class ProductDto {
  @IsString() @Length(1, 120) @Matches(/\S/) title!: string;
  @IsString() @Length(1, 200) @Matches(/\S/) subtitle!: string;
  @IsString() @Length(1, 10000) @Matches(/\S/) description!: string;
  @IsIn(['经典典籍','文创','养生用品','修行工具','线下服务']) category!: string;
  @IsIn(['PHYSICAL','DIGITAL','SERVICE']) type!: 'PHYSICAL' | 'DIGITAL' | 'SERVICE';
  @IsString() @Matches(/^(https:\/\/[^\s]+|\/static\/art\/[a-z-]+\.svg)$/) cover!: string;
  @IsInt() @Min(0) @Max(100000000) price!: number;
  @IsString() @Length(1, 3000) @Matches(/\S/) culturalOrigin!: string;
  @IsBoolean() featured!: boolean;
  @IsOptional() @IsBoolean() memberDiscountEligible?: boolean;
}
class ProductEditDto extends ProductDto { @IsInt() @Min(1) expectedVersion!: number; }
type Tx = Prisma.TransactionClient;

export const publicSku = (row: { id:string;title:string;price:number;stock:number;reserved:number;active:boolean;version:number;serviceOfferingId?:string|null }) => ({id:row.id,title:row.title,price:row.price,available:row.stock-row.reserved,active:row.active,version:row.version,serviceOfferingId:row.serviceOfferingId??null});

@Injectable()
export class ShoppingService {
  constructor(private readonly db:Database){}
  private async lockUser(tx:Tx,userId:string) {
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`;
    if(!rows.length)throw new UnauthorizedException('请重新登录');
  }
  async addresses(userId:string) { return (await this.db.address.findMany({where:{userId},orderBy:[{isDefault:'desc'},{updatedAt:'desc'}],take:20})).map(personalAddress); }
  async address(userId:string,dto:AddressDto,id?:string) {
    return this.db.$transaction(async tx=>{
      await this.lockUser(tx,userId);
      const existing=id?await tx.address.findFirst({where:{id,userId}}):null;
      if(id&&!existing)throw new NotFoundException('地址不存在');
      const count=await tx.address.count({where:{userId}});
      if(!id&&count>=20)throw new BadRequestException('最多保存20个地址');
      const data={...dto,recipient:dto.recipient.trim(),province:dto.province.trim(),city:dto.city.trim(),district:dto.district.trim(),detail:dto.detail.trim(),isDefault:dto.isDefault||count===0};
      const encrypted={...data,recipient:'',phone:'',detail:'',recipientCipher:encryptPrivate(data.recipient),phoneCipher:encryptPrivate(data.phone),detailCipher:encryptPrivate(data.detail)};
      if(data.isDefault)await tx.address.updateMany({where:{userId,isDefault:true},data:{isDefault:false}});
      const result=id?await tx.address.update({where:{id},data:encrypted}):await tx.address.create({data:{...encrypted,userId}});
      if(!await tx.address.count({where:{userId,isDefault:true}}))await tx.address.update({where:{id:result.id},data:{isDefault:true}});
      return personalAddress(await tx.address.findUniqueOrThrow({where:{id:result.id}}));
    });
  }
  async removeAddress(userId:string,id:string) {
    return this.db.$transaction(async tx=>{
      await this.lockUser(tx,userId);
      if(!(await tx.address.deleteMany({where:{id,userId}})).count)throw new NotFoundException('地址不存在');
      if(!await tx.address.count({where:{userId,isDefault:true}})){
        const next=await tx.address.findFirst({where:{userId},orderBy:{updatedAt:'desc'}});
        if(next)await tx.address.update({where:{id:next.id},data:{isDefault:true}});
      }
      return {success:true};
    });
  }
  async cart(userId:string) {
    const rows=await this.db.cartItem.findMany({where:{userId},include:{sku:{include:{product:true}}},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:100});
    const showDemo = await demoContentVisible(this.db),promotions=await productPromotionHints(this.db,rows.map(r=>r.skuId));
    const items=rows.map(({sku,...row})=>{
      const visible=sku.product.status==='PUBLISHED'&&(showDemo||!sku.product.isDemo);
      const count=sku.stock-sku.reserved+Math.max(0,...promotions.filter(p=>p.skuId===sku.id).map(p=>p.remaining)),available=visible&&sku.product.type==='PHYSICAL'&&sku.active&&count>=row.quantity;
      return {id:row.id,quantity:row.quantity,skuId:row.skuId,sku:{...publicSku(sku),available:count},product:{id:sku.product.id,title:sku.product.title,cover:sku.product.cover,type:sku.product.type},available,subtotal:sku.price*row.quantity,unavailableReason:!visible?'商品已下架':sku.product.type!=='PHYSICAL'?'该商品不支持购物车':!sku.active?'规格已停用':!available?'库存不足':null};
    });
    return {items,total:items.filter(row=>row.available).reduce((sum,row)=>sum+row.subtotal,0),checkoutEnabled:false};
  }
  async setCart(userId:string,skuId:string,quantity:number) {
    return this.db.$transaction(async tx=>{
      await this.lockUser(tx,userId);
      const sku=await tx.productSku.findFirst({where:{id:skuId,active:true,product:{...await publicContentScope(this.db),type:'PHYSICAL'}},include:{product:true}});
      if(!sku)throw new NotFoundException('该商品规格不可购买');
      const hints=await productPromotionHints(tx,[sku.id]);if(sku.stock-sku.reserved+Math.max(0,...hints.map(p=>p.remaining))<quantity)throw new ConflictException('当前库存不足，请调整数量');
      const existing=await tx.cartItem.findUnique({where:{userId_skuId:{userId,skuId}}});
      if(!existing&&await tx.cartItem.count({where:{userId}})>=100)throw new BadRequestException('购物车最多100个规格');
      // Cart is a wish to purchase; inventory is reserved only by the order transaction.
      return tx.cartItem.upsert({where:{userId_skuId:{userId,skuId}},create:{userId,skuId,quantity},update:{quantity}});
    });
  }
  async removeCart(userId:string,id:string) {
    if(!(await this.db.cartItem.deleteMany({where:{id,userId}})).count)throw new NotFoundException('购物车记录不存在');
    return {success:true};
  }
  async products(query:TableQuery) {
    const where={...(query.status?{status:query.status}:{}),...(query.q?{title:{contains:query.q,mode:'insensitive' as const}}:{})};
    const [items,total]=await this.db.$transaction([this.db.product.findMany({where,include:{skus:{orderBy:{id:'asc'}}},orderBy:[{updatedAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size}),this.db.product.count({where})]);
    return {items,total};
  }
  async saveProduct(req:AuthRequest,dto:ProductDto|ProductEditDto,id?:string) {
    requireRoles(req,['OPERATOR']);
    const {expectedVersion:_,...data}=dto as ProductEditDto;
    return this.db.$transaction(async tx=>{
      if(id){const updated=await tx.product.updateMany({where:{id,version:(dto as ProductEditDto).expectedVersion,status:{in:['DRAFT','REJECTED']}},data:{...data,version:{increment:1}}});if(!updated.count)throw new ConflictException('商品版本或状态已变化，请刷新');}
      const row=id?await tx.product.findUniqueOrThrow({where:{id}}):await tx.product.create({data});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:id?'product.edit':'product.create',resource:'product',resourceId:row.id,changes:{title:row.title,version:row.version}}});
      return row;
    });
  }
  async sku(req:AuthRequest,productId:string,dto:SkuDto|SkuEditDto,id?:string) {
    requireRoles(req,['OPERATOR']);
    const {expectedVersion:_,reason,...data}=dto as SkuEditDto;
    return this.db.$transaction(async tx=>{
      const products=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;
      if(!products.length)throw new NotFoundException('商品不存在');
      const product=await tx.product.findUniqueOrThrow({where:{id:productId}});
      if(dto.serviceOfferingId){
        const offering=await tx.serviceOffering.findUnique({where:{id:dto.serviceOfferingId}}),teacher=offering?await tx.teacher.findFirst({where:{id:offering.teacherId,...await publicContentScope(tx)}}):null;
        if(product.type!=='SERVICE'||!offering?.active||!teacher)throw new BadRequestException('服务规格须绑定有效的统一服务及已发布名师');
      }
      if(product.type==='SERVICE'&&dto.stock!==0)throw new BadRequestException('服务库存来自统一时段，商品库存请保持为0');
      if(product.type==='SERVICE'&&dto.active&&!dto.serviceOfferingId)throw new BadRequestException('启用服务规格前请选择统一服务，不能另建时段库存');
      if(!id&&await tx.productSku.count({where:{productId}})>=50)throw new BadRequestException('每商品最多50个规格');
      const before=id?await tx.productSku.findFirst({where:{id,productId}}):null;
      if(id){const updated=await tx.productSku.updateMany({where:{id,productId,version:(dto as SkuEditDto).expectedVersion,reserved:{lte:dto.stock}},data:{...data,version:{increment:1}}});if(!updated.count)throw new ConflictException('规格版本已变化或库存小于预占数量');}
      const row=id?await tx.productSku.findUniqueOrThrow({where:{id}}):await tx.productSku.create({data:{...data,productId}});
      if(!before||before.stock!==row.stock)await tx.inventoryLedger.create({data:{skuId:row.id,stockDelta:BigInt(row.stock-(before?.stock??0)),reservedDelta:0n,reason:'MANUAL_ADJUSTMENT',eventKey:'product.manual:'+row.id+':'+row.version,actorId:req.actor.id,stockAfter:BigInt(row.stock),reservedAfter:BigInt(row.reserved)}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:id?'sku.edit':'sku.create',resource:'productSku',resourceId:row.id,changes:{...data,reason:reason.trim(),version:row.version,productId}}});
      return row;
    });
  }
  async transition(req:AuthRequest,id:string,dto:TransitionDto) {
    requireRoles(req,['publish','reject'].includes(dto.action)?['MODERATOR']:['OPERATOR']);
    if(!dto.reason.trim())throw new BadRequestException('请填写操作原因');
    const states={submit:[['DRAFT','REJECTED'],'REVIEW'],publish:[['REVIEW'],'PUBLISHED'],reject:[['REVIEW'],'REJECTED'],archive:[['PUBLISHED'],'ARCHIVED'],revise:[['ARCHIVED','REJECTED'],'DRAFT']} as const;
    const [from,to]=states[dto.action as keyof typeof states];
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${id} FOR UPDATE`;
      const row=await tx.product.findUnique({where:{id},include:{skus:true}});
      if(!row||row.version!==dto.expectedVersion||!(from as readonly string[]).includes(row.status))throw new ConflictException('商品状态或版本已变化');
      if(['submit','publish'].includes(dto.action)){
        await validateEvidencePublication(tx,id);
        if(row.type==='DIGITAL'){
  const release=row.skus.some(sku=>sku.active&&sku.digitalReleaseId)?await tx.digitalRelease.findFirst({where:{productId:id},orderBy:{releaseNo:'desc'}}):null;
  const files=release?await tx.digitalReleaseAsset.count({where:{releaseId:release.id}}):0;
  if(!release||!files)throw new BadRequestException('数字商品需先配置可售规格与资料包文件');
}else if(!row.skus.some(sku=>sku.active))throw new BadRequestException('请配置可售规格');
        if(row.type==='SERVICE')for(const sku of row.skus.filter(s=>s.active)){
          const service=sku.serviceOfferingId?await tx.serviceOffering.findUnique({where:{id:sku.serviceOfferingId}}):null;
          const offers=service?await tx.saleOffer.findMany({where:{serviceOfferingId:service.id,active:true,AND:[{OR:[{validFrom:null},{validFrom:{lte:new Date()}}]},{OR:[{validUntil:null},{validUntil:{gt:new Date()}}]}]}}):[];
          if(!service?.active||!await tx.teacher.findFirst({where:{id:service.teacherId,...await publicContentScope(tx)}})||offers.length!==1||offers[0]!.price!==BigInt(sku.price))throw new BadRequestException('服务商品须绑定开放的统一服务且价格一致；实际收费由预约订单开关控制');
        }
      }
      const result=await tx.product.update({where:{id},data:{status:to,version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'product.'+dto.action,resource:'product',resourceId:id,changes:{reason:dto.reason.trim(),version:result.version}}});
      return result;
    });
  }
}
@Controller('shopping') @UseGuards(UserGuard)
export class ShoppingController {
  constructor(private readonly shopping:ShoppingService){}
  @Get('addresses') addresses(@Req() req:AuthRequest){return this.shopping.addresses(req.actor.id);}
  @Post('addresses') address(@Req() req:AuthRequest,@Body() dto:AddressDto){return this.shopping.address(req.actor.id,dto);}
  @Patch('addresses/:id') editAddress(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:AddressDto){return this.shopping.address(req.actor.id,dto,id);}
  @Delete('addresses/:id') deleteAddress(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.shopping.removeAddress(req.actor.id,id);}
  @Get('cart') cart(@Req() req:AuthRequest){return this.shopping.cart(req.actor.id);}
  @Put('cart/:skuId') setCart(@Req() req:AuthRequest,@Param('skuId',ParseUUIDPipe) id:string,@Body() dto:QuantityDto){return this.shopping.setCart(req.actor.id,id,dto.quantity);}
  @Delete('cart/:id') deleteCart(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.shopping.removeCart(req.actor.id,id);}
}
@Controller('admin') @UseGuards(AdminGuard)
export class ShoppingAdminController {
  constructor(private readonly shopping:ShoppingService,private readonly db:Database){}
  @Get('products') products(@Req() req:AuthRequest,@Query() query:TableQuery){requireRoles(req,['OPERATOR','MODERATOR']);return this.shopping.products(query);}
  @Get('products/service-offerings') async offerings(@Req() req:AuthRequest){requireRoles(req,['OPERATOR','MODERATOR']);return this.db.serviceOffering.findMany({where:{active:true},select:{id:true,title:true,teacherId:true,mode:true,durationMinutes:true},orderBy:{title:'asc'},take:100});}
  @Get('products/:id') async detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){requireRoles(req,['OPERATOR','MODERATOR']);const row=await this.db.product.findUnique({where:{id},include:{skus:{orderBy:{id:'asc'}}}});if(!row)throw new NotFoundException('商品不存在');return row;}
  @Post('products') product(@Req() req:AuthRequest,@Body() dto:ProductDto){return this.shopping.saveProduct(req,dto);}
  @Patch('products/:id') editProduct(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ProductEditDto){return this.shopping.saveProduct(req,dto,id);}
  @Post('products/:id/skus') sku(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SkuDto){return this.shopping.sku(req,id,dto);}
  @Patch('products/:productId/skus/:id') editSku(@Req() req:AuthRequest,@Param('productId',ParseUUIDPipe) productId:string,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SkuEditDto){return this.shopping.sku(req,productId,dto,id);}
  @Post('products/:id/transition') transition(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:TransitionDto){return this.shopping.transition(req,id,dto);}
  @Get('products/:id/audit') audit(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){requireRoles(req,['OPERATOR','MODERATOR']);return this.db.auditLog.findMany({where:{OR:[{resource:'product',resourceId:id},{resource:'productSku',changes:{path:['productId'],equals:id}}]},orderBy:{createdAt:'desc'},take:100});}
}
