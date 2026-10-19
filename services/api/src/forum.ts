import {dailyGrowthAllocated} from './consumption-policy.js';
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { AdminGuard, OptionalUserGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { SystemConfig } from './system-config.js';
import { resourceScopes } from './admin-permissions.js';
import { Database } from './database.js';
import { LearningService } from './learning.js';
import { Prisma } from './generated/prisma/client.js';
import {changePoints,pointsDay} from './points-accounting.js';
import { publicContentScope } from './public-content.js';

class ForumPage {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
  @IsOptional() @IsUUID() sectionId?:string;
  @IsOptional() @IsIn(['PENDING','APPROVED','REJECTED','REMOVED','REVIEW','PUBLISHED','ARCHIVED','RESOLVED']) state?:string;
  @IsOptional() @IsIn(['recent','popular','essence']) sort='recent';
  @IsOptional() @IsString() @Length(1,30) tag?:string;
}
class CourseSectionQuery { @IsOptional() @IsUUID() courseId?:string; @IsOptional() @IsUUID() cohortId?:string; }
class PrivateSourceDto {
  @IsIn(['NOTE','JOURNAL']) kind!:string;
  @IsUUID() id!:string;
  @IsInt() @Min(1) version!:number;
  @IsBoolean() consent!:boolean;
  @IsBoolean() includeQuote!:boolean;
}
class ThreadDto {
  @IsOptional() @ValidateNested() @Type(()=>PrivateSourceDto) privateSource?:PrivateSourceDto;
  @IsUUID() requestKey!:string;
  @IsUUID() sectionId!:string;
  @IsString() @Length(2,120) @Matches(/\S/) title!:string;
  @IsString() @Length(1,10000) @Matches(/\S/) body!:string;
  @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsUUID(undefined,{each:true}) assetIds!:string[];
  @IsOptional() @IsArray() @ArrayMaxSize(2) @ArrayUnique() @IsUUID(undefined,{each:true}) mediaIds:string[]=[];
  @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsString({each:true}) @Length(1,30,{each:true}) tags!:string[];
  @IsOptional() @IsUUID() articleId?:string;
}
class ReplyDto {
  @IsUUID() requestKey!:string;
  @IsString() @Length(1,5000) @Matches(/\S/) body!:string;
  @IsOptional() @IsUUID() parentId?:string;
}
class VersionDto { @IsInt() @Min(1) expectedVersion!:number; }
class ModerationDto extends VersionDto {
  @IsIn(['APPROVE','REJECT','HIDE','RESTORE']) action!:string;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
  @IsOptional() @IsUUID() reportId?:string;
  @IsOptional() @IsBoolean() mediaReviewed?:boolean;
}
class FeatureDto extends VersionDto {
  @IsBoolean() essence!:boolean;
  @IsInt() @Min(0) @Max(30) pinDays!:number;
}
class RestrictionDto {
  @IsIn(['ALL','POST','COMMENT']) scope!:string;
  @IsInt() @Min(1) @Max(365) days!:number;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class RevokeDto extends VersionDto { @IsString() @Length(2,500) @Matches(/\S/) reason!:string; }
class ReportDto {
  @IsIn(['SPAM','INAPPROPRIATE','MISLEADING','COPYRIGHT','OTHER']) reason!:string;
  @IsString() @Length(0,1000) description!:string;
  @IsOptional() @IsUUID() commentId?:string;
}
class ReportResolveDto extends VersionDto { @IsString() @Length(2,500) @Matches(/\S/) reason!:string; }
class ReactionDto { @IsIn(['LIKE','FAVORITE']) kind!:string; @IsBoolean() active!:boolean; }

@Injectable()
export class ForumService {
  constructor(private readonly db:Database,private readonly learning:LearningService,private readonly config:SystemConfig){}
  async privateSource(kind:string,id:string,userId:string,tx:Prisma.TransactionClient=this.db){
    if(!['NOTE','JOURNAL'].includes(kind))throw new NotFoundException('私人记录类型无效');
    const note=kind==='NOTE'?await tx.note.findFirst({where:{id,userId,deletedAt:null}}):null;
    const journal=kind==='JOURNAL'?await tx.practiceLog.findFirst({where:{id,userId,deletedAt:null}}):null;
    if(!note&&!journal)throw new NotFoundException('私人记录不存在或已删除');
    const source=note??journal!,article=note?.releaseId?await tx.article.findFirst({where:{id:note.articleId,...await publicContentScope(tx),visibility:'PUBLIC',currentReleaseId:note.releaseId,version:note.articleVersion}}):null;
    const canIncludeQuote=!!article&&!!note?.quote&&note.quote.length<=1000;
    return {kind,id,version:source.version,text:source.text,title:note?'读《'+note.articleTitle+'》有感':journal!.day+' · 研习心得',canIncludeQuote,quote:canIncludeQuote?note!.quote:'',articleId:article?.id??null};
  }
  private async courseAccess(courseId:string,userId?:string,tx:Prisma.TransactionClient=this.db){
    if(!userId)throw new ForbiddenException('登录并加入课程后可进入讨论区');
    const user=await tx.user.findUnique({where:{id:userId},select:{roles:true}});
    if(user?.roles.includes('TEACHER')&&await tx.courseStaff.findFirst({where:{courseId,userId,cohortId:null,revokedAt:null}}))return;
    const context=await this.learning.context(courseId,userId,tx);
    if(context.access==='TRIAL')throw new ForbiddenException('加入课程后可进入讨论区');
  }
  async section(id:string,userId?:string,tx:Prisma.TransactionClient=this.db){
    const row=await tx.forumSection.findFirst({where:{id,active:true}});
    if(!row)throw new NotFoundException('讨论区不存在或已关闭');
    if(row.cohortId){
      if(!userId)throw new ForbiddenException('登录并加入本营期后可进入讨论');
      if(tx!==this.db)await tx.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${row.cohortId} FOR SHARE`;
      const cohort=await tx.courseCohort.findUnique({where:{id:row.cohortId}}),enrollment=await tx.cohortRegistration.findFirst({where:{userId,cohortId:row.cohortId,revokedAt:null,suspendedAt:null}}),user=await tx.user.findUnique({where:{id:userId},select:{roles:true}});
      const staff=user?.roles.includes('TEACHER')&&await tx.courseStaff.findFirst({where:{userId,cohortId:row.cohortId,revokedAt:null}});
      if(!cohort||cohort.state==='CANCELLED'||cohort.endsAt<=new Date()||!enrollment&&!staff||!staff&&enrollment&&enrollment.acceptedScheduleVersion<cohort.scheduleVersion)throw new ForbiddenException('仅确认最新安排的本营期有效学员和教学人员可进入讨论');
    }else if(row.scope==='COURSE')await this.courseAccess(row.courseId!,userId,tx);
    return row;
  }
  async sections(userId?:string,courseId?:string,cohortId?:string){
    if(cohortId){const row=await this.db.forumSection.findFirst({where:{cohortId,active:true}});if(!row)throw new NotFoundException('营内讨论尚未开放');await this.section(row.id,userId);return {items:[row]};}
    if(courseId){
      await this.courseAccess(courseId,userId);
      const row=await this.db.forumSection.upsert({where:{code:'course:'+courseId},create:{code:'course:'+courseId,title:'课程讨论',scope:'COURSE',courseId,description:'与同课学员交流研习心得。',active:true},update:{}});
      return{items:row.active?[row]:[]};
    }
    return{items:await this.db.forumSection.findMany({where:{scope:'PUBLIC',active:true,cohortId:null},orderBy:{code:'asc'}})};
  }
  async tags(sectionId:string,userId?:string){
    await this.section(sectionId,userId);
    return this.db.$queryRaw<{name:string;count:number}[]>`SELECT g.name,count(*)::int AS count FROM "ResourceTag" rt JOIN "Tag" g ON g.id=rt."tagId" AND g.active JOIN "ForumThread" t ON t.id=rt."resourceId" JOIN "Resource" r ON r.id=t.id WHERE t."sectionId"=${sectionId} AND t."deletedAt" IS NULL AND r."publishState"='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM "UserBlock" b WHERE b."userId"=${userId??''} AND b."blockedId"=t."authorId") GROUP BY g.name ORDER BY count DESC,g.name LIMIT 40`;
  }
  async context(id:string,userId?:string,admin=false,tx:Prisma.TransactionClient=this.db){
    const thread=await tx.forumThread.findUnique({where:{id}}),resource=await tx.resource.findFirst({where:{id,kind:'THREAD'}});
    if(!thread||!resource)throw new NotFoundException('帖子不存在');
    const section=admin?await tx.forumSection.findUniqueOrThrow({where:{id:thread.sectionId}}):await this.section(thread.sectionId,userId,tx);
    if(!admin&&(thread.deletedAt||resource.publishState!=='PUBLISHED')&&thread.authorId!==userId)throw new NotFoundException('帖子尚未公开或已下架');
    if(!admin&&userId&&await tx.userBlock.findFirst({where:{userId,blockedId:thread.authorId}}))throw new NotFoundException('你已屏蔽该作者的内容');
    return {thread,resource,section};
  }
  async detail(id:string,userId?:string,admin=false,tx:Prisma.TransactionClient=this.db){
    const {thread,resource,section}=await this.context(id,userId,admin,tx);
    const author=await tx.user.findUniqueOrThrow({where:{id:thread.authorId},select:{id:true,nickname:true,avatar:true}});
    const staff=section.courseId?await tx.courseStaff.findFirst({where:{courseId:section.courseId,userId:author.id,cohortId:section.cohortId,revokedAt:null}}):null;
    const tags=await tx.$queryRaw<{name:string}[]>`SELECT g.name FROM "ResourceTag" rt JOIN "Tag" g ON g.id=rt."tagId" AND g.active WHERE rt."resourceId"=${id} ORDER BY g.name`;
    const [reactions,likes,favorites]=await Promise.all([userId?tx.reaction.findMany({where:{resourceId:id,userId}}):[],tx.reaction.count({where:{resourceId:id,kind:'LIKE'}}),tx.reaction.count({where:{resourceId:id,kind:'FAVORITE'}})]);
    const release=thread.citationReleaseId?await tx.articleRelease.findUnique({where:{id:thread.citationReleaseId}}):null;
    const article=release?await tx.article.findFirst({where:{id:release.articleId,...await publicContentScope(tx),visibility:'PUBLIC'}}):null;
    const blocks=Array.isArray(thread.blocks)?thread.blocks.filter(b=>!b||typeof b!=='object'||(b as {type?:string}).type!=='articleQuote'||admin||!!article&&!!release&&article.currentReleaseId===release.id):[];
    return{...thread,blocks,title:resource.title,summary:resource.summary,state:resource.publishState,section,author:{...author,teachingRole:staff?.role??null},tags:tags.map(t=>t.name),likes,favorites,liked:reactions.some(r=>r.kind==='LIKE'),favorited:reactions.some(r=>r.kind==='FAVORITE'),citation:article&&release?{articleId:article.id,title:article.title,version:release.releaseNo}:null};
  }
  async list(userId:string|undefined,query:ForumPage,mine=false,admin=false){
    if(!mine&&!admin&&!query.sectionId)throw new BadRequestException('请选择讨论区');
    if(query.sectionId&&!admin)await this.section(query.sectionId,userId);
    const filter=Prisma.sql`${query.sectionId?Prisma.sql`AND t."sectionId"=${query.sectionId}`:Prisma.empty}
      ${mine?Prisma.sql`AND t."authorId"=${userId}`:admin?Prisma.empty:Prisma.sql`AND t."deletedAt" IS NULL AND r."publishState"='PUBLISHED'`}
      ${admin&&query.state?Prisma.sql`AND r."publishState"=${query.state}`:Prisma.empty}
      ${!admin&&userId?Prisma.sql`AND NOT EXISTS(SELECT 1 FROM "UserBlock" b WHERE b."userId"=${userId} AND b."blockedId"=t."authorId")`:Prisma.empty}
      ${query.sort==='essence'?Prisma.sql`AND t.essence`:Prisma.empty}`;
    const source=Prisma.sql`FROM "ForumThread" t JOIN "Resource" r ON r.id=t.id JOIN "ForumSection" s ON s.id=t."sectionId" JOIN "User" u ON u.id=t."authorId" WHERE ${admin?Prisma.sql`true`:Prisma.sql`s.active AND (s."cohortId" IS NULL OR s.id=${query.sectionId??null})`} ${mine&&!query.sectionId?Prisma.sql`AND s.scope='PUBLIC'`:Prisma.empty} ${filter} ${query.tag?Prisma.sql`AND EXISTS(SELECT 1 FROM "ResourceTag" rt JOIN "Tag" g ON g.id=rt."tagId" WHERE rt."resourceId"=t.id AND g.active AND g.name=${query.tag})`:Prisma.empty}`;
    const [items,count]=await this.db.$transaction([
      this.db.$queryRaw<unknown[]>(Prisma.sql`SELECT t.id,t.version,t.essence,t."pinnedUntil",t."createdAt",t."authorId",r.title,r.summary,r."publishState" AS state,s.title AS "sectionTitle",u.nickname AS "authorName",(SELECT count(*)::int FROM "Reaction" x WHERE x."resourceId"=t.id AND x.kind='LIKE') AS likes ${source} ORDER BY (t."pinnedUntil">now()) DESC NULLS LAST,${query.sort==='popular'?Prisma.sql`(SELECT count(*) FROM "Reaction" x WHERE x."resourceId"=t.id AND x.kind='LIKE') DESC,`:Prisma.empty} t."createdAt" DESC,t.id DESC LIMIT ${query.size} OFFSET ${(query.page-1)*query.size}`),
      this.db.$queryRaw<{total:number}[]>(Prisma.sql`SELECT count(*)::int AS total ${source}`),
    ]);return{items,total:count[0]!.total};
  }
  private async allowed(userId:string,scope:string,resourceId:string|undefined,tx:Prisma.TransactionClient){
    const now=new Date();
    const user=await tx.user.findUnique({where:{id:userId}});if(user?.status!=='ACTIVE')throw new ForbiddenException('当前账号不能发言');
    if(await tx.userRestriction.findFirst({where:{userId,scope:{in:['ALL',scope]},revokedAt:null,startsAt:{lte:now},AND:[{OR:[{endsAt:null},{endsAt:{gt:now}}]},{OR:[{resourceId:null},...(resourceId?[{resourceId}]:[])]}]}}))throw new ForbiddenException('当前账号暂不能发言');
  }
  async postingAccess(userId:string,sectionId:string,tx:Prisma.TransactionClient=this.db){
    await this.allowed(userId,'POST',sectionId,tx);
    const section=await this.section(sectionId,userId,tx);
    if(section.scope==='PUBLIC'&&!(await this.config.current('community')).value.publicPostingEnabled)throw new ForbiddenException('公共讨论区暂时停止接收新帖，已有内容仍可阅读');
    return section;
  }
  private async cached(tx:Prisma.TransactionClient,userId:string,operation:string,key:string,payload:unknown,create:()=>Promise<unknown>){
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const payloadHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const prior=await tx.idempotencyRecord.findFirst({where:{userId,operation,requestKey:key}});
    if(prior){if(prior.payloadHash!==payloadHash)throw new ConflictException('提交编号已用于其他内容');return prior.response;}
    const result=await create(),response=JSON.parse(JSON.stringify(result));
    await tx.idempotencyRecord.create({data:{userId,operation,requestKey:key,payloadHash,state:'DONE',responseCode:201,response,expiresAt:new Date(Date.now()+30*86400000)}});return result;
  }
  async create(userId:string,dto:ThreadDto){return this.db.$transaction(tx=>this.cached(tx,userId,'forum.thread.create',dto.requestKey,dto,async()=>{
    const section=await this.postingAccess(userId,dto.sectionId,tx);
    if(await tx.forumThread.count({where:{authorId:userId,createdAt:{gte:new Date(Date.now()-86400000)}}})>=10)throw new BadRequestException('每天最多发10篇帖子');
    if(dto.assetIds.length){
      if(await tx.mediaAsset.count({where:{id:{in:dto.assetIds},uploaderId:userId,status:'READY',visibility:'PRIVATE',mime:{in:['image/png','image/jpeg','image/webp']},variants:{path:['uploadPurpose'],equals:'FORUM_IMAGE'}}})!==dto.assetIds.length)throw new BadRequestException('请选择在发帖页上传的图片，私人附件不能直接公开');
      if(await tx.attachmentBinding.count({where:{assetId:{in:dto.assetIds},purpose:{not:'FORUM_IMAGE'}}}))throw new BadRequestException('私人作业或打卡图片不能直接公开，请重新选择上传');
    }
    const mediaIds=dto.mediaIds??[];
    if(mediaIds.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM "MediaAsset" WHERE id IN (${Prisma.join([...mediaIds].sort())}) ORDER BY id FOR UPDATE`);
    const media=mediaIds.length?await tx.mediaAsset.findMany({where:{id:{in:mediaIds},uploaderId:userId,status:'READY',visibility:'PRIVATE',mime:{in:['video/mp4','audio/mp4']},durationSeconds:{gt:0,lte:600},variants:{path:['uploadPurpose'],equals:'FORUM_MEDIA'}}}):[];
    if(media.length!==mediaIds.length||mediaIds.length&&await tx.mediaUpload.count({where:{assetId:{in:mediaIds},uploaderId:userId,purpose:'FORUM_MEDIA',forumSectionId:section.id,state:'READY',expiresAt:{gt:new Date()}}})!==mediaIds.length)throw new BadRequestException('请选择本讨论区投稿并已处理完成的音视频，私人课件不能公开');
    if(mediaIds.length&&await tx.attachmentBinding.count({where:{assetId:{in:mediaIds}}}))throw new ConflictException('音视频已用于其他内容，请重新上传');
    let citationReleaseId:string|null=null,citationId=dto.articleId,body=dto.body.trim(),citationQuote='';
    if(dto.privateSource){
      const input=dto.privateSource;
      if(!input.consent)throw new BadRequestException('请明确同意将编辑后的选定内容提交公开审核');
      if(section.scope!=='PUBLIC'||section.cohortId)throw new BadRequestException('私人记录主动分享请选择公共研习讨论区');
      const table=input.kind==='NOTE'?'Note':'PracticeLog';await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"'+table+'"')} WHERE id=${input.id} AND "userId"=${userId} FOR SHARE`);
      const source=await this.privateSource(input.kind,input.id,userId,tx);
      if(source.version!==input.version)throw new ConflictException('原记录已更新，请重新打开分享，当前编辑内容尚未发布');
      if(input.includeQuote){
        if(!source.canIncludeQuote||!source.articleId)throw new BadRequestException('原文已变更、下架、超过引用长度或为会员内容，仅可分享自己的心得');
        if(citationId&&citationId!==source.articleId)throw new BadRequestException('所选原文引用与私人笔记来源不一致');
        citationId=source.articleId;citationQuote=source.quote;
      }
    }
    if(citationId){const article=await tx.article.findFirst({where:{id:citationId,...await publicContentScope(tx),visibility:'PUBLIC',currentReleaseId:{not:null}}});if(!article)throw new BadRequestException('只能引用已公开文章');citationReleaseId=article.currentReleaseId;}
    const id=randomUUID();await tx.resource.create({data:{id,kind:'THREAD',title:dto.title.trim(),summary:body.slice(0,180),publishState:'REVIEW',visibility:section.scope==='PUBLIC'?'PUBLIC':'COURSE',categoryCode:section.code,ownerId:userId}});
    const thread=await tx.forumThread.create({data:{id,sectionId:section.id,authorId:userId,blocks:[...(citationQuote?[{type:'articleQuote',text:citationQuote}]:[]),{type:'text',text:body},...dto.assetIds.map(assetId=>({type:'image',assetId})),...mediaIds.map(assetId=>({type:media.find(a=>a.id===assetId)!.mime==='video/mp4'?'video':'audio',assetId}))],citationReleaseId}});
    if(dto.privateSource)await tx.consentRecord.create({data:{userId,policyCode:'PRIVATE_RECORD_SHARING',policyVersion:'1',purpose:'forum-thread:'+id,accepted:true,actedAt:new Date(),source:dto.privateSource.kind+':'+dto.privateSource.id+':'+dto.privateSource.version}});
    // The projection trigger resets summary on thread writes; write owned presentation fields afterwards.
    await tx.resource.update({where:{id},data:{summary:body.slice(0,180)}});
    for(let position=0;position<dto.assetIds.length;position++)await tx.attachmentBinding.create({data:{threadId:id,assetId:dto.assetIds[position]!,purpose:'FORUM_IMAGE',position}});
    for(let position=0;position<mediaIds.length;position++)await tx.attachmentBinding.create({data:{threadId:id,assetId:mediaIds[position]!,purpose:'FORUM_MEDIA',position:dto.assetIds.length+position}});
    for(const name of [...new Set(dto.tags.map(s=>s.trim()).filter(Boolean))]){const code='forum:'+createHash('sha256').update(name).digest('hex');const tag=await tx.tag.upsert({where:{code},create:{code,name,active:true},update:{}});await tx.resourceTag.create({data:{resourceId:id,tagId:tag.id}});}
    return{...thread,state:'REVIEW'};
  }));}
  async comments(id:string,userId:string|undefined,query:ForumPage){
    const thread=await this.detail(id,userId);if(thread.state!=='PUBLISHED'||thread.deletedAt)throw new ForbiddenException('帖子未公开，不能参与讨论');
    const blocked=userId?await this.db.userBlock.findMany({where:{userId},select:{blockedId:true}}):[];
    const where={resourceId:id,deletedAt:null,authorId:{notIn:blocked.map(b=>b.blockedId)},...(userId?{OR:[{reviewState:'APPROVED'},{authorId:userId,reviewState:{in:['PENDING','REJECTED']}}]}:{reviewState:'APPROVED'})};
    const [rows,total]=await this.db.$transaction([this.db.comment.findMany({where,orderBy:[{createdAt:'asc'},{id:'asc'}],skip:(query.page-1)*query.size,take:query.size}),this.db.comment.count({where})]);
    const authors=await this.db.user.findMany({where:{id:{in:rows.map(r=>r.authorId)}},select:{id:true,nickname:true,avatar:true}});
    const staff=thread.section.courseId?await this.db.courseStaff.findMany({where:{courseId:thread.section.courseId,userId:{in:rows.map(r=>r.authorId)},cohortId:thread.section.cohortId,revokedAt:null}}):[];
    return{items:rows.map(r=>({...r,author:{...authors.find(a=>a.id===r.authorId),teachingRole:staff.find(a=>a.userId===r.authorId)?.role??null}})),total};
  }
  async reply(id:string,userId:string,dto:ReplyDto){return this.db.$transaction(tx=>this.cached(tx,userId,'forum.reply:'+id,dto.requestKey,dto,async()=>{
    await this.allowed(userId,'COMMENT',id,tx);await tx.$queryRaw`SELECT id FROM "ForumThread" WHERE id=${id} FOR SHARE`;
    const thread=await this.detail(id,userId,false,tx);if(thread.state!=='PUBLISHED'||thread.deletedAt)throw new ForbiddenException('帖子未公开');
    let target=thread.authorId;
    if(dto.parentId){const parent=await tx.comment.findFirst({where:{id:dto.parentId,resourceId:id,reviewState:'APPROVED',deletedAt:null}});if(!parent)throw new BadRequestException('回复内容不可用');target=parent.authorId;}
    if(await tx.userBlock.findFirst({where:{OR:[{userId,blockedId:target},{userId:target,blockedId:userId}]}}))throw new ForbiddenException('已拉黑的用户之间不能直接互动');
    if(await tx.comment.count({where:{authorId:userId,createdAt:{gte:new Date(Date.now()-3600000)}}})>=30)throw new BadRequestException('发言过于频繁，请稍后再试');
    // Without a configured automated content provider, every reply enters human review.
    return tx.comment.create({data:{resourceId:id,authorId:userId,parentId:dto.parentId,body:dto.body.trim(),reviewState:'PENDING'}});
  }));}
  async react(id:string,userId:string,dto:ReactionDto){
    const thread=await this.detail(id,userId);if(thread.state!=='PUBLISHED'||thread.deletedAt)throw new ForbiddenException('帖子未公开');
    if(dto.active)await this.db.$executeRaw`INSERT INTO "Reaction" ("userId","resourceId",kind) VALUES (${userId},${id},${dto.kind}) ON CONFLICT ("userId","resourceId",kind) DO NOTHING`;
    else await this.db.reaction.deleteMany({where:{userId,resourceId:id,kind:dto.kind}});
    return this.detail(id,userId);
  }
  async report(id:string,userId:string,dto:ReportDto){
    const thread=await this.detail(id,userId);if(thread.state!=='PUBLISHED'||thread.deletedAt)throw new NotFoundException('帖子不可用');
    if(dto.commentId&&!await this.db.comment.findFirst({where:{id:dto.commentId,resourceId:id,reviewState:'APPROVED',deletedAt:null}}))throw new NotFoundException('回复不可用');
    return this.db.report.create({data:{reporterId:userId,resourceId:dto.commentId?null:id,commentId:dto.commentId,reasonCode:dto.reason,description:dto.description,state:'PENDING'},select:{id:true,state:true}});
  }
  async withdraw(id:string,userId:string,dto:VersionDto,comment=false){return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    if(comment){const row=await tx.comment.findFirst({where:{id,authorId:userId}});if(!row)throw new NotFoundException('回复不存在');if((await tx.comment.updateMany({where:{id,authorId:userId,version:dto.expectedVersion,deletedAt:null},data:{deletedAt:new Date(),reviewState:'REMOVED',version:{increment:1},updatedAt:new Date()}})).count!==1)throw new ConflictException('回复已变化，请刷新');}
    else{const row=await tx.forumThread.findFirst({where:{id,authorId:userId}});if(!row)throw new NotFoundException('帖子不存在');if((await tx.forumThread.updateMany({where:{id,version:dto.expectedVersion},data:{deletedAt:new Date(),version:{increment:1},updatedAt:new Date()}})).count!==1)throw new ConflictException('帖子已变化，请刷新');await tx.resource.update({where:{id},data:{publishState:'ARCHIVED'}});}
    if(!comment)await this.reverseRewards(tx,userId,id,'作者撤回帖子');
    if(!comment){const consent=await tx.consentRecord.findFirst({where:{userId,policyCode:'PRIVATE_RECORD_SHARING',purpose:'forum-thread:'+id,accepted:true},orderBy:{actedAt:'desc'}});if(consent)await tx.consentRecord.create({data:{userId,policyCode:consent.policyCode,policyVersion:consent.policyVersion,purpose:consent.purpose,source:consent.source,accepted:false,actedAt:new Date()}});}
    return{success:true};
  });}
  async blocks(userId:string){const rows=await this.db.userBlock.findMany({where:{userId},orderBy:{createdAt:'desc'}});const users=await this.db.user.findMany({where:{id:{in:rows.map(r=>r.blockedId)}},select:{id:true,nickname:true}});return{items:rows.map(r=>({...r,nickname:users.find(u=>u.id===r.blockedId)?.nickname??'书院学友'}))};}
  async block(userId:string,blockedId:string,active:boolean){
    if(userId===blockedId)throw new BadRequestException('不能拉黑自己');if(!await this.db.user.findUnique({where:{id:blockedId}}))throw new NotFoundException('用户不存在');
    if(active)await this.db.$executeRaw`INSERT INTO "UserBlock" ("userId","blockedId") VALUES (${userId},${blockedId}) ON CONFLICT ("userId","blockedId") DO NOTHING`;
    else await this.db.userBlock.deleteMany({where:{userId,blockedId}});return{success:true};
  }
  async moderation(id:string,req:AuthRequest,dto:ModerationDto,comment=false){
    requireRoles(req,['MODERATOR']);return this.db.$transaction(async tx=>{
      const target=comment?await tx.comment.findUnique({where:{id},select:{authorId:true}}):await tx.forumThread.findUnique({where:{id},select:{authorId:true}});
      if(!target)throw new NotFoundException('内容不存在');
      // Lock the author before content and FK writes, matching posting and daily rewards.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${target.authorId} FOR UPDATE`;
      const table=comment?'Comment':'ForumThread';await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"'+table+'"')} WHERE id=${id} FOR UPDATE`);
      const row=comment?await tx.comment.findUnique({where:{id}}):await tx.forumThread.findUnique({where:{id}});if(!row)throw new NotFoundException('内容不存在');
      const resourceId=comment?(row as {resourceId:string}).resourceId:id,resource=await tx.resource.findUniqueOrThrow({where:{id:resourceId}});
      if(resource.kind!=='THREAD')throw new NotFoundException('社区内容不存在，请在所属业务模块处理');
      if(row.version!==dto.expectedVersion)throw new ConflictException('内容已处理，请刷新');
      if(!comment&&['APPROVE','RESTORE'].includes(dto.action)){const consent=await tx.consentRecord.findFirst({where:{userId:row.authorId,policyCode:'PRIVATE_RECORD_SHARING',purpose:'forum-thread:'+id},orderBy:[{actedAt:'desc'},{id:'desc'}]});if(consent&&!consent.accepted)throw new ConflictException('作者已撤回私人分享授权，不能恢复，请由作者重新提交');}
      const state=comment?(row as {reviewState:string}).reviewState:resource.publishState;
      if(dto.action==='APPROVE'||dto.action==='REJECT'){if(state!==(comment?'PENDING':'REVIEW')||row.deletedAt)throw new ConflictException('仅可审核待审内容');}
      if(!comment&&dto.action==='APPROVE'){
        await this.allowed(row.authorId,'POST',(row as {sectionId:string}).sectionId,tx);
        const bound=await tx.attachmentBinding.findMany({where:{threadId:id,purpose:'FORUM_MEDIA'}});
        if(bound.length&&!dto.mediaReviewed)throw new BadRequestException('请先试听试看并确认核对投稿音视频');
        if(bound.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM "MediaAsset" WHERE id IN (${Prisma.join(bound.map(b=>b.assetId).sort())}) ORDER BY id FOR SHARE`);
        if(bound.length&&await tx.mediaAsset.count({where:{id:{in:bound.map(b=>b.assetId)},uploaderId:row.authorId,status:'READY',visibility:'PRIVATE',variants:{path:['uploadPurpose'],equals:'FORUM_MEDIA'}}})!==bound.length)throw new ConflictException('投稿媒体尚未处理完成或已失效，不能通过审核');
      }
      if(dto.action==='RESTORE'&&!['ARCHIVED','REMOVED','REJECTED'].includes(state))throw new ConflictException('内容不需要恢复');
      if(dto.action==='HIDE'&&(row.deletedAt||['ARCHIVED','REMOVED'].includes(state)))throw new ConflictException('内容已隐藏');
      const next=dto.action==='APPROVE'?(comment?'APPROVED':'PUBLISHED'):dto.action==='REJECT'?'REJECTED':dto.action==='HIDE'?(comment?'REMOVED':'ARCHIVED'):(comment?'PENDING':'REVIEW');
      if(dto.reportId){const report=await tx.report.findUnique({where:{id:dto.reportId}});if(!report||report.state!=='PENDING'||(comment?report.commentId!==id:report.resourceId!==id))throw new BadRequestException('举报与本次处理内容不匹配');await tx.report.update({where:{id:report.id},data:{state:'RESOLVED',resolution:dto.reason,resolvedAt:new Date(),assigneeId:req.actor.id,version:{increment:1}}});}
      if(comment)await tx.comment.update({where:{id},data:{reviewState:next,deletedAt:dto.action==='HIDE'?new Date():null,version:{increment:1},updatedAt:new Date()}});
      else{await tx.forumThread.update({where:{id},data:{deletedAt:dto.action==='HIDE'?new Date():null,version:{increment:1},updatedAt:new Date()}});await tx.resource.update({where:{id},data:{publishState:next,summary:resource.summary,...(next==='PUBLISHED'?{publishedAt:new Date()}:{} )}});}
      const authorId=row.authorId;
      await tx.moderationAction.create({data:{actorId:req.actor.id,resourceId,commentId:comment?id:null,targetUserId:authorId,reportId:dto.reportId,action:dto.action,reason:dto.reason,beforeSnapshot:{state},afterSnapshot:{state:next}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'forum.moderate',resource:comment?'comment':'forum_thread',resourceId:id,reason:dto.reason,changes:{from:state,to:next,...(!comment&&dto.action==='APPROVE'?{mediaReviewed:!!dto.mediaReviewed}:{} )}}});
      await tx.notification.create({data:{userId:authorId,eventKey:'forum.review:'+id+':'+(row.version+1),kind:'FORUM_REVIEW',title:'讨论内容状态已更新',body:dto.reason,resourceId}});
      if(!comment&&next==='PUBLISHED')await this.reward(tx,authorId,id);
      if(!comment&&next!=='PUBLISHED')await this.reverseRewards(tx,authorId,id,'帖子治理：'+dto.reason);
      return{success:true,state:next};
    });
  }
  private async reverseRewards(tx:Prisma.TransactionClient,userId:string,id:string,reason:string){
    const rewards=await tx.pointsLedger.findMany({where:{accountId:(await tx.pointsAccount.findUnique({where:{userId}}))?.id??'',ruleSnapshot:{path:['threadId'],equals:id},delta:{gte:0},reversalOfId:null}});
    for(const reward of rewards){const value=reward.delta-reward.debtDelta;if(value>0n&&!await tx.pointsLedger.findUnique({where:{reversalOfId:reward.id}}))await changePoints(tx,userId,-value,'forum.withdraw.points:'+reward.id,reason,{resourceId:id,reversalOfId:reward.id,ruleSnapshot:{threadId:id,returnOf:reward.id}});}
    const growth=await tx.growthLedger.findUnique({where:{eventKey:'forum.approved:'+id}});
    if(growth&&!await tx.growthLedger.findUnique({where:{reversalOfId:growth.id}}))await tx.growthLedger.create({data:{userId,delta:-growth.delta,businessDay:pointsDay(),eventKey:'forum.withdraw.growth:'+growth.id,reason,sourceResourceId:id,reversalOfId:growth.id,ruleSnapshot:{returnOf:growth.id}}});
    const entries=await tx.campaignEntry.findMany({where:{threadId:id,state:'SELECTED'}});
    for(const entry of entries){const reward=await tx.growthLedger.findUnique({where:{eventKey:'campaign.selected:'+entry.id}});if(reward&&!await tx.growthLedger.findUnique({where:{reversalOfId:reward.id}}))await tx.growthLedger.create({data:{userId,delta:-reward.delta,businessDay:pointsDay(),eventKey:'campaign.withdraw:'+entry.id,reason,sourceResourceId:id,reversalOfId:reward.id,ruleSnapshot:{threadId:id}}});}
    if(entries.length)await tx.campaignEntry.updateMany({where:{id:{in:entries.map(e=>e.id)}},data:{state:'WITHDRAWN',judgeNote:reason,version:{increment:1},updatedAt:new Date()}});
  }
  private async reward(tx:Prisma.TransactionClient,userId:string,id:string){
    const section=await tx.forumSection.findUniqueOrThrow({where:{id:(await tx.forumThread.findUniqueOrThrow({where:{id}})).sectionId}});if(section.scope!=='PUBLIC')return;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),businessDay=new Date(day+'T00:00:00Z'),eventKey='forum.daily:'+userId+':'+day;
    if(await tx.moderationAction.count({where:{resourceId:id,commentId:null,action:'APPROVE'}})>1)return;
    if(!await tx.pointsLedger.findUnique({where:{eventKey}})){
      await changePoints(tx,userId,3n,eventKey,'公开帖子审核通过',{businessDay,resourceId:id,ruleSnapshot:{threadId:id,dailyLimit:1,points:3}});
    }
    const gained=await dailyGrowthAllocated(tx,userId,businessDay),delta=Math.max(0,Math.min(5,20-gained));
    if(delta)await tx.growthLedger.create({data:{userId,sourceResourceId:id,eventKey:'forum.approved:'+id,delta,businessDay,reason:'公开帖子审核通过',ruleSnapshot:{growth:5,dailyLimit:20}}});
  }
  async feature(id:string,req:AuthRequest,dto:FeatureDto){requireRoles(req,['OPERATOR','MODERATOR']);return this.db.$transaction(async tx=>{
    const resource=await tx.resource.findUnique({where:{id}});if(resource?.publishState!=='PUBLISHED')throw new BadRequestException('仅已发布帖子可以置顶或精选');
    if((await tx.forumThread.updateMany({where:{id,version:dto.expectedVersion,deletedAt:null},data:{essence:dto.essence,pinnedUntil:dto.pinDays?new Date(Date.now()+dto.pinDays*86400000):null,pinScope:dto.pinDays?'SECTION':null,version:{increment:1},updatedAt:new Date()}})).count!==1)throw new ConflictException('帖子已变化');
    await tx.resource.update({where:{id},data:{summary:resource.summary}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'forum.feature',resource:'forum_thread',resourceId:id,changes:dto as unknown as Prisma.InputJsonValue}});return{success:true};
  });}
  async restrict(userId:string,req:AuthRequest,dto:RestrictionDto){requireRoles(req,['MODERATOR']);if(userId===req.actor.id)throw new BadRequestException('不能限制自己的账号');return this.db.$transaction(async tx=>{
    const user=await tx.user.findUnique({where:{id:userId}});if(!user||user.roles.some(r=>r!=='USER'))throw new ForbiddenException('管理账号由角色管理员处理');
    const action=await tx.moderationAction.create({data:{actorId:req.actor.id,targetUserId:userId,action:'RESTRICT',reason:dto.reason,beforeSnapshot:{},afterSnapshot:{scope:dto.scope,days:dto.days}}});
    const row=await tx.userRestriction.create({data:{userId,scope:dto.scope,startsAt:new Date(),endsAt:new Date(Date.now()+dto.days*86400000),actionId:action.id}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'forum.restrict',resource:'user_restriction',resourceId:row.id,reason:dto.reason,changes:{userId,scope:dto.scope}}});return row;
  });}
  async revoke(id:string,req:AuthRequest,dto:RevokeDto){requireRoles(req,['MODERATOR']);return this.db.$transaction(async tx=>{
    const row=await tx.userRestriction.findUnique({where:{id}});if(!row)throw new NotFoundException('限制不存在');
    if((await tx.userRestriction.updateMany({where:{id,version:dto.expectedVersion,revokedAt:null},data:{revokedAt:new Date(),version:{increment:1},updatedAt:new Date()}})).count!==1)throw new ConflictException('限制已变化');
    await tx.moderationAction.create({data:{actorId:req.actor.id,targetUserId:row.userId,appealOfId:row.actionId,action:'REVOKE',reason:dto.reason,beforeSnapshot:{revoked:false},afterSnapshot:{revoked:true}}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'forum.revoke',resource:'user_restriction',resourceId:id,reason:dto.reason,changes:{revoked:true}}});return{success:true};
  });}
  async reports(userId:string|undefined,query:ForumPage,req?:AuthRequest){
    const kinds=Object.entries(resourceScopes).filter(([,scope])=>req?.permissions?.includes(scope+'.read')).map(([kind])=>kind);
    const scope=userId?Prisma.sql`r."reporterId"=${userId}`:kinds.length?Prisma.sql`res.kind IN (${Prisma.join(kinds)})`:Prisma.sql`FALSE`;
    const filter=Prisma.sql`FROM "Report" r LEFT JOIN "Comment" c ON c.id=r."commentId" LEFT JOIN "Resource" res ON res.id=COALESCE(r."resourceId",c."resourceId") WHERE ${scope} ${query.state?Prisma.sql`AND r.state=${query.state}`:Prisma.empty}`;
    const [items,counts]=await this.db.$transaction([this.db.$queryRaw<Prisma.ReportGetPayload<{}>[]>(Prisma.sql`SELECT r.* ${filter} ORDER BY r."createdAt" DESC,r.id DESC LIMIT ${query.size} OFFSET ${(query.page-1)*query.size}`),this.db.$queryRaw<{total:number}[]>(Prisma.sql`SELECT count(*)::int AS total ${filter}`)]);
    const total=counts[0]!.total;
    if(userId)return{items:items.map(r=>({id:r.id,state:r.state,reasonCode:r.reasonCode,description:r.description,resolution:r.resolution,createdAt:r.createdAt})),total};
    const comments=await this.db.comment.findMany({where:{id:{in:items.flatMap(r=>r.commentId?[r.commentId]:[])}}});
    const ids=[...items.flatMap(r=>r.resourceId?[r.resourceId]:[]),...comments.map(r=>r.resourceId)];
    const resources=await this.db.resource.findMany({where:{id:{in:ids}},select:{id:true,title:true,summary:true,kind:true}});
    return{items:items.map(r=>{const comment=comments.find(c=>c.id===r.commentId),resource=resources.find(c=>c.id===(r.resourceId??comment?.resourceId));return{...r,title:resource?.title??'内容已移除',target:resource?{resourceId:resource.id,kind:resource.kind,body:comment?.body??resource.summary}:null};}),total};
  }
  async resolve(id:string,req:AuthRequest,dto:ReportResolveDto){requireRoles(req,['MODERATOR']);return this.db.$transaction(async tx=>{
    const report=await tx.report.findUnique({where:{id}});if(!report)throw new NotFoundException('举报不存在');
    const target=report.resourceId??(report.commentId?(await tx.comment.findUnique({where:{id:report.commentId},select:{resourceId:true}}))?.resourceId:undefined);
    const resource=target?await tx.resource.findUnique({where:{id:target},select:{kind:true}}):null;
    if(!resource||!req.permissions?.includes(resourceScopes[resource.kind]+'.review'))throw new ForbiddenException('没有被举报内容所属模块的审核权限');
    if((await tx.report.updateMany({where:{id,version:dto.expectedVersion,state:'PENDING'},data:{state:'RESOLVED',resolution:dto.reason,resolvedAt:new Date(),assigneeId:req.actor.id,version:{increment:1},updatedAt:new Date()}})).count!==1)throw new ConflictException('举报已处理');
    await tx.moderationAction.create({data:{actorId:req.actor.id,reportId:id,action:'RESOLVE',reason:dto.reason,beforeSnapshot:{state:'PENDING'},afterSnapshot:{state:'RESOLVED'}}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'forum.report.resolve',resource:'report',resourceId:id,reason:dto.reason,changes:{from:'PENDING',to:'RESOLVED'}}});return{success:true};
  });}
  async adminComments(query:ForumPage){
    const filter=Prisma.sql`FROM "Comment" c JOIN "ForumThread" t ON t.id=c."resourceId" WHERE TRUE ${query.state?Prisma.sql`AND c."reviewState"=${query.state}`:Prisma.empty}`;
    const [items,counts]=await this.db.$transaction([this.db.$queryRaw<Prisma.CommentGetPayload<{}>[]>(Prisma.sql`SELECT c.* ${filter} ORDER BY c."createdAt" DESC,c.id DESC LIMIT ${query.size} OFFSET ${(query.page-1)*query.size}`),this.db.$queryRaw<{total:number}[]>(Prisma.sql`SELECT count(*)::int AS total ${filter}`)]);
    const total=counts[0]!.total;
    const [users,resources]=await Promise.all([this.db.user.findMany({where:{id:{in:items.map(r=>r.authorId)}},select:{id:true,nickname:true}}),this.db.resource.findMany({where:{id:{in:items.map(r=>r.resourceId)}},select:{id:true,title:true,kind:true}})]);
    return{items:items.map(r=>({...r,authorName:users.find(u=>u.id===r.authorId)?.nickname,title:resources.find(x=>x.id===r.resourceId)?.title,resourceKind:resources.find(x=>x.id===r.resourceId)?.kind})),total};}
  async restrictions(){const items=await this.db.userRestriction.findMany({where:{revokedAt:null,OR:[{endsAt:null},{endsAt:{gt:new Date()}}]},orderBy:{createdAt:'desc'},take:100});const users=await this.db.user.findMany({where:{id:{in:items.map(r=>r.userId)}},select:{id:true,nickname:true}});return{items:items.map(r=>({...r,nickname:users.find(u=>u.id===r.userId)?.nickname??'已注销'}))};}
}

@Controller('forum') export class ForumController {
  constructor(private readonly forum:ForumService){}
  @Get('sections') @UseGuards(OptionalUserGuard) sections(@Req() req:AuthRequest,@Query() q:CourseSectionQuery){return this.forum.sections(req.actor?.id,q.courseId,q.cohortId);}
  @Get('sections/:id/tags') @UseGuards(OptionalUserGuard) tags(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.forum.tags(id,req.actor?.id);}
  @Get('threads') @UseGuards(OptionalUserGuard) list(@Req() req:AuthRequest,@Query() q:ForumPage){return this.forum.list(req.actor?.id,q);}
  @Get('mine') @UseGuards(UserGuard) mine(@Req() req:AuthRequest,@Query() q:ForumPage){return this.forum.list(req.actor.id,q,true);}
  @Post('threads') @UseGuards(UserGuard) create(@Req() req:AuthRequest,@Body() dto:ThreadDto){return this.forum.create(req.actor.id,dto);}
  @Get('private-sources/:kind/:id') @UseGuards(UserGuard) privateSource(@Param('kind') kind:string,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.forum.privateSource(kind,id,req.actor.id);}
  @Get('threads/:id') @UseGuards(OptionalUserGuard) detail(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.forum.detail(id,req.actor?.id);}
  @Post('threads/:id/withdraw') @UseGuards(UserGuard) withdraw(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:VersionDto){return this.forum.withdraw(id,req.actor.id,dto);}
  @Get('threads/:id/comments') @UseGuards(OptionalUserGuard) comments(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() q:ForumPage){return this.forum.comments(id,req.actor?.id,q);}
  @Post('threads/:id/comments') @UseGuards(UserGuard) reply(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ReplyDto){return this.forum.reply(id,req.actor.id,dto);}
  @Post('comments/:id/withdraw') @UseGuards(UserGuard) withdrawComment(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:VersionDto){return this.forum.withdraw(id,req.actor.id,dto,true);}
  @Post('threads/:id/reactions') @UseGuards(UserGuard) react(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ReactionDto){return this.forum.react(id,req.actor.id,dto);}
  @Post('threads/:id/reports') @UseGuards(UserGuard) report(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ReportDto){return this.forum.report(id,req.actor.id,dto);}
  @Get('blocks') @UseGuards(UserGuard) blocks(@Req() req:AuthRequest){return this.forum.blocks(req.actor.id);}
  @Post('blocks/:id') @UseGuards(UserGuard) block(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.forum.block(req.actor.id,id,true);}
  @Delete('blocks/:id') @UseGuards(UserGuard) unblock(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.forum.block(req.actor.id,id,false);}
  @Get('reports') @UseGuards(UserGuard) reports(@Req() req:AuthRequest,@Query() q:ForumPage){return this.forum.reports(req.actor.id,q);}
}
@Controller('admin/forum') @UseGuards(AdminGuard) export class ForumAdminController {
  constructor(private readonly forum:ForumService){}
  @Get('threads') list(@Req() req:AuthRequest,@Query() q:ForumPage){requireRoles(req,['OPERATOR','MODERATOR']);return this.forum.list(undefined,q,false,true);}
  @Get('threads/:id') detail(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){requireRoles(req,['OPERATOR','MODERATOR']);return this.forum.detail(id,undefined,true);}
  @Post('threads/:id/moderate') moderate(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ModerationDto){return this.forum.moderation(id,req,dto);}
  @Post('threads/:id/feature') feature(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:FeatureDto){return this.forum.feature(id,req,dto);}
  @Get('comments') comments(@Req() req:AuthRequest,@Query() q:ForumPage){requireRoles(req,['MODERATOR']);return this.forum.adminComments(q);}
  @Post('comments/:id/moderate') moderateComment(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ModerationDto){return this.forum.moderation(id,req,dto,true);}
  @Get('reports') reports(@Req() req:AuthRequest,@Query() q:ForumPage){requireRoles(req,['MODERATOR']);return this.forum.reports(undefined,q,req);}
  @Post('reports/:id/resolve') resolve(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ReportResolveDto){return this.forum.resolve(id,req,dto);}
  @Get('restrictions') restrictions(@Req() req:AuthRequest){requireRoles(req,['MODERATOR']);return this.forum.restrictions();}
  @Post('users/:id/restrict') restrict(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:RestrictionDto){return this.forum.restrict(id,req,dto);}
  @Post('restrictions/:id/revoke') revoke(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:RevokeDto){return this.forum.revoke(id,req,dto);}
}
