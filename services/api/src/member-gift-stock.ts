import {ConflictException} from '@nestjs/common';
import type {Prisma} from './generated/prisma/client.js';
import type {Database} from './database.js';
type Tx=Prisma.TransactionClient;
export async function versionGiftPool(tx:Database|Tx,versionId:string|null){
 if(!versionId)return null;const d=await tx.benefitDefinition.findUnique({where:{code:'SIGNED_GIFT'}});if(!d?.active)return null;
 const b=await tx.planBenefit.findFirst({where:{planVersionId:versionId,definitionId:d.id}});if(!b)return null;
 const poolId=(b.parameters as {poolId?:string}).poolId;if(!poolId||b.quota!==1||b.periodKind!=='MEMBERSHIP')throw new ConflictException('签名商品权益版本配置异常');return poolId;
}
export async function lockGiftPool(tx:Tx,id:string){const initial=await tx.memberGiftPool.findUniqueOrThrow({where:{id}});await tx.$queryRaw`SELECT id FROM "ProductSku" WHERE id=${initial.skuId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "MemberGiftPool" WHERE id=${id} FOR UPDATE`;return tx.memberGiftPool.findUniqueOrThrow({where:{id}});}
// Purchase reservations guarantee the physical entitlement before any channel is opened.
export async function holdMemberGift(tx:Tx,userId:string,versionId:string|null,orderItemId:string,expiresAt:Date){
 const poolId=await versionGiftPool(tx,versionId);if(!poolId)return;const old=await tx.memberGiftAllocation.findUnique({where:{orderItemId}});if(old){if(old.poolId!==poolId||old.state==='RELEASED')throw new ConflictException('原签名商品预留已释放，请重新下单');return;}
 const pool=await lockGiftPool(tx,poolId);if(pool.state!=='OPEN'||pool.capacity-pool.allocated-pool.released<1)throw new ConflictException('本会员版本的签名商品份额已售罄，请选择其他套餐或等待补货');
 await tx.memberGiftAllocation.create({data:{poolId,userId,sourceKey:'item:'+orderItemId,orderItemId,expiresAt,state:'HELD'}});await tx.memberGiftPool.update({where:{id:poolId},data:{allocated:{increment:1},version:{increment:1},updatedAt:new Date()}});
}
export async function memberGiftReady(tx:Tx,itemId:string,versionId:string|null){const poolId=await versionGiftPool(tx,versionId);if(!poolId)return true;return !!await tx.memberGiftAllocation.findFirst({where:{orderItemId:itemId,poolId,state:'HELD'}});}
export async function activateMemberGift(tx:Tx,membershipId:string){
 const m=await tx.membership.findUniqueOrThrow({where:{id:membershipId}}),poolId=await versionGiftPool(tx,m.planVersionId);if(!poolId)return;
 const existing=await tx.memberGiftAllocation.findUnique({where:{membershipId}});if(existing)return;
 const pool=await lockGiftPool(tx,poolId),held=m.orderItemId?await tx.memberGiftAllocation.findUnique({where:{orderItemId:m.orderItemId}}):null;
 if(held){if(held.poolId!==poolId||held.state!=='HELD')throw new ConflictException('签名商品预留来源不一致');await tx.memberGiftAllocation.update({where:{id:held.id},data:{membershipId,state:'AVAILABLE',expiresAt:m.endsAt,version:{increment:1},updatedAt:new Date()}});}
 else{if(pool.state!=='OPEN'||pool.capacity-pool.allocated-pool.released<1)throw new ConflictException('该会员版本的签名商品已无实际库存，不能继续发放此版本');await tx.memberGiftAllocation.create({data:{poolId,userId:m.userId,membershipId,sourceKey:'period:'+membershipId,expiresAt:m.endsAt,state:'AVAILABLE'}});await tx.memberGiftPool.update({where:{id:poolId},data:{allocated:{increment:1},version:{increment:1},updatedAt:new Date()}});}
}
export async function releaseMemberGift(tx:Tx,id:string,actorId:string,reason:string){
 const row=await tx.memberGiftAllocation.findUniqueOrThrow({where:{id}});if(!['HELD','AVAILABLE'].includes(row.state))return;
 const pool=await lockGiftPool(tx,row.poolId);await tx.memberGiftAllocation.update({where:{id},data:{state:'RELEASED',version:{increment:1},updatedAt:new Date()}});
 await tx.memberGiftPool.update({where:{id:pool.id},data:{allocated:{decrement:1},...(pool.state==='CLOSED'?{released:{increment:1}}:{}),version:{increment:1},updatedAt:new Date()}});
 if(pool.state==='CLOSED'){const sku=await tx.productSku.update({where:{id:pool.skuId},data:{reserved:{decrement:1},version:{increment:1}}});await tx.inventoryLedger.create({data:{skuId:sku.id,stockDelta:0n,reservedDelta:-1n,reason:'MEMBER_GIFT_RELEASE',eventKey:'member.gift.release:'+id,actorId,stockAfter:BigInt(sku.stock),reservedAfter:BigInt(sku.reserved)}});}
 await tx.auditLog.create({data:{actorId,action:'member.gift.release',resource:'member_gift_allocation',resourceId:id,reason,changes:{poolId:pool.id}}});
}
export async function releaseOrderGifts(tx:Tx,orderId:string,actorId:string){const items=await tx.tradeOrderItem.findMany({where:{orderId},select:{id:true}});for(const a of await tx.memberGiftAllocation.findMany({where:{orderItemId:{in:items.map(i=>i.id)},state:'HELD'}}))await releaseMemberGift(tx,a.id,actorId,'原会员订单已关闭，释放未付款签名商品份额');}
