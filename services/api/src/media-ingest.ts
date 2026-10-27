import { uploadName } from './upload-name.js';
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Logger, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Req, ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Database } from './database.js';
import { AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { ForumService } from './forum.js';
import { Prisma } from './generated/prisma/client.js';

export const MEDIA_CHUNK_BYTES = 8 * 1024 * 1024;
export const MEDIA_MAX_BYTES = 2147483647;
export const FORUM_MEDIA_MAX_BYTES = 256 * 1024 * 1024;
type UploadPurpose='COURSE'|'FORUM_MEDIA'|'HOME_HERO';
const day = 86400000;
class UploadDto {
  @IsString() @Length(1,200) name!:string;
  @IsIn(['video/mp4','audio/mpeg','audio/mp4','audio/wav']) mime!:string;
  @IsInt() @Min(1) @Max(MEDIA_MAX_BYTES) bytes!:number;
  @Matches(/^[a-f0-9]{64}$/) fingerprint!:string;
}
class ForumUploadDto {
  @IsUUID() requestKey!:string;
  @IsUUID() sectionId!:string;
  @IsString() @Length(1,200) name!:string;
  @IsIn(['video/mp4','audio/mpeg','audio/mp4','audio/wav']) mime!:string;
  @IsInt() @Min(1) @Max(FORUM_MEDIA_MAX_BYTES) bytes!:number;
}
type Probe = {format:{duration?:string};streams:{codec_type:string;codec_name:string;width?:number;height?:number;start_time?:string;duration?:string;pix_fmt?:string}[]};

// Keep subprocess output bounded: malformed/long media must not fill API memory or logs.
export function mediaCommand(binary:string,args:string[],timeout=30000,signal?:AbortSignal):Promise<string>{
  return new Promise((yes,no)=>{
    if(signal?.aborted){no(new Error('MEDIA_INTERRUPTED'));return;}
    const child=spawn(binary,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',ended=false;
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('MEDIA_TIMEOUT'));},timeout);
    const abort=()=>{child.kill('SIGKILL');finish(new Error('MEDIA_INTERRUPTED'));};signal?.addEventListener('abort',abort,{once:true});
    function finish(error?:Error){if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?no(error):yes(stdout);}
    child.stdout.on('data',data=>{stdout+=data.toString();if(stdout.length>1024*1024){child.kill('SIGKILL');finish(new Error('MEDIA_OUTPUT_LIMIT'));}});
    child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-4000);});
    child.on('error',()=>finish(new Error('MEDIA_TOOLS_UNAVAILABLE')));
    child.on('close',code=>finish(code===0?undefined:new Error('MEDIA_DECODE_FAILED: '+stderr)));
  });
}
export async function fileHash(path:string){const hash=createHash('sha256');for await(const data of createReadStream(path))hash.update(data);return hash.digest('hex');}

@Injectable()
export class MediaIngest {
  private readonly root=resolve(process.env.MEDIA_DIR??'.media');
  private readonly logger=new Logger(MediaIngest.name);
  private timer?:ReturnType<typeof setInterval>;private working=false;private stopped=false;
  private encoder?:AbortController;
  private encodingId?:string;
  private readonly ffmpeg=process.env.FFMPEG_PATH??'ffmpeg';
  private readonly ffprobe=process.env.FFPROBE_PATH??'ffprobe';
  constructor(private readonly db:Database,private readonly forum:ForumService){}
  onModuleInit(){if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.runJobs().catch(()=>this.logger.error('Media jobs pending; will retry')),5000);this.timer.unref();}}
  onModuleDestroy(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.encoder?.abort();}
  private source(id:string){return resolve(this.root,'uploads',id+'.part');}
  private async tools(){try{await mediaCommand(this.ffmpeg,['-version']);await mediaCommand(this.ffprobe,['-version']);}catch{throw new ServiceUnavailableException('音视频处理服务尚未就绪，请联系管理员配置 FFmpeg / FFprobe');}}
  private async capacity(bytes:number){
    await mkdir(resolve(this.root,'uploads'),{recursive:true});
    const disk=await statfs(this.root),free=disk.bavail*disk.bsize;
    if(free<bytes+512*1024*1024)throw new ServiceUnavailableException('媒体存储空间不足，请先扩容或清理已取消的上传');
  }
  private view(row:{id:string;name:string;mime:string;forumSectionId:string|null;bytes:number;receivedBytes:number;state:string;assetId:string|null;failure:string|null;expiresAt:Date}){
    return {id:row.id,name:row.name,mime:row.mime,sectionId:row.forumSectionId,bytes:row.bytes,receivedBytes:row.receivedBytes,state:row.state,assetId:row.assetId,failure:row.failure,expiresAt:row.expiresAt.toISOString(),chunkBytes:MEDIA_CHUNK_BYTES};
  }
  private async owned(req:AuthRequest,id:string,purpose:UploadPurpose,tx:Prisma.TransactionClient=this.db,write=false){
    const row=await tx.mediaUpload.findFirst({where:{id,uploaderId:req.actor.id,purpose}});if(!row)throw new NotFoundException('上传任务不存在');
    if(purpose==='FORUM_MEDIA'&&write)await this.forum.postingAccess(req.actor.id,row.forumSectionId!,tx);
    return row;
  }
  async create(req:AuthRequest,dto:UploadDto,purpose:UploadPurpose='COURSE',forumSectionId?:string){
    if(purpose==='COURSE')requireRoles(req,['OPERATOR']);
    else if(purpose==='HOME_HERO'){requireRoles(req,['ADMIN']);if(dto.mime!=='video/mp4')throw new BadRequestException('首页视频请上传 MP4 文件');}
    else if(!forumSectionId||dto.bytes>FORUM_MEDIA_MAX_BYTES)throw new BadRequestException('投稿文件不能超过256MiB');
    await this.tools();
    if(!['video/mp4','audio/mpeg','audio/mp4','audio/wav'].includes(dto.mime))throw new BadRequestException('仅支持 MP4、MP3、M4A、WAV');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
      if(purpose==='FORUM_MEDIA')await this.forum.postingAccess(req.actor.id,forumSectionId!,tx);
      if(purpose==='FORUM_MEDIA'){
        const prior=await tx.mediaUpload.findFirst({where:{uploaderId:req.actor.id,purpose,fingerprint:dto.fingerprint}});
        if(prior&&(prior.forumSectionId!==forumSectionId||prior.name!==dto.name||prior.mime!==dto.mime||prior.bytes!==dto.bytes))throw new ConflictException('上传编号已用于其他文件，请重新选择');
      }
      const old=await tx.mediaUpload.findFirst({where:{uploaderId:req.actor.id,purpose,forumSectionId:forumSectionId??null,fingerprint:dto.fingerprint,name:dto.name,bytes:dto.bytes,mime:dto.mime,state:{in:['UPLOADING','PROCESSING','READY','FAILED']},expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'}});
      if(old)return this.view(old);
      if(purpose==='FORUM_MEDIA'&&await tx.auditLog.count({where:{actorId:req.actor.id,action:'forum.media.upload.create',createdAt:{gte:new Date(Date.now()-day)}}})>=10)throw new ConflictException('每天最多上传10份音视频，请明天再试');
      if(await tx.mediaUpload.count({where:{uploaderId:req.actor.id,state:{in:['UPLOADING','PROCESSING','FAILED']},expiresAt:{gt:new Date()}}})>=3)throw new ConflictException('最多同时保留 3 个上传任务，请先完成或取消旧任务');
      // Reserve source plus bounded playback output for every outstanding task, across operators.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(80621349)::text`;
      const pending=await tx.mediaUpload.aggregate({where:{state:{in:['UPLOADING','PROCESSING','FAILED']},expiresAt:{gt:new Date()}},_sum:{bytes:true}});
      await this.capacity((pending._sum.bytes??0)*2+dto.bytes*2);
      const row=await tx.mediaUpload.create({data:{...dto,purpose,forumSectionId,uploaderId:req.actor.id,expiresAt:new Date(Date.now()+7*day)}});
      if(purpose==='FORUM_MEDIA')await tx.auditLog.create({data:{actorId:req.actor.id,action:'forum.media.upload.create',resource:'forum_thread',resourceId:row.id,changes:{name:row.name,bytes:row.bytes,sectionId:forumSectionId!}}});
      return this.view(row);
    });
  }
  async status(req:AuthRequest,id:string,purpose:UploadPurpose='COURSE'){return this.view(await this.owned(req,id,purpose));}
  async homeAsset(req:AuthRequest,id:string){const row=await this.owned(req,id,'HOME_HERO');if(row.state!=='READY'||!row.assetId)throw new NotFoundException('首页视频尚未处理完成');return this.db.mediaAsset.findFirstOrThrow({where:{id:row.assetId,status:'READY',variants:{path:['uploadPurpose'],equals:'HOME_HERO'}},select:{id:true,name:true,mime:true,bytes:true,durationSeconds:true}});}
  async pending(req:AuthRequest,purpose:UploadPurpose='COURSE'){
    if(purpose==='FORUM_MEDIA')return(await this.db.$queryRaw<Prisma.MediaUploadGetPayload<{}>[]>`SELECT u.* FROM "MediaUpload" u WHERE u."uploaderId"=${req.actor.id} AND u.purpose='FORUM_MEDIA' AND u.state IN ('UPLOADING','PROCESSING','FAILED','READY') AND u."expiresAt">now() AND NOT EXISTS(SELECT 1 FROM "AttachmentBinding" b WHERE b."assetId"=u."assetId") ORDER BY u."createdAt" DESC,u.id DESC LIMIT 20`).map(row=>this.view(row));
    return(await this.db.mediaUpload.findMany({where:{uploaderId:req.actor.id,purpose,state:{in:['UPLOADING','PROCESSING','FAILED']},expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'},take:20})).map(row=>this.view(row));
  }
  async legacy(req:AuthRequest,file?:{buffer:Buffer;size:number;originalname:string;mimetype:string}){
    if(!file?.buffer.length)throw new BadRequestException('请选择媒体文件');
    const task=await this.create(req,{name:uploadName(file.originalname),mime:file.mimetype,bytes:file.size,fingerprint:createHash('sha256').update(file.buffer).digest('hex')});
    if(task.state==='UPLOADING'){
      for(let offset=task.receivedBytes;offset<file.size;offset+=MEDIA_CHUNK_BYTES)await this.chunk(req,task.id,offset,{buffer:file.buffer.subarray(offset,offset+MEDIA_CHUNK_BYTES)});
      await this.complete(req,task.id);
    }
    const row=await this.db.mediaUpload.findUniqueOrThrow({where:{id:task.id}});
    return this.db.mediaAsset.findUniqueOrThrow({where:{id:row.assetId!},select:{id:true,name:true,mime:true,bytes:true,status:true,durationSeconds:true}});
  }
  async chunk(req:AuthRequest,id:string,offset:number,file?:{buffer:Buffer},purpose:UploadPurpose='COURSE'){
    if(!file?.buffer.length||file.buffer.length>MEDIA_CHUNK_BYTES||offset<0)throw new BadRequestException('分片大小或位置无效');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "MediaUpload" WHERE id=${id} FOR UPDATE`;
      const row=await this.owned(req,id,purpose,tx,true);if(row.state!=='UPLOADING'||row.expiresAt<=new Date())throw new ConflictException('上传任务已结束或过期，请重新选择文件');
      if(offset>row.receivedBytes||offset+file.buffer.length>row.bytes)throw new ConflictException('上传位置不一致，请重新获取进度');
      await mkdir(resolve(this.root,'uploads'),{recursive:true});
      const path=this.source(id),handle=await open(path,'a+');await handle.close();
      const target=await open(path,'r+');
      try{
        if(offset<row.receivedBytes){
          if(offset+file.buffer.length>row.receivedBytes)throw new ConflictException('分片与已有数据重叠，请恢复上传');
          const existing=Buffer.alloc(file.buffer.length),read=await target.read(existing,0,existing.length,offset);
          if(read.bytesRead!==existing.length||!existing.equals(file.buffer))throw new ConflictException('分片内容不一致，请重新上传');
          return this.view(row);
        }
        if((await target.stat()).size<row.receivedBytes)throw new ConflictException('上传文件不完整，请取消后重新上传');
        await target.truncate(row.receivedBytes);
        let written=0;while(written<file.buffer.length){const next=await target.write(file.buffer,written,file.buffer.length-written,offset+written);if(!next.bytesWritten)throw new Error('MEDIA_WRITE_FAILED');written+=next.bytesWritten;}
        await target.sync();
      }finally{await target.close();}
      return this.view(await tx.mediaUpload.update({where:{id},data:{receivedBytes:offset+file.buffer.length,expiresAt:new Date(Date.now()+7*day)}}));
    },{timeout:30000});
  }
  async complete(req:AuthRequest,id:string,purpose:UploadPurpose='COURSE'){
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "MediaUpload" WHERE id=${id} FOR UPDATE`;
      const row=await this.owned(req,id,purpose,tx,true);
      if(['PROCESSING','READY','FAILED'].includes(row.state))return this.view(row);
      if(row.state!=='UPLOADING'||row.expiresAt.getTime()<Date.now()||row.receivedBytes!==row.bytes)throw new ConflictException('文件尚未上传完整或任务已过期');
      if((await stat(this.source(id))).size!==row.bytes)throw new ConflictException('文件校验失败，请重新上传');
      const mime=row.mime==='video/mp4'?'video/mp4':'audio/mp4';
      const asset=await tx.mediaAsset.create({data:{storageKey:randomUUID(),name:row.name,mime,bytes:0,status:'PROCESSING',visibility:'PRIVATE',uploaderId:req.actor.id,variants:{sourceBytes:row.bytes,...(purpose!=='COURSE'?{uploadPurpose:purpose}:{})}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'media.upload',resource:'media',resourceId:asset.id,changes:{name:row.name,sourceBytes:row.bytes,uploadId:id}}});
      return this.view(await tx.mediaUpload.update({where:{id},data:{state:'PROCESSING',assetId:asset.id,failure:null}}));
    });
  }
  async retry(req:AuthRequest,id:string,purpose:UploadPurpose='COURSE'){
    const row=await this.owned(req,id,purpose,this.db,true);if(row.state!=='FAILED'||row.expiresAt<=new Date()||!row.assetId)throw new ConflictException('任务不能重试，请重新上传');
    await this.tools();await stat(this.source(id));await this.capacity(row.bytes);
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
      await this.owned(req,id,purpose,tx,true);
      const changed=await tx.mediaUpload.updateMany({where:{id,state:'FAILED'},data:{state:'PROCESSING',attempts:0,failure:null,leaseUntil:null}});if(!changed.count)throw new ConflictException('任务已变化，请刷新');
      await tx.mediaAsset.update({where:{id:row.assetId!},data:{status:'PROCESSING',failureCode:null}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'media.retry',resource:'media',resourceId:row.assetId!,changes:{uploadId:id}}});
    });return this.status(req,id,purpose);
  }
  async cancel(req:AuthRequest,id:string,purpose:UploadPurpose='COURSE'){
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "MediaUpload" WHERE id=${id} FOR UPDATE`;
      const row=await this.owned(req,id,purpose,tx);
      if(row.state==='CANCELLED')return;
      if(row.assetId)await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${row.assetId} FOR UPDATE`;
      if(purpose==='FORUM_MEDIA'&&row.assetId&&await tx.attachmentBinding.count({where:{assetId:row.assetId}}))throw new ConflictException('媒体已提交，请到帖子详情撤回');
      if(purpose!=='FORUM_MEDIA'&&!['UPLOADING','FAILED'].includes(row.state))throw new ConflictException('处理中或已完成的媒体不能取消上传');
      await tx.mediaUpload.update({where:{id},data:{state:'CANCELLED',leaseUntil:null,leaseToken:null,expiresAt:new Date(0)}});
      if(this.encodingId===id)this.encoder?.abort();
      await unlink(this.source(id)).catch(error=>{if(error.code!=='ENOENT'){if(purpose==='FORUM_MEDIA')this.logger.warn('Cancelled source cleanup pending');else throw error;}});
      if(row.assetId)await tx.mediaAsset.update({where:{id:row.assetId},data:{status:purpose==='FORUM_MEDIA'?'DELETED':'REJECTED',failureCode:'UPLOAD_CANCELLED'}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'media.cancel',resource:'media',resourceId:row.assetId??id,changes:{uploadId:id}}});
    });return {cancelled:true};
  }
  private async probe(path:string):Promise<Probe>{return JSON.parse(await mediaCommand(this.ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',path]));}
  async runJobs(){
    if(this.working||this.stopped)return;this.working=true;
    try{
      // Lease survives API restarts. Only a single encoder runs per service process.
      const row=await this.db.mediaUpload.findFirst({where:{state:'PROCESSING',OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},orderBy:{createdAt:'asc'}});
      if(row){const token=randomUUID();const claimed=await this.db.mediaUpload.updateMany({where:{id:row.id,state:'PROCESSING',OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{leaseUntil:new Date(Date.now()+90000),leaseToken:token,attempts:{increment:1}}});if(claimed.count)await this.process(row.id,token);}
      const expired=await this.db.mediaUpload.findMany({where:{state:{in:['UPLOADING','FAILED','CANCELLED','READY']},expiresAt:{lt:new Date()}},take:20});
      for(const row of expired){
        await this.db.$transaction(async tx=>{
          await tx.$queryRaw`SELECT id FROM "MediaUpload" WHERE id=${row.id} FOR UPDATE`;const current=await tx.mediaUpload.findUnique({where:{id:row.id}});if(!current||current.state==='PROCESSING'||current.expiresAt.getTime()>Date.now())return;
          await unlink(this.source(row.id)).catch(error=>{if(error.code!=='ENOENT')throw error;});
          if(current.purpose==='FORUM_MEDIA'&&current.assetId){
            await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${current.assetId} FOR UPDATE`;
            if(!await tx.attachmentBinding.count({where:{assetId:current.assetId}})){
              const asset=await tx.mediaAsset.update({where:{id:current.assetId},data:{status:'DELETED',failureCode:'UNBOUND_UPLOAD_EXPIRED'}});
              await unlink(resolve(this.root,asset.storageKey)).catch(error=>{if(error.code!=='ENOENT')throw error;});
            }
          }
          await tx.mediaUpload.delete({where:{id:row.id}});
        });
      }
      // A quick restart may finish before an old work file ages out; sweep even when the queue is idle.
      const names=await readdir(this.root).catch(error=>{if(error.code==='ENOENT')return [] as string[];throw error;});
      let cleaned=0;
      for(const name of names){const match=/^[a-f0-9-]{36}\.([a-f0-9-]{36})\.working\.mp4$/.exec(name);if(!match)continue;const path=resolve(this.root,name);if((await stat(path)).mtimeMs>Date.now()-120000)continue;if(await this.db.mediaUpload.count({where:{state:'PROCESSING',leaseToken:match[1],leaseUntil:{gt:new Date()}}}))continue;await unlink(path);if(++cleaned>=20)break;}
    }finally{this.working=false;}
  }
  private async process(id:string,token:string){
    const row=await this.db.mediaUpload.findUniqueOrThrow({where:{id}});if(!row.assetId)return;
    const asset=await this.db.mediaAsset.findUniqueOrThrow({where:{id:row.assetId}}),source=this.source(id),output=resolve(this.root,asset.storageKey+'.'+token+'.working.mp4');
    const controller=new AbortController();this.encoder=controller;this.encodingId=id;
    let leaseLost=false,renewing=false;
    const heartbeat=setInterval(()=>{if(renewing)return;renewing=true;void this.db.mediaUpload.updateMany({where:{id,state:'PROCESSING',leaseToken:token},data:{leaseUntil:new Date(Date.now()+90000)}}).then(result=>{if(!result.count){leaseLost=true;controller.abort();}}).catch(()=>{leaseLost=true;controller.abort();}).finally(()=>{renewing=false;});},20000);heartbeat.unref();
    try{
      if(row.attempts>3)throw new Error('MEDIA_RESTART_LIMIT');
      for(const name of await readdir(this.root)){if(name.startsWith(asset.storageKey+'.')&&name.endsWith('.working.mp4')&&resolve(this.root,name)!==output){const path=resolve(this.root,name);if((await stat(path)).mtimeMs<Date.now()-120000)await unlink(path);}}
      const handle=await open(source,'r'),header=Buffer.alloc(12);try{await handle.read(header,0,12,0);}finally{await handle.close();}
      const signature=row.mime==='audio/wav'?header.subarray(0,4).toString()==='RIFF'&&header.subarray(8,12).toString()==='WAVE':row.mime==='audio/mpeg'?header.subarray(0,3).toString()==='ID3'||header[0]===255&&(header[1]!&224)===224:header.subarray(4,8).toString()==='ftyp';
      if(!signature)throw new Error('MEDIA_INVALID_CONTAINER');
      const probe=await this.probe(source),video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
      const duration=Number(probe.format.duration);
      if(!Number.isFinite(duration)||duration<=0||duration>(row.purpose==='FORUM_MEDIA'?600:86400)||row.mime==='video/mp4'&&!video||row.mime!=='video/mp4'&&(!audio||video))throw new Error('MEDIA_INVALID_TRACKS');
      await this.capacity(Math.min(MEDIA_MAX_BYTES,Math.ceil(duration*(video?4128000:128000)/8)+16*1024*1024));
      const args=['-nostdin','-hide_banner','-loglevel','error','-xerror','-y','-protocol_whitelist','file,pipe','-fflags','+genpts','-i',source,'-map_metadata','-1','-map_chapters','-1','-threads','2'];
      if(video)args.push('-map','0:v:0','-map','0:a:0?','-vf',"scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",'-c:v','libx264','-preset','fast','-crf','21','-profile:v','main','-pix_fmt','yuv420p','-r','30','-fps_mode','cfr','-g','60','-keyint_min','30','-sc_threshold','0','-maxrate','4M','-bufsize','8M');
      else args.push('-map','0:a:0','-vn');
      // One shared timestamp origin; resetting each track independently destroys intentional offsets.
      if(audio)args.push('-c:a','aac','-b:a','128k','-ar','48000','-ac','2','-af','aresample=async=1000');
      args.push('-avoid_negative_ts','make_zero','-max_muxing_queue_size','2048','-movflags','+faststart','-fs',String(MEDIA_MAX_BYTES),'-f','mp4',output);
      await mediaCommand(this.ffmpeg,args,6*60*60*1000,controller.signal);
      const normalized=await this.probe(output),actual=Number(normalized.format.duration),info=await stat(output);
      if(!Number.isFinite(actual)||Math.abs(actual-duration)>Math.max(1,duration*0.001)||info.size<=0||info.size>=MEDIA_MAX_BYTES)throw new Error('MEDIA_DURATION_MISMATCH');
      if(video&&!normalized.streams.some(s=>s.codec_type==='video'&&s.codec_name==='h264'&&s.pix_fmt==='yuv420p')||audio&&!normalized.streams.some(s=>s.codec_type==='audio'&&s.codec_name==='aac'))throw new Error('MEDIA_CODEC_MISMATCH');
      const sha256=await fileHash(output),sourceSha256=await fileHash(source);
      if(leaseLost)throw new Error('MEDIA_LEASE_LOST');
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${row.uploaderId} FOR KEY SHARE`;
        const done=await tx.mediaUpload.updateMany({where:{id,state:'PROCESSING',leaseToken:token},data:{state:'READY',failure:null,leaseUntil:null,leaseToken:null}});if(!done.count)throw new Error('MEDIA_LEASE_LOST');
        await rename(output,resolve(this.root,asset.storageKey));
        await tx.mediaAsset.update({where:{id:asset.id},data:{status:'READY',bytes:info.size,durationSeconds:Math.ceil(actual),sha256,failureCode:null,variants:{sourceBytes:row.bytes,sourceSha256,...(row.purpose!=='COURSE'?{uploadPurpose:row.purpose}:{}),delivery:'MP4_FASTSTART',videoCodec:video?'h264':null,audioCodec:audio?'aac':null,keyframeSeconds:video?2:null,maxVideoBitrate:video?4000000:null}}});
        await tx.auditLog.create({data:{actorId:row.uploaderId,action:'media.process.ready',resource:'media',resourceId:asset.id,changes:{durationSeconds:Math.ceil(actual),bytes:info.size,uploadId:id}}});
      });
      await unlink(source).catch(()=>this.logger.warn('Processed media source cleanup pending'));
    }catch(error){
      if(this.stopped||leaseLost){await this.db.mediaUpload.updateMany({where:{id,state:'PROCESSING',leaseToken:token},data:{leaseUntil:new Date(0)}});return;}
      const failure=(error as Error).message.startsWith('MEDIA_TOOLS_UNAVAILABLE')?'处理工具不可用，请联系管理员后重试':(error as Error).message.includes('空间')?'存储空间不足，请扩容后重试':row.purpose==='FORUM_MEDIA'?'音视频须为可解码的MP4、MP3、M4A或WAV且不超过10分钟，请检查源文件':'视频或音频解码、时间轴或转码校验失败，请检查源文件后重试';
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${row.uploaderId} FOR KEY SHARE`;
        const failed=await tx.mediaUpload.updateMany({where:{id,state:'PROCESSING',leaseToken:token},data:{state:'FAILED',failure,leaseUntil:null,leaseToken:null}});
        if(failed.count){await tx.mediaAsset.update({where:{id:asset.id},data:{status:'REJECTED',failureCode:'MEDIA_PROCESS_FAILED'}});await tx.auditLog.create({data:{actorId:row.uploaderId,action:'media.process.failed',resource:'media',resourceId:asset.id,changes:{uploadId:id,failure}}});}
      });
      this.logger.warn('Media processing failed: '+id);
    }finally{clearInterval(heartbeat);if(this.encoder===controller){this.encoder=undefined;this.encodingId=undefined;}await unlink(output).catch(()=>{});}
  }
}

@Controller('forum/media/uploads') @UseGuards(UserGuard)
export class ForumMediaIngestController {
  constructor(private readonly ingest:MediaIngest){}
  @Post() create(@Req() req:AuthRequest,@Body() dto:ForumUploadDto){
    // This key identifies a resumable submission; the worker computes the actual source SHA-256.
    const fingerprint=createHash('sha256').update(dto.requestKey).digest('hex');
    return this.ingest.create(req,{name:dto.name,mime:dto.mime,bytes:dto.bytes,fingerprint},'FORUM_MEDIA',dto.sectionId);
  }
  @Get() pending(@Req() req:AuthRequest){return this.ingest.pending(req,'FORUM_MEDIA');}
  @Get(':id') status(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.status(req,id,'FORUM_MEDIA');}
  @Post(':id/chunks/:offset') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MEDIA_CHUNK_BYTES,files:1,fields:0}})) chunk(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Param('offset',ParseIntPipe) offset:number,@UploadedFile() file:{buffer:Buffer}){return this.ingest.chunk(req,id,offset,file,'FORUM_MEDIA');}
  @Post(':id/complete') complete(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.complete(req,id,'FORUM_MEDIA');}
  @Post(':id/retry') retry(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.retry(req,id,'FORUM_MEDIA');}
  @Post(':id/cancel') cancel(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.cancel(req,id,'FORUM_MEDIA');}
}

@Controller('admin/media/uploads') @UseGuards(AdminGuard)
export class MediaIngestController {
  constructor(private readonly ingest:MediaIngest){}
  @Post() create(@Req() req:AuthRequest,@Body() dto:UploadDto){return this.ingest.create(req,dto);}
  @Get() pending(@Req() req:AuthRequest){return this.ingest.pending(req);}
  @Get(':id') status(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.status(req,id);}
  @Post(':id/chunks/:offset') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MEDIA_CHUNK_BYTES,files:1,fields:0}})) chunk(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Param('offset',ParseIntPipe) offset:number,@UploadedFile() file:{buffer:Buffer}){return this.ingest.chunk(req,id,offset,file);}
  @Post(':id/complete') complete(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.complete(req,id);}
  @Post(':id/retry') retry(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.retry(req,id);}
  @Post(':id/cancel') cancel(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.cancel(req,id);}
}

@Controller('admin/media/uploads/home-hero') @UseGuards(AdminGuard)
export class HomeHeroUploadController {
  constructor(private readonly ingest:MediaIngest){}
  @Post() create(@Req() req:AuthRequest,@Body() dto:UploadDto){return this.ingest.create(req,dto,'HOME_HERO');}
  @Get(':id/asset') asset(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.homeAsset(req,id);}
  @Get(':id') status(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.status(req,id,'HOME_HERO');}
  @Post(':id/chunks/:offset') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MEDIA_CHUNK_BYTES,files:1,fields:0}})) chunk(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Param('offset',ParseIntPipe) offset:number,@UploadedFile() file:{buffer:Buffer}){return this.ingest.chunk(req,id,offset,file,'HOME_HERO');}
  @Post(':id/complete') complete(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.complete(req,id,'HOME_HERO');}
  @Post(':id/retry') retry(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.retry(req,id,'HOME_HERO');}
  @Post(':id/cancel') cancel(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.ingest.cancel(req,id,'HOME_HERO');}
}
