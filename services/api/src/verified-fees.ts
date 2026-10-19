import {BadRequestException,ConflictException} from '@nestjs/common';
import {Prisma,type PaymentTransaction} from './generated/prisma/client.js';
// Verification evidence is recorded by the owning workflow; the money journal is shared per receipt.
export async function postVerifiedChannelFee(tx:Prisma.TransactionClient,payment:PaymentTransaction,fee:bigint){
 if(fee<0n||fee>payment.amount)throw new BadRequestException('手续费超出原收款范围');
 const eventKey='channel.verified.fee:'+payment.id,old=await tx.financeJournal.findUnique({where:{eventKey}});
 if(old){const entry=await tx.financeEntry.findFirst({where:{journalId:old.id,accountCode:'CHANNEL_FEE_EXPENSE'}});if(entry?.debit!==fee)throw new ConflictException('该收款已有不同的费用核对事实，请走财务差异处理');return;}
 if(fee===0n)return;
 const account=payment.channel==='WECHAT_APP'?'WECHAT_RECEIVABLE':payment.channel==='ALIPAY_APP'?'ALIPAY_RECEIVABLE':null;
 if(!account)throw new BadRequestException('当前渠道费用须通过其专用账单处理');
 const journal=await tx.financeJournal.create({data:{eventKey,kind:'VERIFIED_CHANNEL_FEE',orderId:payment.orderId,transactionId:payment.id,currency:payment.currency,postedAt:new Date(),description:'财务核对原渠道账单手续费，不重写支付原始事实'}});
 await tx.financeEntry.createMany({data:[{journalId:journal.id,accountCode:'CHANNEL_FEE_EXPENSE',debit:fee},{journalId:journal.id,accountCode:account,credit:fee}]});
}
