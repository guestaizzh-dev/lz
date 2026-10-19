import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Body,Controller,ForbiddenException,Get,Injectable,NotFoundException,OnModuleDestroy,OnModuleInit,Param,ParseUUIDPipe,Post,Req,Res,UnauthorizedException,UseGuards} from '@nestjs/common';
import {IsString,Length} from 'class-validator';
import type {Response} from 'express';
import {Database} from './database.js';
import {AdminPermissions} from './admin-permissions.js';
import {AuthService,UserGuard,type AuthRequest} from './auth.js';
import {ZegoService} from './zego.js';
import type {Prisma} from './generated/prisma/client.js';

const hash=(key:string)=>createHash('sha256').update(key).digest('hex');
export const consultRoom=(id:string)=>'consult_'+id.replace(/-/g,'');
const consultStream=(id:string,role:string)=>'consult_'+id.replace(/-/g,'')+'_'+role.toLowerCase();
class ConsultKeyDto{@IsString() @Length(43,43) key!:string;}
@Injectable()
export class ConsultRtc implements OnModuleInit,OnModuleDestroy{
  private timer:NodeJS.Timeout|undefined;private working=false;private cursor:string|undefined;
  constructor(private readonly db:Database,private readonly permissions:AdminPermissions,private readonly auth:AuthService,private readonly zego:ZegoService){}
  onModuleInit(){if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.runJobs().catch(()=>{}),15000);this.timer.unref();}}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async mine(req:AuthRequest){
    const rows=await this.db.$queryRaw<{id:string;title:string;state:string;startsAt:Date;endsAt:Date;role:string;ready:boolean}[]>`SELECT a.id,COALESCE(a."serviceSnapshot"->>'title',o.title) AS title,a.state,s."startsAt",s."endsAt",CASE WHEN a."userId"=${req.actor.id} THEN 'STUDENT' ELSE 'TEACHER' END AS role,(a.state='CONFIRMED' AND s.state<>'CANCELLED' AND a."acceptedScheduleVersion">=s."scheduleVersion" AND now()>=s."startsAt"-interval '5 minutes' AND now()<s."endsAt"+interval '5 minutes') AS ready FROM "Appointment" a JOIN "AppointmentSlot" s ON s.id=a."slotId" JOIN "ServiceOffering" o ON o.id=s."offeringId" JOIN "Teacher" t ON t.id=COALESCE(a."serviceSnapshot"->>'teacherId',o."teacherId") WHERE (a."userId"=${req.actor.id} OR (${req.actor.roles.includes('TEACHER')} AND t."userId"=${req.actor.id})) AND COALESCE(a."serviceSnapshot"->>'mode',o.mode)='IN_APP_RTC' ORDER BY (s."endsAt">now()) DESC,s."startsAt" ASC,a.id ASC LIMIT 50`;
    return{items:rows,serverTime:new Date()};
  }
  private async access(tx:Prisma.TransactionClient,id:string,userId:string){
    const row=await tx.appointment.findUnique({where:{id}});if(!row)throw new NotFoundException('预约不存在');
    const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}}),snapshot=row.serviceSnapshot as {teacherId?:string;mode?:string;title?:string},offering=await tx.serviceOffering.findUniqueOrThrow({where:{id:slot.offeringId}}),teacher=await tx.teacher.findUnique({where:{id:snapshot.teacherId??offering.teacherId}});
    const mode=snapshot.mode??offering.mode;
    if(mode!=='IN_APP_RTC'||row.state!=='CONFIRMED'||slot.state==='CANCELLED'||row.acceptedScheduleVersion<slot.scheduleVersion)throw new ForbiddenException('预约已变更、暂停或取消，当前不能进入咨询');
    const user=await tx.user.findUnique({where:{id:userId}});if(user?.status!=='ACTIVE')throw new ForbiddenException('账号暂不可用');
    const isTeacher=teacher?.userId===userId;
    if(!isTeacher&&row.userId!==userId)throw new ForbiddenException('仅本次预约学员和负责老师可进入');
    if(isTeacher&&(!user.roles.includes('TEACHER')||!(await this.permissions.resolve(user.roles)).includes('teaching.write')||teacher?.status!=='PUBLISHED'))throw new ForbiddenException('咨询老师权限已变化');
    if(!teacher?.userId)throw new ForbiddenException('老师尚未开通App咨询');
    const teacherUser=await tx.user.findUnique({where:{id:teacher.userId}}),student=await tx.user.findUnique({where:{id:row.userId}});if(teacherUser?.status!=='ACTIVE'||teacher.status!=='PUBLISHED'||!teacherUser.roles.includes('TEACHER')||!(await this.permissions.resolve(teacherUser.roles)).includes('teaching.write')||student?.status!=='ACTIVE')throw new ForbiddenException('本次咨询参与账号权限已变化');
    if(row.orderItemId){const hold=await tx.$queryRaw<{id:string}[]>`SELECT r.id FROM "Refund" r JOIN "TradeOrderItem" i ON i."orderId"=r."orderId" WHERE i.id=${row.orderItemId} AND r.state IN ('APPROVED','REFUNDING','FAILED') LIMIT 1`;if(hold.length)throw new ForbiddenException('本次预约正在办理售后，暂不能进入');}
    const now=Date.now(),until=new Date(+slot.endsAt+5*60000);
    if(now<+slot.startsAt-5*60000||now>=+until)throw new ForbiddenException('请在预约开始前5分钟至结束后5分钟内进入咨询');
    return{row,slot,role:isTeacher?'TEACHER':'STUDENT',until,title:snapshot.title??offering.title};
  }
  async join(req:AuthRequest,id:string){
    await this.auth.rateLimit('consult-join:'+req.actor.id,30,60000);
    if(!this.zego.ready())throw new ForbiddenException('实时咨询服务尚未开通');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id=${id} FOR UPDATE`;
      const scope=await this.access(tx,id,req.actor.id),key=randomBytes(32).toString('base64url'),leaseId=randomUUID();
      await tx.consultRtcLease.updateMany({where:{appointmentId:id,userId:req.actor.id,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.consultRtcLease.create({data:{id:leaseId,appointmentId:id,authSessionId:req.authSessionId,userId:req.actor.id,rtcUserId:'c_'+leaseId.replace(/-/g,''),role:scope.role,keyHash:hash(key),expiresAt:new Date(Math.min(+scope.until,Date.now()+90000)),absoluteExpiresAt:scope.until}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'consult.rtc.join',resource:'appointment',resourceId:id,changes:{role:scope.role,leaseId}}});
      return{key,title:scope.title,role:scope.role,endsAt:scope.until};
    });
  }
  private async valid(tx:Prisma.TransactionClient,key:string){
    const lease=await tx.consultRtcLease.findUnique({where:{keyHash:hash(key)}}),now=new Date();
    if(!lease||lease.revokedAt||lease.expiresAt<=now||lease.absoluteExpiresAt<=now)throw new UnauthorizedException('咨询连接已结束，请重新进入');
    if(!await tx.authSession.findFirst({where:{id:lease.authSessionId,userId:lease.userId,kind:'APP',revokedAt:null,expiresAt:{gt:now},user:{status:'ACTIVE'}}}))throw new UnauthorizedException('请重新登录');
    await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id=${lease.appointmentId} FOR SHARE`;
    const scope=await this.access(tx,lease.appointmentId,lease.userId);if(scope.role!==lease.role)throw new ForbiddenException('咨询身份已变化');
    return{lease,scope};
  }
  async refresh(key:string){return this.db.$transaction(async tx=>{
    const {lease,scope}=await this.valid(tx,key),publishStreamId=consultStream(lease.appointmentId,lease.role),playStreamId=consultStream(lease.appointmentId,lease.role==='TEACHER'?'STUDENT':'TEACHER');
    const token=this.zego.roomToken(lease.rtcUserId,consultRoom(lease.appointmentId),publishStreamId,true);
    if(!(await tx.consultRtcLease.updateMany({where:{id:lease.id,revokedAt:null,expiresAt:{gt:new Date()}},data:{expiresAt:new Date(Math.min(+scope.until,Date.now()+90000))}})).count)throw new UnauthorizedException('咨询连接已结束');
    return{...token,title:scope.title,role:lease.role,publishStreamId,playStreamIds:[playStreamId],endsAt:scope.until};
  });}
  async leave(key:string){await this.db.consultRtcLease.updateMany({where:{keyHash:hash(key),revokedAt:null},data:{revokedAt:new Date()}});return{success:true};}
  async runJobs(){
    if(this.working||!this.zego.ready())return;this.working=true;
    try{const rows=await this.db.consultRtcLease.findMany({where:{kickedAt:null},orderBy:{id:'asc'},take:100,...(this.cursor?{cursor:{id:this.cursor},skip:1}:{})});this.cursor=rows.length===100?rows.at(-1)!.id:undefined;for(const lease of rows){
      let stop=!!lease.revokedAt||lease.expiresAt<=new Date()||lease.absoluteExpiresAt<=new Date();
      if(!stop)try{await this.db.$transaction(async tx=>{const session=await tx.authSession.findFirst({where:{id:lease.authSessionId,revokedAt:null,expiresAt:{gt:new Date()},user:{status:'ACTIVE'}}});if(!session)throw Error('session revoked');await this.access(tx,lease.appointmentId,lease.userId);});}catch{stop=true;}
      if(stop){await this.db.consultRtcLease.updateMany({where:{id:lease.id,revokedAt:null},data:{revokedAt:new Date()}});try{await this.zego.kickRoom(consultRoom(lease.appointmentId),lease.rtcUserId);await this.db.consultRtcLease.update({where:{id:lease.id},data:{kickedAt:new Date()}});}catch{}}
    }}finally{this.working=false;}
  }
}
@Controller('rtc/consultations')
export class ConsultRtcController{
  constructor(private readonly rtc:ConsultRtc){}
  @Get('mine') @UseGuards(UserGuard) mine(@Req() req:AuthRequest){return this.rtc.mine(req);}
  @Post(':id/join') @UseGuards(UserGuard) join(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');return this.rtc.join(req,id);}
  @Post('refresh') refresh(@Body() dto:ConsultKeyDto,@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');return this.rtc.refresh(dto.key);}
  @Post('leave') leave(@Body() dto:ConsultKeyDto){return this.rtc.leave(dto.key);}
}
