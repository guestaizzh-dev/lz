import {createHash,createPrivateKey,createPublicKey,randomUUID,sign} from 'node:crypto';
import {BadRequestException,Body,Controller,Delete,ForbiddenException,Get,Headers,Injectable,NotFoundException,Param,ParseIntPipe,ParseUUIDPipe,Post,Query,Req,Res,ServiceUnavailableException,UseGuards} from '@nestjs/common';
import {open} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {Equals,IsOptional,IsUUID} from 'class-validator';
import type {Response} from 'express';
import {Database} from './database.js';
import {AuthService,UserGuard,type AuthRequest} from './auth.js';
import {LearningService} from './learning.js';
import {phoneLookup} from './private-data.js';
import {Prisma,OfflineLicense} from './generated/prisma/client.js';

export const offlineWindowHours=72;
export const offlineChunkBytes=4*1024*1024;
const maxDevices=3,maxLicenses=500;
class LicenseDto {
  @IsUUID() deviceId!:string;
  @IsOptional() @IsUUID() cohortId?:string;
  @Equals(true,{message:'请确认离线授权将开始本章节的学习交付'}) consentToStart!:boolean;
}
class DownloadQuery{@IsUUID() deviceId!:string;}
type Claims={v:1;purpose:'academy-offline-lesson';id:string;version:number;userId:string;deviceHash:string;lessonId:string;releaseId:string;assetId:string;sha256:string;bytes:number;mime:string;cohortId:string|null;issuedAt:string;expiresAt:string};
type Snapshot={claims:Claims;source:{kind:string;id:string;endsAt:string|null}};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');

export function offlineSigningConfig(env:NodeJS.ProcessEnv=process.env){
  if(env.OFFLINE_LICENSE_ENABLED!==undefined&&!['true','false'].includes(env.OFFLINE_LICENSE_ENABLED))throw Error('OFFLINE_LICENSE_ENABLED must be true or false');
  if(env.OFFLINE_LICENSE_ENABLED!=='true')return null;
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(env.OFFLINE_LICENSE_KEY_ID??''))throw Error('OFFLINE_LICENSE_KEY_ID is required');
  try{
    const privateKey=createPrivateKey((env.OFFLINE_LICENSE_PRIVATE_KEY??'').replace(/\\n/g,'\n'));
    if(privateKey.asymmetricKeyType!=='rsa'||(privateKey.asymmetricKeyDetails?.modulusLength??0)<2048)throw Error('RSA key required');
    const publicKey=createPublicKey(privateKey).export({type:'spki',format:'pem'}).toString();
    return{privateKey,publicKey,kid:env.OFFLINE_LICENSE_KEY_ID!};
  }catch{throw Error('OFFLINE_LICENSE_PRIVATE_KEY must be an RSA private key of at least 2048 bits');}
}
function signed(claims:Claims,config:NonNullable<ReturnType<typeof offlineSigningConfig>>){
  const input=b64({alg:'RS256',typ:'academy-offline-license',kid:config.kid})+'.'+b64(claims);
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),config.privateKey).toString('base64url');
}

@Injectable()
export class OfflineLicenses {
  constructor(private readonly db:Database,private readonly learning:LearningService,private readonly auth:AuthService){}
  capabilities(){
    const config=offlineSigningConfig();
    return{licenseServiceReady:!!config,nativeDownloadReady:!!config&&process.env.OFFLINE_NATIVE_PLAYBACK_READY==='true',maxOfflineHours:offlineWindowHours,maxDevices,verificationKey:config?{kid:config.kid,algorithm:'RS256',publicKey:config.publicKey}:null};
  }
  private config(){const config=offlineSigningConfig();if(!config)throw new ServiceUnavailableException('离线授权尚未开通，当前请联网学习');return config;}
  private snapshot(row:OfflineLicense){return row.entitlementSnapshot as unknown as Snapshot;}
  private async session(tx:Prisma.TransactionClient,req:AuthRequest){
    const users=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${req.actor.id} AND status='ACTIVE' FOR UPDATE`;
    const session=await tx.authSession.findFirst({where:{id:req.authSessionId,userId:req.actor.id,kind:'APP',revokedAt:null,expiresAt:{gt:new Date()},accessExpiresAt:{gt:new Date()}}});
    if(!users.length||!session)throw new ForbiddenException('登录状态已变化，请重新登录');
  }
  async issue(lessonId:string,dto:LicenseDto,req:AuthRequest,renewId?:string){
    const config=this.config(),deviceHash=phoneLookup('offline-device:'+dto.deviceId);
    await this.auth.rateLimit('offline-license:'+req.actor.id,120,3600000);
    return this.db.$transaction(async tx=>{
      await this.session(tx,req);
      const original=renewId?await tx.offlineLicense.findFirst({where:{id:renewId,userId:req.actor.id,deviceId:deviceHash,lessonId}}):null;
      if(renewId&&(!original||original.revokedAt))throw new NotFoundException('离线授权已删除或不属于当前设备，请重新下载');
      const lesson=await tx.lesson.findUnique({where:{id:lessonId},include:{release:true}});
      if(!lesson)throw new NotFoundException('章节不存在');
      await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id=${lesson.releaseId} FOR SHARE`;
      const release=await tx.courseRelease.findUniqueOrThrow({where:{id:lesson.releaseId}});
      if(release.withdrawnAt)throw new ForbiddenException('此版本已停止交付，不能签发或刷新离线授权');
      const context=await this.learning.context(release.courseId,req.actor.id,tx,dto.cohortId);
      if(context.releaseId!==lesson.releaseId||context.access==='TRIAL')throw new ForbiddenException('获得本课程完整权限后才可离线学习');
      await this.learning.requireLessonOpen(context,lesson.id,tx);
      if(context.enrollment?.orderItemId){
        const held=await tx.$queryRaw<{id:string}[]>`SELECT r.id FROM "Refund" r JOIN "PaymentTransaction" p ON p.id=r."paymentTransactionId" AND p.disposition='ACCEPTED' JOIN "TradeOrderItem" i ON i."orderId"=r."orderId" WHERE i.id=${context.enrollment.orderItemId} AND r.state IN ('APPROVED','REFUNDING','FAILED') LIMIT 1`;
        if(held.length)throw new ForbiddenException('课程正在办理退款，暂不能签发或刷新离线授权');
      }
      if(lesson.liveSessionId||!lesson.mediaId)throw new BadRequestException('仅支持已发布的录播音视频课件');
      const asset=await tx.mediaAsset.findUnique({where:{id:lesson.mediaId}}),variants=asset?.variants as {delivery?:string;uploadPurpose?:string}|undefined;
      if(!asset||asset.status!=='READY'||asset.visibility!=='PRIVATE'||!['video/mp4','audio/mp4'].includes(asset.mime)||!Number.isSafeInteger(asset.bytes)||asset.bytes<=0||!/^[a-f0-9]{64}$/.test(asset.sha256)||variants?.delivery!=='MP4_FASTSTART'||variants.uploadPurpose)throw new BadRequestException('该课件尚未通过离线文件校验，请联网学习');
      const member=context.access==='MEMBER'?await this.learning.membership(req.actor.id,tx):null;
      const source=context.registration?{kind:'COHORT',id:context.registration.id,endsAt:context.cohort!.endsAt}:context.enrollment?{kind:'ENROLLED',id:context.enrollment.id,endsAt:context.enrollment.expiresAt}:member?{kind:'MEMBER',id:member.id,endsAt:member.endsAt}:null;
      if(!source)throw new ForbiddenException('课程权限已变化，请重新进入课程');
      const now=new Date(),expiresAt=new Date(Math.min(now.valueOf()+offlineWindowHours*3600000,source.endsAt?.valueOf()??Infinity));
      if(expiresAt<=now)throw new ForbiddenException('课程权限已到期');
      const existing=original??await tx.offlineLicense.findFirst({where:{userId:req.actor.id,deviceId:deviceHash,lessonId,revokedAt:null,entitlementSnapshot:{path:['claims','cohortId'],equals:dto.cohortId??Prisma.JsonNull}},orderBy:{createdAt:'desc'}});
      if(original&&(original.assetId!==asset.id||this.snapshot(original).claims?.cohortId!==(dto.cohortId??null)))throw new BadRequestException('文件或研习营已变化，请重新下载');
      const active=await tx.offlineLicense.findMany({where:{userId:req.actor.id,revokedAt:null,expiresAt:{gt:now}},select:{id:true,deviceId:true}}),devices=new Set(active.map(row=>row.deviceId));
      if(!devices.has(deviceHash)&&devices.size>=maxDevices)throw new BadRequestException('最多保留三台设备的有效离线授权，请先移除旧设备');
      if(!active.some(row=>row.id===existing?.id)&&active.length>=maxLicenses)throw new BadRequestException('有效离线课件已达上限，请先删除不需要的课件');
      await this.learning.markPaidAccess(lessonId,req.actor.id,dto.cohortId,tx);
      const claims:Claims={v:1,purpose:'academy-offline-lesson',id:existing?.id??randomUUID(),version:(existing?.version??0)+1,userId:req.actor.id,deviceHash,lessonId,releaseId:release.id,assetId:asset.id,sha256:asset.sha256,bytes:asset.bytes,mime:asset.mime,cohortId:dto.cohortId??null,issuedAt:now.toISOString(),expiresAt:expiresAt.toISOString()},token=signed(claims,config);
      const data={userId:req.actor.id,deviceId:deviceHash,lessonId,assetId:asset.id,expiresAt,version:claims.version,licenseHash:hash(token),entitlementSnapshot:{claims,source:{...source,endsAt:source.endsAt?.toISOString()??null}} as unknown as Prisma.InputJsonValue,updatedAt:now};
      if(existing)await tx.offlineLicense.update({where:{id:existing.id},data});else await tx.offlineLicense.create({data:{id:claims.id,...data}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:renewId?'offline.license.refresh':'offline.license.issue',resource:'offline_license',resourceId:claims.id,changes:{lessonId,releaseId:release.id,version:claims.version,expiresAt:claims.expiresAt,source:source.kind}}});
      return{id:claims.id,token,expiresAt:claims.expiresAt,serverTime:claims.issuedAt,version:claims.version};
    });
  }
  async refresh(id:string,dto:LicenseDto,req:AuthRequest){
    const row=await this.db.offlineLicense.findFirst({where:{id,userId:req.actor.id}});
    if(!row)throw new NotFoundException('离线授权不存在');
    return this.issue(row.lessonId,dto,req,id);
  }
  async chunk(id:string,index:number,deviceId:string,token:string,req:AuthRequest){
    this.config();
    if(!Number.isSafeInteger(index)||index<0||index>511||!token||token.length>8192)throw new BadRequestException('下载凭证或分片编号无效');
    const data=await this.db.$transaction(async tx=>{
      await this.session(tx,req);
      const row=await tx.offlineLicense.findFirst({where:{id,userId:req.actor.id,deviceId:phoneLookup('offline-device:'+deviceId),licenseHash:hash(token),revokedAt:null,expiresAt:{gt:new Date()}}});
      if(!row)throw new ForbiddenException('离线授权已变化或到期，请联网刷新');
      const snapshot=this.snapshot(row),claims=snapshot.claims;
      if(!claims||claims.purpose!=='academy-offline-lesson'||claims.userId!==req.actor.id||claims.assetId!==row.assetId)throw new ForbiddenException('离线授权不可用，请重新下载');
      const lesson=await tx.lesson.findUniqueOrThrow({where:{id:row.lessonId},include:{release:true}});
      const context=await this.learning.context(lesson.release.courseId,req.actor.id,tx,claims.cohortId??undefined);
      if(context.releaseId!==claims.releaseId||context.access==='TRIAL'||lesson.release.withdrawnAt)throw new ForbiddenException('课件权限已变化，下载已停止');
      await this.learning.requireLessonOpen(context,lesson.id,tx);
      if(context.enrollment?.orderItemId){const holds=await tx.$queryRaw<{id:string}[]>`SELECT r.id FROM "Refund" r JOIN "TradeOrderItem" i ON i."orderId"=r."orderId" WHERE i.id=${context.enrollment.orderItemId} AND r.state IN ('APPROVED','REFUNDING','FAILED') LIMIT 1`;if(holds.length)throw new ForbiddenException('课程正在办理退款，下载已停止');}
      const asset=await tx.mediaAsset.findFirst({where:{id:row.assetId,status:'READY',visibility:'PRIVATE',sha256:claims.sha256,bytes:claims.bytes}});
      if(!asset||asset.id!==lesson.mediaId||index*offlineChunkBytes>=claims.bytes)throw new NotFoundException('本课件或下载分片不存在');
      return{asset,claims};
    });
    const root=resolve(process.env.MEDIA_DIR??'.media'),path=resolve(root,data.asset.storageKey);
    if(!path.startsWith(root+sep))throw new NotFoundException('课件文件不可用');
    const file=await open(path,'r').catch(()=>{throw new NotFoundException('课件文件暂不可用，请稍后重试');});
    try{const info=await file.stat();if(info.size!==data.claims.bytes)throw new NotFoundException('课件文件已变化，请重新下载');const length=Math.min(offlineChunkBytes,info.size-index*offlineChunkBytes),buffer=Buffer.alloc(length);let read=0;while(read<length){const result=await file.read(buffer,read,length-read,index*offlineChunkBytes+read);if(!result.bytesRead)throw new NotFoundException('课件分片不完整');read+=result.bytesRead;}return{buffer,sha256:createHash('sha256').update(buffer).digest('hex')};}finally{await file.close();}
  }
  async list(userId:string){
    const rows=await this.db.offlineLicense.findMany({where:{userId,revokedAt:null,expiresAt:{gt:new Date()}},orderBy:{updatedAt:'desc'},take:500}),lessons=await this.db.lesson.findMany({where:{id:{in:rows.map(r=>r.lessonId)}},select:{id:true,title:true}});
    return{items:rows.map(row=>({id:row.id,lessonId:row.lessonId,title:lessons.find(l=>l.id===row.lessonId)?.title??'研习课件',deviceRef:row.deviceId,assetId:row.assetId,version:row.version,expiresAt:row.expiresAt,revokedAt:row.revokedAt,updatedAt:row.updatedAt})),truncated:false};
  }
  async revokeDevice(deviceRef:string,req:AuthRequest){if(!/^[a-f0-9]{64}$/.test(deviceRef))throw new BadRequestException('设备标识无效');return this.db.$transaction(async tx=>{await this.session(tx,req);const result=await tx.offlineLicense.updateMany({where:{userId:req.actor.id,deviceId:deviceRef,revokedAt:null},data:{revokedAt:new Date(),updatedAt:new Date(),version:{increment:1}}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'offline.device.revoke',resource:'offline_license',changes:{count:result.count}}});return{success:true,count:result.count};});}
  async revoke(id:string,req:AuthRequest){return this.db.$transaction(async tx=>{
    await this.session(tx,req);
    const row=await tx.offlineLicense.findFirst({where:{id,userId:req.actor.id}});if(!row)throw new NotFoundException('离线授权不存在');
    if(!row.revokedAt){await tx.offlineLicense.update({where:{id},data:{revokedAt:new Date(),updatedAt:new Date(),version:{increment:1}}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'offline.license.revoke',resource:'offline_license',resourceId:id,changes:{lessonId:row.lessonId}}});}
    return{success:true,offlineWindowNotice:'已阻止继续刷新；完全离线设备上的既有授权最迟在原有效期结束时失效。'};
  });}
}

@Controller('learning') @UseGuards(UserGuard)
export class OfflineLicensesController {
  constructor(private readonly licenses:OfflineLicenses){}
  @Get('offline/capabilities') capabilities(@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');return this.licenses.capabilities();}
  @Get('offline/licenses') list(@Req() req:AuthRequest,@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');return this.licenses.list(req.actor.id);}
  @Get('offline/licenses/:id/chunks/:index') async chunk(@Param('id',ParseUUIDPipe) id:string,@Param('index',ParseIntPipe) index:number,@Query() query:DownloadQuery,@Headers('x-offline-license') token:string,@Req() req:AuthRequest,@Res() res:Response){const result=await this.licenses.chunk(id,index,query.deviceId,token,req);res.set({'Content-Type':'application/octet-stream','Cache-Control':'private, no-store','X-Chunk-SHA256':result.sha256,'Content-Length':String(result.buffer.length)});return res.send(result.buffer);}
  @Post('lessons/:id/offline-license') issue(@Param('id',ParseUUIDPipe) id:string,@Body() dto:LicenseDto,@Req() req:AuthRequest,@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');return this.licenses.issue(id,dto,req);}
  @Post('offline/licenses/:id/refresh') refresh(@Param('id',ParseUUIDPipe) id:string,@Body() dto:LicenseDto,@Req() req:AuthRequest,@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');return this.licenses.refresh(id,dto,req);}
  @Delete('offline/licenses/:id') revoke(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.licenses.revoke(id,req);}
  @Delete('offline/devices/:deviceRef') revokeDevice(@Param('deviceRef') deviceRef:string,@Req() req:AuthRequest){return this.licenses.revokeDevice(deviceRef,req);}
}
