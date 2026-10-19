import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Param, Put, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsObject, IsString, Length, Min } from 'class-validator';
import { Database } from './database.js';
import { AdminGuard, requireRoles, type AuthRequest } from './auth.js';
import type { Prisma } from './generated/prisma/client.js';

export const configDefaults = {
  site: { academyName: '老子道学书院', description: '道学文化传承与实践', supportPhone: '', supportEmail: '', supportHours: '工作日 09:00—18:00' },
  catalog: { homeArticles: 4, homeCourses: 4, homeProducts: 6, homeEvents: 3 },
  community: { publicPostingEnabled: true },
  presentation: { showDemoContent: false },
};
export type ConfigKey = keyof typeof configDefaults;
export function validateConfig(key: string, input: Record<string, unknown>) {
  if (!(Object.hasOwn(configDefaults,key))) throw new BadRequestException('配置项未登记');
  const defaults = configDefaults[key as ConfigKey];
  if (Object.keys(input).length !== Object.keys(defaults).length || Object.keys(input).some(name => !(Object.hasOwn(defaults,name)))) throw new BadRequestException('请完整填写配置，不允许未知字段');
  for (const [name, value] of Object.entries(input)) {
    const example = defaults[name as keyof typeof defaults];
    if (typeof value !== typeof example) throw new BadRequestException('配置字段类型错误');
    if (key === 'catalog' && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 12)) throw new BadRequestException('首页展示数量须为1至12');
    if (typeof value === 'string' && (value.length > (name === 'description' ? 500 : 100) || value !== value.trim() || /[\x00-\x1f]/.test(value))) throw new BadRequestException('配置文字过长或含不允许的字符');
  }
  if (key === 'site') {
    if (!input.academyName) throw new BadRequestException('书院名称不能为空');
    if (input.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.supportEmail))) throw new BadRequestException('客服邮箱格式错误');
    if (input.supportPhone && !/^[\d+()\- ]{5,30}$/.test(String(input.supportPhone))) throw new BadRequestException('客服电话格式错误');
  }
  return input as Prisma.InputJsonObject;
}
class ConfigDto {
  @IsInt() @Min(0) expectedRevision!: number;
  @IsObject() value!: Record<string, unknown>;
  @IsString() @Length(2, 500) reason!: string;
}
@Injectable()
export class SystemConfig {
  constructor(private readonly db: Database) {}
  async current<K extends ConfigKey>(key: K): Promise<{ revision: number; value: typeof configDefaults[K] }> {
    const row = await this.db.featureConfig.findFirst({ where: { configKey: key, effectiveAt: { lte: new Date() } }, orderBy: { revision: 'desc' } });
    const defaults = key === 'presentation' ? { showDemoContent: process.env.NODE_ENV !== 'production' } : configDefaults[key];
    return { revision: row?.revision ?? 0, value: { ...defaults, ...(row?.value as object ?? {}) } as typeof configDefaults[K] };
  }
  async list() { return Promise.all((Object.keys(configDefaults) as ConfigKey[]).map(async key => ({ key, ...await this.current(key) }))); }
  async save(key: string, req: AuthRequest, dto: ConfigDto) {
    requireRoles(req, ['ADMIN']);
    const value = validateConfig(key, dto.value);
    if (dto.reason.trim().length < 2) throw new BadRequestException('请填写修改原因');
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`config:${key}`},0))`;
      const previous = await tx.featureConfig.findFirst({ where: { configKey: key }, orderBy: { revision: 'desc' } });
      if ((previous?.revision ?? 0) !== dto.expectedRevision) throw new ConflictException('配置已被更新，请刷新后修改');
      const row = await tx.featureConfig.create({ data: { configKey: key, revision: dto.expectedRevision + 1, value, effectiveAt: new Date(), approvedBy: req.actor.id, reason: dto.reason.trim() } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'config.update', resource: 'feature_config', resourceId: row.id, requestId: req.requestId ?? '', reason: dto.reason.trim(), changes: { key, revision: row.revision }, beforeSnapshot: previous?.value ?? configDefaults[key as ConfigKey], afterSnapshot: value } });
      return { key, revision: row.revision, value: row.value };
    });
  }
  async history(key: string) {
    if (!(Object.hasOwn(configDefaults,key))) throw new BadRequestException('配置项未登记');
    return this.db.featureConfig.findMany({ where: { configKey: key }, orderBy: { revision: 'desc' }, take: 50 });
  }
}
@Controller('admin/config') @UseGuards(AdminGuard)
export class ConfigController {
  constructor(private readonly config: SystemConfig) {}
  @Get() list() { return this.config.list(); }
  @Get(':key/history') history(@Param('key') key: string) { return this.config.history(key); }
  @Put(':key') save(@Param('key') key: string, @Req() req: AuthRequest, @Body() dto: ConfigDto) { return this.config.save(key, req, dto); }
}
@Controller('configuration')
export class PublicConfigController {
  constructor(private readonly config: SystemConfig) {}
  @Get() async site() { return (await this.config.current('site')).value; }
}
