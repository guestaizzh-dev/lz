import {createHash} from 'node:crypto';
import type {Database} from './database.js';
import type {Prisma} from './generated/prisma/client.js';
export function appleRefundCycle(fact:{revokedAt?:Date|string|null;revocationType?:string|null;revocationPercentage?:number|null}){
  return createHash('sha256').update(JSON.stringify([fact.revokedAt?new Date(fact.revokedAt).toISOString():null,fact.revocationType??null,fact.revocationPercentage??null])).digest('hex');
}
export async function reviewedAppleRefund(store:Database|Prisma.TransactionClient,receiptId:string,fact:Parameters<typeof appleRefundCycle>[0]){
  const row=await store.appleRefundReview.findFirst({where:{receiptId,cycleHash:appleRefundCycle(fact),state:'CONFIRMED'}});if(!row?.refundId)return false;
  const refund=await store.refund.findUnique({where:{id:row.refundId}});return refund?.state==='SUCCEEDED'&&refund.approvedAmount===row.amount;
}
