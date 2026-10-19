import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, HttpException, Injectable, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import type { Request, Response } from 'express';
import { Database } from './database.js';
import type { Role, User } from './generated/prisma/client.js';
import {AdminPermissions} from './admin-permissions.js';
import { isPreviewUser, previewSessionDevice } from './preview-login.js';
import {encryptPrivate,decryptPrivate} from './private-data.js';

const scrypt = promisify(scryptCallback);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const safeEqual = (left: string, right: string) => timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
async function passwordMatches(password: string, stored: string) {
  const [method, salt, encoded] = stored.split(':');
  if (method !== 'scrypt' || !salt || encoded?.length !== 128) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(encoded, 'hex'));
}
const cookies = (req: Request) => Object.fromEntries((req.headers.cookie ?? '').split(';').flatMap(item => {
  const offset = item.indexOf('=');
  if (offset < 0) return [];
  return [[item.slice(0, offset).trim(), item.slice(offset + 1).trim()]];
}));
export const publicUser = (user: User) => ({ id: user.id, nickname: user.nickname, avatar: user.avatar, tags: user.tags, roles: user.roles });
export type AuthRequest = Request & { actor: User; authSessionId: string; csrfToken: string; permissions?:string[]; requestId?:string };

export function requireOrigin(req: Request) {
  const origin = req.headers.origin;
  const allowed = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  if (!origin || !allowed.includes(origin)) throw new ForbiddenException('请求来源不被允许');
}

@Injectable()
export class AuthService {
  constructor(private readonly db: Database, private readonly permissions:AdminPermissions) {}
  async rateLimit(key: string, maximum: number, duration: number) {
    const now = new Date();
    const expiresAt = new Date(Date.now() + duration);
    const [row] = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" (key, count, "expiresAt") VALUES (${key}, 1, ${expiresAt})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN "RateLimit"."expiresAt" <= ${now} THEN 1 ELSE "RateLimit".count + 1 END,
        "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= ${now} THEN EXCLUDED."expiresAt" ELSE "RateLimit"."expiresAt" END
      RETURNING count`;
    if (row!.count > maximum) throw new HttpException('请求频繁，请稍后重试', 429);
  }
  credentials() {
    const access = token(), refresh = token();
    return { access, refresh, accessHash: digest(access), refreshHash: digest(refresh), accessExpiresAt: new Date(Date.now() + 15 * 60_000) };
  }
  async login(username: string, password: string, ip: string, requestId = '') {
    await this.rateLimit(`admin-login-ip:${ip}`, 30, 15 * 60_000);
    await this.rateLimit(`admin-login:${ip}:${username}`, 10, 15 * 60_000);
    const user = await this.db.user.findUnique({ where: { username } });
    // Equal-cost hashing avoids turning account lookup into an easy timing oracle.
    const dummy = 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);
    const valid = await passwordMatches(password, user?.passwordHash ?? dummy);
    if (!user || !valid || user.status !== 'ACTIVE' || !user.roles.some(role => role !== 'USER')) throw new UnauthorizedException('账号或密码错误');
    const credentials = this.credentials();
    const session = await this.db.$transaction(async tx => {
    const row = await tx.authSession.create({ data: {
      userId: user.id, accessHash: credentials.accessHash, refreshHash: credentials.refreshHash,
      accessExpiresAt: credentials.accessExpiresAt, csrfToken: token(), expiresAt: new Date(Date.now() + 30 * 86400_000),
    } });
    await tx.auditLog.create({data:{actorId:user.id,action:'auth.login',resource:'auth_session',resourceId:row.id,changes:{},requestId,ipHash:digest(ip)}});
    return row;
    });
    return { ...credentials, user: {...publicUser(user),permissions:await this.permissions.resolve(user.roles)}, csrfToken: session.csrfToken };
  }
  async authenticate(req: Request) {
    const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const value = bearer ?? cookies(req).daoxue_access;
    if (!value || value.length > 128) throw new UnauthorizedException('请登录');
    const session = await this.db.authSession.findUnique({ where: { accessHash: digest(value) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.accessExpiresAt <= new Date() || session.user.status !== 'ACTIVE') throw new UnauthorizedException('登录已过期');
    if (session.deviceId === previewSessionDevice && !isPreviewUser(session.user)) throw new UnauthorizedException('预览登录已关闭或过期');
    if (bearer && session.kind !== 'APP') throw new UnauthorizedException('请使用 App 登录');
    return session;
  }
  async refresh(req: Request) {
    requireOrigin(req);
    const value = cookies(req).daoxue_refresh;
    const csrf = req.headers['x-csrf-token'];
    if (!value || typeof csrf !== 'string') throw new UnauthorizedException('请重新登录');
    return this.rotate(value, 'ADMIN', csrf);
  }
  async rotate(value: string, kind: 'ADMIN' | 'APP', csrf?: string,rotationId?:string) {
    if (value.length !== 43) throw new UnauthorizedException('请重新登录');
    const hash = digest(value);
    const credentials = this.credentials();
    const result = await this.db.$transaction(async tx => {
      // Lock token rotation; only one request can consume the current token.
      const matches = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "AuthSession" WHERE "refreshHash" = ${hash} FOR UPDATE`;
      if (!matches[0]) {
        const consumed = await tx.consumedRefresh.findUnique({ where: { hash }, include: { session: {include:{user:true}} } });
        if(kind==='APP'&&rotationId&&consumed?.session.kind==='APP'){
          await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${consumed.sessionId} FOR UPDATE`;
          const session=await tx.authSession.findUniqueOrThrow({where:{id:consumed.sessionId},include:{user:true}});
          if(consumed.requestHash===digest(rotationId)&&consumed.resultCipher&&consumed.expiresAt>new Date()&&!session.revokedAt&&session.expiresAt>new Date()&&session.user.status==='ACTIVE'&&(session.deviceId!==previewSessionDevice||isPreviewUser(session.user))){
            const saved=JSON.parse(decryptPrivate(consumed.resultCipher)) as ReturnType<AuthService['credentials']>;
            if(saved.refreshHash===session.refreshHash)return {...saved,user:publicUser(session.user),csrfToken:session.csrfToken};
          }
        }
        if (consumed && consumed.session.kind === kind && (kind === 'APP' || safeEqual(csrf ?? '', consumed.session.csrfToken))) {
          await tx.authSession.update({ where: { id: consumed.sessionId }, data: { revokedAt: new Date() } });
        }
        return null;
      }
      const session = await tx.authSession.findUniqueOrThrow({ where: { id: matches[0].id }, include: { user: true } });
      if (session.deviceId === previewSessionDevice && !isPreviewUser(session.user)) return null;
      if (session.kind !== kind || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE' || (kind === 'ADMIN' && !safeEqual(csrf ?? '', session.csrfToken))) return null;
      credentials.accessExpiresAt=new Date(Math.min(credentials.accessExpiresAt.getTime(),session.expiresAt.getTime()-1));
      await tx.consumedRefresh.updateMany({where:{sessionId:session.id,resultCipher:{not:null}},data:{resultCipher:null}});
      await tx.consumedRefresh.create({ data: { hash, sessionId: session.id,expiresAt:session.expiresAt,...(kind==='APP'&&rotationId?{requestHash:digest(rotationId),resultCipher:encryptPrivate(JSON.stringify(credentials))}:{}) } });
      await tx.authSession.update({ where: { id: session.id }, data: { accessHash: credentials.accessHash, refreshHash: credentials.refreshHash, accessExpiresAt: credentials.accessExpiresAt } });
      return { ...credentials,user: publicUser(session.user), csrfToken: session.csrfToken };
    });
    if (!result) throw new UnauthorizedException('请重新登录');
    return { ...result, user:kind==='ADMIN'?{...result.user,permissions:await this.permissions.resolve(result.user.roles)}:result.user };
  }
  async logout(id: string, requestId = '', ip = '') { await this.db.$transaction(async tx => {
    const session=await tx.authSession.update({ where: { id }, data: { revokedAt: new Date() } });
    await tx.deviceToken.updateMany({where:{sessionId:id},data:{enabled:false,revokedAt:new Date(),version:{increment:1}}});
    await tx.auditLog.create({data:{actorId:session.userId,action:'auth.logout',resource:'auth_session',resourceId:id,changes:{},requestId,ipHash:ip?digest(ip):''}});
  }); }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly permissions:AdminPermissions, private readonly db:Database) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.auth.authenticate(req);
    if (session.kind !== 'ADMIN') throw new ForbiddenException('请使用后台账号登录');
    if (!session.user.roles.some(role => role !== 'USER')) throw new ForbiddenException('无后台权限');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      requireOrigin(req);
      if (typeof req.headers['x-csrf-token'] !== 'string' || !safeEqual(req.headers['x-csrf-token'], session.csrfToken)) throw new ForbiddenException('请求校验失败，请刷新页面');
    }
    req.actor = session.user; req.authSessionId = session.id; req.csrfToken = session.csrfToken;
    try{req.permissions=await this.permissions.assert(session.user.roles,req.method,req.path,req.body);}
    catch(error){await this.db.auditLog.create({data:{actorId:req.actor.id,action:'access.denied',resource:'admin_api',changes:{method:req.method,path:req.path},requestId:req.requestId??'',ipHash:digest(req.ip??'')}});throw error;}
    return true;
  }
}
@Injectable()
export class UserGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.auth.authenticate(req);
    if (session.kind !== 'APP') throw new UnauthorizedException('请使用 App 登录');
    req.actor = session.user; req.authSessionId = session.id;
    return true;
  }
}
@Injectable()
export class OptionalUserGuard implements CanActivate {
  constructor(private readonly users: UserGuard) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    return req.headers.authorization ? this.users.canActivate(context) : true;
  }
}
export function requireRoles(req: AuthRequest, roles: Role[]) {
  if (!req.actor.roles.includes('ADMIN') && !req.actor.roles.some(role => roles.includes(role))) throw new ForbiddenException('无权进行此操作');
}
class LoginDto {
  @IsString() @Length(3, 80) username!: string;
  @IsString() @Length(8, 200) password!: string;
}
function setCookies(res: Response, access: string, refresh: string, csrfToken: string) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie('daoxue_access', access, { httpOnly: true, secure, sameSite: 'strict', path: '/api/v1', maxAge: 15 * 60_000 });
  res.cookie('daoxue_refresh', refresh, { httpOnly: true, secure, sameSite: 'strict', path: '/api/v1/admin/auth', maxAge: 30 * 86400_000 });
  res.cookie('daoxue_csrf', csrfToken, { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge: 30 * 86400_000 });
}
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') @HttpCode(200)
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    requireOrigin(req);
    const result = await this.auth.login(body.username, body.password, req.ip ?? 'unknown', (req as AuthRequest).requestId);
    setCookies(res, result.access, result.refresh, result.csrfToken);
    return { user: result.user, csrfToken: result.csrfToken };
  }
  @Get('session') @UseGuards(AdminGuard)
  session(@Req() req: AuthRequest) { return { user: {...publicUser(req.actor),permissions:req.permissions??[]}, csrfToken: req.csrfToken }; }
  @Post('refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(req);
    setCookies(res, result.access, result.refresh, result.csrfToken);
    return { user: result.user, csrfToken: result.csrfToken };
  }
  @Post('logout') @HttpCode(200) @UseGuards(AdminGuard)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.authSessionId, req.requestId, req.ip);
    // Logout audit belongs to the administrator, even after its session is revoked.
    res.clearCookie('daoxue_access', { path: '/api/v1' });
    res.clearCookie('daoxue_refresh', { path: '/api/v1/admin/auth' });
    res.clearCookie('daoxue_csrf', { path: '/' });
    return { success: true };
  }
}
