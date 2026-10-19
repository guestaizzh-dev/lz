import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {BadRequestException,Body,ConflictException,Controller,Get,HttpCode,Injectable,OnModuleDestroy,OnModuleInit,Param,Post,Req,ServiceUnavailableException,UnauthorizedException,UseGuards} from '@nestjs/common';
import {IsIn,IsString,IsUUID,Length,Matches} from 'class-validator';
import {AuthService,UserGuard,publicUser,type AuthRequest} from './auth.js';
import {Database} from './database.js';
import {IdentityService,OtpDto} from './identity.js';
import {LoginProviders,loginCodeHash,socialLoginConfig,type LoginProvider} from './login-providers.js';
import {decryptPrivate,encryptPrivate,phoneLookup,maskedPhone} from './private-data.js';
import type {Prisma,SocialChallenge} from './generated/prisma/client.js';
import type {Request} from 'express';

class ProviderDto{@IsIn(['WECHAT','APPLE']) provider!:LoginProvider;}
class TicketDto{@IsUUID() ticketId!:string;@IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) state!:string;}
class AuthorizeDto extends TicketDto{@IsString() @Length(1,2048) authorizationCode!:string;}
class PhoneLinkDto extends OtpDto{@IsUUID() ticketId!:string;@IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) state!:string;}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const providers:LoginProvider[]=['WECHAT','APPLE'];

@Injectable()
export class SocialAuth implements OnModuleInit,OnModuleDestroy{
  private timer:NodeJS.Timeout|undefined;private working=false;
  constructor(private readonly db:Database,private readonly auth:AuthService,private readonly identity:IdentityService,private readonly platform:LoginProviders){}
  onModuleInit(){if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.runJobs().catch(()=>{}),30000);this.timer.unref();}}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  options(){return providers.map(provider=>({provider,enabled:!!socialLoginConfig(provider)}));}
  private enabled(provider:LoginProvider){const config=socialLoginConfig(provider);if(!config)throw new ServiceUnavailableException('该登录方式尚未开通，请使用手机号登录');return config;}
  async begin(provider:LoginProvider,ip:string,req?:AuthRequest){
    const config=this.enabled(provider);await this.auth.rateLimit('social-begin-ip:'+ip,30,15*60000);
    if(req)await this.auth.rateLimit('social-bind:'+req.actor.id,15,15*60000);
    const state=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+5*60000),row=await this.db.socialChallenge.create({data:{provider,appScope:config.appScope,stateHash:hash(state),userId:req?.actor.id,sessionId:req?.authSessionId,expiresAt}});
    return{ticketId:row.id,state,expiresAt};
  }
  private valid(row:SocialChallenge|null,dto:TicketDto,req?:AuthRequest){
    if(!row||!timingSafeEqual(Buffer.from(row.stateHash,'hex'),Buffer.from(hash(dto.state),'hex'))||row.finishedAt||row.expiresAt<=new Date()||row.userId!==(req?.actor.id??null)||row.sessionId!==(req?.authSessionId??null))throw new UnauthorizedException('授权已失效，请重新授权');
    if(this.enabled(row.provider as LoginProvider).appScope!==row.appScope)throw new UnauthorizedException('登录配置已变化，请重新授权');return row;
  }
  private async activeSession(tx:Prisma.TransactionClient,req:AuthRequest){
    const user=await tx.user.findUnique({where:{id:req.actor.id}}),session=await tx.authSession.findFirst({where:{id:req.authSessionId,userId:req.actor.id,kind:'APP',revokedAt:null,expiresAt:{gt:new Date()},accessExpiresAt:{gt:new Date()}}});
    if(user?.status!=='ACTIVE'||!session)throw new UnauthorizedException('登录状态已变化，请重新登录');return user;
  }
  async authorize(dto:AuthorizeDto,ip:string,req?:AuthRequest){
    await this.auth.rateLimit('social-verify-ip:'+ip,60,15*60000);
    const row=this.valid(await this.db.socialChallenge.findUnique({where:{id:dto.ticketId}}),dto,req);
    if(row.codeHash)throw new ConflictException('这次授权已处理，请重新授权');
    try{const claimed=await this.db.socialChallenge.updateMany({where:{id:row.id,codeHash:null,finishedAt:null,expiresAt:{gt:new Date()}},data:{codeHash:loginCodeHash(row.provider,row.appScope,dto.authorizationCode)}});if(claimed.count!==1)throw new ConflictException('授权已处理，请重新授权');}
    catch(e){if((e as {code?:string}).code==='P2002')throw new ConflictException('授权码已使用，请重新授权');throw e;}
    const verified=await this.platform.exchange(row.provider as LoginProvider,dto.authorizationCode),subjectHash=phoneLookup('identity:'+JSON.stringify([row.provider,row.appScope,verified.subject]));
    await this.db.socialChallenge.update({where:{id:row.id},data:{subjectHash,refreshCipher:verified.refreshToken?encryptPrivate(verified.refreshToken):null,verifiedAt:new Date()}});
    const known=await this.db.authIdentity.findFirst({where:{provider:row.provider,appScope:row.appScope,subjectHash}});
    if(req&&known&&known.userId!==req.actor.id)throw new ConflictException('该身份已绑定其他账号，请使用原账号登录；订单与权益不会自动合并');
    if(req||!known)return{requiresPhone:true,ticketId:row.id,expiresAt:row.expiresAt};
    const userId=known.userId,credentials=this.auth.credentials();
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "SocialChallenge" WHERE id=${row.id} FOR UPDATE`;
      const ticket=this.valid(await tx.socialChallenge.findUnique({where:{id:row.id}}),dto,req),user=await tx.user.findUnique({where:{id:userId}});
      if(user?.status!=='ACTIVE')throw new UnauthorizedException('该账号暂不可用，请联系书院');
      const identity=await tx.authIdentity.findFirst({where:{id:known!.id,userId,provider:ticket.provider,appScope:ticket.appScope,subjectHash}});if(!identity)throw new ConflictException('账号绑定已变化，请重新登录');
      await tx.authIdentity.update({where:{id:identity.id},data:{verifiedAt:new Date(),refreshCipher:ticket.refreshCipher,version:{increment:1},updatedAt:new Date()}});
      await tx.socialChallenge.update({where:{id:ticket.id},data:{finishedAt:new Date(),refreshCipher:null}});
      await tx.authSession.create({data:{userId,kind:'APP',accessHash:credentials.accessHash,refreshHash:credentials.refreshHash,accessExpiresAt:credentials.accessExpiresAt,expiresAt:new Date(Date.now()+30*86400000),csrfToken:randomBytes(32).toString('hex'),deviceId:'social:'+identity.id}});
      await tx.auditLog.create({data:{actorId:userId,action:'auth.social.login',resource:'auth_identity',resourceId:identity.id,changes:{provider:ticket.provider}}});
      return{user:publicUser(user),accessToken:credentials.access,refreshToken:credentials.refresh,expiresIn:900};
    });
  }
  private async attach(tx:Prisma.TransactionClient,ticket:SocialChallenge,userId:string){
    if(!ticket.subjectHash||!ticket.verifiedAt)throw new UnauthorizedException('请先完成第三方授权');
    // Serialize all bindings for one verified identity, across different phone accounts.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ticket.subjectHash},7))::text`;
    const existing=await tx.authIdentity.findFirst({where:{provider:ticket.provider,appScope:ticket.appScope,subjectHash:ticket.subjectHash}});
    if(existing&&existing.userId!==userId)throw new ConflictException('该身份已绑定其他账号，请使用原账号登录；订单与权益不会自动合并');
    if(await tx.authIdentity.count({where:{userId,provider:ticket.provider,appScope:ticket.appScope,...(existing?{id:{not:existing.id}}:{})}}))throw new ConflictException('当前账号已绑定另一身份，请先验证手机号并解绑');
    const data={verifiedAt:new Date(),refreshCipher:ticket.refreshCipher,updatedAt:new Date()},identity=existing?await tx.authIdentity.update({where:{id:existing.id},data:{...data,version:{increment:1}}}):await tx.authIdentity.create({data:{...data,userId,provider:ticket.provider,appScope:ticket.appScope,subjectHash:ticket.subjectHash}});
    await tx.socialChallenge.update({where:{id:ticket.id},data:{finishedAt:new Date(),refreshCipher:null}});
    await tx.auditLog.create({data:{actorId:userId,action:'auth.identity.bind',resource:'auth_identity',resourceId:identity.id,changes:{provider:ticket.provider}}});
  }
  async phone(dto:PhoneLinkDto,ip:string,req?:AuthRequest){
    this.valid(await this.db.socialChallenge.findUnique({where:{id:dto.ticketId}}),dto,req);
    return this.identity.login(dto,ip,async(tx,user)=>{
      if(req){if(user.id!==req.actor.id)throw new UnauthorizedException('请验证当前账号绑定的手机号');await this.activeSession(tx,req);}
      await tx.$queryRaw`SELECT id FROM "SocialChallenge" WHERE id=${dto.ticketId} FOR UPDATE`;
      const ticket=this.valid(await tx.socialChallenge.findUnique({where:{id:dto.ticketId}}),dto,req);await this.attach(tx,ticket,user.id);
    });
  }
  async list(userId:string){return(await this.db.authIdentity.findMany({where:{userId},orderBy:{createdAt:'asc'},select:{id:true,provider:true,appScope:true,verifiedAt:true,version:true}}));}
  async unbind(provider:string,dto:OtpDto,req:AuthRequest){
    if(!providers.includes(provider as LoginProvider))throw new BadRequestException('登录方式无效');
    // The same phone OTP transaction both proves ownership and issues the replacement session.
    return this.identity.login(dto,req.ip??'unknown',async(tx,user)=>{
      if(user.id!==req.actor.id)throw new UnauthorizedException('请验证当前账号绑定的手机号');await this.activeSession(tx,req);
      const identities=await tx.authIdentity.findMany({where:{userId:user.id,provider}});
      for(const row of identities){
        await queueAppleRevoke(tx,row);
        await tx.authIdentity.delete({where:{id:row.id}});
        await tx.authSession.updateMany({where:{userId:user.id,deviceId:'social:'+row.id,revokedAt:null},data:{revokedAt:new Date()}});
        await tx.auditLog.create({data:{actorId:user.id,action:'auth.identity.unbind',resource:'auth_identity',resourceId:row.id,changes:{provider}}});
      }
    });
  }
  async runJobs(){
    if(this.working)return;this.working=true;
    try{
      // Unclaimed authorization credentials are short lived and never exposed by generic CRUD.
      const stale=await this.db.socialChallenge.findMany({where:{expiresAt:{lt:new Date()},refreshCipher:{not:null}},take:20});
      for(const ticket of stale)await this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "SocialChallenge" WHERE id=${ticket.id} FOR UPDATE`;const row=await tx.socialChallenge.findUnique({where:{id:ticket.id}});if(row?.refreshCipher&&row.expiresAt<new Date()){await queueAppleRevoke(tx,{...row,id:'challenge-'+row.id});await tx.socialChallenge.update({where:{id:row.id},data:{refreshCipher:null}});}});
      await this.db.socialChallenge.deleteMany({where:{expiresAt:{lt:new Date(Date.now()-86400000)},refreshCipher:null}});
      const [job]=await this.db.$queryRaw<{id:string;payload:{cipher:string};attempts:number;workerId:string}[]>`UPDATE "OutboxJob" SET state='RUNNING',"workerId"=${randomUUID()},"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1,"updatedAt"=now() WHERE id=(SELECT id FROM "OutboxJob" WHERE kind='AUTH_APPLE_REVOKE' AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,payload,attempts,"workerId"`;
      if(job){try{await this.platform.revokeApple(decryptPrivate(job.payload.cipher));await this.db.outboxJob.updateMany({where:{id:job.id,workerId:job.workerId},data:{state:'DONE',payload:{},completedAt:new Date(),lockedUntil:null,lastErrorCode:null}});}catch{await this.db.outboxJob.updateMany({where:{id:job.id,workerId:job.workerId},data:{state:job.attempts>=8?'DEAD':'READY',lockedUntil:null,availableAt:new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)),lastErrorCode:'APPLE_REVOKE_UNAVAILABLE'}});}}
    }finally{this.working=false;}
  }
}
export async function queueAppleRevoke(tx:Prisma.TransactionClient,row:{id:string;provider:string;refreshCipher:string|null}){
  if(row.provider==='APPLE'&&row.refreshCipher)await tx.outboxJob.upsert({where:{eventKey:'auth.apple.revoke:'+row.id},create:{eventKey:'auth.apple.revoke:'+row.id,kind:'AUTH_APPLE_REVOKE',aggregateType:'AUTH_IDENTITY',aggregateId:row.id,payload:{cipher:row.refreshCipher},availableAt:new Date()},update:{}});
}
@Controller('auth/social')
export class SocialAuthController{
  constructor(private readonly social:SocialAuth){}
  @Get('providers') options(){return{items:this.social.options()};}
  @Post('challenge') begin(@Body() dto:ProviderDto,@Req() req:Request){return this.social.begin(dto.provider,req.ip??'unknown');}
  @Post('authorize') @HttpCode(200) authorize(@Body() dto:AuthorizeDto,@Req() req:Request){return this.social.authorize(dto,req.ip??'unknown');}
  @Post('phone') @HttpCode(200) phone(@Body() dto:PhoneLinkDto,@Req() req:Request){return this.social.phone(dto,req.ip??'unknown');}
}
@Controller('me/identities') @UseGuards(UserGuard)
export class SocialBindingController{
  constructor(private readonly social:SocialAuth){}
  @Get() async list(@Req() req:AuthRequest){return{items:await this.social.list(req.actor.id),phone:maskedPhone(req.actor)};}
  @Post('challenge') begin(@Body() dto:ProviderDto,@Req() req:AuthRequest){return this.social.begin(dto.provider,req.ip??'unknown',req);}
  @Post('authorize') @HttpCode(200) authorize(@Body() dto:AuthorizeDto,@Req() req:AuthRequest){return this.social.authorize(dto,req.ip??'unknown',req);}
  @Post('phone') @HttpCode(200) phone(@Body() dto:PhoneLinkDto,@Req() req:AuthRequest){return this.social.phone(dto,req.ip??'unknown',req);}
  @Post(':provider/unbind') @HttpCode(200) unbind(@Param('provider') provider:string,@Body() dto:OtpDto,@Req() req:AuthRequest){return this.social.unbind(provider,dto,req);}
}
