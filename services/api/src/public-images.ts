import {uploadName} from './upload-name.js';
import { BadRequestException, Controller, Get, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { Response } from 'express';
import { Database } from './database.js';
import { AdminGuard, type AuthRequest } from './auth.js';
import { mediaCommand } from './media-ingest.js';
import { TableQuery } from './admin.js';

type ImageFile = { buffer: Buffer; originalname: string; size: number };
@Injectable()
export class PublicImages {
  private logger = new Logger(PublicImages.name);
  private root = resolve(process.env.MEDIA_DIR ?? '.media', 'public-images');
  private busy = 0;
  constructor(private readonly db: Database) {}
  url(id: string) { return (process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '') + '/assets/images/' + id; }
  async list(query: TableQuery) {
    const where = { status: 'READY', variants: { path: ['uploadPurpose'], equals: 'PUBLIC_IMAGE' }, ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}) };
    const [rows, total] = await this.db.$transaction([this.db.mediaAsset.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.size, take: query.size }), this.db.mediaAsset.count({ where })]);
    return { items: rows.map(row => ({ id: row.id, name: row.name, url: this.url(row.id) })), total };
  }
  async upload(req: AuthRequest, file?: ImageFile) {
    if (!file?.buffer.length || file.buffer.length > 10 * 1024 * 1024) throw new BadRequestException('请选择10MB以内的图片');
    const b = file.buffer;
    const valid = b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || b[0] === 255 && b[1] === 216 && b[2] === 255 || b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP';
    if (!valid) throw new BadRequestException('支持JPEG、PNG、WebP图片，请重新选择');
    if (this.busy >= 2) throw new BadRequestException('图片正在处理，请稍后重新上传');
    this.busy++;
    const id = randomUUID(), input = resolve(this.root, id + '.source'), output = resolve(this.root, id + '.jpg');
    let saved = false;
    try {
      await mkdir(this.root, { recursive: true }); await writeFile(input, b, { flag: 'wx' });
      const probe = JSON.parse(await mediaCommand(process.env.FFPROBE_PATH ?? 'ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-show_streams','-of','json',input]));
      const stream = probe.streams?.[0];
      if (!stream || stream.width < 1 || stream.height < 1 || stream.width * stream.height > 40000000) throw new BadRequestException('图片尺寸过大或无法识别，请使用4000万像素以内的图片');
      const result = await promisify(execFile)(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-v','error','-nostdin','-protocol_whitelist','file,pipe','-i',input,'-frames:v','1','-vf',"scale=w='min(2048,iw)':h='min(2048,ih)':force_original_aspect_ratio=decrease",'-q:v','3','-threads','1','-f','image2pipe','-c:v','mjpeg','pipe:1'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 30000, windowsHide: true });
      const bytes = result.stdout;
      if (!bytes.length) throw new BadRequestException('图片无法解码，请重新选择');
      await writeFile(output, bytes, { flag: 'wx' });
      const row = await this.db.$transaction(async tx => {
        const row = await tx.mediaAsset.create({ data: { id, name: uploadName(file.originalname).slice(0, 160), storageKey: 'public-images/' + id + '.jpg', mime: 'image/jpeg', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), uploaderId: req.actor.id, status: 'READY', visibility: 'PUBLIC', variants: { uploadPurpose: 'PUBLIC_IMAGE' } } });
        await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'image.upload', resource: 'media', resourceId: id, changes: { name: row.name, bytes: row.bytes } } });
        return row;
      });
      saved = true; return { id, name: row.name, url: this.url(id) };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(error instanceof Error ? error.message : 'Image processing failed');
      throw new BadRequestException('图片处理未完成，请确认图片正常后重试',{cause:error});
    } finally {
      this.busy--; await unlink(input).catch(() => {}); if (!saved) await unlink(output).catch(() => {});
    }
  }
  async send(id: string, res: Response) {
    const asset = await this.db.mediaAsset.findFirst({ where: { id, status: 'READY', visibility: 'PUBLIC', variants: { path: ['uploadPurpose'], equals: 'PUBLIC_IMAGE' } } });
    if (!asset) throw new NotFoundException('图片不存在');
    res.type('image/jpeg'); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); res.setHeader('Cache-Control', 'public,max-age=86400');
    return res.sendFile(resolve(this.root, id + '.jpg'), { dotfiles: 'allow' }, error => { if (error && !res.headersSent) res.status(404).end(); });
  }
}
@Controller('admin/images') @UseGuards(AdminGuard)
export class ImagesAdminController {
  constructor(private readonly images: PublicImages) {}
  @Get() list(@Query() query: TableQuery) { return this.images.list(query); }
  @Post() @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } })) upload(@Req() req: AuthRequest, @UploadedFile() file: ImageFile) { return this.images.upload(req, file); }
}
@Controller('assets/images')
export class ImagesPublicController {
  constructor(private readonly images: PublicImages) {}
  @Get(':id') image(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) { return this.images.send(id, res); }
}
