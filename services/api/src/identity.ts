import { encryptPrivate, phoneLookup } from './private-data.js';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, Injectable, Post, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsString, IsUUID, IsOptional, Matches, Length } from 'class-validator';
import { Database } from './database.js';
import { AuthService, UserGuard, publicUser } from './auth.js';
import type { AuthRequest } from './auth.js';
import type { Request } from 'express';
import { sendSms } from './sms.js';
import { isPreviewUser, previewLoginConfig, previewPhone, previewSessionDevice } from './preview-login.js';
import type {Prisma,User} from './generated/prisma/client.js';

const processOtpKey = randomBytes(32).toString('hex');
const otpHash = (id: string, code: string) => createHmac('sha256', process.env.OTP_HASH_SECRET ?? processOtpKey).update(id + ':' + code).digest('hex');
class PhoneDto { @IsString() @Matches(/^1[3-9]\d{9}$/) phone!: string; }
export class OtpDto extends PhoneDto { @IsUUID() challengeId!: string; @IsString() @Matches(/^\d{6}$/) code!: string; }
class RefreshDto { @IsString() @Length(43, 43) refreshToken!: string; @IsOptional() @IsUUID() rotationId?:string; }

@Injectable()
export class IdentityService {
  constructor(private readonly db: Database, private readonly auth: AuthService) {}
  async challenge(phone: string, ip: string) {
    const config = previewLoginConfig();
    const preview = phone === previewPhone ? config : null;
    if (!preview && process.env.SMS_ENABLED === 'false') throw new ServiceUnavailableException('短信登录尚未开通，请联系书院');
    const phoneHash = phoneLookup(phone);
    if (preview) {
      const user = await this.db.user.findFirst({ where: { OR: [{ phoneHash }, { phone }] } });
      if (!user || !isPreviewUser(user)) throw new ServiceUnavailableException('预览测试账号不可用');
    }
    // Preserve the limit during the first release from legacy plaintext counters.
    for (const [prefix,maximum,duration] of [['sms-phone-minute:',1,60_000],['sms-phone-day:',10,86400_000]] as const) {
      const legacy = await this.db.rateLimit.findUnique({ where: { key: prefix + phone } });
      if (legacy && legacy.expiresAt > new Date() && legacy.count >= maximum) throw new HttpException('请求频繁，请稍后重试',429);
      if (legacy && legacy.expiresAt > new Date()) await this.db.rateLimit.upsert({ where: { key: prefix + phoneHash }, create: { key: prefix + phoneHash, count: legacy.count, expiresAt: legacy.expiresAt }, update: {} });
      await this.auth.rateLimit(prefix + phoneHash, maximum, duration);
    }
    await this.auth.rateLimit('sms-ip-hour:' + ip, 30, 3600_000);
    const id = randomUUID(), code = preview?.code ?? (process.env.NODE_ENV !== 'production' && process.env.DEV_OTP_CODE ? process.env.DEV_OTP_CODE : String(randomInt(0, 1000000)).padStart(6, '0'));
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('测试验证码配置无效');
    // Revoke previous pending codes even if the provider fails: no stale codes become reusable.
    await this.db.otpChallenge.updateMany({ where: { OR: [{ phoneHash },{ phone }], consumedAt: null }, data: { consumedAt: new Date() } });
    await this.db.otpChallenge.create({ data: { id, phone: '', phoneHash, codeHash: otpHash(id, code), expiresAt: new Date(Math.min(Date.now() + 5 * 60_000, preview?.expiresAt.getTime() ?? Infinity)), ...(preview ? { purpose: 'PREVIEW_LOGIN', deliveryState: 'SIMULATED' } : {}) } });
    try {
      const channel = preview ? 'PREVIEW' : await sendSms(phone, code);
      return { challengeId: id, expiresIn: 300, retryAfter: 60, channel };
    } catch (e) { await this.db.otpChallenge.update({ where: { id }, data: { consumedAt: new Date() } }); throw e; }
  }
  async login(dto: OtpDto, ip: string, beforeSession?:(tx:Prisma.TransactionClient,user:User)=>Promise<void>) {
    await this.auth.rateLimit('otp-verify-ip:' + ip, 60, 15 * 60_000);
    const credentials = this.auth.credentials();
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "OtpChallenge" WHERE id = ${dto.challengeId} FOR UPDATE`;
      const challenge = await tx.otpChallenge.findUnique({ where: { id: dto.challengeId } });
      const phoneHash = phoneLookup(dto.phone);
      if (!challenge || (challenge.phoneHash ? challenge.phoneHash !== phoneHash : challenge.phone !== dto.phone) || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) return null;
      const valid = timingSafeEqual(Buffer.from(challenge.codeHash), Buffer.from(otpHash(dto.challengeId, dto.code)));
      await tx.otpChallenge.update({ where: { id: dto.challengeId }, data: { attempts: { increment: 1 }, ...(valid ? { consumedAt: new Date() } : {}) } });
      if (!valid) return null;
      const preview = challenge.purpose === 'PREVIEW_LOGIN' ? previewLoginConfig() : null;
      if (challenge.purpose === 'PREVIEW_LOGIN' && (!preview || dto.phone !== previewPhone)) return null;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${phoneHash},0))`;
      const existing = await tx.user.findFirst({ where: { OR: [{ phoneHash }, { phone: dto.phone }] } });
      if (preview && (!existing || !isPreviewUser(existing))) return null;
      const user = existing ? await tx.user.update({ where: { id: existing.id }, data: { phone: null, phoneHash, phoneCipher: encryptPrivate(dto.phone) } }) : await tx.user.create({ data: { phone: null, phoneHash, phoneCipher: encryptPrivate(dto.phone), nickname: '研习者', tags: [], roles: ['USER'] } });
      if (user.status !== 'ACTIVE') return null;
      if (preview && !isPreviewUser(user)) return null;
      if(beforeSession){if(preview)throw new BadRequestException('预览验证码不能用于第三方账号绑定或解绑');await beforeSession(tx,user);}
      const session = await tx.authSession.create({ data: { userId: user.id, kind: 'APP', accessHash: credentials.accessHash, refreshHash: credentials.refreshHash, accessExpiresAt: credentials.accessExpiresAt, expiresAt: preview?.expiresAt ?? new Date(Date.now() + 30 * 86400_000), csrfToken: randomBytes(32).toString('hex'), ...(preview ? { deviceId: previewSessionDevice } : {}) } });
      if (preview) await tx.auditLog.create({ data: { actorId: user.id, action: 'auth.preview.login', resource: 'auth_session', resourceId: session.id, changes: { expiresAt: preview.expiresAt.toISOString() } } });
      return publicUser(user);
    });
    if (!result) throw new UnauthorizedException('验证码无效、已使用或已过期');
    return { user: result, accessToken: credentials.access, refreshToken: credentials.refresh, expiresIn: 900 };
  }
}
@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService, private readonly auth: AuthService) {}
  @Post('sms') async sms(@Body() dto: PhoneDto, @Req() req: Request) { return this.identity.challenge(dto.phone, req.ip ?? 'unknown'); }
  @Post('login') @HttpCode(200) login(@Body() dto: OtpDto, @Req() req: Request) { return this.identity.login(dto, req.ip ?? 'unknown'); }
  @Post('refresh') @HttpCode(200) async refresh(@Body() dto: RefreshDto) {
    const result = await this.auth.rotate(dto.refreshToken, 'APP',undefined,dto.rotationId);
    return { user: result.user, accessToken: result.access, refreshToken: result.refresh, expiresIn: 900 };
  }
  @Get('me') @UseGuards(UserGuard) me(@Req() req: AuthRequest) { return publicUser(req.actor); }
  @Post('logout') @HttpCode(200) @UseGuards(UserGuard) async logout(@Req() req: AuthRequest) { await this.auth.logout(req.authSessionId); return { success: true }; }
}
