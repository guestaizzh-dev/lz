import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Injectable,NotFoundException,Param,ParseUUIDPipe,Patch,Post,Query,Req,UseGuards} from '@nestjs/common';
import {Type} from 'class-transformer';
import {ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsBoolean,IsIn,IsInt,IsISO8601,IsOptional,IsString,Length,Matches,Max,Min,ValidateNested} from 'class-validator';
import {AdminGuard,UserGuard,type AuthRequest} from './auth.js';
import {Database} from './database.js';
import {LiveService} from './live.js';
import {liveEvents} from './live-chat.js';
import {encryptPrivate,decryptPrivate} from './private-data.js';
import type {Prisma} from './generated/prisma/client.js';

class SurveyQuestion {
  @IsIn(['SINGLE','MULTIPLE','TEXT']) type!:string;
  @IsString() @Length(1,300) @Matches(/\S/) prompt!:string;
  @IsBoolean() required!:boolean;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @IsString({each:true}) @Length(1,100,{each:true}) options?:string[];
}
class PollDto {
  @IsIn(['POLL','SURVEY']) kind!:string;
  @IsString() @Length(1,300) @Matches(/\S/) question!:string;
  @IsBoolean() allowMultiple!:boolean;
  @IsISO8601({strict:true}) closesAt!:string;
  @IsIn(['AFTER_VOTE','AFTER_CLOSE','HOST_ONLY']) resultVisibility!:string;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @IsString({each:true}) @Length(1,100,{each:true}) options?:string[];
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({each:true}) @Type(()=>SurveyQuestion) questions?:SurveyQuestion[];
}
class PollEditDto extends PollDto { @IsInt() @Min(1) expectedVersion!:number; }
class PollStateDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsIn(['OPEN','CLOSE','REVOKE']) action!:string;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class AnswerDto {
  @IsString() @Matches(/^q(?:[1-9]|1[0-9]|20)$/) questionId!:string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ArrayUnique() @IsString({each:true}) @Length(1,36,{each:true}) optionIds?:string[];
  @IsOptional() @IsString() @Length(0,2000) text?:string;
}
class RespondDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({each:true}) @Type(()=>AnswerDto) answers!:AnswerDto[]; }
class ResponsesQuery { @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1; }
type Question={id:string;type:string;prompt:string;required:boolean;options:{id:string;label:string}[]};
type Answer={questionId:string;optionIds?:string[];text?:string};
type Store=Prisma.TransactionClient;

@Injectable()
export class LivePolls {
  constructor(private readonly db:Database,private readonly live:LiveService){}
  private async manage(sessionId:string,req:AuthRequest,store:Store=this.db,hostOnly=false,write=true){
    const s=await this.live.session(sessionId,store);
    if(!hostOnly){if(!req.permissions?.includes(write?'live.write':'live.read'))throw new ForbiddenException('无本场互动管理权限');return s;}
    await this.live.hostAllowed(s,req.actor.id,store);return s;
  }
  private async read(sessionId:string,req:AuthRequest,management:false|'operator'|'host',store:Store=this.db){
    if(management)return this.manage(sessionId,req,store,management==='host',false);
    const user=await store.user.findUnique({where:{id:req.actor.id}});
    if(!user||user.status!=='ACTIVE'||user.deletedAt)throw new ForbiddenException('账号已不可用');
    const s=await this.live.access(sessionId,req.actor.id,store);
    if(!['LIVE','ENDED','REPLAY_READY'].includes(s.state))throw new ConflictException('本场互动尚未开放');return s;
  }
  private normalized(dto:PollDto){
    const date=new Date(dto.closesAt);
    if(!/(Z|[+-]\d\d:\d\d)$/.test(dto.closesAt)||date<=new Date()||date.getTime()>Date.now()+30*86400000)throw new BadRequestException('截止时间须带时区、晚于现在且不超过30天');
    const options=(items:string[]|undefined)=>{
      if(!items||items.length<2||items.length>8)throw new BadRequestException('每道选择题须有2至8个选项');
      const values=items.map(s=>s.trim());if(values.some(s=>!s)||new Set(values).size!==values.length)throw new BadRequestException('选项不能为空或重复');return values.map((label,i)=>({id:'o'+(i+1),label}));
    };
    let questions:Question[]=[];
    if(dto.kind==='SURVEY'){
      if(!dto.questions?.length||dto.options?.length||dto.resultVisibility!=='HOST_ONLY'||dto.allowMultiple)throw new BadRequestException('问卷须配置问题，答案仅主持和授权运营可见');
      questions=dto.questions.map((q,i)=>{if(q.type==='TEXT'&&q.options?.length)throw new BadRequestException('文字题不应配置选项');return{id:'q'+(i+1),type:q.type,prompt:q.prompt.trim(),required:q.required,options:q.type==='TEXT'?[]:options(q.options)};});
    }else{
      if(dto.questions?.length)throw new BadRequestException('投票只配置一道选择题');
      questions=[{id:'q1',type:dto.allowMultiple?'MULTIPLE':'SINGLE',prompt:dto.question.trim(),required:true,options:options(dto.options)}];
    }
    return{kind:dto.kind,question:dto.question.trim(),allowMultiple:dto.allowMultiple,closesAt:date,resultVisibility:dto.resultVisibility,questions};
  }
  async save(sessionId:string,req:AuthRequest,dto:PollDto,id?:string,expectedVersion?:number,hostOnly=false){
    const data=this.normalized(dto);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${sessionId} FOR UPDATE`;
      const s=await this.manage(sessionId,req,tx,hostOnly);if(!['SCHEDULED','PREPARING','LIVE'].includes(s.state))throw new ConflictException('本场已结束，不能新建或编辑互动');
      if(await tx.livePoll.count({where:{sessionId}})>=50&&!id)throw new BadRequestException('每场最多50份投票或问卷');
      const row=id?await tx.livePoll.findFirst({where:{id,sessionId}}):null;
      if(id&&(!row||row.state!=='DRAFT'||row.version!==expectedVersion))throw new ConflictException('仅能编辑当前草稿，请刷新后重试');
      const saved=row?await tx.livePoll.update({where:{id:row.id},data:{...data,version:{increment:1},updatedAt:new Date()}}):await tx.livePoll.create({data:{sessionId,...data,state:'DRAFT'}});
      await tx.pollOption.deleteMany({where:{pollId:saved.id}});
      if(data.kind==='POLL')await tx.pollOption.createMany({data:data.questions[0]!.options.map((o,i)=>({pollId:saved.id,label:o.label,position:i+1}))});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:row?'live.poll.edit':'live.poll.create',resource:'live',resourceId:sessionId,changes:{pollId:saved.id,kind:data.kind}}});return{id:saved.id,version:saved.version};
    });
  }
  async transition(sessionId:string,id:string,req:AuthRequest,dto:PollStateDto,hostOnly=false){
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${sessionId} FOR UPDATE`;
      const s=await this.manage(sessionId,req,tx,hostOnly),poll=await tx.livePoll.findFirst({where:{id,sessionId}});
      if(!poll||poll.version!==dto.expectedVersion)throw new ConflictException('互动状态已变化，请刷新');
      if(dto.action==='OPEN'&&(poll.state!=='DRAFT'||s.state!=='LIVE'||poll.closesAt<=new Date()))throw new ConflictException('只能在直播中发布未过期的草稿');
      if(dto.action==='OPEN'&&!(poll.questions as unknown[]).length)throw new ConflictException('互动题目未配置完整，请重新编辑草稿');
      if(dto.action==='CLOSE'&&poll.state!=='OPEN'||dto.action==='REVOKE'&&poll.state==='REVOKED')throw new ConflictException('此互动已关闭或撤回');
      const state={OPEN:'OPEN',CLOSE:'CLOSED',REVOKE:'REVOKED'}[dto.action]!;
      await tx.livePoll.update({where:{id},data:{state,version:{increment:1},updatedAt:new Date()}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.poll.'+dto.action.toLowerCase(),resource:'live',resourceId:sessionId,changes:{pollId:id,reason:dto.reason.trim()}}});
    });liveEvents.emit('change',sessionId);return{success:true};
  }
  private answers(questions:Question[],dto:RespondDto):Answer[]{
    if(new Set(dto.answers.map(a=>a.questionId)).size!==dto.answers.length||dto.answers.some(a=>!questions.some(q=>q.id===a.questionId)))throw new BadRequestException('答案问题不匹配或重复');
    return questions.map(q=>{
      const a=dto.answers.find(a=>a.questionId===q.id),selected=a?.optionIds??[],text=a?.text?.trim()??'';
      if(q.type==='TEXT'){
        if(selected.length||q.required&&!text)throw new BadRequestException('请完成必填文字题');return{questionId:q.id,text};
      }
      if(text||selected.some(id=>!q.options.some(o=>o.id===id))||q.required&&!selected.length||q.type==='SINGLE'&&selected.length>1)throw new BadRequestException('请按题目要求选择有效选项');
      return{questionId:q.id,optionIds:[...selected].sort()};
    });
  }
  async respond(sessionId:string,id:string,req:AuthRequest,dto:RespondDto){
    await this.db.$transaction(async tx=>{
      // State changes and all submissions share the session lock, including multi-choice votes.
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${sessionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
      const s=await this.read(sessionId,req,false,tx),poll=await tx.livePoll.findFirst({where:{id,sessionId}});
      if(!poll||poll.state==='DRAFT'||poll.state==='REVOKED')throw new NotFoundException('互动已撤回或不存在');
      const questions=poll.questions as unknown as Question[];if(!questions.length)throw new ConflictException('此互动未配置完整，请联系主持');
      const answers=this.answers(questions,dto),prior=await tx.pollResponse.findUnique({where:{pollId_userId:{pollId:id,userId:req.actor.id}}});
      if(prior){if(decryptPrivate(prior.answersCipher)!==JSON.stringify(answers))throw new ConflictException('你已提交，不能重复更改答案');return;}
      if(s.state!=='LIVE'||poll.state!=='OPEN'||poll.closesAt<=new Date())throw new ConflictException('互动已截止，不能继续提交');
      await tx.pollResponse.create({data:{pollId:id,userId:req.actor.id,answersCipher:encryptPrivate(JSON.stringify(answers))}});
      if(poll.kind==='POLL'){
        const options=await tx.pollOption.findMany({where:{pollId:id}});const selected=answers[0]!.optionIds!;
        await tx.pollVote.createMany({data:selected.map(optionId=>({pollId:id,userId:req.actor.id,optionId:options.find(o=>o.position===Number(optionId.slice(1)))!.id}))});
      }
    });liveEvents.emit('change',sessionId);return{success:true};
  }
  async list(sessionId:string,req:AuthRequest,management:false|'operator'|'host'=false){
    return this.db.$transaction(async tx=>{
      const session=await this.read(sessionId,req,management,tx),now=new Date(),polls=await tx.livePoll.findMany({where:{sessionId,...(management?{}:{state:{notIn:['DRAFT','REVOKED']},NOT:{questions:{equals:[]}}})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50});
      const ids=polls.map(p=>p.id),ownResponses=await tx.pollResponse.findMany({where:{pollId:{in:ids},userId:req.actor.id}});
      const visible=polls.filter(p=>p.kind==='POLL'&&(management||p.resultVisibility==='AFTER_VOTE'&&ownResponses.some(r=>r.pollId===p.id)||p.resultVisibility==='AFTER_CLOSE'&&(p.state!=='OPEN'||p.closesAt<=now||session.state!=='LIVE'))).map(p=>p.id);
      // Batch counts once per refresh; adding questions must not add queries for every viewer.
      const [participants,counts,options]=await Promise.all([
        tx.pollResponse.groupBy({by:['pollId'],where:{pollId:{in:management?ids:visible}},_count:true}),
        tx.pollVote.groupBy({by:['pollId','optionId'],where:{pollId:{in:visible}},_count:true}),
        tx.pollOption.findMany({where:{pollId:{in:visible}}}),
      ]);
      const items=polls.map(poll=>{
        const questions=poll.questions as unknown as Question[];
        const own=ownResponses.find(r=>r.pollId===poll.id),closed=poll.state!=='OPEN'||poll.closesAt<=now||session.state!=='LIVE',showResults=visible.includes(poll.id);
        return{id:poll.id,version:poll.version,kind:poll.kind,question:poll.question,questions,closesAt:poll.closesAt,resultVisibility:poll.resultVisibility,state:poll.state==='OPEN'&&closed?'CLOSED':poll.state,storedState:management?poll.state:undefined,canSubmit:!closed&&!own,submitted:!!own,answers:own?JSON.parse(decryptPrivate(own.answersCipher)) as Answer[]:[],participants:management||showResults?participants.find(p=>p.pollId===poll.id)?._count??0:undefined,results:showResults?questions[0]?.options.map(o=>({optionId:o.id,count:counts.find(c=>c.pollId===poll.id&&c.optionId===options.find(item=>item.pollId===poll.id&&item.position===Number(o.id.slice(1)))?.id)?._count??0})):undefined};
      });return{items,serverTime:now,sessionState:session.state};
    },{isolationLevel:'RepeatableRead'});
  }
  async responses(sessionId:string,id:string,req:AuthRequest,query:ResponsesQuery,hostOnly=false){
    await this.manage(sessionId,req,this.db,hostOnly);const poll=await this.db.livePoll.findFirst({where:{id,sessionId}});if(!poll||poll.kind!=='SURVEY')throw new NotFoundException('问卷不存在');
    const rows=await this.db.pollResponse.findMany({where:{pollId:id},orderBy:[{createdAt:'asc'},{id:'asc'}],take:21,skip:(query.page-1)*20});
    // Operators receive anonymous response groups, never respondent identities or contact details.
    await this.db.auditLog.create({data:{actorId:req.actor.id,action:'live.survey.responses',resource:'live',resourceId:sessionId,changes:{pollId:id,page:query.page}}});
    return{items:rows.slice(0,20).map((r,index)=>({number:(query.page-1)*20+index+1,answers:JSON.parse(decryptPrivate(r.answersCipher)) as Answer[]})),hasMore:rows.length>20};
  }
}

@Controller('live/sessions/:sessionId/polls') @UseGuards(UserGuard)
export class LivePollController {
  constructor(private readonly polls:LivePolls){}
  @Get() list(@Param('sessionId',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.polls.list(id,req);}
  @Post(':id/responses') respond(@Param('sessionId',ParseUUIDPipe) sessionId:string,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:RespondDto){return this.polls.respond(sessionId,id,req,dto);}
}
@Controller('admin/live/sessions/:sessionId/polls') @UseGuards(AdminGuard)
export class LivePollAdminController {
  constructor(private readonly polls:LivePolls){}
  @Get() list(@Param('sessionId',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.polls.list(id,req,'operator');}
  @Post() create(@Param('sessionId',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:PollDto){return this.polls.save(id,req,dto);}
  @Patch(':id') edit(@Param('sessionId',ParseUUIDPipe) sessionId:string,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:PollEditDto){return this.polls.save(sessionId,req,dto,id,dto.expectedVersion);}
  @Post(':id/state') state(@Param('sessionId',ParseUUIDPipe) sessionId:string,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:PollStateDto){return this.polls.transition(sessionId,id,req,dto);}
  @Get(':id/responses') responses(@Param('sessionId',ParseUUIDPipe) sessionId:string,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() query:ResponsesQuery){return this.polls.responses(sessionId,id,req,query);}
}
@Controller('admin/live-host/:sessionId/polls') @UseGuards(AdminGuard)
export class LivePollHostController {
  constructor(private readonly polls:LivePolls){}
  @Get() list(@Param('sessionId',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.polls.list(id,req,'host');}
  @Post() create(@Param('sessionId',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:PollDto){return this.polls.save(id,req,dto,undefined,undefined,true);}
  @Patch(':id') edit(@Param('sessionId',ParseUUIDPipe) sessionId:string,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:PollEditDto){return this.polls.save(sessionId,req,dto,id,dto.expectedVersion,true);}
  @Post(':id/state') state(@Param('sessionId',ParseUUIDPipe) sessionId:string,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:PollStateDto){return this.polls.transition(sessionId,id,req,dto,true);}
  @Get(':id/responses') responses(@Param('sessionId',ParseUUIDPipe) sessionId:string,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() query:ResponsesQuery){return this.polls.responses(sessionId,id,req,query,true);}
}
