import {queueAppleRevoke} from './social-auth.js';
import {NoteExportQuery,exportPrivateNotes} from './note-export.js';
import {BookingSalesService} from './booking-sales.js';
import {CohortSalesService} from './cohort-sales.js';
import { encryptPrivate, decryptPrivate } from './private-data.js';
import { demoScope } from './public-content.js';
import { BadRequestException, ConflictException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { UserGuard } from './auth.js';
import type { AuthRequest } from './auth.js';
import { Database } from './database.js';
import { LearningService } from './learning.js';
import { OrdersService } from './orders.js';
import {releaseMemberGift} from './member-gift-stock.js';
import { MembershipSalesService } from './membership-sales.js';
import { CourseSalesService } from './course-sales.js';
import { ProductSalesService } from './product-sales.js';
import { Prisma } from './generated/prisma/client.js';

class PageQuery {
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
}
function paging(query: PageQuery) { return { take: query.size + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] }; }
function page<T extends { id: string }>(items: T[], size: number) { return { items: items.slice(0, size), nextCursor: items.length > size ? items[size - 1]!.id : null }; }
class NoteRangeDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,80}$/) blockId!: string;
  @IsInt() @Min(0) rangeStart!: number;
  @IsInt() @Min(1) rangeEnd!: number;
}
class NoteDto {
  @IsUUID() articleId!: string;
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,80}$/) blockId!: string;
  @IsString() @Length(0, 10000) text!: string;
  @IsOptional() @IsInt() @Min(1) articleVersion?: number;
  @IsOptional() @IsInt() @Min(0) rangeStart?: number;
  @IsOptional() @IsInt() @Min(1) rangeEnd?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => NoteRangeDto) ranges?: NoteRangeDto[];
}
class NoteTextDto { @IsString() @Length(0, 10000) text!: string; }
class TextDto { @IsString() @Length(1, 10000) text!: string; }
class PracticeDto extends TextDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) day!: string;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}
class TagsDto {
  @IsArray() @ArrayMaxSize(8) @IsIn(['经典研习', '实践修行', '生活应用', '少儿启蒙', '名师解读', '文创', '养生交流', '线下活动'], { each: true }) tags!: string[];
}
class CloseAccountDto {
  @IsIn(['确认注销']) confirmation!: string;
  @IsOptional() @IsBoolean() forfeitPaidAccess?: boolean;
}
class ProfileDto {
  @IsString() @Length(1,30) @Matches(/\S/) nickname!:string;
  @IsOptional() @IsUUID() avatarAssetId?:string|null;
  @IsInt() @Min(1) expectedVersion!:number;
}
@Controller('me') @UseGuards(UserGuard)
export class PersonalController {
  constructor(private readonly db: Database, private readonly learning: LearningService, private readonly orders: OrdersService, private readonly sales: CourseSalesService, private readonly memberships: MembershipSalesService, private readonly productSales:ProductSalesService,private readonly bookingSales:BookingSalesService,private readonly cohortSales:CohortSalesService) {}
  private async closureStatus(userId: string, store: Database | Prisma.TransactionClient = this.db) {
    const [pendingOrders, pendingRefunds, unresolvedPaidOrders, paidCourses, paidMemberships, pendingBookings, giftWallet,commissionOpen] = await Promise.all([
      store.tradeOrder.count({ where: { userId, state: 'PENDING' } }),
      store.$queryRaw<{count:number}[]>`SELECT ((SELECT count(*) FROM "Refund" WHERE "userId"=${userId} AND state NOT IN ('SUCCEEDED','REVERSED','REJECTED','CANCELLED'))+(SELECT count(*) FROM "MemberGiftClaim" WHERE "userId"=${userId} AND state IN ('FULFILLING','RETURN_REQUESTED','RETURN_APPROVED','RETURN_SHIPPED'))+(SELECT count(*) FROM "PointsRedemption" WHERE "userId"=${userId} AND state IN ('FULFILLING','RETURN_REQUESTED','RETURN_APPROVED','RETURN_SHIPPED')))::int AS count`.then(rows=>rows[0]?.count??0),
      store.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM "TradeOrder" WHERE "userId"=${userId} AND "paidTotal">"refundedTotal" AND (state NOT IN ('COMPLETED','CLOSED') OR kind NOT IN ('COURSE','MEMBERSHIP','PHYSICAL','GIFT','OPERATING_SERVICE'))`,
      store.enrollment.count({ where: { userId, source: 'PURCHASE', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      store.membership.count({where:{userId,source:'PURCHASE',revokedAt:null,endsAt:{gt:new Date()}}}),
      store.$queryRaw<{count:number}[]>`SELECT (
        (SELECT count(*) FROM "Appointment" WHERE "userId"=${userId} AND state IN ('PENDING','CONFIRMED','CANCEL_PENDING')) +
        (SELECT count(*) FROM "EventRegistration" r JOIN "EventTicketType" t ON t.id=r."ticketTypeId" JOIN "EventSession" s ON s.id=t."sessionId" WHERE r."userId"=${userId} AND r.state IN ('PENDING','CONFIRMED') AND s."endsAt">now()) +
        (SELECT count(*) FROM "CohortRegistration" r JOIN "CourseCohort" c ON c.id=r."cohortId" WHERE r."userId"=${userId} AND r."revokedAt" IS NULL AND c."endsAt">now())
      )::int AS count`,
      store.giftWallet.findUnique({where:{userId},select:{balance:true,systemHold:true}}),
      store.$queryRaw<{count:number}[]>`SELECT ((SELECT count(*) FROM "WithdrawalRequest" WHERE "userId"=${userId} AND state IN ('PENDING','APPROVED'))+(SELECT count(*) FROM "ReferralOrder" WHERE "promoterId"=${userId} AND "deliveredAt" IS NOT NULL AND "feeVerifiedAt" IS NULL)+(CASE WHEN COALESCE((SELECT sum(delta) FROM "CommissionLedger" WHERE "promoterId"=${userId}),0)<>COALESCE((SELECT sum(amount) FROM "WithdrawalRequest" WHERE "userId"=${userId} AND state='PAID'),0) THEN 1 ELSE 0 END))::int count`,
    ]);
    return {pendingCommission:commissionOpen[0]?.count??0,giftBalance:String(giftWallet?.balance??0n),giftHold:giftWallet?.systemHold??false, pendingBookings:pendingBookings[0]?.count??0, pendingOrders, pendingRefunds, unresolvedPaidOrders: unresolvedPaidOrders[0]?.count ?? 0, paidCourses, paidMemberships, receiptReference: userId };
  }
  @Get('close-account/status') status(@Req() req: AuthRequest) { return this.closureStatus(req.actor.id); }
  @Get('profile') profile(@Req() req:AuthRequest){return{id:req.actor.id,nickname:req.actor.nickname,avatar:req.actor.avatar,avatarAssetId:req.actor.avatarAssetId,version:req.actor.version};}
  @Patch('profile') async editProfile(@Req() req:AuthRequest,@Body() dto:ProfileDto){return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
    if(dto.avatarAssetId&&!await tx.mediaAsset.findFirst({where:{id:dto.avatarAssetId,uploaderId:req.actor.id,status:'READY',variants:{path:['uploadPurpose'],equals:'PROFILE_IMAGE'},mime:{in:['image/png','image/jpeg','image/webp']}}}))throw new BadRequestException('请选择在个人资料页上传的头像');
    const avatar=dto.avatarAssetId?'/api/v1/profiles/'+req.actor.id+'/avatar?v='+(dto.expectedVersion+1):null;
    const changed=await tx.user.updateMany({where:{id:req.actor.id,status:'ACTIVE',version:dto.expectedVersion},data:{nickname:dto.nickname.trim(),...(dto.avatarAssetId!==undefined?{avatarAssetId:dto.avatarAssetId,avatar}:{}),version:{increment:1},updatedAt:new Date()}});
    if(changed.count!==1)throw new ConflictException('个人资料已变化，请重新加载后保存');
    return tx.user.findUniqueOrThrow({where:{id:req.actor.id},select:{id:true,nickname:true,avatar:true,avatarAssetId:true,version:true}});
  });}
  @Get('notes') async notes(@Query() query: PageQuery, @Req() req: AuthRequest) {
    return page(await this.db.note.findMany({ where: { userId: req.actor.id, deletedAt: null }, ...paging(query) }), query.size);
  }
  @Get('articles/:id/annotations') async annotations(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    const article = await this.db.article.findFirst({ where: { id, status: 'PUBLISHED', ...await demoScope(this.db) } });
    if (!article) throw new NotFoundException('文章不可阅读');
    if (article.visibility === 'MEMBER') { const member = await this.learning.membership(req.actor.id); if (!member || member.contentTier < article.membershipTier) throw new NotFoundException('文章不可阅读'); }
    return this.db.note.findMany({ where: { userId: req.actor.id, articleId: id, articleVersion: article.version, deletedAt: null, rangeStart: { not: null } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }
  @Get('notes/export') exportMarkdown(@Query() query:NoteExportQuery,@Req() req:AuthRequest){return exportPrivateNotes(this.db,req.actor.id,query);}
  @Post('notes') async note(@Body() body: NoteDto, @Req() req: AuthRequest) {
    const article = await this.db.article.findFirst({ where: { id: body.articleId, status: 'PUBLISHED', ...await demoScope(this.db) } });
    if (!article) throw new NotFoundException('文章不可阅读');
    if (article.visibility === 'MEMBER') { const member = await this.learning.membership(req.actor.id); if (!member || member.contentTier < article.membershipTier) throw new NotFoundException('文章不可阅读'); }
    const block = (article.blocks as { id: string; type: string; text: string }[]).find(block => block.id === body.blockId);
    if (!block?.text || block.type === 'image') throw new BadRequestException('原文段落已变化，请重新打开文章');
    const hasRange = !!body.ranges || body.rangeStart !== undefined || body.rangeEnd !== undefined;
    if (hasRange && body.articleVersion !== article.version) throw new ConflictException('原文版本已变化，请重新打开文章');
    const blocks = article.blocks as { id: string; type: string; text: string }[];
    const ranges = body.ranges ?? (hasRange ? [{ blockId: body.blockId, rangeStart: body.rangeStart!, rangeEnd: body.rangeEnd! }] : []);
    let previousPosition = -1;
    for (const range of ranges) {
      const position = blocks.findIndex(b => b.id === range.blockId), source = blocks[position];
      if (!source?.text || source.type === 'image' || position <= previousPosition || !Number.isInteger(range.rangeStart) || !Number.isInteger(range.rangeEnd) || range.rangeStart < 0 || range.rangeEnd <= range.rangeStart || range.rangeEnd > source.text.length || /[\uDC00-\uDFFF]/.test(source.text[range.rangeStart] ?? '') || /[\uDC00-\uDFFF]/.test(source.text[range.rangeEnd] ?? '')) throw new BadRequestException('标注范围无效');
      previousPosition = position;
    }
    if (ranges.length && ranges[0]!.blockId !== body.blockId) throw new BadRequestException('标注起始段落不一致');
    if (!hasRange && !body.text.trim()) throw new BadRequestException('笔记内容不能为空');
    const quote = hasRange ? ranges.map(r => blocks.find(b => b.id === r.blockId)!.text.slice(r.rangeStart, r.rangeEnd)).join('\n\n') : block.text;
    return this.db.note.create({ data: { userId: req.actor.id, articleId: article.id, articleTitle: article.title, articleVersion: article.version, blockId: block.id, quote, text: body.text.trim(), releaseId: article.currentReleaseId, rangeStart: ranges[0]?.rangeStart, rangeEnd: ranges[0]?.rangeEnd, ...(ranges.length ? { ranges: ranges.map(({blockId,rangeStart,rangeEnd})=>({blockId,rangeStart,rangeEnd})) } : {}) } });
  }
  @Patch('notes/:id') async editNote(@Param('id', ParseUUIDPipe) id: string, @Body() body: NoteTextDto, @Req() req: AuthRequest) {
    const result = await this.db.note.updateMany({ where: { id, userId: req.actor.id, deletedAt: null }, data: { text: body.text, version: { increment: 1 } } });
    if (result.count !== 1) throw new NotFoundException('笔记不存在');
    return this.db.note.findFirstOrThrow({ where: { id, userId: req.actor.id } });
  }
  private async removePrivateSource(userId:string,id:string,kind:'NOTE'|'JOURNAL') {return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const auth=await tx.contentAuthorization.findMany({where:{userId,...(kind==='NOTE'?{noteId:id}:{logId:id})}});
    if(auth.length){await tx.contentAuthorization.updateMany({where:{id:{in:auth.map(a=>a.id)}},data:{revokedAt:new Date(),version:{increment:1},updatedAt:new Date()}});await tx.courseCase.updateMany({where:{authorizationId:{in:auth.map(a=>a.id)}},data:{state:'WITHDRAWN',textCipher:encryptPrivate('已删除'),teacherComment:null,withdrawnAt:new Date(),version:{increment:1},updatedAt:new Date()}});}
    const result=kind==='NOTE'?auth.length?await tx.note.updateMany({where:{id,userId,deletedAt:null},data:{text:'',quote:'',ranges:[],deletedAt:new Date(),version:{increment:1}}}):await tx.note.deleteMany({where:{id,userId}}):auth.length?await tx.practiceLog.updateMany({where:{id,userId,deletedAt:null},data:{text:'',deletedAt:new Date(),version:{increment:1}}}):await tx.practiceLog.deleteMany({where:{id,userId}});
    if(result.count!==1)throw new NotFoundException('私人记录不存在');return{success:true};
  });}
  @Delete('notes/:id') async deleteNote(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.removePrivateSource(req.actor.id,id,'NOTE');
  }
  @Get('favorites') async favorites(@Query() query: PageQuery, @Req() req: AuthRequest) {
    const result = page(await this.db.favorite.findMany({ where: { userId: req.actor.id }, ...paging(query) }), query.size);
    const articles = await this.db.article.findMany({ where: { id: { in: result.items.map(row => row.articleId) }, status: 'PUBLISHED', ...await demoScope(this.db) }, select: { id: true, title: true, summary: true, category: true, cover: true, visibility: true } });
    return { ...result, items: result.items.map(item => ({ ...item, article: articles.find(article => article.id === item.articleId) ?? null })) };
  }
  @Put('favorites/:id') async favorite(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    if (!await this.db.article.findFirst({ where: { id, status: 'PUBLISHED', ...await demoScope(this.db) } })) throw new NotFoundException('文章不可收藏');
    return this.db.favorite.upsert({ where: { userId_articleId: { userId: req.actor.id, articleId: id } }, create: { userId: req.actor.id, articleId: id }, update: {} });
  }
  @Get('favorite-state/:id') async favoriteState(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return { favorited: !!await this.db.favorite.findUnique({ where: { userId_articleId: { userId: req.actor.id, articleId: id } }, select: { id: true } }) };
  }
  @Get('like-state/:id') async likeState(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return { liked: !!await this.db.reaction.findFirst({ where: { userId: req.actor.id, resourceId: id, kind: 'LIKE' }, select: { id: true } }) };
  }
  @Delete('favorites/:id') async unfavorite(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    await this.db.favorite.deleteMany({ where: { userId: req.actor.id, articleId: id } }); return { success: true };
  }
  @Get('practice') async practice(@Query() query: PageQuery, @Req() req: AuthRequest) {
    return page(await this.db.practiceLog.findMany({ where: { userId: req.actor.id,deletedAt:null }, ...paging(query) }), query.size);
  }
  @Put('practice') async record(@Body() body: PracticeDto, @Req() req: AuthRequest) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const parsed = new Date(body.day + 'T00:00:00Z');
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== body.day || body.day > today) throw new BadRequestException('请选择有效且不晚于今天的日期');
    if (!body.text.trim()) throw new BadRequestException('日志内容不能为空');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
      const current=await tx.practiceLog.findUnique({where:{userId_day:{userId:req.actor.id,day:body.day}}});
      if(body.expectedVersion!==undefined&&(current?.deletedAt?0:current?.version??0)!==body.expectedVersion)throw new ConflictException('该日期日志已存在或已更新，请重新打开后编辑');
      return tx.practiceLog.upsert({where:{userId_day:{userId:req.actor.id,day:body.day}},create:{userId:req.actor.id,day:body.day,text:body.text.trim()},update:{text:body.text.trim(),deletedAt:null,version:{increment:1}}});
    });
  }
  @Delete('practice/:id') async deletePractice(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.removePrivateSource(req.actor.id,id,'JOURNAL');
  }
  @Patch('tags') async tags(@Body() body: TagsDto, @Req() req: AuthRequest) {
    const tags = [...new Set(body.tags)]; await this.db.user.update({ where: { id: req.actor.id }, data: { tags } }); return { tags };
  }
  @Post('close-account') async close(@Body() dto: CloseAccountDto, @Req() req: AuthRequest) {
    // Close unpaid preview reservations before removing personal data.
    const pending = await this.db.order.findMany({where:{userId:req.actor.id,status:'PENDING'},select:{id:true}});
    for(const row of pending)await this.orders.cancel(req.actor.id,row.id);
    const courseOrders = await this.db.tradeOrder.findMany({ where: { userId: req.actor.id, kind: 'COURSE', state: 'PENDING' }, select: { id: true } });
    for (const row of courseOrders) await this.sales.cancel(row.id, req.actor.id, 'ACCOUNT_CLOSURE');
    const memberOrders=await this.db.tradeOrder.findMany({where:{userId:req.actor.id,kind:'MEMBERSHIP',state:'PENDING'},select:{id:true}});
    for(const row of memberOrders)await this.memberships.cancel(row.id,req.actor.id,'ACCOUNT_CLOSURE');
    const productOrders=await this.db.tradeOrder.findMany({where:{userId:req.actor.id,kind:'PHYSICAL',state:'PENDING'},select:{id:true}});
    for(const row of productOrders)await this.productSales.cancel(row.id,req.actor.id,'ACCOUNT_CLOSURE');
    const bookingOrders=await this.db.tradeOrder.findMany({where:{userId:req.actor.id,kind:{in:['CONSULTATION','EVENT']},state:'PENDING'},select:{id:true}});
    for(const row of bookingOrders)await this.bookingSales.cancel(row.id,req.actor.id,'ACCOUNT_CLOSURE');
    const cohortOrders=await this.db.tradeOrder.findMany({where:{userId:req.actor.id,kind:'COHORT',state:'PENDING'},select:{id:true}});
    for(const row of cohortOrders)await this.cohortSales.cancel(row.id,req.actor.id,'ACCOUNT_CLOSURE');
    await this.db.$transaction(async tx => {
      const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${req.actor.id} AND status='ACTIVE' FOR UPDATE`;
      if (!users.length) throw new ConflictException('账号已注销或状态已变化');
      if(await tx.order.count({where:{userId:req.actor.id,status:'PENDING'}}))throw new BadRequestException('订单状态已变化，请重试注销');
      const status = await this.closureStatus(req.actor.id, tx);
      if(status.pendingCommission)throw new ConflictException('仍有推广佣金、提现或费用待核对，请先在课程推广中结清或联系客服');
      if(BigInt(status.giftBalance)>0n||status.giftHold)throw new ConflictException('仍有付费礼物余额或渠道撤销核查，请先在礼物余额中退款或联系客服后注销');
      if(status.pendingBookings)throw new ConflictException('仍有有效预约、活动报名或训练营，请先取消或完成服务后再注销');
      if (status.pendingOrders || status.pendingRefunds || status.unresolvedPaidOrders) throw new ConflictException('仍有待确认交易、退款或履约，请先在订单与客服中处理，账号及权益已保留');
      if ((status.paidCourses||status.paidMemberships) && !dto.forfeitPaidAccess) throw new ConflictException('你仍有已购课程或会员，请先确认注销将放弃剩余学习与会员权限；注销不会自动退款');
      await tx.appointment.updateMany({where:{userId:req.actor.id},data:{contactCipher:encryptPrivate(JSON.stringify({name:'已注销',phone:''})),version:{increment:1}}});
      const registrations=await tx.eventRegistration.findMany({where:{userId:req.actor.id}});
      for(const r of registrations){const snapshot=r.attendeeSnapshotCipher.startsWith('v1:')?JSON.parse(decryptPrivate(r.attendeeSnapshotCipher)):{};delete snapshot.requestDigest;delete snapshot.consentedAt;await tx.eventRegistration.update({where:{id:r.id},data:{attendeeSnapshotCipher:encryptPrivate(JSON.stringify({...snapshot,name:'已注销',phone:''})),version:{increment:1}}});}
      await tx.charityApplication.updateMany({where:{userId:req.actor.id},data:{statementCipher:encryptPrivate('已注销'),state:'REVOKED',reviewNote:null,version:{increment:1},updatedAt:new Date()}});
      await tx.promoterProfile.updateMany({where:{userId:req.actor.id},data:{state:'SUSPENDED',statement:'已注销',reviewNote:null,version:{increment:1},updatedAt:new Date()}});
      // Keep payment, refund, journal and order facts for after-sales tracing.
      await tx.order.updateMany({where:{userId:req.actor.id},data:{address:{redacted:true}}});
      await tx.membership.updateMany({ where: { userId: req.actor.id }, data: { revokedAt: new Date() } });
      for(const allocation of await tx.memberGiftAllocation.findMany({where:{userId:req.actor.id,state:{in:['HELD','AVAILABLE']}}}))await releaseMemberGift(tx,allocation.id,req.actor.id,'本人确认注销，放弃未领取签名礼遇，返还未消费份额');
      await tx.cohortRegistration.updateMany({where:{userId:req.actor.id,revokedAt:null},data:{revokedAt:new Date(),version:{increment:1}}});
      await tx.enrollment.updateMany({ where: { userId: req.actor.id }, data: { revokedAt: new Date() } });
      await tx.studyEvent.deleteMany({ where: { userId: req.actor.id } });
      await tx.studyProgress.deleteMany({ where: { userId: req.actor.id } });
      await tx.offlineStudyProgress.deleteMany({where:{userId:req.actor.id}});await tx.offlineCourseCertificate.deleteMany({where:{userId:req.actor.id}});
      await tx.courseCase.deleteMany({where:{userId:req.actor.id}});await tx.campaignEntry.deleteMany({where:{userId:req.actor.id}});await tx.contentAuthorization.deleteMany({where:{userId:req.actor.id}});
      const heldPins=await tx.forumPinApplication.findMany({where:{userId:req.actor.id,state:'PENDING'}});await tx.benefitUsage.updateMany({where:{id:{in:heldPins.map(p=>p.usageId)},state:'HELD'},data:{state:'RELEASED',version:{increment:1},updatedAt:new Date()}});await tx.forumPinApplication.updateMany({where:{id:{in:heldPins.map(p=>p.id)}},data:{state:'WITHDRAWN',version:{increment:1},updatedAt:new Date()}});
      await tx.userCoupon.updateMany({where:{userId:req.actor.id,state:{in:['AVAILABLE','EXPIRED']}},data:{state:'REVOKED',version:{increment:1},updatedAt:new Date()}});
      await tx.note.deleteMany({ where: { userId: req.actor.id } });
      await tx.readingEvent.deleteMany({ where: { userId: req.actor.id } });
      await tx.reaction.deleteMany({ where: { userId: req.actor.id } });
      const threads=await tx.forumThread.findMany({where:{authorId:req.actor.id},select:{id:true}});
        await tx.mediaUpload.updateMany({where:{uploaderId:req.actor.id,purpose:'FORUM_MEDIA'},data:{state:'CANCELLED',leaseUntil:null,leaseToken:null,expiresAt:new Date(0)}});
        await tx.mediaAsset.updateMany({where:{uploaderId:req.actor.id,variants:{path:['uploadPurpose'],equals:'FORUM_MEDIA'}},data:{status:'DELETED',failureCode:'ACCOUNT_CLOSED'}});
      await tx.attachmentBinding.deleteMany({where:{threadId:{in:threads.map(r=>r.id)}}});
      await tx.forumThread.updateMany({where:{authorId:req.actor.id},data:{blocks:[],deletedAt:new Date(),version:{increment:1},updatedAt:new Date()}});
      await tx.resource.updateMany({where:{id:{in:threads.map(r=>r.id)}},data:{title:'已注销用户的讨论',summary:'',publishState:'ARCHIVED',version:{increment:1}}});
      await tx.userBlock.deleteMany({where:{OR:[{userId:req.actor.id},{blockedId:req.actor.id}]}});
      await tx.idempotencyRecord.deleteMany({where:{userId:req.actor.id,OR:[{operation:'forum.thread.create'},{operation:{startsWith:'forum.reply:'}}]}});
      await tx.userTag.deleteMany({ where: { userId: req.actor.id } });
      await tx.noteExport.deleteMany({ where: { userId: req.actor.id } });
      await tx.pollVote.deleteMany({where:{userId:req.actor.id}});
      await tx.pollResponse.deleteMany({where:{userId:req.actor.id}});
      await tx.comment.updateMany({ where: { authorId: req.actor.id }, data: { body: '已注销用户', quoteSnapshot: null, quoteBlockId: null, deletedAt: new Date(), version: { increment: 1 } } });
      await tx.favorite.deleteMany({ where: { userId: req.actor.id } });
      await tx.courseCertificate.deleteMany({where:{userId:req.actor.id}});
      await tx.courseReview.updateMany({where:{userId:req.actor.id},data:{body:'已注销用户',reviewState:'REMOVED',deletedAt:new Date(),version:{increment:1},updatedAt:new Date()}});
      const checkins=await tx.practiceCheckin.findMany({where:{userId:req.actor.id},select:{id:true}});
      await tx.teacherReview.updateMany({where:{checkinId:{in:checkins.map(r=>r.id)}},data:{body:'已注销用户的点评已清除'}});
      await tx.attachmentBinding.deleteMany({where:{checkinId:{in:checkins.map(r=>r.id)}}});
      await tx.practiceCheckin.updateMany({where:{userId:req.actor.id},data:{body:'已注销用户的记录已清除',state:'REMOVED',privateLogId:null}});
      await tx.practiceLog.deleteMany({where:{userId:req.actor.id}});
      const questions=await tx.teacherQuestion.findMany({where:{userId:req.actor.id},select:{id:true}});
      await tx.teacherAnswer.updateMany({where:{questionId:{in:questions.map(r=>r.id)}},data:{body:'已注销用户的问答已清除',reviewState:'REMOVED'}});
      await tx.teacherQuestion.updateMany({where:{userId:req.actor.id},data:{body:'已注销用户的问题已清除',state:'CLOSED'}});
      const feedback=await tx.feedback.findMany({where:{userId:req.actor.id},select:{id:true}});
      await tx.feedbackReply.updateMany({where:{feedbackId:{in:feedback.map(r=>r.id)}},data:{body:'已注销用户的反馈已清除'}});
      await tx.feedback.updateMany({where:{userId:req.actor.id},data:{body:'已注销用户的反馈已清除',contactCipher:null,state:'CLOSED',closedAt:new Date()}});
      await tx.idempotencyRecord.deleteMany({where:{userId:req.actor.id,operation:'feedback.create'}});
      await tx.idempotencyRecord.deleteMany({where:{userId:req.actor.id,operation:{startsWith:'question.ask:'}}});
      const homework = await tx.submission.findMany({ where: { userId: req.actor.id }, select: { id: true } });
      await tx.attachmentBinding.deleteMany({ where: { submissionId: { in: homework.map(row => row.id) } } });
      await tx.submission.updateMany({ where: { userId: req.actor.id }, data: { body: '已注销用户的作业正文已清除', updatedAt: new Date() } });
      await tx.notificationDelivery.deleteMany({where:{notificationId:{in:(await tx.notification.findMany({where:{userId:req.actor.id},select:{id:true}})).map(r=>r.id)}}});
      await tx.notification.deleteMany({ where: { userId: req.actor.id } });
      await tx.notificationPreference.deleteMany({where:{userId:req.actor.id}});
      await tx.deviceToken.updateMany({where:{userId:req.actor.id},data:{enabled:false,revokedAt:new Date(),tokenCipher:'',version:{increment:1}}});
      await tx.idempotencyRecord.deleteMany({ where: { userId: req.actor.id, operation: { startsWith: 'assignment.submit:' } } });
      await tx.cartItem.deleteMany({ where: { userId: req.actor.id } });
      await tx.address.deleteMany({ where: { userId: req.actor.id } });
      for(const row of await tx.authIdentity.findMany({where:{userId:req.actor.id}}))await queueAppleRevoke(tx,row);
      await tx.authIdentity.deleteMany({where:{userId:req.actor.id}});
      await tx.offlineLicense.deleteMany({where:{userId:req.actor.id}});
      await tx.socialChallenge.updateMany({where:{userId:req.actor.id},data:{finishedAt:new Date()}});
      await tx.authSession.updateMany({ where: { userId: req.actor.id }, data: { revokedAt: new Date() } });
      await tx.user.update({ where: { id: req.actor.id }, data: { phone: null, phoneCipher: null, phoneHash: null, deletedAt: new Date(), username: null, passwordHash: null, avatar: null, avatarAssetId: null, nickname: '已注销', tags: [], roles: ['USER'], status: 'DELETED' } });
      await tx.tradeOrder.updateMany({ where: { userId: req.actor.id }, data: { addressSnapshotCipher: null } });
      await tx.shipment.updateMany({where:{orderId:{in:(await tx.tradeOrder.findMany({where:{userId:req.actor.id},select:{id:true}})).map(o=>o.id)}},data:{addressSnapshotCipher:encryptPrivate(JSON.stringify({redacted:true})),trackingSnapshot:Prisma.JsonNull}});
      await tx.refund.updateMany({where:{userId:req.actor.id},data:{returnAddressCipher:null}});
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'account.close', resource: 'user', resourceId: req.actor.id, changes: { reason: 'user-requested', forfeitPaidAccess: dto.forfeitPaidAccess === true, forfeitedPaidCourses: status.paidCourses, forfeitedPaidMemberships:status.paidMemberships, receiptReference: req.actor.id, financialFactsRetained: true } } });
    });
    return { success: true, receiptReference: req.actor.id };
  }
}
