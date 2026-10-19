import {ConflictException} from '@nestjs/common';
import {Prisma} from './generated/prisma/client.js';
export const pointsDay=(at=new Date())=>new Date(new Date(+at+8*3600000).toISOString().slice(0,10)+'T00:00:00Z');
// The caller owns the User lock (or its fulfilment lock); acquire the account last.
export async function changePoints(tx:Prisma.TransactionClient,userId:string,delta:bigint,eventKey:string,reason:string,source:{orderItemId?:string;resourceId?:string;reversalOfId?:string;ruleSnapshot:Prisma.InputJsonValue;businessDay?:Date}){
 if(delta===0n)throw new ConflictException('积分变动不能为空');
 await tx.pointsAccount.upsert({where:{userId},create:{userId},update:{}});
 await tx.$queryRaw`SELECT id FROM "PointsAccount" WHERE "userId"=${userId} FOR UPDATE`;
 const account=await tx.pointsAccount.findUniqueOrThrow({where:{userId}}),old=await tx.pointsLedger.findUnique({where:{eventKey}});
 if(old){if(old.accountId!==account.id||old.delta-old.debtDelta!==delta||old.reversalOfId!==(source.reversalOfId??null)||old.resourceId!==(source.resourceId??null)||old.orderItemId!==(source.orderItemId??null))throw new ConflictException('积分编号已用于其他变动');return old;}
 if(source.reversalOfId){const original=await tx.pointsLedger.findUnique({where:{id:source.reversalOfId}});if(!original||original.accountId!==account.id||original.delta-original.debtDelta!==-delta||await tx.pointsLedger.findUnique({where:{reversalOfId:original.id}}))throw new ConflictException('积分原始来源不可重复或跨账号冲回');}
 const available=account.balance-account.reserved,offset=delta>0n?(delta+available<account.debt?delta+available:account.debt):(-delta<available?-delta:available);
 const balanceDelta=delta>0n?delta-offset:-offset,debtDelta=delta>0n?-offset:-delta-offset,balance=account.balance+balanceDelta,debt=account.debt+debtDelta;
 await tx.pointsAccount.update({where:{id:account.id},data:{balance,debt,version:{increment:1},updatedAt:new Date()}});
 return tx.pointsLedger.create({data:{accountId:account.id,eventKey,delta:balanceDelta,debtDelta,debtAfter:debt,balanceAfter:balance,reason,...source,businessDay:source.businessDay??pointsDay()}});
}
// All callers hold the owning SKU/offering lock before the reward/account locks.
export async function returnRedemptionPoints(tx:Prisma.TransactionClient,id:string,actorId:string,reason:string){
 await tx.$queryRaw`SELECT id FROM "PointsRedemption" WHERE id=${id} FOR UPDATE`;
 const row=await tx.pointsRedemption.findUniqueOrThrow({where:{id}});if(row.state==='REFUNDED')return;
 if(!['FULFILLING','COMPLETED','RETURN_REQUESTED'].includes(row.state))throw new ConflictException('兑换状态已变化');
 await tx.$queryRaw`SELECT id FROM "PointsReward" WHERE id=${row.rewardId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "PointsAccount" WHERE "userId"=${row.userId} FOR UPDATE`;
 const debit=await tx.pointsLedger.findUniqueOrThrow({where:{eventKey:'points.redeem:'+id}});
 await changePoints(tx,row.userId,row.pointsCost,'points.return:'+id,reason,{orderItemId:debit.orderItemId??undefined,ruleSnapshot:{redemptionId:id,returnOf:debit.id},reversalOfId:debit.id});
 await tx.pointsReward.update({where:{id:row.rewardId},data:{stock:{increment:1},version:{increment:1},updatedAt:new Date()}});
 await tx.pointsReservation.updateMany({where:{redemptionId:id,state:'CONSUMED'},data:{state:'RELEASED',version:{increment:1},updatedAt:new Date()}});
 await tx.pointsRedemption.update({where:{id},data:{state:'REFUNDED',completedAt:new Date(),version:{increment:1},updatedAt:new Date()}});
 if(row.orderId){await tx.tradeOrder.update({where:{id:row.orderId},data:{state:'CLOSED',closedAt:new Date(),closeReason:'POINTS_RETURNED',version:{increment:1}}});await tx.tradeOrderItem.updateMany({where:{orderId:row.orderId},data:{state:'REFUNDED'}});}
 await tx.auditLog.create({data:{actorId,action:'points.redemption.return',resource:'points_redemption',resourceId:id,reason,changes:{points:String(row.pointsCost)}}});
}
export async function syncPointsAppointment(tx:Prisma.TransactionClient,appointmentId:string,actorId:string){
 const redemption=await tx.pointsRedemption.findUnique({where:{appointmentId}});if(!redemption||redemption.state==='REFUNDED')return;
 const appointment=await tx.appointment.findUniqueOrThrow({where:{id:appointmentId}});
 if(appointment.state==='CANCELLED')return returnRedemptionPoints(tx,redemption.id,actorId,'积分咨询预约取消，原路退回积分');
 if(['COMPLETED','NO_SHOW'].includes(appointment.state)&&redemption.state==='FULFILLING'){
  await tx.pointsRedemption.update({where:{id:redemption.id},data:{state:'COMPLETED',completedAt:new Date(),version:{increment:1},updatedAt:new Date()}});
  if(redemption.orderId)await tx.tradeOrder.update({where:{id:redemption.orderId},data:{state:'COMPLETED',completedAt:new Date(),version:{increment:1}}});
 }
}
