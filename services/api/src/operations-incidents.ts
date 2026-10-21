import {BadRequestException,Body,ConflictException,Controller,Get,Injectable,Logger,OnModuleDestroy,OnModuleInit,Param,ParseUUIDPipe,Post,Query,Req,UseGuards} from '@nestjs/common';
import {IsInt,IsString,Length,Min} from 'class-validator';
import {statfs} from 'node:fs/promises';import {resolve} from 'node:path';
import {Database} from './database.js';import {AdminGuard,requireRoles,type AuthRequest} from './auth.js';import {MarketingPage} from './marketing.js';
export type OperationSignal={key:string;title:string;severity:'WARNING'|'CRITICAL';path:string;details:{[key:string]:number|string|boolean};active:boolean};
class AcknowledgeDto {@IsInt() @Min(1) expectedVersion!:number;@IsString() @Length(2,500) reason!:string;}
@Injectable()
export class OperationsIncidents implements OnModuleInit,OnModuleDestroy {
 constructor(private readonly db:Database){}
 private timer?:ReturnType<typeof setInterval>;private working=false;private logger=new Logger(OperationsIncidents.name);private samples:{at:number;ms:number;failed:boolean}[]=[];
 onModuleInit(){if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.scan().catch(()=>this.logger.error('Operations incident scan failed')),30000);this.timer.unref();void this.scan().catch(()=>this.logger.error('Operations incident startup scan pending'));}}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 observe(status:number,ms:number){this.samples.push({at:Date.now(),ms,failed:status>=500});if(this.samples.length>3000)this.samples.splice(0,1000);}
 metrics(){const recent=this.samples.filter(s=>s.at>Date.now()-300000),latencies=recent.map(s=>s.ms).sort((a,b)=>a-b);return{sampledRequests:recent.length,errorCount:recent.filter(s=>s.failed).length,p95Ms:latencies[Math.max(0,Math.ceil(latencies.length*.95)-1)]??0,windowMinutes:5};}
 async reconcile(signals:OperationSignal[]){
  for(const signal of signals)await this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'ops.incident:'+signal.key},0))`;const old=await tx.operationsIncident.findUnique({where:{key:signal.key}});
   if(!signal.active){if(old&&old.state!=='RESOLVED'){await tx.operationsIncident.update({where:{id:old.id},data:{state:'RESOLVED',resolvedAt:new Date(),lastSeenAt:new Date(),details:signal.details,version:{increment:1}}});await tx.operationsIncidentEvent.create({data:{incidentId:old.id,episode:old.episode,action:'RESOLVED',details:signal.details}});}return;}
   const reopened=old?.state==='RESOLVED',episode=(old?.episode??0)+(reopened||!old?1:0),row=old?await tx.operationsIncident.update({where:{id:old.id},data:{title:signal.title,severity:signal.severity,path:signal.path,details:signal.details,lastSeenAt:new Date(),...(reopened?{state:'OPEN',episode,resolvedAt:null,acknowledgedBy:null,acknowledgedAt:null,version:{increment:1}}:{})}}):await tx.operationsIncident.create({data:{key:signal.key,title:signal.title,severity:signal.severity,path:signal.path,details:signal.details}});
   if(!old||reopened){await tx.operationsIncidentEvent.create({data:{incidentId:row.id,episode,action:'OPEN',details:signal.details}});const administrators=await tx.user.findMany({where:{status:'ACTIVE',roles:{has:'ADMIN'}},select:{id:true}});for(const user of administrators)await tx.notification.create({data:{userId:user.id,kind:'OPERATIONS_ALERT',eventKey:'ops.incident:'+row.id+':'+episode+':'+user.id,title:signal.title,body:'后台运行异常已记录，请到后台「运行告警」查看并处理；修复后系统自动复核解除。'}});}
  });
 }
 async scan(){if(this.working)return;this.working=true;try{
  const at=new Date(),[dead,overdue,recording,partner,refunds,inventory]=await Promise.all([this.db.outboxJob.count({where:{state:'DEAD'}}),this.db.outboxJob.count({where:{state:{in:['READY','RUNNING']},availableAt:{lt:new Date(+at-15*60000)},OR:[{lockedUntil:null},{lockedUntil:{lt:at}}]}}),this.db.liveRecording.count({where:{state:'FAILED'}}),this.db.commercePartnerShare.count({where:{attempts:{gte:20}}}),this.db.refund.count({where:{state:{in:['REFUNDING','FAILED']},updatedAt:{lt:new Date(+at-86400000)}}}),this.db.$queryRaw<{count:number}[]>`SELECT count(*)::int AS count FROM "ProductSku" WHERE stock<0 OR reserved<0 OR reserved>stock`]);
  const count=(key:string,title:string,n:number,path:string,severity:'WARNING'|'CRITICAL'='WARNING'):OperationSignal=>({key,title,severity,path,details:{count:n},active:n>0});
  const signals=[count('dead-jobs','业务任务失败，需要核查',dead,'/operations','CRITICAL'),count('overdue-jobs','业务任务积压超过15分钟',overdue,'/operations'),count('failed-recordings','直播录制失败，需要处理回放',recording,'/content/live','CRITICAL'),count('partner-recovery','合作分成来源核对失败',partner,'/partner-finance'),count('stalled-refunds','退款超过24小时仍待确认',refunds,'/finance'),count('inventory','商品库存账异常',inventory[0]?.count??0,'/products','CRITICAL')];
  try{const disk=await statfs(resolve(process.env.MEDIA_DIR??'.media')),available=Number(disk.bavail)*Number(disk.bsize),total=Number(disk.blocks)*Number(disk.bsize);signals.push({key:'media-capacity',title:'媒体存储空间不足，请处理容量',severity:available<2*1024**3?'CRITICAL':'WARNING',path:'/operations/incidents',details:{availableBytes:available,totalBytes:total,minimumRecordingWorkingBytes:6*1024**3},active:available<6*1024**3});}catch{signals.push({key:'media-capacity',title:'媒体存储状态无法读取',severity:'CRITICAL',path:'/operations/incidents',details:{available:false},active:true});}
  const metrics=this.metrics();signals.push({key:'api-errors',title:'接口错误率升高',severity:'CRITICAL',path:'/operations/incidents',details:metrics,active:metrics.sampledRequests>=20&&metrics.errorCount/metrics.sampledRequests>.05},{key:'api-latency',title:'常用接口响应超过目标',severity:'WARNING',path:'/operations/incidents',details:metrics,active:metrics.sampledRequests>=20&&metrics.p95Ms>800});await this.reconcile(signals);
 }finally{this.working=false;}}
 async summary(){const [open,acknowledged]=await Promise.all([this.db.operationsIncident.count({where:{state:'OPEN'}}),this.db.operationsIncident.count({where:{state:'ACKNOWLEDGED'}})]);return{open,acknowledged,active:open+acknowledged,metrics:this.metrics(),checkedAt:new Date()};}
 async list(q:MarketingPage){const [items,total]=await this.db.$transaction([this.db.operationsIncident.findMany({orderBy:[{state:'asc'},{lastSeenAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.size,take:q.size}),this.db.operationsIncident.count()]);return{items,total};}
 async history(id:string,q:MarketingPage){const where={incidentId:id};const [items,total]=await this.db.$transaction([this.db.operationsIncidentEvent.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.size,take:q.size}),this.db.operationsIncidentEvent.count({where})]);return{items,total};}
 async acknowledge(id:string,req:AuthRequest,dto:AcknowledgeDto){requireRoles(req,['ADMIN']);return this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "OperationsIncident" WHERE id=${id} FOR UPDATE`;const row=await tx.operationsIncident.findUniqueOrThrow({where:{id}});if(row.state==='RESOLVED')throw new ConflictException('异常已经解除，请刷新');if(row.version!==dto.expectedVersion)throw new ConflictException('告警状态已变化，请刷新');if(row.state==='ACKNOWLEDGED')return row;const saved=await tx.operationsIncident.update({where:{id},data:{state:'ACKNOWLEDGED',acknowledgedBy:req.actor.id,acknowledgedAt:new Date(),version:{increment:1}}});await tx.operationsIncidentEvent.create({data:{incidentId:id,episode:row.episode,action:'ACKNOWLEDGED',actorId:req.actor.id,details:{reason:dto.reason}}});await tx.auditLog.create({data:{actorId:req.actor.id,action:'operations.incident.acknowledge',resource:'operations_incident',resourceId:id,reason:dto.reason,changes:{key:row.key,episode:row.episode}}});return saved;});}
}
@Controller('admin/operations/incidents') @UseGuards(AdminGuard)
export class OperationsIncidentsController {
 constructor(private readonly incidents:OperationsIncidents){}
 @Get('summary') summary(){return this.incidents.summary();}
 @Get() list(@Query() q:MarketingPage){return this.incidents.list(q);}
 @Get(':id/history') history(@Param('id',ParseUUIDPipe) id:string,@Query() q:MarketingPage){return this.incidents.history(id,q);}
 @Post('scan') async scan(@Req() req:AuthRequest){requireRoles(req,['ADMIN']);await this.incidents.scan();return this.incidents.summary();}
 @Post(':id/acknowledge') acknowledge(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:AcknowledgeDto){return this.incidents.acknowledge(id,req,dto);}
}
