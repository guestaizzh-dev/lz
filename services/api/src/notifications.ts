import {BadRequestException,Body,ConflictException,Controller,Delete,Get,Injectable,Logger,NotFoundException,Param,ParseUUIDPipe,Patch,Post,Req,UseGuards} from '@nestjs/common';
import {IsBoolean,IsIn,IsInt,IsString,Length,Matches,Min} from 'class-validator';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {Database} from './database.js';
import {UserGuard,type AuthRequest} from './auth.js';
import {encryptPrivate,decryptPrivate} from './private-data.js';
import {messageCategory,messageTarget} from './message-target.js';

class PreferencesDto {
  @IsInt() @Min(0) expectedVersion!:number;
  @IsBoolean() pushEnabled!:boolean;
  @IsBoolean() transactions!:boolean;
  @IsBoolean() learning!:boolean;
  @IsBoolean() community!:boolean;
}
class DeviceDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{10,200}$/) clientId!:string;
  @IsIn(['ANDROID','IOS']) platform!:string;
  @IsBoolean() permissionGranted!:boolean;
}
export function pushConfiguration(env=process.env){
  if(env.PUSH_ENABLED!==undefined&&!['true','false'].includes(env.PUSH_ENABLED))throw Error('PUSH_ENABLED must be true or false');
  if(env.PUSH_ENABLED!=='true')return null;
  let url:URL;try{url=new URL(env.PUSH_GATEWAY_URL??'');}catch{throw Error('Push requires an HTTPS gateway');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(env.PUSH_GATEWAY_SECRET??'').length<32)throw Error('Push requires an HTTPS gateway and a server secret of at least 32 characters');
  return {url:url.toString(),secret:env.PUSH_GATEWAY_SECRET!};
}
const defaults={version:0,pushEnabled:false,transactions:true,learning:true,community:true};
@Injectable()
export class Notifications {
  private timer?:ReturnType<typeof setInterval>;
  private running=false;
  private readonly logger=new Logger(Notifications.name);
  constructor(private readonly db:Database){}
  onModuleInit(){pushConfiguration();if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.runJobs().catch(()=>this.logger.error('Notification worker failed; jobs remain durable')),10000);this.timer.unref();}}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async preferences(userId:string){return {...(await this.db.notificationPreference.findUnique({where:{userId}})??defaults),gatewayReady:!!pushConfiguration()};}
  async savePreferences(req:AuthRequest,dto:PreferencesDto){return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
    const row=await tx.notificationPreference.findUnique({where:{userId:req.actor.id}});
    if((row?.version??0)!==dto.expectedVersion)throw new ConflictException('通知偏好已变化，请刷新后保存');
    const {expectedVersion,...value}=dto;
    const saved=row?await tx.notificationPreference.update({where:{userId:req.actor.id},data:{...value,version:{increment:1},updatedAt:new Date()}}):await tx.notificationPreference.create({data:{userId:req.actor.id,...value}});
    if(!value.pushEnabled)await tx.deviceToken.updateMany({where:{userId:req.actor.id},data:{enabled:false,revokedAt:new Date(),version:{increment:1}}});
    return {...saved,gatewayReady:!!pushConfiguration()};
  });}
  async register(req:AuthRequest,dto:DeviceDto){return this.db.$transaction(async tx=>{
    // The authenticated session owns the binding. Client-supplied user/device IDs are never trusted.
    await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${req.authSessionId} FOR UPDATE`;
    const session=await tx.authSession.findUniqueOrThrow({where:{id:req.authSessionId}});
    if(session.kind!=='APP'||session.revokedAt||session.expiresAt<=new Date())throw new BadRequestException('请使用有效App会话');
    const hash=createHash('sha256').update(dto.clientId).digest('hex');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash},0))`;
    const prior=await tx.deviceToken.findUnique({where:{tokenHash:hash}}),pref=await tx.notificationPreference.findUnique({where:{userId:req.actor.id}}),enabled=!!pref?.pushEnabled&&dto.permissionGranted;
    const same=prior?.sessionId===session.id&&prior.userId===session.userId&&!prior.revokedAt&&prior.enabled===enabled;
    await tx.deviceToken.updateMany({where:{sessionId:session.id,tokenHash:{not:hash},enabled:true},data:{enabled:false,revokedAt:new Date(),version:{increment:1}}});
    const data={userId:session.userId,sessionId:session.id,deviceId:session.id,platform:dto.platform,provider:'UNI_PUSH',tokenCipher:encryptPrivate(dto.clientId),enabled,revokedAt:enabled?null:new Date(),lastConfirmedAt:new Date()};
    const row=prior?await tx.deviceToken.update({where:{id:prior.id},data:{...data,...(!same?{boundAt:new Date(),version:{increment:1}}:{})}}):await tx.deviceToken.create({data:{...data,tokenHash:hash}});
    return {registered:row.enabled,gatewayReady:!!pushConfiguration()};
  });}
  async unbind(req:AuthRequest){await this.db.deviceToken.updateMany({where:{userId:req.actor.id,sessionId:req.authSessionId},data:{enabled:false,revokedAt:new Date(),version:{increment:1}}});return{success:true};}
  async detail(userId:string,id:string){const row=await this.db.notification.findFirst({where:{id,userId,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});if(!row)throw new NotFoundException('消息已过期或不属于当前账号');return{...row,target:messageTarget(row)};}
  async readAll(userId:string){const now=new Date(),result=await this.db.notification.updateMany({where:{userId,readAt:null,OR:[{expiresAt:null},{expiresAt:{gt:now}}]},data:{readAt:now,updatedAt:now}});return{count:result.count};}
  async runJobs(limit=30){
    if(this.running)return;this.running=true;
    try{for(let i=0;i<limit;i++){
      const [job]=await this.db.$queryRaw<{id:string;aggregateId:string;attempts:number;workerId:string}[]>`UPDATE "OutboxJob" SET state='RUNNING',"workerId"=${randomUUID()},"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1,"updatedAt"=now() WHERE id=(SELECT id FROM "OutboxJob" WHERE kind='NOTIFICATION_PUSH' AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,"aggregateId",attempts,"workerId"`;
      if(!job)break;
      try{await this.deliver(job.aggregateId);await this.db.outboxJob.updateMany({where:{id:job.id,workerId:job.workerId},data:{state:'DONE',completedAt:new Date(),lockedUntil:null,lastErrorCode:null}});}
      catch(e){const code=e instanceof PushFailure?e.code:'PUSH_UNAVAILABLE',dead=code==='PUSH_AMBIGUOUS'||job.attempts>=8;await this.db.outboxJob.updateMany({where:{id:job.id,workerId:job.workerId},data:{state:dead?'DEAD':'READY',lockedUntil:null,availableAt:new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)),lastErrorCode:code}});}
    }}finally{this.running=false;}
  }
  private async deliver(id:string){
    const notification=await this.db.notification.findUnique({where:{id}});if(!notification)return;
    const pref=await this.db.notificationPreference.findUnique({where:{userId:notification.userId}}),now=new Date();
    if(!pref?.pushEnabled||!pref[messageCategory(notification.kind)]||notification.readAt||notification.expiresAt&&notification.expiresAt<=now||now.getTime()-notification.createdAt.getTime()>86400000)return;
    const devices=await this.db.deviceToken.findMany({where:{userId:notification.userId,enabled:true,revokedAt:null,boundAt:{lte:notification.createdAt}},take:20});
    for(const device of devices){
      const key=createHash('sha256').update(id+':'+device.id+':'+device.version).digest('hex').slice(0,32);
      const delivery=await this.db.notificationDelivery.upsert({where:{deliveryKey:key},create:{notificationId:id,deviceTokenId:device.id,deviceVersion:device.version,channel:'UNI_PUSH',deliveryKey:key,state:'READY'},update:{}});
      if(['ACCEPTED','SKIPPED','UNKNOWN'].includes(delivery.state)){if(delivery.state==='UNKNOWN')throw new PushFailure('PUSH_AMBIGUOUS');continue;}
      // Lock the binding through dispatch so logout/transfer cannot race sending an old account's event.
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "DeviceToken" WHERE id=${device.id} FOR UPDATE`;
        const current=await tx.deviceToken.findUniqueOrThrow({where:{id:device.id}}),session=current.sessionId?await tx.authSession.findUnique({where:{id:current.sessionId}}):null,latest=await tx.notificationPreference.findUnique({where:{userId:notification.userId}});
        if(current.userId!==notification.userId||current.version!==delivery.deviceVersion||!current.enabled||current.revokedAt||!session||session.revokedAt||session.expiresAt<=new Date()||!latest?.pushEnabled||!latest[messageCategory(notification.kind)]){await tx.notificationDelivery.update({where:{id:delivery.id},data:{state:'SKIPPED',failureCode:'BINDING_INACTIVE'}});return;}
        const config=pushConfiguration();if(!config)throw new PushFailure('PUSH_NOT_CONFIGURED');
        await tx.notificationDelivery.update({where:{id:delivery.id},data:{attempts:{increment:1},state:'SENDING'}});
        const body=JSON.stringify({requestId:key,clientId:decryptPrivate(current.tokenCipher),notificationId:id}),timestamp=String(Date.now()),signature=createHmac('sha256',config.secret).update(timestamp+'.'+body).digest('hex');
        let state='READY',failureCode:string|null=null,messageId:string|null=null;
        try{const res=await fetch(config.url,{method:'POST',headers:{'Content-Type':'application/json','X-Academy-Timestamp':timestamp,'X-Academy-Signature':signature},body,signal:AbortSignal.timeout(8000),redirect:'error'});const result=await res.json() as {state?:string;messageId?:string};if(res.ok&&result.state==='ACCEPTED'&&result.messageId){state='ACCEPTED';messageId=result.messageId;}else{failureCode=result.state==='UNKNOWN'?'PUSH_AMBIGUOUS':'PUSH_GATEWAY_REJECTED';state=failureCode==='PUSH_AMBIGUOUS'?'UNKNOWN':'READY';}}
        catch{failureCode='PUSH_AMBIGUOUS';state='UNKNOWN';}
        await tx.notificationDelivery.update({where:{id:delivery.id},data:{state,failureCode,providerMessageId:messageId,nextRetryAt:state==='READY'?new Date(Date.now()+60000):null}});
      },{timeout:15000});
      const result=await this.db.notificationDelivery.findUniqueOrThrow({where:{id:delivery.id}});
      if(result.state==='UNKNOWN')throw new PushFailure('PUSH_AMBIGUOUS');if(result.state==='READY')throw new PushFailure(result.failureCode??'PUSH_UNAVAILABLE');
    }
  }
}
class PushFailure extends Error {constructor(readonly code:string){super(code);}}
@Controller('me') @UseGuards(UserGuard)
export class NotificationsController {
  constructor(private readonly service:Notifications){}
  @Get('notification-preferences') preferences(@Req() req:AuthRequest){return this.service.preferences(req.actor.id);}
  @Patch('notification-preferences') save(@Req() req:AuthRequest,@Body() dto:PreferencesDto){return this.service.savePreferences(req,dto);}
  @Post('push-device') register(@Req() req:AuthRequest,@Body() dto:DeviceDto){return this.service.register(req,dto);}
  @Delete('push-device') unbind(@Req() req:AuthRequest){return this.service.unbind(req);}
  @Post('messages/read-all') readAll(@Req() req:AuthRequest){return this.service.readAll(req.actor.id);}
  @Get('messages/:id') detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.service.detail(req.actor.id,id);}
}
