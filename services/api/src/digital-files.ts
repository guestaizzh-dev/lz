import { BadRequestException } from '@nestjs/common';
import type { Database } from './database.js';
import type { Prisma } from './generated/prisma/client.js';

export async function checkDigitalRelease(store: Database | Prisma.TransactionClient, id: string) {
  const links = await store.digitalReleaseAsset.findMany({ where: { releaseId: id } });
  const assets = await store.mediaAsset.findMany({
    where: { id: { in: links.map((l) => l.assetId) }, visibility: 'PRIVATE', status: 'READY' },
  });
  if (
    !links.length ||
    links.length !== assets.length ||
    assets.some((a) =>
      ['EVIDENCE_FILE', 'PUBLIC_IMAGE', 'FORUM_MEDIA', 'HOME_HERO'].includes(
        String((a.variants as { uploadPurpose?: string } | null)?.uploadPurpose),
      ),
    )
  )
    throw new BadRequestException('资料包文件不完整或不可交付，请联系书院');
}
