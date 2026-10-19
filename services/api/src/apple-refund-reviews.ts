import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Injectable,NotFoundException,Param,ParseUUIDPipe,Post,Query,Req,UploadedFile,UseGuards,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {IsIn,IsInt,IsString,IsUUID,Length,Matches,Max,Min,IsOptional} from 'class-validator';
import {Type,Transform} from 'class-transformer';
import {createHash} from 'node:crypto';
import {AdminGuard,requireRoles,type AuthRequest} from './auth.js';
import {Database} from './database.js';
import {MediaService} from './media.js';
import {AppleCommerceService} from './apple-commerce.js';
import {appleRefundCycle} from './apple-refund-state.js';
import type {Prisma} from './generated/prisma/client.js';
const safe=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
class ProposalDto {
  @IsUUID() requestKey!:string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) cycleHash!:string;
  @IsInt() @Min(1) @Max(100000000) amount!:number;
  @IsUUID() proofAssetId!:string;
  @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(4,120) @Matches(/\S/) reference!:string;
  @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(10,1000) @Matches(/\S/) note!:string;
}
class DecisionDto {@IsIn(['CONFIRM','REJECT']) action!:string;@IsInt() @Min(1) expectedVersion!:number;@Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(2,500) @Matches(/\S/) reason!:string;}
class ReviewPage {@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;}
type Tx=Prisma.TransactionClient;
@Injectable()
export class AppleRefundReviews {
  constructor(private readonly db:Database,private readonly apple:AppleCommerceService){}
  private async source(tx:Database|Tx,id:string){
    const receipt=await tx.appleTransactionState.findUnique({where:{id}});if(!receipt)throw new NotFoundException('Apple交易不存在');
    const facts=receipt.facts as {revokedAt:string|null;revocationType:string|null;revocationPercentage:number|null;amount:string};
    const payment=receipt.paymentId?await tx.paymentTransaction.findUnique({where:{id:receipt.paymentId}}):null;
    const order=payment?await tx.tradeOrder.findUnique({where:{id:payment.orderId}}):null;
    const eligible=receipt.issueCode!=='REFUND_CYCLE_CONFLICT'&&!!receipt.revokedAt&&facts.revocationType==='REFUND_PRORATED'&&!!payment&&payment.channel==='APPLE_IAP'&&payment.currency==='CNY'&&['COURSE','MEMBERSHIP'].includes(order?.kind??'');
    return{receipt,facts,payment,order,eligible,cycleHash:appleRefundCycle(facts)};
  }
  private async lock(tx:Tx,id:string){
    const original=await this.source(tx,id);
    if(original.order)await tx.$queryRaw`SELECT id FROM "User" WHERE id=${original.order.userId} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${original.receipt.appScope+':'+original.receipt.originalTransactionId},0))`;
    return this.source(tx,id);
  }
  private async proof(tx:Database|Tx,id:string,owner?:string){
    const asset=await tx.mediaAsset.findFirst({where:{id,status:'READY',visibility:'PRIVATE',...(owner?{uploaderId:owner}:{}),variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}});
    if(!asset||!['application/pdf','image/png','image/jpeg','image/webp'].includes(asset.mime)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw new BadRequestException('请上传本人可核验的Apple私有退款凭证（PDF或图片）');return asset;
  }
  async context(id:string,req:AuthRequest,page:ReviewPage){
    requireRoles(req,['FINANCE']);const src=await this.source(this.db,id),where={receiptId:id};
    const [rows,total]=await this.db.$transaction([this.db.appleRefundReview.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page.page-1)*page.size,take:page.size}),this.db.appleRefundReview.count({where})]);
    const ids=rows.flatMap(r=>r.refundId?[r.refundId]:[]),refunds=await this.db.refund.findMany({where:{id:{in:ids}},select:{id:true,state:true}});
    const pending=await this.db.appleRefundReview.count({where:{receiptId:id,cycleHash:src.cycleHash,state:'PENDING'}}),refunded=src.payment?await this.db.refund.count({where:{paymentTransactionId:src.payment.id,state:'SUCCEEDED'}}):0;
    return safe({receiptId:id,transactionId:src.receipt.transactionId,appScope:src.receipt.appScope,state:src.receipt.state,issueCode:src.receipt.issueCode,cycleHash:src.cycleHash,revokedAt:src.receipt.revokedAt,revocationType:src.facts.revocationType,revocationPercentage:src.facts.revocationPercentage,originalAmount:src.payment?.amount??null,currency:'CNY',orderId:src.order?.id??null,orderNo:src.order?.orderNo??null,kind:src.order?.kind??null,lastCheckedAt:src.receipt.lastCheckedAt,
      canSubmit:src.eligible&&!pending&&!refunded,unavailableReason:!src.eligible?'本工具只处理已验签撤销的课程或固定期会员比例退款；礼物及自动续费不在本工具范围。':pending?'本次退款已有待复核记录，请先处理。':refunded?'已有已入账退款，请查看原记录；再次更正须核查渠道新事实。':'',
      reviews:{total,items:rows.map(r=>({...r,refundState:refunds.find(f=>f.id===r.refundId)?.state??null,currentCycle:r.cycleHash===src.cycleHash,canConfirm:r.state==='PENDING'&&r.cycleHash===src.cycleHash&&src.eligible&&r.submittedBy!==req.actor.id,own:r.submittedBy===req.actor.id}))}});
  }
  async submit(id:string,req:AuthRequest,dto:ProposalDto){
    requireRoles(req,['FINANCE']);const requestHash=hash({receiptId:id,cycleHash:dto.cycleHash,amount:dto.amount,proofAssetId:dto.proofAssetId,reference:dto.reference.trim(),note:dto.note.trim()});
    return this.db.$transaction(async tx=>{
      const src=await this.lock(tx,id),prior=await tx.appleRefundReview.findUnique({where:{submittedBy_requestKey:{submittedBy:req.actor.id,requestKey:dto.requestKey}}});
      if(prior){if(prior.requestHash!==requestHash)throw new ConflictException('同一提交编号的内容不可变化');return safe(prior);}
      if(!src.eligible||!src.payment||!src.order||src.receipt.queryFailureCode||src.receipt.lastCheckedAt<new Date(Date.now()-15*60000))throw new ConflictException('请先向Apple核实最新比例退款事实，再提交实际金额核查');
      if(src.cycleHash!==dto.cycleHash)throw new ConflictException('Apple退款事实已变化，请刷新核查页面');
      if(BigInt(dto.amount)>src.payment.amount||await tx.refund.count({where:{paymentTransactionId:src.payment.id,state:'SUCCEEDED'}}))throw new ConflictException('退款不得超过实收；已有退款须先核对原记录');
      if(await tx.appleRefundReview.count({where:{receiptId:id,cycleHash:src.cycleHash,state:'PENDING'}}))throw new ConflictException('本次退款已有待复核记录，请勿重复提交');
      const asset=await this.proof(tx,dto.proofAssetId,req.actor.id);
      const row=await tx.appleRefundReview.create({data:{receiptId:id,paymentId:src.payment.id,cycleHash:src.cycleHash,amount:BigInt(dto.amount),proofAssetId:asset.id,proofHash:asset.sha256,reference:dto.reference.trim(),note:dto.note.trim(),submittedBy:req.actor.id,requestKey:dto.requestKey,requestHash}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'apple.refund.review.submit',resource:'apple_refund_review',resourceId:row.id,reason:'提交Apple实际退款金额与私有凭证，待另一位财务复核',changes:{receiptId:id,amount:String(row.amount),proofAssetId:asset.id,proofHash:asset.sha256,cycleHash:src.cycleHash}}});return safe(row);
    });
  }
  async decide(id:string,req:AuthRequest,dto:DecisionDto){
    requireRoles(req,['FINANCE']);const initial=await this.db.appleRefundReview.findUnique({where:{id}});if(!initial)throw new NotFoundException('核查记录不存在');
    if(initial.state==='PENDING'&&dto.action==='CONFIRM')await this.apple.refresh(initial.receiptId);
    return this.db.$transaction(async tx=>{
      const src=await this.lock(tx,initial.receiptId),row=await tx.appleRefundReview.findUniqueOrThrow({where:{id}});
      if(row.state!=='PENDING'){if(row.state===(dto.action==='CONFIRM'?'CONFIRMED':'REJECTED'))return safe(row);throw new ConflictException('核查记录已处理');}
      if(row.version!==dto.expectedVersion)throw new ConflictException('核查记录已变化，请刷新');
      if(dto.action==='REJECT'){const updated=await tx.appleRefundReview.update({where:{id},data:{state:'REJECTED',reviewedBy:req.actor.id,reviewedAt:new Date(),reviewNote:dto.reason.trim(),version:{increment:1}}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'apple.refund.review.reject',resource:'apple_refund_review',resourceId:id,reason:dto.reason.trim(),changes:{receiptId:src.receipt.id}}});return safe(updated);}
      if(row.submittedBy===req.actor.id)throw new ForbiddenException('提交人与确认入账人必须不同，请由另一位财务复核');
      if(!src.eligible||src.cycleHash!==row.cycleHash||!src.payment||!src.order||src.payment.id!==row.paymentId)throw new ConflictException('退款已撤回或事实已变化，请驳回此记录后重新核查');
      const proof=await this.proof(tx,row.proofAssetId);if(proof.sha256!==row.proofHash)throw new ConflictException('原始凭证已变化，请重新核查');
      if(await tx.refund.count({where:{paymentTransactionId:row.paymentId,state:'SUCCEEDED'}}))throw new ConflictException('该笔交易已有已入账退款');
      const item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:src.order.id}});if(row.amount>src.payment.amount||src.order.refundedTotal+row.amount>src.order.paidTotal||item.refundedAmount+row.amount>item.payable)throw new ConflictException('核查金额超出实际可记退款范围');
      const member=src.order.kind==='MEMBERSHIP',prefix=member?'membership':'course';
      const refund=await tx.refund.create({data:{orderId:src.order.id,userId:src.order.userId,requestKey:'apple.review:'+id,kind:'REFUND_ONLY',state:'SUCCEEDED',requestedAmount:row.amount,approvedAmount:row.amount,reasonCode:'APPLE_REVOKED',description:'Apple已撤销购买；实际退款金额经私有渠道凭证及双人财务复核入账，非按比例估算。',paymentTransactionId:src.payment.id,succeededAt:src.receipt.revokedAt!,assessmentSnapshot:{source:'MANUAL_APPLE_REPORT',reviewId:id,proofAssetId:row.proofAssetId,proofHash:row.proofHash,cycleHash:row.cycleHash,submittedBy:row.submittedBy,reviewedBy:req.actor.id}}});
      await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount:row.amount,revokeQuantity:src.payment.disposition==='ACCEPTED'?1:0}});
      await tx.refundTransaction.create({data:{refundId:refund.id,paymentTransactionId:src.payment.id,channel:'APPLE_IAP',appScope:src.receipt.appScope,externalRefundId:'revocation:'+src.receipt.transactionId+':'+src.receipt.revokedAt!.getTime(),amount:row.amount,currency:'CNY',verifiedAt:new Date(),succeededAt:src.receipt.revokedAt!,receiptHash:hash({cycle:row.cycleHash,review:id,proof:row.proofHash})}});
      const journal=await tx.financeJournal.create({data:{eventKey:prefix+'.refunded:'+refund.id,kind:member?'MEMBERSHIP_REFUND':'COURSE_REFUND',orderId:src.order.id,transactionId:src.payment.id,refundId:refund.id,currency:'CNY',postedAt:new Date(),description:'Apple退款金额经双人凭证核查确认'}}),income=src.payment.disposition==='ACCEPTED'?(member?'MEMBERSHIP_REVENUE':'COURSE_REVENUE'):(member?'MEMBERSHIP_REFUND_PAYABLE':'COURSE_REFUND_PAYABLE');
      await tx.financeEntry.createMany({data:[{journalId:journal.id,accountCode:income,debit:row.amount,userId:src.order.userId},{journalId:journal.id,accountCode:'APPLE_RECEIVABLE',credit:row.amount,userId:src.order.userId}]});
      await tx.tradeOrder.update({where:{id:src.order.id},data:{refundedTotal:{increment:row.amount},version:{increment:1}}});await tx.tradeOrderItem.update({where:{id:item.id},data:{refundedAmount:{increment:row.amount},state:'REFUNDED'}});
      const updated=await tx.appleRefundReview.update({where:{id},data:{state:'CONFIRMED',refundId:refund.id,reviewedBy:req.actor.id,reviewedAt:new Date(),reviewNote:dto.reason.trim(),version:{increment:1}}});
      await tx.appleTransactionState.update({where:{id:src.receipt.id},data:{state:'REVOKED',issueCode:null}});
      await tx.notification.create({data:{userId:src.order.userId,kind:member?'MEMBERSHIP_ORDER':'COURSE_ORDER',orderId:src.order.id,eventKey:'apple.refund.review:'+id,title:'Apple退款金额已核对',body:'本笔实际退款金额已根据Apple凭证核对并记入原订单；是否到账仍以Apple及银行记录为准。'}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'apple.refund.review.confirm',resource:'apple_refund_review',resourceId:id,reason:dto.reason.trim(),changes:{receiptId:src.receipt.id,refundId:refund.id,amount:String(row.amount),proofAssetId:row.proofAssetId,submittedBy:row.submittedBy}}});return safe(updated);
    });
  }
}
@Controller('admin/apple-transactions') @UseGuards(AdminGuard)
export class AppleRefundReviewsController {
  constructor(private readonly reviews:AppleRefundReviews,private readonly media:MediaService){}
  @Get(':id/refund-review') context(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() q:ReviewPage){return this.reviews.context(id,req,q);}
  @Post(':id/refund-review') submit(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ProposalDto){return this.reviews.submit(id,req,dto);}
  @Post('refund-reviews/:id/decision') decide(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:DecisionDto){return this.reviews.decide(id,req,dto);}
  @Post('refund-review-proof') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024}})) upload(@Req() req:AuthRequest,@UploadedFile() file:{originalname:string;mimetype:string;size:number;buffer:Buffer}){requireRoles(req,['FINANCE']);return this.media.upload(req,file,true,'EVIDENCE_FILE');}
  @Post('refund-reviews/:id/proof') proof(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){requireRoles(req,['FINANCE']);return this.media.referralProofTicket('apple-refund-review',id,req);}
}
