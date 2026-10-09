import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsString, IsUUID, Matches, Length } from 'class-validator';
import { Database } from './database.js';
import { AuthService, UserGuard, publicUser } from './auth.js';
import type { AuthRequest } from './auth.js';
import type { Request } from 'express';
import { sendSms } from './sms.js';

const processOtpKey = randomBytes(32).toString('hex');
const otpHash = (id: string, code: string) => createHmac('sha256', process.env.OTP_HASH_SECRET ?? processOtpKey).update(id + ':' + code).digest('hex');
class PhoneDto { @IsString() @Matches(/^1[3-9]\d{9}$/) phone!: string; }
class OtpDto extends PhoneDto { @IsUUID() challengeId!: string; @IsString() @Matches(/^\d{6}$/) code!: string; }
class RefreshDto { @IsString() @Length(43, 43) refreshToken!: string; }

@Injectable()
export class IdentityService {
  constructor(private readonly db: Database, private readonly auth: AuthService) {}
  async challenge(phone: string, ip: string) {
    await this.auth.rateLimit('sms-phone-minute:' + phone, 1, 60_000);
    await this.auth.rateLimit('sms-phone-day:' + phone, 10, 86400_000);
    await this.auth.rateLimit('sms-ip-hour:' + ip, 30, 3600_000);
    const id = randomUUID(), code = process.env.NODE_ENV !== 'production' && process.env.DEV_OTP_CODE ? process.env.DEV_OTP_CODE : String(randomInt(0, 1000000)).padStart(6, '0');
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('测试验证码配置无效');
    // Revoke previous pending codes even if the provider fails: no stale codes become reusable.
    await this.db.otpChallenge.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: new Date() } });
    await this.db.otpChallenge.create({ data: { id, phone, codeHash: otpHash(id, code), expiresAt: new Date(Date.now() + 5 * 60_000) } });
    try {
      const channel = await sendSms(phone, code);
      return { challengeId: id, expiresIn: 300, retryAfter: 60, channel };
    } catch (e) { await this.db.otpChallenge.update({ where: { id }, data: { consumedAt: new Date() } }); throw e; }
  }
  async login(dto: OtpDto, ip: string) {
    await this.auth.rateLimit('otp-verify-ip:' + ip, 60, 15 * 60_000);
    const credentials = this.auth.credentials();
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "OtpChallenge" WHERE id = ${dto.challengeId} FOR UPDATE`;
      const challenge = await tx.otpChallenge.findUnique({ where: { id: dto.challengeId } });
      if (!challenge || challenge.phone !== dto.phone || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) return null;
      const valid = timingSafeEqual(Buffer.from(challenge.codeHash), Buffer.from(otpHash(dto.challengeId, dto.code)));
      await tx.otpChallenge.update({ where: { id: dto.challengeId }, data: { attempts: { increment: 1 }, ...(valid ? { consumedAt: new Date() } : {}) } });
      if (!valid) return null;
      const user = await tx.user.upsert({ where: { phone: dto.phone }, create: { phone: dto.phone, nickname: '研习者', tags: [], roles: ['USER'] }, update: {} });
      if (user.status !== 'ACTIVE') return null;
      await tx.authSession.create({ data: { userId: user.id, kind: 'APP', accessHash: credentials.accessHash, refreshHash: credentials.refreshHash, accessExpiresAt: credentials.accessExpiresAt, expiresAt: new Date(Date.now() + 30 * 86400_000), csrfToken: randomBytes(32).toString('hex') } });
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
    const result = await this.auth.rotate(dto.refreshToken, 'APP');
    return { user: result.user, accessToken: result.access, refreshToken: result.refresh, expiresIn: 900 };
  }
  @Get('me') @UseGuards(UserGuard) me(@Req() req: AuthRequest) { return publicUser(req.actor); }
  @Post('logout') @HttpCode(200) @UseGuards(UserGuard) async logout(@Req() req: AuthRequest) { await this.auth.logout(req.authSessionId); return { success: true }; }
}
