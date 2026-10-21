import {OfflineCourses} from './offline-courses.js';
import { uploadName } from './upload-name.js';
import { subtitleCues } from './subtitles.js';
import { BadRequestException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Request, Response } from 'express';
import { Database } from './database.js';
import { Prisma } from './generated/prisma/client.js';
import { LearningService, LearningContextQuery } from './learning.js';
import { AdminGuard, OptionalUserGuard, UserGuard, requireRoles } from './auth.js';
import { TeachingService } from './teaching.js';
import { PracticesService } from './practices.js';
import { ForumService } from './forum.js';
import type { AuthRequest } from './auth.js';
import { IsIn, IsOptional } from 'class-validator';
import { TableQuery } from './admin.js';
import { AdminPermissions } from './admin-permissions.js';
import { LiveService } from './live.js';
import { MediaIngest } from './media-ingest.js';
import { CatalogService } from './catalog.js';
import type { ArticleMediaBlock } from './article-media.js';

class MediaQuery extends TableQuery {
  @IsOptional() @IsIn(['video/mp4','audio/mpeg','audio/mp4','audio/wav']) mime?:string;
  @IsOptional() @IsIn(['UPLOADING','PROCESSING','REVIEW','READY','REJECTED','DELETED']) assetStatus?:string;
}
type FileUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
type Ticket = { adminAssetId?:string;adminAssetVersion?:number;offlineRegistrationId?:string;referralProofKind?:string;referralProofId?:string;giftContractId?:string;giftSettlementId?:string; uploadId?:string; threadVersion?:number; forumMedia?:boolean; evidenceId?:string; evidenceVersion?:number; evidenceResourceId?:string; evidenceScope?:string; articleId?:string; articleVersion?:number; articleBlockId?:string; articlePreview?:boolean; replayReviewId?:string; replayVersion?:number; liveSessionId?:string; digitalDeliveryId?:string; lessonId?: string; cohortId?:string; submissionId?: string; checkinId?:string; threadId?:string; assetId?: string; userId?: string; sessionId?: string; sessionKind?: string; expires: number };
@Injectable()
export class MediaService {
  // Single-process local delivery: restarting invalidates tickets; object storage/CDN replaces this for scaled deployment.
  private readonly secret = process.env.MEDIA_TOKEN_SECRET ?? randomBytes(32).toString('hex');
  private readonly root = resolve(process.env.MEDIA_DIR ?? '.media');
  constructor(private readonly db: Database, private readonly learning: LearningService, private readonly teaching: TeachingService, private readonly practices:PracticesService, private readonly forum:ForumService, private readonly permissions:AdminPermissions, private readonly live:LiveService, private readonly catalog:CatalogService,private readonly offline:OfflineCourses) {}
  async library(query:MediaQuery) {
    const filter=Prisma.sql`FROM "MediaAsset" WHERE variants->>'uploadPurpose' IS NULL AND mime IN (${Prisma.join(query.mime?[query.mime]:['video/mp4','audio/mpeg','audio/mp4','audio/wav'])}) ${query.assetStatus?Prisma.sql`AND status=${query.assetStatus}`:Prisma.empty} ${query.q?Prisma.sql`AND name ILIKE ${'%'+query.q+'%'}`:Prisma.empty}`;
    const [items,count]=await this.db.$transaction([this.db.$queryRaw(Prisma.sql`SELECT id,name,mime,bytes,status,"failureCode","createdAt","durationSeconds","uploaderId" ${filter} ORDER BY "createdAt" DESC,id DESC LIMIT ${query.size} OFFSET ${(query.page-1)*query.size}`),this.db.$queryRaw<{total:number}[]>(Prisma.sql`SELECT count(*)::int AS total ${filter}`)]);
    return {items,total:count[0]!.total};
  }
  async asset(id:string){
    if((await this.db.$queryRaw<{id:string}[]>`SELECT id FROM "MediaAsset" WHERE id=${id} AND variants->>'uploadPurpose' IS NOT NULL`).length)throw new NotFoundException('私人投稿请在所属审核流程查看');
    const asset=await this.db.mediaAsset.findUnique({where:{id},select:{id:true,name:true,mime:true,bytes:true,status:true,durationSeconds:true,failureCode:true}});if(!asset)throw new NotFoundException('媒体不存在');return asset;
  }
  async assetPreview(id:string,req:AuthRequest){
    const asset=await this.db.mediaAsset.findUnique({where:{id}});
    if(!asset||asset.status!=='READY'||(asset.variants as {uploadPurpose?:string})?.uploadPurpose||!['video/mp4','audio/mp4','audio/mpeg','audio/wav'].includes(asset.mime))throw new NotFoundException('课件尚未处理完成或不可预览');
    const payload:Ticket={adminAssetId:id,adminAssetVersion:asset.version,assetId:id,userId:req.actor.id,sessionId:req.authSessionId,sessionKind:'ADMIN',expires:Date.now()+10*60000};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return {path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url')};
  }
  private async articleBlock(id:string,blockId:string,userId?:string,preview=false,version?:number){
    const article=preview?await this.db.article.findUnique({where:{id}}):await this.catalog.article(id,userId);
    if(!article)throw new NotFoundException('文章不存在');
    if('access' in article&&article.access==='MEMBERSHIP_REQUIRED')throw new ForbiddenException('当前会员权益不能阅读该文章');
    if(version!==undefined&&article.version!==version)throw new NotFoundException('文章已更新，请重新打开');
    const block=(article.blocks as ArticleMediaBlock[]).find(block=>block.id===blockId&&['audio','video'].includes(block.type));
    const asset=block?.mediaId?await this.db.mediaAsset.findUnique({where:{id:block.mediaId}}):null;
    if(!block||!asset||asset.status!=='READY'||(asset.variants as {uploadPurpose?:string}|null)?.uploadPurpose||(block.type==='video'?asset.mime!=='video/mp4':!['audio/mpeg','audio/mp4','audio/wav'].includes(asset.mime)))throw new NotFoundException('该段音视频暂不可用，仍可继续阅读文字');
    return {article,asset};
  }
  async evidenceTicket(resourceId:string,evidenceId:string,req:AuthRequest){
    const evidence=await this.db.sourceEvidence.findUnique({where:{id:evidenceId}}),resource=await this.db.resource.findUnique({where:{id:resourceId}});
    if(!evidence?.proofAssetId||!resource||!await this.db.resourceEvidence.findFirst({where:{resourceId,evidenceId}}))throw new NotFoundException('证据文件不存在');
    const scope=resource.kind==='ARTICLE'?'content':resource.kind==='PRODUCT'?'products':resource.kind==='TEACHER'?'courses':null;
    if(!scope)throw new NotFoundException('证据类型不支持');
    const payload:Ticket={evidenceId,evidenceVersion:evidence.version,evidenceResourceId:resourceId,evidenceScope:scope,assetId:evidence.proofAssetId,userId:req.actor.id,sessionId:req.authSessionId,sessionKind:'ADMIN',expires:Date.now()+5*60000};
    const asset=await this.db.mediaAsset.findFirst({where:{id:evidence.proofAssetId,status:'READY',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}});if(!asset)throw new NotFoundException('证据文件暂不可用');
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    await this.db.auditLog.create({data:{actorId:req.actor.id,action:'evidence.file.view',resource:scope,resourceId:evidenceId,changes:{boundResourceId:resourceId,version:evidence.version}}});
    return {path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url'),mime:asset.mime};
  }
  private async referralProof(kind:string,id:string){
    if(kind==='apple-refund-review'){const row=await this.db.appleRefundReview.findUnique({where:{id}});if(!row)return null;return (await this.db.mediaAsset.findFirst({where:{id:row.proofAssetId,sha256:row.proofHash,status:'READY',visibility:'PRIVATE',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}}))?.id;}
    if(kind==='operating-contract'){const c=await this.db.partnerContract.findUnique({where:{id}});return (c?.scopeSnapshot as {kind?:string}|undefined)?.kind==='OPERATING_SERVICE'?c?.proofAssetId:null;}
    if(kind==='operating-receipt')return (await this.db.operatingBankReceipt.findUnique({where:{id}}))?.proofAssetId;
    if(kind==='operating-refund'){const r=await this.db.refund.findFirst({where:{id,reasonCode:'OPERATING_SERVICE'}});return (r?.assessmentSnapshot as {agreementProofId?:string}|undefined)?.agreementProofId;}
    if(kind==='member-gift-pool')return (await this.db.memberGiftPool.findUnique({where:{id}}))?.proofAssetId;
    if(kind==='member-gift-return')return (await this.db.memberGiftClaim.findUnique({where:{id}}))?.returnProofAssetId;
    if(kind==='operating-delivery')return (await this.db.operatingFulfilment.findUnique({where:{id}}))?.proofAssetId;
    if(kind==='charity-qualification')return (await this.db.charityProgram.findUnique({where:{id}}))?.qualificationProofId;
    if(kind==='charity-contract'){const p=await this.db.charityProgram.findUnique({where:{id}});return p?(await this.db.partnerContract.findUnique({where:{id:p.contractId}}))?.proofAssetId:null;}
    if(kind==='charity-revenue'){const o=await this.db.charityOrder.findUnique({where:{id}});return o?(await this.db.charityRevenue.findFirst({where:{orderItemId:o.orderItemId,reversalOfId:null}}))?.proofAssetId:null;}
    if(kind==='service-delivery'){const row=await this.db.serviceDelivery.findUnique({where:{id}});if(!row?.proofAssetId||!row.proofHash)return null;return (await this.db.mediaAsset.findFirst({where:{id:row.proofAssetId,sha256:row.proofHash,status:'READY',visibility:'PRIVATE',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}}))?.id;}
    if(kind==='points-returns')return (await this.db.pointsRedemption.findUnique({where:{id}}))?.returnProofAssetId;
    if(kind==='promoters')return (await this.db.promoterProfile.findUnique({where:{id}}))?.proofAssetId;
    if(kind==='accruals')return (await this.db.referralOrder.findUnique({where:{id}}))?.feeProofAssetId;
    if(kind==='withdrawals')return (await this.db.withdrawalRequest.findUnique({where:{id}}))?.proofAssetId;
    throw new NotFoundException('凭证类型不存在');
  }
  async referralProofTicket(kind:string,id:string,req:AuthRequest){
    const assetId=await this.referralProof(kind,id);if(!assetId)throw new NotFoundException('尚无凭证');
    const payload:Ticket={referralProofKind:kind,referralProofId:id,assetId,userId:req.actor.id,sessionId:req.authSessionId,sessionKind:'ADMIN',expires:Date.now()+5*60000};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');await this.db.auditLog.create({data:{actorId:req.actor.id,action:'workflow.proof.view',resource:kind,resourceId:id,changes:{assetId}}});
    return{path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url')};
  }
  async giftProofTicket(id:string,req:AuthRequest,settlement=false){
    requireRoles(req,['FINANCE']);const contract=settlement?await this.db.settlement.findUnique({where:{id}}):await this.db.partnerContract.findUnique({where:{id}});
    if(!contract?.proofAssetId)throw new NotFoundException('尚未上传凭证');
    const asset=await this.db.mediaAsset.findFirst({where:{id:contract.proofAssetId,status:'READY',visibility:'PRIVATE',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}});if(!asset)throw new NotFoundException('凭证暂不可用');
    const payload:Ticket={...(settlement?{giftSettlementId:id}:{giftContractId:id}),assetId:asset.id,userId:req.actor.id,sessionId:req.authSessionId,sessionKind:'ADMIN',expires:Date.now()+5*60000};const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    await this.db.auditLog.create({data:{actorId:req.actor.id,action:'gift.proof.view',resource:settlement?'settlement':'partner_contract',resourceId:id,changes:{assetId:asset.id}}});return{path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url')};
  }
  async articleTicket(id:string,blockId:string,req:AuthRequest,preview=false){
    if(preview)requireRoles(req,['OPERATOR','MODERATOR']);
    const {article,asset}=await this.articleBlock(id,blockId,req.actor?.id,preview);
    try{await stat(resolve(this.root,asset.storageKey));}catch{throw new NotFoundException('该段音视频暂不可用，仍可继续阅读文字');}
    const payload:Ticket={articleId:id,articleBlockId:blockId,articleVersion:article.version,articlePreview:preview,assetId:asset.id,...(req.actor?{userId:req.actor.id,sessionId:req.authSessionId,sessionKind:preview?'ADMIN':'APP'}:{}),expires:Date.now()+5*60000};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return {path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url'),expiresAt:new Date(payload.expires).toISOString(),mime:asset.mime};
  }
  async forumImageTicket(threadId:string,assetId:string,req:AuthRequest,admin=false){
    return this.forumTicket(threadId,assetId,req,admin,false);
  }
  private async forumAsset(threadId:string,assetId:string,userId?:string,admin=false,media=true){
    const {thread,section}=await this.forum.context(threadId,userId,admin);
    if(!admin){
      if(thread.deletedAt)throw new NotFoundException('帖子已撤回或隐藏');
      const author=await this.db.user.findUnique({where:{id:thread.authorId}});
      const now=new Date();
      if(author?.status!=='ACTIVE'||await this.db.userRestriction.count({where:{userId:thread.authorId,scope:{in:['ALL','POST']},revokedAt:null,startsAt:{lte:now},AND:[{OR:[{endsAt:null},{endsAt:{gt:now}}]},{OR:[{resourceId:null},{resourceId:section.id}]}]}}))throw new NotFoundException('投稿媒体已停止公开');
    }
    if(!await this.db.attachmentBinding.findFirst({where:{threadId,assetId,purpose:media?'FORUM_MEDIA':'FORUM_IMAGE'}}))throw new NotFoundException('帖子附件不存在');
    const asset=await this.db.mediaAsset.findFirst({where:{id:assetId,uploaderId:thread.authorId,status:'READY',visibility:'PRIVATE',mime:{in:media?['video/mp4','audio/mp4']:['image/png','image/jpeg','image/webp']},variants:{path:['uploadPurpose'],equals:media?'FORUM_MEDIA':'FORUM_IMAGE'}}});
    if(!asset)throw new NotFoundException('帖子附件暂不可用');return {...asset,threadVersion:thread.version};
  }
  async forumTicket(threadId:string,assetId:string,req:AuthRequest,admin=false,media=true){
    if(admin)requireRoles(req,['OPERATOR','MODERATOR']);
    const asset=await this.forumAsset(threadId,assetId,req.actor?.id,admin,media);
    const payload:Ticket={threadId,threadVersion:asset.threadVersion,forumMedia:media,assetId,...(req.actor?{userId:req.actor.id,sessionId:req.authSessionId,sessionKind:admin?'ADMIN':'APP'}:{}),expires:Date.now()+5*60000};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    if(admin&&media)await this.db.auditLog.create({data:{actorId:req.actor.id,action:'forum.media.preview',resource:'forum_thread',resourceId:threadId,changes:{assetId,version:asset.threadVersion}}});
    return{path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url'),mime:asset.mime,expiresAt:new Date(payload.expires).toISOString(),durationSeconds:asset.durationSeconds};
  }
  private async forumUploadAsset(id:string,userId:string){
    const row=await this.db.mediaUpload.findFirst({where:{id,uploaderId:userId,purpose:'FORUM_MEDIA',state:'READY',expiresAt:{gt:new Date()}}});if(!row?.assetId)throw new NotFoundException('投稿尚未处理完成或已过期');
    await this.forum.postingAccess(userId,row.forumSectionId!);
    const asset=await this.db.mediaAsset.findFirst({where:{id:row.assetId,uploaderId:userId,status:'READY',visibility:'PRIVATE',variants:{path:['uploadPurpose'],equals:'FORUM_MEDIA'}}});if(!asset)throw new NotFoundException('投稿媒体暂不可用');return asset;
  }
  async forumUploadTicket(id:string,req:AuthRequest){
    const asset=await this.forumUploadAsset(id,req.actor.id),payload:Ticket={uploadId:id,assetId:asset.id,userId:req.actor.id,sessionId:req.authSessionId,sessionKind:'APP',expires:Date.now()+5*60000};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return{path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url'),mime:asset.mime,expiresAt:new Date(payload.expires).toISOString(),durationSeconds:asset.durationSeconds};
  }
  async checkinImageTicket(checkinId:string,assetId:string,req:AuthRequest){
    await this.practices.checkinAccess(checkinId,req.actor);
    if(!await this.db.attachmentBinding.findFirst({where:{checkinId,assetId}}))throw new NotFoundException('实践图片不存在');
    const payload:Ticket={checkinId,assetId,userId:req.actor.id,sessionId:req.authSessionId,sessionKind:req.headers.authorization?'APP':'ADMIN',expires:Date.now()+5*60000};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return{path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url')};
  }
  async upload(req: AuthRequest, file?: FileUpload, imageOnly = false, imagePurpose?:string) {
    if (!imageOnly) throw new BadRequestException('音视频请使用分片上传入口');
    if (!file?.buffer.length) throw new BadRequestException('请选择媒体文件');
    const image = file.mimetype === 'image/png' ? file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : file.mimetype === 'image/jpeg' ? file.buffer[0] === 255 && file.buffer[1] === 216 && file.buffer[2] === 255 : file.mimetype === 'image/webp' && file.buffer.subarray(0,4).toString() === 'RIFF' && file.buffer.subarray(8,12).toString() === 'WEBP';
    const pdf=imagePurpose==='EVIDENCE_FILE'&&file.mimetype==='application/pdf'&&file.buffer.subarray(0,5).toString()==='%PDF-';
    if (!image&&!pdf) throw new BadRequestException(imagePurpose==='EVIDENCE_FILE'?'证据文件仅支持 PDF、PNG、JPEG、WebP':'作业附件仅支持 PNG、JPEG、WebP 图片');
    const storageKey = randomUUID();
    await mkdir(this.root, { recursive: true });
    await writeFile(resolve(this.root, storageKey), file.buffer, { flag: 'wx' });
    try {
      return await this.db.$transaction(async tx => {
        const asset = await tx.mediaAsset.create({ data: { storageKey, name: uploadName(file.originalname), mime: file.mimetype, bytes: file.size, uploaderId: req.actor.id, sha256: createHash('sha256').update(file.buffer).digest('hex'), status: 'READY', visibility: 'PRIVATE', ...(imagePurpose?{variants:{uploadPurpose:imagePurpose}}:{}) } });
        await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'media.upload', resource: 'media', resourceId: asset.id, changes: { name: asset.name, bytes: asset.bytes } } });
        return { id: asset.id, name: asset.name, mime: asset.mime, bytes: asset.bytes };
      });
    } catch (e) { await unlink(resolve(this.root, storageKey)); throw e; }
  }
  async imageTicket(submissionId: string, assetId: string, req: AuthRequest) {
    await this.teaching.submissionAccess(submissionId, req.actor);
    if (!await this.db.attachmentBinding.findFirst({ where: { submissionId, assetId } })) throw new NotFoundException('作业图片不存在');
    const payload: Ticket = { submissionId, assetId, userId: req.actor.id, sessionId: req.authSessionId, sessionKind: req.headers.authorization ? 'APP' : 'ADMIN', expires: Date.now() + 5 * 60000 };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = encoded + '.' + createHmac('sha256', this.secret).update(encoded).digest('base64url');
    return { path: '/media/stream?ticket=' + token, expiresAt: new Date(payload.expires).toISOString() };
  }
  async ticket(id: string, req: AuthRequest,cohortId?:string,offlineRegistrationId?:string) {
    if(cohortId&&offlineRegistrationId)throw new BadRequestException('请选择单一课程报名上下文');
    const { lesson } = offlineRegistrationId?await this.offline.lesson(id,req.actor?.id??'',offlineRegistrationId):await this.learning.lesson(id, req.actor?.id,cohortId);
    if (!lesson.mediaId) throw new NotFoundException('该章节没有媒体');
    const media=await this.db.mediaAsset.findUnique({where:{id:lesson.mediaId}});
    if(!media||media.status!=='READY')throw new NotFoundException('该章节媒体暂时不可用');
    try{await stat(resolve(this.root,media.storageKey));}catch{throw new NotFoundException('该章节媒体暂时不可用');}
    if(!offlineRegistrationId)await this.learning.markPaidAccess(id,req.actor?.id,cohortId);
    const payload: Ticket = { lessonId: id,...(offlineRegistrationId?{offlineRegistrationId}:{}),...(cohortId?{cohortId}:{}), ...(req.actor ? { userId: req.actor.id, sessionId: req.authSessionId } : {}), expires: Date.now() + 30 * 60000 };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = encoded + '.' + createHmac('sha256', this.secret).update(encoded).digest('base64url');
    return { path: '/media/stream?ticket=' + token, expiresAt: new Date(payload.expires).toISOString() };
  }
  async replayReviewTicket(id:string,req:AuthRequest){
    requireRoles(req,['MODERATOR']);
    const replay=await this.db.liveReplay.findUnique({where:{sessionId:id}});
    if(!replay)throw new NotFoundException('尚未提交回放');
    const asset=await this.db.mediaAsset.findFirst({where:{id:replay.assetId,status:'READY',mime:'video/mp4'}});
    if(!asset||(asset.variants as {uploadPurpose?:string})?.uploadPurpose)throw new NotFoundException('回放视频不可用');
    try{await stat(resolve(this.root,asset.storageKey));}catch{throw new NotFoundException('回放视频不可用');}
    const payload:Ticket={replayReviewId:replay.id,replayVersion:replay.version,assetId:asset.id,userId:req.actor.id,sessionId:req.authSessionId,sessionKind:'ADMIN',expires:Date.now()+5*60000};
    await this.db.auditLog.create({data:{actorId:req.actor.id,action:'live.replay.preview',resource:'live',resourceId:id,changes:{replayId:replay.id,version:replay.version}}});
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return {path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url'),expiresAt:new Date(payload.expires).toISOString()};
  }
  async replayTicket(id:string,req:AuthRequest){
    const session=await this.live.access(id,req.actor.id),replay=await this.db.liveReplay.findUnique({where:{sessionId:id}});
    if(session.state!=='REPLAY_READY'||!replay||replay.reviewState!=='APPROVED'||!replay.publishedAt||!replay.reviewerId)throw new NotFoundException('回放尚未发布');
    const asset=await this.db.mediaAsset.findFirst({where:{id:replay.assetId,status:'READY',mime:'video/mp4'}});if(!asset)throw new NotFoundException('回放视频暂不可用');
    try{await stat(resolve(this.root,asset.storageKey));}catch{throw new NotFoundException('回放视频暂不可用');}
    await this.live.markCourseStarted(id,req.actor.id);
    const payload:Ticket={liveSessionId:id,replayVersion:replay.version,assetId:replay.assetId,userId:req.actor.id,sessionId:req.authSessionId,expires:Date.now()+5*60000};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return {path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url'),expiresAt:new Date(payload.expires).toISOString(),subtitles:subtitleCues(replay.subtitleText,replay.durationSeconds),notes:replay.notes};
  }
  async digitalFile(deliveryId:string,assetId:string,req:AuthRequest){
    const delivery=await this.db.digitalDelivery.findFirst({where:{id:deliveryId,userId:req.actor.id,revokedAt:null}});
    if(!delivery||delivery.startsAt>new Date()||(delivery.expiresAt&&delivery.expiresAt<=new Date()))throw new ForbiddenException('数字资料已失效或已过期');
    if(!await this.db.digitalReleaseAsset.findFirst({where:{releaseId:delivery.releaseId,assetId}}))throw new NotFoundException('数字资料不存在');
    const asset=await this.db.mediaAsset.findFirst({where:{id:assetId,status:'READY',visibility:'PRIVATE'}});
    if(!asset)throw new NotFoundException('数字资料暂时不可用');
    try{await stat(resolve(this.root,asset.storageKey));}catch{throw new NotFoundException('数字资料暂时不可用');}
    const payload:Ticket={digitalDeliveryId:deliveryId,assetId,userId:req.actor.id,sessionId:req.authSessionId,sessionKind:'APP',expires:Date.now()+10*60000};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return{path:'/media/stream?ticket='+encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url'),mime:asset.mime,name:asset.name,expiresAt:new Date(payload.expires).toISOString()};
  }
  async stream(token: string, req: Request, res: Response) {
    if (!token || token.length > 1000) throw new UnauthorizedException('播放凭证无效');
    const [encoded, signature, extra] = token.split('.');
    const expected = createHmac('sha256', this.secret).update(encoded ?? '').digest('base64url');
    if (!signature || extra || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new UnauthorizedException('播放凭证无效');
    let ticket: Ticket;
    try { ticket = JSON.parse(Buffer.from(encoded!, 'base64url').toString()); } catch { throw new UnauthorizedException('播放凭证无效'); }
    if ((!ticket.adminAssetId && !ticket.referralProofId && !ticket.giftContractId && !ticket.giftSettlementId && !ticket.evidenceId && !ticket.articleId && !ticket.replayReviewId && !ticket.liveSessionId && !ticket.lessonId && !ticket.submissionId && !ticket.checkinId && !ticket.threadId && !ticket.uploadId && !ticket.digitalDeliveryId) || !Number.isFinite(ticket.expires) || ticket.expires <= Date.now()) throw new UnauthorizedException('媒体凭证已过期，请重新打开');
    let assetId: string | null = null;
    if (ticket.userId) {
      const session = await this.db.authSession.findFirst({ where: { id: ticket.sessionId ?? '', userId: ticket.userId, kind: ticket.sessionKind ?? 'APP', revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } }, include: { user: true } });
      if (!session) throw new UnauthorizedException('请重新登录');
      if(ticket.sessionKind==='ADMIN') {
        const needed=ticket.adminAssetId?'media.read':ticket.referralProofKind==='service-delivery'?'orders.read':ticket.referralProofKind==='operating-delivery'?null:ticket.referralProofId?(['member-gift-pool','member-gift-return'].includes(ticket.referralProofKind!)?'products.read':ticket.referralProofKind==='points-returns'?'members.read':ticket.referralProofKind==='promoters'?'courses.read':'finance.read'):ticket.giftContractId||ticket.giftSettlementId?'finance.read':ticket.evidenceId?ticket.evidenceScope+'.read':ticket.articleId?'content.read':ticket.replayReviewId?'live.review':ticket.threadId?'community.read':ticket.submissionId||ticket.checkinId?'teaching.read':null;
        if(ticket.referralProofKind==='service-delivery')requireRoles({actor:session.user} as AuthRequest,['OPERATOR','FINANCE']);
        if(ticket.referralProofKind?.startsWith('operating-')){requireRoles({actor:session.user} as AuthRequest,ticket.referralProofKind==='operating-delivery'?['OPERATOR','FINANCE']:['FINANCE']);if(ticket.referralProofKind==='operating-delivery'&&!(await this.permissions.resolve(session.user.roles)).some(p=>['courses.read','finance.read'].includes(p)))throw new ForbiddenException('服务交付凭证权限已撤销');}
        if(needed&&!(await this.permissions.resolve(session.user.roles)).includes(needed))throw new ForbiddenException('媒体访问权限已撤销，请联系管理员');
      }
      if (ticket.submissionId) {
        await this.teaching.submissionAccess(ticket.submissionId, session.user);
        if (!await this.db.attachmentBinding.findFirst({ where: { submissionId: ticket.submissionId, assetId: ticket.assetId ?? '' } })) throw new NotFoundException('作业图片不存在');
        assetId = ticket.assetId ?? null;
      }
      if(ticket.checkinId){await this.practices.checkinAccess(ticket.checkinId,session.user);if(!await this.db.attachmentBinding.findFirst({where:{checkinId:ticket.checkinId,assetId:ticket.assetId??''}}))throw new NotFoundException('实践图片不存在');assetId=ticket.assetId??null;}
      if(ticket.digitalDeliveryId){
        const delivery=await this.db.digitalDelivery.findFirst({where:{id:ticket.digitalDeliveryId,userId:session.user.id,revokedAt:null}});
        if(!delivery||delivery.startsAt>new Date()||(delivery.expiresAt&&delivery.expiresAt<=new Date()))throw new ForbiddenException('数字资料已失效或已过期');
        if(!await this.db.digitalReleaseAsset.findFirst({where:{releaseId:delivery.releaseId,assetId:ticket.assetId??''}}))throw new NotFoundException('数字资料不存在');
        assetId=ticket.assetId??null;
      }
      if(ticket.threadId&&ticket.sessionKind==='ADMIN')requireRoles({actor:session.user} as AuthRequest,['OPERATOR','MODERATOR']);
    }
    if(ticket.adminAssetId){if(!ticket.userId||ticket.sessionKind!=='ADMIN')throw new UnauthorizedException('请登录运营后台');const asset=await this.db.mediaAsset.findUnique({where:{id:ticket.adminAssetId}});if(!asset||asset.version!==ticket.adminAssetVersion||asset.status!=='READY'||(asset.variants as {uploadPurpose?:string})?.uploadPurpose||asset.id!==ticket.assetId)throw new NotFoundException('课件已变化，请重新预览');assetId=asset.id;}
    if(ticket.referralProofId){if(ticket.sessionKind!=='ADMIN'||!ticket.userId||!ticket.referralProofKind)throw new UnauthorizedException();const bound=await this.referralProof(ticket.referralProofKind,ticket.referralProofId);if(!bound||bound!==ticket.assetId)throw new NotFoundException('凭证已变化');assetId=bound;}
    if(ticket.threadId){
      const asset=await this.forumAsset(ticket.threadId,ticket.assetId??'',ticket.userId,ticket.sessionKind==='ADMIN',!!ticket.forumMedia);
      if(ticket.threadVersion!==undefined&&asset.threadVersion!==ticket.threadVersion)throw new NotFoundException('帖子已更新，请重新打开');
      assetId=asset.id;
    }
    if(ticket.uploadId){
      if(!ticket.userId||ticket.sessionKind!=='APP')throw new UnauthorizedException('请重新登录');
      assetId=(await this.forumUploadAsset(ticket.uploadId,ticket.userId)).id;
      if(assetId!==ticket.assetId)throw new NotFoundException('投稿媒体已变化');
    }
    if(ticket.giftContractId||ticket.giftSettlementId){
      if(ticket.sessionKind!=='ADMIN'||!ticket.userId)throw new UnauthorizedException('请登录财务账号');const row=ticket.giftContractId?await this.db.partnerContract.findUnique({where:{id:ticket.giftContractId}}):await this.db.settlement.findUnique({where:{id:ticket.giftSettlementId!}});
      if(!row||row.proofAssetId!==ticket.assetId)throw new NotFoundException('凭证已变化，请重新打开');const proof=await this.db.mediaAsset.findFirst({where:{id:ticket.assetId,status:'READY',visibility:'PRIVATE',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}});if(!proof)throw new NotFoundException('凭证不可用');res.set('X-Content-Type-Options','nosniff');res.set('Content-Disposition','attachment; filename="gift-proof'+(proof.mime==='application/pdf'?'.pdf':proof.mime==='image/png'?'.png':proof.mime==='image/webp'?'.webp':'.jpg')+'"');assetId=proof.id;
    }
    if(ticket.evidenceId){
      if(ticket.sessionKind!=='ADMIN'||!ticket.userId)throw new UnauthorizedException('请登录运营后台查看证据');
      const evidence=await this.db.sourceEvidence.findUnique({where:{id:ticket.evidenceId}});
      if(!evidence||evidence.version!==ticket.evidenceVersion||evidence.proofAssetId!==ticket.assetId||!await this.db.resourceEvidence.findFirst({where:{resourceId:ticket.evidenceResourceId??'',evidenceId:ticket.evidenceId}}))throw new NotFoundException('证据已更新或撤回，请重新打开');
      const proof=await this.db.mediaAsset.findUnique({where:{id:ticket.assetId??''}});
      if((proof?.variants as {uploadPurpose?:string}|null)?.uploadPurpose!=='EVIDENCE_FILE')throw new NotFoundException('证据文件不存在');
      res.set('X-Content-Type-Options','nosniff');if(proof?.mime==='application/pdf')res.set('Content-Disposition','attachment; filename="evidence.pdf"');
      assetId=ticket.assetId??null;
    }
    if(ticket.articleId){
      if(ticket.articlePreview&&(!ticket.userId||ticket.sessionKind!=='ADMIN'))throw new UnauthorizedException('请重新登录审核账号');
      const {asset}=await this.articleBlock(ticket.articleId,ticket.articleBlockId??'',ticket.userId,ticket.articlePreview,ticket.articleVersion);
      if(asset.id!==ticket.assetId)throw new NotFoundException('音视频已更新，请重新打开文章');
      assetId=asset.id;
    }
    if(ticket.replayReviewId){
      if(!ticket.userId||ticket.sessionKind!=='ADMIN')throw new UnauthorizedException('请重新登录审核账号');
      const replay=await this.db.liveReplay.findUnique({where:{id:ticket.replayReviewId}});
      if(!replay||replay.version!==ticket.replayVersion||replay.assetId!==ticket.assetId)throw new NotFoundException('回放已变化，请重新打开审核');
      assetId=replay.assetId;
    }
    if (ticket.lessonId) assetId = ticket.offlineRegistrationId?(await this.offline.lesson(ticket.lessonId,ticket.userId??'',ticket.offlineRegistrationId)).lesson.mediaId:(await this.learning.lesson(ticket.lessonId, ticket.userId,ticket.cohortId)).lesson.mediaId;
    if(ticket.liveSessionId){
      if(!ticket.userId)throw new UnauthorizedException('请重新登录');
      const live=await this.live.access(ticket.liveSessionId,ticket.userId),replay=await this.db.liveReplay.findUnique({where:{sessionId:live.id}});
      if(live.state!=='REPLAY_READY'||!replay||replay.reviewState!=='APPROVED'||!replay.publishedAt||!replay.reviewerId||replay.assetId!==ticket.assetId||replay.version!==ticket.replayVersion)throw new NotFoundException('回放已经撤下或更新');
      assetId=replay.assetId;
    }
    const asset = assetId ? await this.db.mediaAsset.findUnique({ where: { id: assetId } }) : null;
    if (!asset || asset.status !== 'READY' || (ticket.submissionId||ticket.checkinId||ticket.threadId&&!ticket.forumMedia) && !['image/png','image/jpeg','image/webp'].includes(asset.mime)) throw new NotFoundException('媒体不存在');
    return this.deliver(asset,req,res);
  }
  async avatar(id:string,req:Request,res:Response){
    const user=await this.db.user.findFirst({where:{id,status:'ACTIVE'}});
    const asset=user?.avatarAssetId?await this.db.mediaAsset.findFirst({where:{id:user.avatarAssetId,uploaderId:id,status:'READY',variants:{path:['uploadPurpose'],equals:'PROFILE_IMAGE'},mime:{in:['image/png','image/jpeg','image/webp']}}}):null;
    if(!asset)throw new NotFoundException('头像不存在');
    return this.deliver(asset,req,res);
  }
  private async deliver(asset:{storageKey:string;mime:string},req:Request,res:Response){
    const path = resolve(this.root, asset.storageKey);
    let bytes: number;
    try { bytes = (await stat(path)).size; } catch { throw new NotFoundException('媒体暂时不可用'); }
    res.set({ 'Content-Type': asset.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Accel-Buffering':'no' });
    let start = 0, end = bytes - 1;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.status(416).set('Content-Range', `bytes */${bytes}`).end(); return; }
      if (!match[1]) start = Math.max(0, bytes - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes) { res.status(416).set('Content-Range', `bytes */${bytes}`).end(); return; }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${bytes}`);
    }
    res.set('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(path, { start, end });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
}
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService, private readonly db: Database, private readonly ingest:MediaIngest) {}
  @Post('admin/media') @UseGuards(AdminGuard) @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 0 } })) upload(@Req() req: AuthRequest, @UploadedFile() file: FileUpload) { return this.ingest.legacy(req, file); }
  @Post('learning/submission-images') @UseGuards(UserGuard) @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } })) image(@Req() req: AuthRequest, @UploadedFile() file: FileUpload) { return this.media.upload(req, file, true); }
  @Post('forum/images') @UseGuards(UserGuard) @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024,files:1,fields:0}})) forumImage(@Req() req:AuthRequest,@UploadedFile() file:FileUpload){return this.media.upload(req,file,true,'FORUM_IMAGE');}
  @Post('forum/media/uploads/:id/preview') @UseGuards(UserGuard) forumUploadPreview(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.media.forumUploadTicket(id,req);}
  @Post('forum/threads/:id/media/:assetId') @UseGuards(OptionalUserGuard) forumMedia(@Param('id',ParseUUIDPipe) id:string,@Param('assetId',ParseUUIDPipe) assetId:string,@Req() req:AuthRequest){return this.media.forumTicket(id,assetId,req);}
  @Post('admin/forum/threads/:id/media/:assetId') @UseGuards(AdminGuard) adminForumMedia(@Param('id',ParseUUIDPipe) id:string,@Param('assetId',ParseUUIDPipe) assetId:string,@Req() req:AuthRequest){return this.media.forumTicket(id,assetId,req,true);}
  @Post('me/profile/avatar') @UseGuards(UserGuard) @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024,files:1,fields:0}})) avatarUpload(@Req() req:AuthRequest,@UploadedFile() file:FileUpload){return this.media.upload(req,file,true,'PROFILE_IMAGE');}
  @Get('profiles/:id/avatar') avatar(@Param('id',ParseUUIDPipe) id:string,@Req() req:Request,@Res() res:Response){return this.media.avatar(id,req,res);}
  @Post('forum/threads/:id/images/:assetId') @UseGuards(OptionalUserGuard) forumTicket(@Param('id',ParseUUIDPipe) id:string,@Param('assetId',ParseUUIDPipe) assetId:string,@Req() req:AuthRequest){return this.media.forumImageTicket(id,assetId,req);}
  @Post('admin/forum/threads/:id/images/:assetId') @UseGuards(AdminGuard) adminForumTicket(@Param('id',ParseUUIDPipe) id:string,@Param('assetId',ParseUUIDPipe) assetId:string,@Req() req:AuthRequest){return this.media.forumImageTicket(id,assetId,req,true);}
  @Post('learning/checkins/:id/images/:assetId') @UseGuards(UserGuard) checkinImageTicket(@Param('id',ParseUUIDPipe) id:string,@Param('assetId',ParseUUIDPipe) assetId:string,@Req() req:AuthRequest){return this.media.checkinImageTicket(id,assetId,req);}
  @Post('admin/teaching/checkins/:id/images/:assetId') @UseGuards(AdminGuard) adminCheckinImageTicket(@Param('id',ParseUUIDPipe) id:string,@Param('assetId',ParseUUIDPipe) assetId:string,@Req() req:AuthRequest){return this.media.checkinImageTicket(id,assetId,req);}
  @Post('learning/submissions/:id/images/:assetId') @UseGuards(UserGuard) imageTicket(@Param('id', ParseUUIDPipe) id: string, @Param('assetId', ParseUUIDPipe) assetId: string, @Req() req: AuthRequest) { return this.media.imageTicket(id, assetId, req); }
  @Post('admin/teaching/submissions/:id/images/:assetId') @UseGuards(AdminGuard) adminImageTicket(@Param('id', ParseUUIDPipe) id: string, @Param('assetId', ParseUUIDPipe) assetId: string, @Req() req: AuthRequest) { return this.media.imageTicket(id, assetId, req); }
  @Get('admin/media') @UseGuards(AdminGuard) async list(@Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); return (await this.media.library(Object.assign(new MediaQuery(),{size:50}))).items; }
  @Get('admin/media-library') @UseGuards(AdminGuard) library(@Query() query:MediaQuery) {return this.media.library(query);}
  @Post('admin/media/assets/:id/preview') @UseGuards(AdminGuard) assetPreview(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.media.assetPreview(id,req);}
  @Get('admin/media/assets/:id') @UseGuards(AdminGuard) asset(@Param('id',ParseUUIDPipe) id:string){return this.media.asset(id);}
  @Post('articles/:id/blocks/:blockId/media') @UseGuards(OptionalUserGuard) articleTicket(@Param('id',ParseUUIDPipe) id:string,@Param('blockId') blockId:string,@Req() req:AuthRequest){return this.media.articleTicket(id,blockId,req);}
  @Post('admin/articles/:id/blocks/:blockId/media') @UseGuards(AdminGuard) articlePreview(@Param('id',ParseUUIDPipe) id:string,@Param('blockId') blockId:string,@Req() req:AuthRequest){return this.media.articleTicket(id,blockId,req,true);}
  @Post('learning/lessons/:id/media') @UseGuards(OptionalUserGuard) ticket(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest,@Query() query:LearningContextQuery) { return this.media.ticket(id, req,query.cohortId,query.offlineRegistrationId); }
  @Get('media/stream') stream(@Query('ticket') ticket: string, @Req() req: Request, @Res() res: Response) { return this.media.stream(ticket, req, res); }
  @Post('admin/live/sessions/:id/replay/review/preview') @UseGuards(AdminGuard) replayPreview(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.media.replayReviewTicket(id,req);}
  @Post('live/sessions/:id/replay-ticket') @UseGuards(UserGuard) replay(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.media.replayTicket(id,req);}
}

