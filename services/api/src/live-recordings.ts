import {Injectable,Logger,ServiceUnavailableException} from '@nestjs/common';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {access,mkdir,readdir,rename,stat,statfs,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Database} from './database.js';
import {ZegoService,rtcRoomId,rtcStreamId,zegoToken04} from './zego.js';
import {fileHash,mediaCommand,MEDIA_MAX_BYTES} from './media-ingest.js';

const terminal=['ENDED','REPLAY_READY','CANCELLED'];
type Running={process?:ChildProcessWithoutNullStreams;token:string;controller:AbortController;renewed:number;started:number;failure?:string;processing?:boolean;stopping?:number;};
export const recordingMessages:Record<string,string>={RECORDER_UNAVAILABLE:'服务端录制尚未安装或启用，请联系维护人员。',RECORDING_DISK_LOW:'录像磁盘可用空间不足，请扩容后重试。',RECORDING_PROCESS_FAILED:'录制进程异常退出，已保留录制片段。',RECORDING_RETRY_LIMIT:'录制连续失败，已保留片段，请检查服务后重试。',RECORDING_EMPTY:'未录到有效音视频，请确认开播时摄像头和麦克风正常。',RECORDING_MEDIA_INVALID:'录制文件处理失败，原片段已保留，请重试或联系维护人员。',RECORDING_PARTIAL:'本场录制经过恢复，请预览后确认发布，避免不完整视频自动公开。'};

@Injectable()
export class LiveRecordings {
  private readonly root=resolve(process.env.MEDIA_DIR??'.media');
  private readonly logger=new Logger(LiveRecordings.name);
  private readonly active=new Map<string,Running>();
  private timer?:ReturnType<typeof setInterval>;private working=false;private stopped=false;
  constructor(private readonly db:Database,private readonly zego:ZegoService){}
  onModuleInit(){if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.tick().catch(()=>this.logger.error('Recording recovery pending')),3000);this.timer.unref();}}
  async onModuleDestroy(){this.stopped=true;if(this.timer)clearInterval(this.timer);for(const task of this.active.values()){task.controller.abort();task.process?.stdin.end('STOP\n');}await new Promise(r=>setTimeout(r,1000));for(const task of this.active.values())task.process?.kill('SIGTERM');}
  async readiness(){
    if(process.platform!=='linux'||process.env.ZEGO_LOCAL_RECORDING_ENABLED!=='true')return {ready:false,reason:recordingMessages.RECORDER_UNAVAILABLE};
    try{await access(process.env.ZEGO_RECORDER_BINARY??'/opt/zego-recorder/academy-recorder');await mkdir(resolve(this.root,'recordings'),{recursive:true});const disk=await statfs(this.root);if(disk.bavail*disk.bsize<2*1024**3)return{ready:false,reason:recordingMessages.RECORDING_DISK_LOW};this.zego.config();return{ready:true,reason:''};}catch{return{ready:false,reason:recordingMessages.RECORDER_UNAVAILABLE};}
  }
  async requireReady(){const status=await this.readiness();if(!status.ready)throw new ServiceUnavailableException(status.reason);}
  async ensure(sessionId:string){return this.db.liveRecording.upsert({where:{sessionId},create:{sessionId},update:{}});}
  private credential(sessionId:string,jobId:string){const{appId,secret}=this.zego.config(),userId='rec_'+jobId.replace(/-/g,'');return{appId,userId,token:zegoToken04(appId,userId,secret,300,JSON.stringify({room_id:rtcRoomId(sessionId),privilege:{1:1,2:0},stream_id_list:null}))};}
  async tick(){
    if(this.working||this.stopped)return;this.working=true;
    try{
      for(const[id,task]of this.active){
        const result=await this.db.liveRecording.updateMany({where:{id,leaseToken:task.token},data:{leaseUntil:new Date(Date.now()+90000)}});
        if(!result.count){task.controller.abort();task.process?.kill('SIGTERM');continue;}
        const job=await this.db.liveRecording.findUniqueOrThrow({where:{id}}),session=await this.db.liveSession.findUniqueOrThrow({where:{id:job.sessionId}});
        if(task.process){
          const disk=await statfs(this.root);if(disk.bavail*disk.bsize<512*1024**2)task.failure='RECORDING_DISK_LOW';
          if(task.failure||terminal.includes(session.state)||session.state==='PREPARING'&&Date.now()-task.started>10*60000){if(!task.stopping){task.stopping=Date.now();task.process.stdin.write('STOP\n');}else if(Date.now()-task.stopping>20000)task.process.kill('SIGTERM');}
          if(Date.now()-task.renewed>60000&&!task.stopping){task.process.stdin.write('TOKEN '+this.credential(session.id,job.id).token+'\n');task.renewed=Date.now();}
        }
      }
      if(this.active.size>=2)return;
      const jobs=await this.db.liveRecording.findMany({where:{state:{in:['WAITING','STARTING','ARMED','RECORDING','PROCESSING']},OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},orderBy:{createdAt:'asc'},take:4});
      for(const job of jobs){
        if(this.active.size>=2)break;
        const s=await this.db.liveSession.findUniqueOrThrow({where:{id:job.sessionId}});if(s.state==='SCHEDULED')continue;
        const finishing=terminal.includes(s.state)||job.state==='PROCESSING';if(finishing?[...this.active.values()].some(t=>t.processing):[...this.active.values()].some(t=>!t.processing))continue;
        const token=randomUUID(),claimed=await this.db.liveRecording.updateMany({where:{id:job.id,OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{leaseToken:token,leaseUntil:new Date(Date.now()+90000)}});if(!claimed.count)continue;
        const running:Running={token,controller:new AbortController(),renewed:Date.now(),started:Date.now()};this.active.set(job.id,running);
        if(terminal.includes(s.state)||job.state==='PROCESSING')void this.finish(job.id,running).catch(()=>{});
        else void this.launch(job.id,running).catch(()=>{});
      }
    }catch(error){for(const task of this.active.values()){task.failure='RECORDING_PROCESS_FAILED';task.controller.abort();task.process?.kill('SIGTERM');}throw error;}
    finally{this.working=false;}
  }
  private async fail(id:string,task:Running,failure:string){await this.db.liveRecording.updateMany({where:{id,leaseToken:task.token},data:{state:'FAILED',failure,leaseToken:null,leaseUntil:null}});}
  private async launch(id:string,task:Running){
    try{
      await this.requireReady();const job=await this.db.liveRecording.findUniqueOrThrow({where:{id}});
      if(job.retries>=3){await this.fail(id,task,'RECORDING_RETRY_LIMIT');return;}
      const attempt=job.attempts+1,directory=resolve(this.root,'recordings',id,String(attempt).padStart(4,'0'));
      await mkdir(directory,{recursive:true});
      await this.db.liveRecording.updateMany({where:{id,leaseToken:task.token},data:{attempts:attempt,state:'STARTING',failure:null}});
      const c=this.credential(job.sessionId,id),child=spawn(process.env.ZEGO_RECORDER_BINARY??'/opt/zego-recorder/academy-recorder',[String(c.appId),rtcRoomId(job.sessionId),c.userId,rtcStreamId(job.sessionId),directory],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,LD_LIBRARY_PATH:process.env.ZEGO_RECORDER_LIBRARY_DIR??'/opt/zego-recorder'},windowsHide:true});task.process=child;
      child.stdin.on('error',()=>{});child.stdin.write(c.token+'\n');
      let buffer='';child.stdout.on('data',data=>{buffer=(buffer+data.toString()).slice(-32768);let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const event=JSON.parse(line);if(event.event==='login'&&event.code===0)void this.db.liveRecording.updateMany({where:{id,leaseToken:task.token,state:'STARTING'},data:{state:'ARMED'}}).catch(()=>{});if(event.event==='recording')void this.db.liveRecording.updateMany({where:{id,leaseToken:task.token,state:{in:['STARTING','ARMED']}},data:{state:'RECORDING',startedAt:job.startedAt??new Date()}}).catch(()=>{});}catch{}}});
      child.stderr.on('data',()=>{}); // SDK logs stay in its bounded private directory, never return tokens or raw logs.
      const code=await new Promise<number|null>(yes=>{child.once('error',()=>yes(-1));child.once('close',yes);});task.process=undefined;
      if(this.stopped)return;
      const s=await this.db.liveSession.findUniqueOrThrow({where:{id:job.sessionId}});
      if(task.failure){await this.fail(id,task,task.failure);return;}
      if(code!==0)await this.db.liveRecording.updateMany({where:{id,leaseToken:task.token},data:{failure:'RECORDING_PROCESS_FAILED'}});
      if(terminal.includes(s.state)){await this.finish(id,task);return;}
      await this.db.liveRecording.updateMany({where:{id,leaseToken:task.token},data:{state:job.retries+1>=3?'FAILED':'WAITING',retries:{increment:1},failure:'RECORDING_PROCESS_FAILED',leaseUntil:new Date(Date.now()+15000),leaseToken:null}});
    }catch(error){await this.fail(id,task,error instanceof ServiceUnavailableException?(error.message.includes('空间')?'RECORDING_DISK_LOW':'RECORDER_UNAVAILABLE'):'RECORDING_PROCESS_FAILED').catch(()=>{});}
    finally{if(this.active.get(id)===task)this.active.delete(id);}
  }
  private async files(directory:string):Promise<string[]>{const entries=await readdir(directory,{withFileTypes:true}).catch(()=>[]);const files:string[]=[];for(const entry of entries){const path=resolve(directory,entry.name);if(entry.isDirectory()&&/^\d{4}$/.test(entry.name))files.push(...await this.files(path));else if(entry.isFile()&&/^part-\d+.*\.mp4$/.test(entry.name))files.push(path);}return files;}
  private async finish(id:string,task:Running){
    task.processing=true;
    try{
      const job=await this.db.liveRecording.findUniqueOrThrow({where:{id}}),session=await this.db.liveSession.findUniqueOrThrow({where:{id:job.sessionId}});
      await this.db.liveRecording.updateMany({where:{id,leaseToken:task.token},data:{state:'PROCESSING',stoppedAt:job.stoppedAt??new Date()}});
      const files=(await this.files(resolve(this.root,'recordings',id))).sort();if(!files.length){await this.fail(id,task,'RECORDING_EMPTY');return;}
      const valid:string[]=[];let expectedDuration=0,skipped=false;
      for(const file of files){try{const p=JSON.parse(await mediaCommand(process.env.FFPROBE_PATH??'ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',file],30000,task.controller.signal));const duration=Number(p.format?.duration);if(duration>0&&p.streams?.some((s:{codec_type:string})=>s.codec_type==='video')){valid.push(file);expectedDuration+=duration;}else skipped=true;}catch{skipped=true;}}
      if(!valid.length){await this.fail(id,task,'RECORDING_MEDIA_INVALID');return;}
      const disk=await statfs(this.root);if(disk.bavail*disk.bsize<Math.min(expectedDuration*600000,MEDIA_MAX_BYTES)+512*1024**2){await this.fail(id,task,'RECORDING_DISK_LOW');return;}
      const list=resolve(this.root,'recordings',id,task.token+'.concat'),output=resolve(this.root,id+'.'+task.token+'.recording.mp4'),storageKey=id+'.replay.mp4';
      await writeFile(list,valid.map(file=>"file '"+file.replace(/\\/g,'/').replace(/'/g,"'\\''")+"'").join('\n'));
      await mediaCommand(process.env.FFMPEG_PATH??'ffmpeg',['-nostdin','-y','-v','error','-protocol_whitelist','file,pipe','-f','concat','-safe','0','-i',list,'-map','0:v:0','-map','0:a:0?','-vf',"scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",'-c:v','libx264','-preset','fast','-threads','1','-crf','23','-pix_fmt','yuv420p','-r','30','-g','60','-keyint_min','30','-sc_threshold','0','-c:a','aac','-b:a','128k','-af','aresample=async=1000','-avoid_negative_ts','make_zero','-movflags','+faststart','-fs',String(MEDIA_MAX_BYTES),output],24*60*60000,task.controller.signal);
      const info=await stat(output),probe=JSON.parse(await mediaCommand(process.env.FFPROBE_PATH??'ffprobe',['-v','error','-show_format','-show_streams','-of','json',output],30000,task.controller.signal)),duration=Number(probe.format?.duration);
      if(info.size>=MEDIA_MAX_BYTES||duration<=0||Math.abs(duration-expectedDuration)>Math.max(2,expectedDuration*0.005))throw Error('RECORDING_MEDIA_INVALID');
      const sha256=await fileHash(output),partial=skipped||job.attempts>1||!!job.failure;
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "LiveRecording" WHERE id=${id} FOR UPDATE`;
        const current=await tx.liveRecording.findUniqueOrThrow({where:{id}});if(current.leaseToken!==task.token)throw Error('LEASE_LOST');
        await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${session.id} FOR UPDATE`;
        const latest=await tx.liveSession.findUniqueOrThrow({where:{id:session.id}}),room=await tx.liveRoom.findUniqueOrThrow({where:{id:latest.roomId}});
        if(!terminal.includes(latest.state))throw Error('SESSION_ACTIVE');
        await rename(output,resolve(this.root,storageKey));
        const asset=await tx.mediaAsset.upsert({where:{storageKey},create:{storageKey,name:latest.title+' · 直播回放',mime:'video/mp4',bytes:info.size,uploaderId:latest.hostUserId,status:'READY',visibility:'PRIVATE',sha256,durationSeconds:Math.ceil(duration),variants:{delivery:'MP4_FASTSTART',recordingId:id,source:'ZEGO_SERVER_LOCAL',partial}},update:{bytes:info.size,status:'READY',sha256,durationSeconds:Math.ceil(duration)}});
        const prior=await tx.liveReplay.findUnique({where:{sessionId:session.id}}),publish=room.managedByAdmin&&!partial&&latest.state!=='CANCELLED'&&!prior;
        // Never overwrite an administrator's replacement or republish a withdrawn replay.
        if(!prior)await tx.liveReplay.create({data:{sessionId:session.id,assetId:asset.id,durationSeconds:Math.ceil(duration),reviewState:publish?'APPROVED':'PENDING',accessRuleSnapshot:latest.accessRuleSnapshot as object,reviewerId:publish?latest.hostUserId:null,publishedAt:publish?new Date():null}});
        if(publish){await tx.liveSession.update({where:{id:session.id},data:{state:'REPLAY_READY',version:{increment:1}}});const reservations=await tx.liveReservation.findMany({where:{sessionId:session.id,cancelledAt:null},select:{userId:true}});if(reservations.length)await tx.notification.createMany({data:reservations.map(r=>({userId:r.userId,eventKey:'live:'+session.id+':replay',kind:'LIVE',title:'直播回放已就绪',body:latest.title,resourceId:latest.roomId})),skipDuplicates:true});}
        await tx.liveRecording.update({where:{id},data:{state:'READY',assetId:asset.id,failure:partial?'RECORDING_PARTIAL':null,leaseToken:null,leaseUntil:null}});
        await tx.auditLog.create({data:{actorId:latest.hostUserId,action:'live.recording.ready',resource:'live',resourceId:latest.id,changes:{recordingId:id,assetId:asset.id,durationSeconds:Math.ceil(duration),partial,published:publish}}});
      });
    }catch{if(!this.stopped)await this.fail(id,task,'RECORDING_MEDIA_INVALID').catch(()=>{});}
    finally{if(this.active.get(id)===task)this.active.delete(id);}
  }
}
