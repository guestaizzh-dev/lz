import {createHash} from 'node:crypto';
import {Body,ConflictException,Controller,ForbiddenException,Inject,Injectable,NotFoundException,Post,Req,UseGuards} from '@nestjs/common';
import {IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Min} from 'class-validator';
import {AdminGuard,AuthService,UserGuard,type AuthRequest} from './auth.js';
import {Database} from './database.js';
import type {LiveService} from './live.js';
import {LearningService} from './learning.js';
import {ZegoService} from './zego.js';
import type {Prisma} from './generated/prisma/client.js';

const active=['WAITING','APPROVED','CONNECTED'];
export async function endSessionMics(tx:Prisma.TransactionClient,sessionId:string,now=new Date()){await tx.liveMicRequest.updateMany({where:{sessionId,state:{in:active}},data:{state:'ENDED',endedAt:now,updatedAt:now,version:{increment:1}}});}
export const micStreamId=(leaseId:string)=>'mic_'+leaseId.replace(/-/g,'');
export async function activeMic(store:Prisma.TransactionClient,sessionId:string,leaseId:string){
  return store.liveMicRequest.findFirst({where:{sessionId,rtcSessionId:leaseId,state:'CONNECTED',endedAt:null}});
}
export async function micAudience(store:Prisma.TransactionClient,sessionId:string){
  const rows=await store.liveMicRequest.findMany({where:{sessionId,state:'CONNECTED',endedAt:null},take:1});
  const result=[];for(const row of rows){const lease=await store.liveRtcLease.findFirst({where:{id:row.rtcSessionId??'',revokedAt:null,expiresAt:{gt:new Date()},absoluteExpiresAt:{gt:new Date()}}});if(lease)result.push({id:row.id,streamId:micStreamId(lease.id)});}
  return result;
}
class MicDto{
  @IsString() @Length(43,43) key!:string;
  @IsIn(['LIST','REQUEST','CANCEL','APPROVE','REJECT','CONNECT','REMOVE']) action!:string;
  @IsOptional() @IsUUID() requestId?:string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?:number;
}
@Injectable()
export class LiveMics{
  constructor(private readonly db:Database,@Inject('LIVE_SERVICE') private readonly live:LiveService,private readonly learning:LearningService,private readonly zego:ZegoService,private readonly auth:AuthService){}
  private async priority(userId:string,tx:Prisma.TransactionClient){
    const member=await this.learning.membership(userId,tx);
    const version=member?.planVersionId?await tx.membershipPlanVersion.findUnique({where:{id:member.planVersionId}}):null;
    return member?.tier===3&&(version?.termsSnapshot as {micPriority?:boolean}|undefined)?.micPriority===true?1:0;
  }
  async act(req:AuthRequest,dto:MicDto){
    await this.auth.rateLimit('live-mic:'+req.actor.id,120,60000);
    const keyHash=createHash('sha256').update(dto.key).digest('hex');
    const result=await this.db.$transaction(async tx=>{
      const first=await tx.liveRtcLease.findFirst({where:{keyHash,userId:req.actor.id,authSessionId:req.authSessionId}});if(!first)throw new NotFoundException('请先进入本场直播');
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${first.sessionId} FOR UPDATE`;
      const lease=await tx.liveRtcLease.findUniqueOrThrow({where:{id:first.id}}),now=new Date();
      if(lease.revokedAt||lease.expiresAt<=now||lease.absoluteExpiresAt<=now)throw new ForbiddenException('直播连接已过期，请重新进入');
      const session=await this.live.refreshCheck(lease,tx);if(session.state!=='LIVE')throw new ConflictException('仅直播中可以连麦');
      const host=lease.role==='HOST';
      for(const row of await tx.liveMicRequest.findMany({where:{sessionId:session.id,state:{in:active}}})){
        const owner=await tx.liveRtcLease.findFirst({where:{id:row.rtcSessionId??'',revokedAt:null,expiresAt:{gt:now},absoluteExpiresAt:{gt:now}}});
        if(!owner){await tx.liveMicRequest.update({where:{id:row.id},data:{state:'ENDED',endedAt:now,version:{increment:1},updatedAt:now}});continue;}
        try{await this.live.refreshCheck(owner,tx);}catch{await tx.liveMicRequest.update({where:{id:row.id},data:{state:'ENDED',endedAt:now,version:{increment:1},updatedAt:now}});continue;}
        const priority=await this.priority(row.userId,tx);if(row.priority!==priority)await tx.liveMicRequest.update({where:{id:row.id},data:{priority}});
      }
      let changed:null|{id:string;rtcUserId?:string;streamId?:string}=null;
      if(dto.action==='REQUEST'){
        if(host)throw new ConflictException('主播无需申请连麦');
        const old=await tx.liveMicRequest.findFirst({where:{sessionId:session.id,userId:req.actor.id,state:{in:active}}});
        if(old&&old.rtcSessionId!==lease.id)throw new ConflictException('已在其他连接申请连麦，请先结束原连接');
        if(!old){
          if(await tx.liveMicRequest.count({where:{sessionId:session.id,state:'WAITING'}})>=100)throw new ConflictException('申请人数较多，请稍后再试');
          const row=await tx.liveMicRequest.create({data:{sessionId:session.id,userId:req.actor.id,state:'WAITING',priority:await this.priority(req.actor.id,tx),rtcSessionId:lease.id}});changed={id:row.id};
        }
      }else if(dto.action!=='LIST'){
        if(!dto.requestId||!dto.expectedVersion)throw new ConflictException('请重新读取连麦申请');
        const row=await tx.liveMicRequest.findFirst({where:{id:dto.requestId,sessionId:session.id}});if(!row)throw new NotFoundException('本场没有该申请');
        const moderation=['APPROVE','REJECT','REMOVE'].includes(dto.action);if(moderation&&!host)throw new ForbiddenException('仅本场主播可处理连麦');
        if(!moderation&&(row.userId!==req.actor.id||row.rtcSessionId!==lease.id))throw new ForbiddenException('仅能操作本连接的申请');
        if(dto.action==='CANCEL'&&['CANCELLED','ENDED'].includes(row.state))return{kick:null,data:await this.view(tx,session.id,lease.id,host)};
        if(row.version!==dto.expectedVersion)throw new ConflictException('申请已变化，请刷新');
        let state:string;
        if(dto.action==='APPROVE'){
          if(row.state!=='WAITING')throw new ConflictException('申请已处理');
          if(await tx.liveMicRequest.count({where:{sessionId:session.id,state:{in:['APPROVED','CONNECTED']}}}))throw new ConflictException('请先结束当前连麦，再邀请下一位');state='APPROVED';
        }else if(dto.action==='REJECT'){if(row.state!=='WAITING')throw new ConflictException('申请已处理');state='REJECTED';}
        else if(dto.action==='CONNECT'){if(row.state!=='APPROVED')throw new ConflictException('须由主播批准后才能开麦');state='CONNECTED';}
        else {if(!active.includes(row.state))throw new ConflictException('连麦已经结束');state=dto.action==='CANCEL'?'CANCELLED':'ENDED';}
        await tx.liveMicRequest.update({where:{id:row.id},data:{state,...(moderation?{approvedBy:req.actor.id}:{}),...(state==='CONNECTED'?{startedAt:now}:{}),...(['REJECTED','ENDED','CANCELLED'].includes(state)?{endedAt:now}:{}),version:{increment:1},updatedAt:now}});
        const owner=await tx.liveRtcLease.findUnique({where:{id:row.rtcSessionId??''}});changed={id:row.id,...(row.state==='CONNECTED'&&state!=='CONNECTED'&&owner?{rtcUserId:owner.rtcUserId,streamId:micStreamId(owner.id)}:{})};
        if(changed.rtcUserId&&owner)await tx.liveRtcLease.update({where:{id:owner.id},data:{revokedAt:now}});
      }
      if(changed)await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.mic.'+dto.action.toLowerCase(),resource:'live',resourceId:session.id,changes:{requestId:changed.id}}});
      return{kick:changed?.rtcUserId?{sessionId:session.id,userId:changed.rtcUserId}:null,data:await this.view(tx,session.id,lease.id,host)};
    });
    if(result.kick)try{await this.zego.kick(result.kick.sessionId,result.kick.userId);}catch{/* Refresh stops capture and retries the room check; the provider may already have disconnected. */}
    return result.data;
  }
  private async view(tx:Prisma.TransactionClient,sessionId:string,leaseId:string,host:boolean){
    const rows=await tx.liveMicRequest.findMany({where:{sessionId,...(host?{state:{in:active}}:{rtcSessionId:leaseId})},orderBy:[{priority:'desc'},{createdAt:'asc'},{id:'asc'}],take:100});
    const users=host?await tx.user.findMany({where:{id:{in:rows.map(r=>r.userId)}},select:{id:true,nickname:true}}):[];
    return{host,items:rows.map(row=>({id:row.id,state:row.state,version:row.version,priority:row.priority,createdAt:row.createdAt,...(host?{nickname:users.find(u=>u.id===row.userId)?.nickname??'研习学员'}:{})}))};
  }
}
@Controller('live/mics') @UseGuards(UserGuard)
export class LiveMicsController{constructor(private readonly mics:LiveMics){} @Post() act(@Req() req:AuthRequest,@Body() dto:MicDto){return this.mics.act(req,dto);}}
@Controller('admin/live/mics') @UseGuards(AdminGuard)
export class LiveMicsAdminController{constructor(private readonly mics:LiveMics){} @Post() act(@Req() req:AuthRequest,@Body() dto:MicDto){return this.mics.act(req,dto);}}
