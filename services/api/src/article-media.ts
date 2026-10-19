import { BadRequestException } from '@nestjs/common';
import type { Prisma } from './generated/prisma/client.js';

export type ArticleMediaBlock = { id: string; type: string; text: string; mediaId?: string; url?: string; caption?: string };

// Media stays private; an article stores a binding, never a playable storage URL.
export async function validateArticleMedia(db: Prisma.TransactionClient, blocks: ArticleMediaBlock[]) {
  for (const block of blocks) {
    if (block.type !== 'audio' && block.type !== 'video') continue;
    if (!block.mediaId || block.url) throw new BadRequestException('音视频块须选择媒体库资源，不能填写外部地址');
    const asset = await db.mediaAsset.findUnique({ where: { id: block.mediaId } });
    const mimeMatches = block.type === 'video' ? asset?.mime === 'video/mp4' : ['audio/mpeg', 'audio/mp4', 'audio/wav'].includes(asset?.mime ?? '');
    if (!asset || asset.status !== 'READY' || !mimeMatches || (asset.variants as { uploadPurpose?: string } | null)?.uploadPurpose) throw new BadRequestException('文章音视频未处理完成、类型不符或属于私人附件');
  }
}
