import {ConflictException} from '@nestjs/common';
import type {Prisma} from './generated/prisma/client.js';
import type {Database} from './database.js';
type Tx=Prisma.TransactionClient;
export async function serviceDeliverySummary(store:Database|Tx,orderId:string){const row=await store.serviceDelivery.findFirst({where:{orderId,state:'APPROVED'},orderBy:{revision:'desc'},select:{id:true,revision:true,outcome:true,deliveredUnits:true,totalUnits:true,publicSummary:true,reviewedAt:true,contextSnapshot:true}});if(!row)return null;const{contextSnapshot,...value}=row,unitLabel=(contextSnapshot as {unitLabel?:string}).unitLabel;return{...value,unitLabel:['分钟','人','节'].includes(unitLabel??'')?unitLabel:'份'};}
export function serviceAccounts(kind:string){if(!['CONSULTATION','EVENT','COHORT'].includes(kind))throw new ConflictException('订单不属于付费服务');const prefix=kind==='COHORT'?'COHORT':'BOOKING';return{advance:prefix+'_ADVANCE',revenue:prefix+'_REVENUE'};}
export async function serviceBalances(tx:Tx,orderId:string,kind:string){
 const codes=serviceAccounts(kind),rows=await tx.$queryRaw<{code:string;balance:bigint}[]>`SELECT e."accountCode" AS code,COALESCE(sum(e.credit-e.debit),0)::bigint AS balance FROM "FinanceEntry" e JOIN "FinanceJournal" j ON j.id=e."journalId" WHERE j."orderId"=${orderId} AND e."accountCode" IN (${codes.advance},${codes.revenue}) GROUP BY e."accountCode"`;
 const advance=rows.find(r=>r.code===codes.advance)?.balance??0n,revenue=rows.find(r=>r.code===codes.revenue)?.balance??0n;
 if(advance<0n||revenue<0n)throw new ConflictException('预收或收入账务为负，请先核查财务事实');return{advance,revenue};
}
// The owning transaction holds User then TradeOrder locks before posting.
export async function serviceRefundEntries(tx:Tx,order:{id:string;userId:string;kind:string},journalId:string,receivable:string,amount:bigint){
 const balances=await serviceBalances(tx,order.id,order.kind),codes=serviceAccounts(order.kind);
 if(amount<=0n||amount>balances.advance+balances.revenue)throw new ConflictException('退款超过原有效收款账务，请核查');
 const liability=amount<balances.advance?amount:balances.advance,revenue=amount-liability;
 await tx.financeEntry.createMany({data:[...(liability?[{journalId,accountCode:codes.advance,debit:liability,userId:order.userId}]:[]),...(revenue?[{journalId,accountCode:codes.revenue,debit:revenue,userId:order.userId}]:[]),{journalId,accountCode:receivable,credit:amount,userId:order.userId}]});
}
