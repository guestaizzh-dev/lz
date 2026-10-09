import { BadRequestException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Request, Response } from 'express';
import { Database } from './database.js';
import { LearningService } from './learning.js';
import { AdminGuard, OptionalUserGuard, UserGuard, requireRoles } from './auth.js';
import { TeachingService } from './teaching.js';
import type { AuthRequest } from './auth.js';

type FileUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
type Ticket = { lessonId?: string; submissionId?: string; assetId?: string; userId?: string; sessionId?: string; sessionKind?: string; expires: number };
@Injectable()
export class MediaService {
  // Single-process local delivery: restarting invalidates tickets; object storage/CDN replaces this for scaled deployment.
  private readonly secret = process.env.MEDIA_TOKEN_SECRET ?? randomBytes(32).toString('hex');
  private readonly root = resolve(process.env.MEDIA_DIR ?? '.media');
  constructor(private readonly db: Database, private readonly learning: LearningService, private readonly teaching: TeachingService) {}
  async upload(req: AuthRequest, file?: FileUpload, imageOnly = false) {
    if (!imageOnly) requireRoles(req, ['OPERATOR']);
    if (!file?.buffer.length) throw new BadRequestException('请选择媒体文件');
    const allowed = ['video/mp4', 'audio/mpeg', 'audio/mp4', 'audio/wav'];
    const mp4 = file.buffer.subarray(4, 8).toString() === 'ftyp';
    const mp3 = file.buffer.subarray(0, 3).toString() === 'ID3' || (file.buffer[0] === 255 && (file.buffer[1]! & 224) === 224);
    const wav = file.buffer.subarray(0, 4).toString() === 'RIFF' && file.buffer.subarray(8, 12).toString() === 'WAVE';
    const image = file.mimetype === 'image/png' ? file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : file.mimetype === 'image/jpeg' ? file.buffer[0] === 255 && file.buffer[1] === 216 && file.buffer[2] === 255 : file.mimetype === 'image/webp' && file.buffer.subarray(0,4).toString() === 'RIFF' && file.buffer.subarray(8,12).toString() === 'WEBP';
    if (imageOnly ? !image : !allowed.includes(file.mimetype) || !(file.mimetype === 'audio/mpeg' ? mp3 : file.mimetype === 'audio/wav' ? wav : mp4)) throw new BadRequestException(imageOnly ? '作业附件仅支持 PNG、JPEG、WebP 图片' : '仅支持 MP4 视频、MP3 / M4A / WAV 音频');
    const storageKey = randomUUID();
    await mkdir(this.root, { recursive: true });
    await writeFile(resolve(this.root, storageKey), file.buffer, { flag: 'wx' });
    try {
      return await this.db.$transaction(async tx => {
        const asset = await tx.mediaAsset.create({ data: { storageKey, name: file.originalname.slice(0, 200), mime: file.mimetype, bytes: file.size, uploaderId: req.actor.id, sha256: createHash('sha256').update(file.buffer).digest('hex'), status: 'READY', visibility: 'PRIVATE' } });
        await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'media.upload', resource: 'media', resourceId: asset.id, changes: { name: asset.name, bytes: asset.bytes } } });
        return { id: asset.id, name: asset.name, mime: asset.mime, bytes: asset.bytes };
      });
    } catch (e) { await unlink(resolve(this.root, storageKey)); throw e; }
  }
  async imageTicket(submissionId: string, assetId: string, req: AuthRequest) {
    await this.teaching.submissionAccess(submissionId, req.actor);
    if (!await this.db.attachmentBinding.findFirst({ where: { submissionId, assetId } })) throw new NotFoundException('作业图片不存在');
    const payload: Ticket = { submissionId, assetId, userId: req.actor.id, sessionId: req.authSessionId, sessionKind: req.headers.authorization ? 'APP' : 'ADMIN', expires: Date.now() + 5 * 60000 };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = encoded + '.' + createHmac('sha256', this.secret).update(encoded).digest('base64url');
    return { path: '/media/stream?ticket=' + token, expiresAt: new Date(payload.expires).toISOString() };
  }
  async ticket(id: string, req: AuthRequest) {
    const { lesson } = await this.learning.lesson(id, req.actor?.id);
    if (!lesson.mediaId) throw new NotFoundException('该章节没有媒体');
    const payload: Ticket = { lessonId: id, ...(req.actor ? { userId: req.actor.id, sessionId: req.authSessionId } : {}), expires: Date.now() + 30 * 60000 };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = encoded + '.' + createHmac('sha256', this.secret).update(encoded).digest('base64url');
    return { path: '/media/stream?ticket=' + token, expiresAt: new Date(payload.expires).toISOString() };
  }
  async stream(token: string, req: Request, res: Response) {
    if (!token || token.length > 1000) throw new UnauthorizedException('播放凭证无效');
    const [encoded, signature, extra] = token.split('.');
    const expected = createHmac('sha256', this.secret).update(encoded ?? '').digest('base64url');
    if (!signature || extra || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new UnauthorizedException('播放凭证无效');
    let ticket: Ticket;
    try { ticket = JSON.parse(Buffer.from(encoded!, 'base64url').toString()); } catch { throw new UnauthorizedException('播放凭证无效'); }
    if ((!ticket.lessonId && !ticket.submissionId) || !Number.isFinite(ticket.expires) || ticket.expires <= Date.now()) throw new UnauthorizedException('媒体凭证已过期，请重新打开');
    let assetId: string | null = null;
    if (ticket.userId) {
      const session = await this.db.authSession.findFirst({ where: { id: ticket.sessionId ?? '', userId: ticket.userId, kind: ticket.sessionKind ?? 'APP', revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } }, include: { user: true } });
      if (!session) throw new UnauthorizedException('请重新登录');
      if (ticket.submissionId) {
        await this.teaching.submissionAccess(ticket.submissionId, session.user);
        if (!await this.db.attachmentBinding.findFirst({ where: { submissionId: ticket.submissionId, assetId: ticket.assetId ?? '' } })) throw new NotFoundException('作业图片不存在');
        assetId = ticket.assetId ?? null;
      }
    }
    if (ticket.lessonId) assetId = (await this.learning.lesson(ticket.lessonId, ticket.userId)).lesson.mediaId;
    const asset = assetId ? await this.db.mediaAsset.findUnique({ where: { id: assetId } }) : null;
    if (!asset || asset.status !== 'READY' || ticket.submissionId && !['image/png','image/jpeg','image/webp'].includes(asset.mime)) throw new NotFoundException('媒体不存在');
    const path = resolve(this.root, asset.storageKey);
    let bytes: number;
    try { bytes = (await stat(path)).size; } catch { throw new NotFoundException('媒体暂时不可用'); }
    res.set({ 'Content-Type': asset.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    let start = 0, end = bytes - 1;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.status(416).set('Content-Range', `bytes */${bytes}`).end(); return; }
      if (!match[1]) start = Math.max(0, bytes - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes) { res.status(416).set('Content-Range', `bytes */${bytes}`).end(); return; }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${bytes}`);
    }
    res.set('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(path, { start, end });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
}
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService, private readonly db: Database) {}
  @Post('admin/media') @UseGuards(AdminGuard) @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 0 } })) upload(@Req() req: AuthRequest, @UploadedFile() file: FileUpload) { return this.media.upload(req, file); }
  @Post('learning/submission-images') @UseGuards(UserGuard) @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } })) image(@Req() req: AuthRequest, @UploadedFile() file: FileUpload) { return this.media.upload(req, file, true); }
  @Post('learning/submissions/:id/images/:assetId') @UseGuards(UserGuard) imageTicket(@Param('id', ParseUUIDPipe) id: string, @Param('assetId', ParseUUIDPipe) assetId: string, @Req() req: AuthRequest) { return this.media.imageTicket(id, assetId, req); }
  @Post('admin/teaching/submissions/:id/images/:assetId') @UseGuards(AdminGuard) adminImageTicket(@Param('id', ParseUUIDPipe) id: string, @Param('assetId', ParseUUIDPipe) assetId: string, @Req() req: AuthRequest) { return this.media.imageTicket(id, assetId, req); }
  @Get('admin/media') @UseGuards(AdminGuard) list(@Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); return this.db.mediaAsset.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, name: true, mime: true, bytes: true } }); }
  @Post('learning/lessons/:id/media') @UseGuards(OptionalUserGuard) ticket(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.media.ticket(id, req); }
  @Get('media/stream') stream(@Query('ticket') ticket: string, @Req() req: Request, @Res() res: Response) { return this.media.stream(ticket, req, res); }
}
