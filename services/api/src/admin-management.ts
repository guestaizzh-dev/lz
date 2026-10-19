import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { Database } from './database.js';
import { AdminGuard, passwordHash, requireRoles, type AuthRequest } from './auth.js';
import { permissions, rolePermissions } from './admin-permissions.js';
import { TableQuery } from './admin.js';
import { DomainService } from './domain.js';
import type { Prisma } from './generated/prisma/client.js';

class ManagementQuery extends TableQuery {
  @IsOptional() @IsIn(['ACTIVE','FROZEN','DELETED']) accountStatus?: 'ACTIVE'|'FROZEN'|'DELETED';
  @IsOptional() @IsIn(['USER','TEACHER','OPERATOR','MODERATOR','SUPPORT','FINANCE','ADMIN']) role?: 'USER'|'TEACHER'|'OPERATOR'|'MODERATOR'|'SUPPORT'|'FINANCE'|'ADMIN';
  @IsOptional() @IsString() @Length(0,100) action?: string;
  @IsOptional() @IsString() @Length(0,100) resource?: string;
  @IsOptional() @IsString() @Length(0,100) actorId?: string;
  @IsOptional() @IsString() @Length(0,100) requestId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}
class ReasonDto {
  @IsString() @Length(2,500) reason!: string;
}
class UserActionDto extends ReasonDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['freeze','restore','revokeSessions','resetPassword']) action!: string;
  @IsOptional() @IsString() @Length(12,200) password?: string;
}
class CreateUserDto extends ReasonDto {
  @IsString() @Matches(/^[a-zA-Z0-9_.-]{3,80}$/) username!: string;
  @IsString() @Length(1,80) nickname!: string;
  @IsString() @Length(12,200) password!: string;
}
class PolicyDto extends ReasonDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({each:true}) permissionCodes!: string[];
  @IsBoolean() active!: boolean;
}

// Historic audit payloads may contain private content; redact recursively at the read boundary.
export function redactAudit(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[已省略]';
  if (Array.isArray(value)) return value.slice(0,100).map(item => redactAudit(item,depth+1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, /password|token|secret|cipher|hash|phone|email|contact|address|recipient|cookie|authorization|payload|response|body|text|quote|blocks|note|message|detail/i.test(key) ? '[已脱敏]' : redactAudit(item,depth+1)]));
  return typeof value === 'string' && value.length > 1000 ? value.slice(0,1000)+'…' : value;
}
const userSelect = {id:true,username:true,nickname:true,roles:true,status:true,version:true,createdAt:true,lastSeenAt:true} as const;

@Injectable()
export class AdminManagement {
  constructor(private readonly db: Database, private readonly domain: DomainService) {}
  async users(query: ManagementQuery) {
    const where: Prisma.UserWhereInput = { id:{notIn:['system-order-expiry','development-seed']}, ...(query.accountStatus ? {status:query.accountStatus}:{}), ...(query.role ? {roles:{has:query.role}}:{}), ...(query.q ? {OR:[{nickname:{contains:query.q,mode:'insensitive'}},{username:{contains:query.q,mode:'insensitive'}},{id:query.q}]}:{}) };
    const [items,total] = await this.db.$transaction([this.db.user.findMany({where,select:userSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size}),this.db.user.count({where})]);
    return {items,total};
  }
  async createUser(req: AuthRequest, dto: CreateUserDto) {
    requireRoles(req,['ADMIN']);
    if (!dto.nickname.trim() || dto.reason.trim().length < 2) throw new BadRequestException('名称和操作原因不能为空');
    const hash = await passwordHash(dto.password);
    try {return await this.db.$transaction(async tx => {
      const user = await tx.user.create({data:{username:dto.username,nickname:dto.nickname.trim(),passwordHash:hash,roles:['USER']},select:userSelect});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'user.create',resource:'app_user',resourceId:user.id,requestId:req.requestId??'',reason:dto.reason.trim(),changes:{username:user.username}}});
      return user;
    });} catch(error) {if ((error as {code?:string}).code==='P2002') throw new ConflictException('账号名称已存在');throw error;}
  }
  async userAction(req: AuthRequest, id: string, dto: UserActionDto) {
    requireRoles(req,['ADMIN']);
    if (req.actor.id===id) throw new ForbiddenException('不能在账号管理中变更自己的账号，请使用退出登录');
    if(dto.reason.trim().length<2)throw new BadRequestException('请填写操作原因');
    if(dto.action==='resetPassword'&&!dto.password)throw new BadRequestException('请填写新密码，至少12位');
    if(dto.action!=='resetPassword'&&dto.password)throw new BadRequestException('此操作不接受密码');
    const hash=dto.action==='resetPassword'?await passwordHash(dto.password!):null;
    return this.db.$transaction(async tx => {
      // Shared with role grants: two administrators cannot disable the last active administrator concurrently.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(761029001)`;
      const actor=await tx.user.findFirst({where:{id:req.actor.id,status:'ACTIVE',roles:{has:'ADMIN'}}});
      if(!actor)throw new ForbiddenException('管理员权限已变化');
      const user=await tx.user.findUnique({where:{id}});
      if(!user)throw new NotFoundException('账号不存在');
      if(user.version!==dto.expectedVersion)throw new ConflictException('账号已被更新，请刷新');
      if(user.status==='DELETED')throw new ConflictException('已注销账号不能恢复或重设密码');
      if(dto.action==='freeze'&&user.status!=='ACTIVE'||dto.action==='restore'&&user.status!=='FROZEN')throw new ConflictException('此操作不适用于当前账号状态');
      if(dto.action==='freeze'&&user.roles.includes('ADMIN')&&await tx.user.count({where:{status:'ACTIVE',roles:{has:'ADMIN'}}})<=1)throw new ConflictException('不能冻结最后一名有效管理员');
      const result=await tx.user.update({where:{id},data:{version:{increment:1},...(dto.action==='freeze'?{status:'FROZEN' as const}:dto.action==='restore'?{status:'ACTIVE' as const}:hash?{passwordHash:hash}:{})},select:userSelect});
      const revoked=dto.action==='restore'?0:(await tx.authSession.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}})).count;
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'user.'+dto.action,resource:'app_user',resourceId:id,requestId:req.requestId??'',reason:dto.reason.trim(),changes:{status:result.status,revokedSessions:revoked,version:result.version},beforeSnapshot:{status:user.status,version:user.version}}});
      return result;
    });
  }
  async policies() {return {roles:await this.db.accessRole.findMany({orderBy:{code:'asc'}}),permissions,ceilings:rolePermissions};}
  async policy(req: AuthRequest, code: string, dto: PolicyDto) {
    requireRoles(req,['ADMIN']);
    if(code==='ADMIN'||code==='USER'||!Object.hasOwn(rolePermissions,code))throw new BadRequestException('该角色策略不可修改');
    if(dto.permissionCodes.some(item=>!rolePermissions[code]!.includes(item)))throw new BadRequestException('权限超出此角色的业务范围');
    if(dto.permissionCodes.some(item=>item.endsWith('.write')||item.endsWith('.review') ? !dto.permissionCodes.includes(item.split('.')[0]+'.read') : false))throw new BadRequestException('编辑或审核权限必须同时保留对应查看权限');
    if(dto.reason.trim().length<2)throw new BadRequestException('请填写修改原因');
    return this.db.$transaction(async tx=>{
      const old=await tx.accessRole.findUnique({where:{code}});if(!old)throw new NotFoundException('角色不存在');
      const changed=await tx.accessRole.updateMany({where:{code,version:dto.expectedVersion},data:{permissionCodes:dto.permissionCodes,active:dto.active,version:{increment:1},updatedAt:new Date()}});
      if(!changed.count)throw new ConflictException('权限策略已变化，请刷新');
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'access.policy',resource:'access_role',resourceId:old.id,requestId:req.requestId??'',reason:dto.reason.trim(),changes:{code},beforeSnapshot:{permissionCodes:old.permissionCodes,active:old.active},afterSnapshot:{permissionCodes:dto.permissionCodes,active:dto.active}}});
      return {success:true};
    });
  }
  async grants(req: AuthRequest,id: string) {
    const rows=await this.db.userRole.findMany({where:{userId:id,revokedAt:null},take:20});
    const roles=await this.db.accessRole.findMany();
    return Promise.all(rows.map(async row=>({...await this.domain.detail(req,'user_role',row.id),role:roles.find(role=>role.id===row.roleId)?.code})));
  }
  async audit(query: ManagementQuery) {
    if(query.from&&query.to&&new Date(query.from)>new Date(query.to))throw new BadRequestException('开始时间不能晚于结束时间');
    const actorIds=query.actorId&&!/^[a-f0-9-]{36}$/i.test(query.actorId)?(await this.db.user.findMany({where:{OR:[{nickname:{contains:query.actorId,mode:'insensitive'}},{username:{contains:query.actorId,mode:'insensitive'}}]},select:{id:true}})).map(user=>user.id):null;
    const where:Prisma.AuditLogWhereInput={...(query.action?{action:{contains:query.action,mode:'insensitive'}}:{}),...(query.resource?{resource:query.resource}:{}),...(query.actorId?{actorId:actorIds?{in:actorIds}:query.actorId}:{}),...(query.requestId?{requestId:query.requestId}:{}),...(query.from||query.to?{createdAt:{...(query.from?{gte:new Date(query.from)}:{}),...(query.to?{lte:new Date(query.to)}:{})}}:{}),...(query.q?{OR:[{resourceId:query.q},{requestId:query.q},{action:{contains:query.q,mode:'insensitive'}}]}:{})};
    const [rows,total]=await this.db.$transaction([this.db.auditLog.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size}),this.db.auditLog.count({where})]);
    const actors=await this.db.user.findMany({where:{id:{in:[...new Set(rows.map(row=>row.actorId))]}},select:{id:true,nickname:true,username:true}});
    return {items:rows.map(row=>({...row,ipHash:undefined,changes:redactAudit(row.changes),beforeSnapshot:redactAudit(row.beforeSnapshot),afterSnapshot:redactAudit(row.afterSnapshot),actor:actors.find(actor=>actor.id===row.actorId)??{id:row.actorId,nickname:'已注销账号'}})),total};
  }
}
@Controller('admin') @UseGuards(AdminGuard)
export class ManagementController {
  constructor(private readonly management:AdminManagement,private readonly domain:DomainService) {}
  @Get('users') users(@Query() query:ManagementQuery) {return this.management.users(query);}
  @Post('users') create(@Req() req:AuthRequest,@Body() dto:CreateUserDto) {return this.management.createUser(req,dto);}
  @Post('users/:id/actions') action(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:UserActionDto) {return this.management.userAction(req,id,dto);}
  @Get('users/:id/roles') roles(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string) {return this.management.grants(req,id);}
  @Post('users/:id/roles') grant(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:Record<string,unknown>) {return this.domain.roleAction(req,{...body,userId:id});}
  @Get('access') policies() {return this.management.policies();}
  @Patch('access/:code') policy(@Req() req:AuthRequest,@Param('code') code:string,@Body() dto:PolicyDto) {return this.management.policy(req,code,dto);}
  @Get('audit') audit(@Query() query:ManagementQuery) {return this.management.audit(query);}
}
