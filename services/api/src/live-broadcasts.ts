import {imageUrlPattern} from './image-url.js';
import {BadRequestException,Body,ConflictException,Controller,Get,Injectable,NotFoundException,Param,ParseUUIDPipe,Post,Req,UseGuards} from '@nestjs/common';
import {IsIn,IsInt,IsISO8601,IsOptional,IsString,IsUUID,Length,Min} from 'class-validator';
import {randomUUID} from 'node:crypto';
import {AdminGuard,requireRoles,type AuthRequest} from './auth.js';
import {Database} from './database.js';
import {LiveService} from './live.js';
import {LiveRecordings,recordingMessages} from './live-recordings.js';
import {rtcRoomId,ZegoService} from './zego.js';

class BroadcastDto {
  @IsUUID() requestKey!:string;
  @IsString() @Length(1,120) title!:string;
  @IsString() @Length(1,500) summary!:string;
  @IsISO8601() scheduledAt!:string;
  @IsOptional() @IsString() @Length(0,500) cover?:string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?:number;
}
class BroadcastActionDto {
  @IsIn(['ENTER','ENTER_OBS','END','CANCEL','PUBLISH_REPLAY','HIDE_REPLAY','RETRY_RECORDING']) action!:string;
  @IsInt() @Min(1) expectedVersion!:number;
}
const rule={mode:'MEMBER',allMembers:true};
@Injectable()
export class LiveBroadcasts {
  constructor(private readonly db:Database,private readonly live:LiveService,private readonly recordings:LiveRecordings,private readonly zego:ZegoService){}
  private async managed(id:string){const s=await this.live.session(id),room=await this.db.liveRoom.findUniqueOrThrow({where:{id:s.roomId}});if(!room.managedByAdmin)throw new BadRequestException('历史课程直播请从历史直播入口处理，不能改写已购权限');return{s,room};}
  async list(req:AuthRequest){
    requireRoles(req,['ADMIN']);
    const rows=await this.db.$queryRaw<{id:string;roomId:string;title:string;summary:string;cover:string;state:string;version:number;scheduledAt:Date;startedAt:Date|null;endedAt:Date|null;disconnectedAt:Date|null;publishState:string;reservations:number;viewers:number;recordingState:string|null;recordingFailure:string|null;replayState:string|null;replayVersion:number|null;durationSeconds:number|null}[]>`SELECT s.id,s."roomId",s.title,CASE WHEN s."pushSecretRef"='OBS_WHIP' THEN 'OBS' ELSE 'BROWSER' END AS publisher,r.summary,l.cover,s.state,s.version,s."scheduledAt",s."startedAt",s."endedAt",s."disconnectedAt",r."publishState",(SELECT count(*)::int FROM "LiveReservation" v WHERE v."sessionId"=s.id AND v."cancelledAt" IS NULL) reservations,(SELECT count(DISTINCT v."userId")::int FROM "LiveRtcLease" v WHERE v."sessionId"=s.id AND v.role='VIEWER' AND v."revokedAt" IS NULL AND v."expiresAt">now() AND v."absoluteExpiresAt">now()) viewers,j.state AS "recordingState",j.failure AS "recordingFailure",p."reviewState" AS "replayState",p.version AS "replayVersion",p."durationSeconds" FROM "LiveSession" s JOIN "LiveRoom" l ON l.id=s."roomId" AND l."managedByAdmin" JOIN "Resource" r ON r.id=l.id LEFT JOIN "LiveRecording" j ON j."sessionId"=s.id LEFT JOIN "LiveReplay" p ON p."sessionId"=s.id ORDER BY s."scheduledAt" DESC,s.id DESC LIMIT 200`;
    let obsReady=false;try{this.zego.whip('readiness','readiness');obsReady=true;}catch{}
    return{items:rows.map(row=>({...row,accessMode:'MEMBER',recordingMessage:row.recordingFailure?recordingMessages[row.recordingFailure]??'录制需要处理，请联系维护人员。':''})),recording:await this.recordings.readiness(),obs:{ready:obsReady}};
  }
  async save(req:AuthRequest,dto:BroadcastDto,id?:string){
    requireRoles(req,['ADMIN']);const title=dto.title.trim(),summary=dto.summary.trim(),scheduledAt=new Date(dto.scheduledAt),cover=(dto.cover??'').trim();
    if(!title||!summary)throw new BadRequestException('请填写直播主题与主要内容');
    if(+scheduledAt<Date.now()-60000||+scheduledAt>Date.now()+366*86400000)throw new BadRequestException('请选择现在至一年内的北京时间');
    if(cover&&!/^\/static\/art\/[\w.-]+\.(svg|png|jpg|webp)$/.test(cover)&&!imageUrlPattern.test(cover))throw new BadRequestException('封面须为HTTPS图片地址');
    return this.db.$transaction(async tx=>{
      const sessionId=id??dto.requestKey;await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))::text`;
      const existing=await tx.liveSession.findUnique({where:{id:sessionId}});
      if(existing){
        const room=await tx.liveRoom.findUniqueOrThrow({where:{id:existing.roomId}}),resource=await tx.resource.findUniqueOrThrow({where:{id:existing.roomId}});
        if(!room.managedByAdmin)throw new ConflictException('编号已被使用，请刷新重试');
        if(!id){if(existing.title!==title||resource.summary!==summary||+existing.scheduledAt!==+scheduledAt||room.cover!==cover)throw new ConflictException('提交编号已用于其他预告，请刷新');return existing;}
        await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;
        const current=await tx.liveSession.findUniqueOrThrow({where:{id}});
        if(current.version!==dto.expectedVersion||current.state!=='SCHEDULED')throw new ConflictException('仅待开播预告可编辑，请刷新确认状态');
        await tx.resource.update({where:{id:current.roomId},data:{title,summary,version:{increment:1}}});await tx.liveRoom.update({where:{id:current.roomId},data:{cover,version:{increment:1}}});
        const changed=await tx.liveSession.update({where:{id},data:{title,scheduledAt,version:{increment:1}}});
        if(+current.scheduledAt!==+scheduledAt){await tx.liveReservation.updateMany({where:{sessionId:id,cancelledAt:null},data:{reminderSentAt:null}});for(const r of await tx.liveReservation.findMany({where:{sessionId:id,cancelledAt:null}}))await tx.notification.upsert({where:{userId_eventKey:{userId:r.userId,eventKey:'live:'+id+':reschedule:'+changed.version}},create:{userId:r.userId,eventKey:'live:'+id+':reschedule:'+changed.version,kind:'LIVE',title:'直播预告时间已调整',body:title+' · '+scheduledAt.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),resourceId:current.roomId},update:{}});}
        await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.broadcast.edit',resource:'live',resourceId:id,changes:{title,scheduledAt:dto.scheduledAt}}});return changed;
      }
      if(id)throw new NotFoundException('直播预告不存在');
      const roomId=randomUUID();await tx.resource.create({data:{id:roomId,kind:'LIVE',title,summary,categoryCode:'MEMBER',visibility:'MEMBER',publishState:'PUBLISHED',publishedAt:new Date()}});
      await tx.liveRoom.create({data:{id:roomId,teacherId:null,managedByAdmin:true,cover,provider:'ZEGO_RTC',providerRoomId:rtcRoomId(roomId),categoryCode:'MEMBER',accessRule:rule}});
      const session=await tx.liveSession.create({data:{id:sessionId,roomId,hostUserId:req.actor.id,title,scheduledAt,providerSessionId:rtcRoomId(sessionId),accessRuleSnapshot:rule}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.broadcast.publish',resource:'live',resourceId:session.id,changes:{title,scheduledAt:dto.scheduledAt,allMembers:true}}});return session;
    });
  }
  async action(req:AuthRequest,id:string,dto:BroadcastActionDto){
    requireRoles(req,['ADMIN']);const{s}=await this.managed(id);
    if(dto.action==='END'&&['ENDED','REPLAY_READY'].includes(s.state)||dto.action==='CANCEL'&&s.state==='CANCELLED')return s;
    if(s.version!==dto.expectedVersion)throw new ConflictException('直播状态已变化，请刷新后重试');
    if(dto.action==='ENTER'||dto.action==='ENTER_OBS'){
      if(!['SCHEDULED','PREPARING','LIVE'].includes(s.state))throw new ConflictException('本场已结束或取消');
      if(dto.action==='ENTER_OBS')this.zego.whip('readiness',id);
      await this.recordings.requireReady();
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(20090015)::text`;
        const other=await tx.$queryRaw<{id:string}[]>`SELECT s.id FROM "LiveSession" s JOIN "LiveRoom" l ON l.id=s."roomId" AND l."managedByAdmin" WHERE s.id<>${id} AND s.state IN ('PREPARING','LIVE') LIMIT 1`;
        if(other.length)throw new ConflictException('已有直播正在准备或进行，请先结束或取消上一场');
        const current=await tx.liveSession.findUniqueOrThrow({where:{id}});if(current.version!==dto.expectedVersion)throw new ConflictException('直播状态已变化，请刷新');
        if(current.state==='SCHEDULED'){await tx.liveSession.update({where:{id},data:{state:'PREPARING',version:{increment:1}}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.session.prepare',resource:'live',resourceId:id,changes:{before:'SCHEDULED',state:'PREPARING'}}});}
      });
      await this.recordings.ensure(id);const credential=await this.live.lease(req,id,true,dto.action==='ENTER_OBS'?'OBS':'BROWSER');
      if(dto.action!=='ENTER_OBS')return credential;
      const verified=await this.live.refresh(credential.key);return{...credential,obs:this.zego.whip(verified.userId,id)};
    }
    if(dto.action==='END'||dto.action==='CANCEL')return this.live.state(req,id,{action:dto.action,expectedVersion:s.version,reason:dto.action==='END'?'管理员结束直播':'管理员取消直播'});
    if(dto.action==='RETRY_RECORDING'){
      const job=await this.db.liveRecording.findUnique({where:{sessionId:id}});if(!job||job.state!=='FAILED')throw new ConflictException('当前没有失败的录制任务');
      await this.recordings.requireReady();return this.db.$transaction(async tx=>{const changed=await tx.liveRecording.updateMany({where:{id:job.id,state:'FAILED'},data:{state:terminalState(s.state)?'PROCESSING':'WAITING',failure:null,retries:0,leaseUntil:null,leaseToken:null}});if(!changed.count)throw new ConflictException('任务正在恢复，请刷新');await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.recording.retry',resource:'live',resourceId:id,changes:{recordingId:job.id}}});return{queued:true};});
    }
    const replay=await this.db.liveReplay.findUnique({where:{sessionId:id}});if(!replay)throw new BadRequestException('回放尚未生成');
    if(s.state==='CANCELLED')throw new ConflictException('已取消的直播不能发布回放');
    return this.live.reviewReplay(req,id,{state:dto.action==='PUBLISH_REPLAY'?'APPROVED':'REJECTED',expectedVersion:replay.version,reason:dto.action==='PUBLISH_REPLAY'?'管理员预览确认发布回放':'管理员撤下回放'});
  }
}
const terminalState=(state:string)=>['ENDED','REPLAY_READY','CANCELLED'].includes(state);
@Controller('admin/live/broadcasts') @UseGuards(AdminGuard)
export class LiveBroadcastController {
  constructor(private readonly broadcasts:LiveBroadcasts){}
  @Get() list(@Req() req:AuthRequest){return this.broadcasts.list(req);}
  @Post() create(@Req() req:AuthRequest,@Body() dto:BroadcastDto){return this.broadcasts.save(req,dto);}
  @Post(':id') edit(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:BroadcastDto){return this.broadcasts.save(req,dto,id);}
  @Post(':id/action') action(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:BroadcastActionDto){return this.broadcasts.action(req,id,dto);}
}
