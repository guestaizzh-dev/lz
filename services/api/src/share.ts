import { Body, Controller, Get, Injectable, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { Response } from 'express';
import { DiscoveryService, contentTypes } from './discovery.js';
import { CatalogService } from './catalog.js';
import { renderSharePage } from './share-page.js';

class ShareDto {
  @IsIn(contentTypes) resourceType!: string;
  @IsUUID() resourceId!: string;
  // Old clients send metadata; it is never trusted or persisted.
  @IsOptional() @IsString() @Length(0, 200) title?: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @IsOptional() @IsString() @Length(0, 2000) coverUrl?: string;
}
@Injectable()
export class ShareService {
  constructor(private readonly discovery: DiscoveryService, private readonly catalog: CatalogService) {}
  async resolve(code: string) {
    const [type, id, extra] = code.split('_');
    if (extra || !contentTypes.includes(type!) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id ?? '')) throw new NotFoundException('分享链接无效');
    const item = await this.discovery.publicItem(id!, type!);
    return { resourceType: item.type, resourceId: item.id, title: item.title, description: item.summary, coverUrl: item.cover };
  }
  async landing(code: string) {
    const item = await this.resolve(code);
    // The public landing never consumes a login cookie or a member's access token.
    const article = item.resourceType === 'ARTICLE' ? await this.catalog.article(item.resourceId) : null;
    const related = await this.discovery.related(item.resourceId);
    return renderSharePage(item, code, article, related.items);
  }
  async create(dto: ShareDto) {
    const code = `${dto.resourceType}_${dto.resourceId}`;
    const metadata=await this.resolve(code);
    const base = (process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
    const url = `${base}/share/open/${code}`;
    return { ...metadata, code, url, shortUrl: url, development: process.env.NODE_ENV !== 'production' };
  }
}
@Controller('share')
export class ShareController {
  constructor(private readonly service: ShareService) {}
  @Post('links') create(@Body() dto: ShareDto) { return this.service.create(dto); }
  @Get('links/:code/resolve') resolve(@Param('code') code: string) { return this.service.resolve(code); }
  @Get('open/:code') async open(@Param('code') code: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: http:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.type('html').send(await this.service.landing(code));
  }
}
