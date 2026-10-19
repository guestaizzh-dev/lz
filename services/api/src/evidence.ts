import { BadRequestException } from '@nestjs/common';
import type { Prisma } from './generated/prisma/client.js';

export const evidencePublicFields = { id:true, kind:true, title:true, author:true, edition:true, sourceUrl:true, rightsHolder:true, licenseScope:true, validFrom:true, validUntil:true } as const;
export function effectiveEvidence(now = new Date()) {
  return { reviewState:'APPROVED', reviewerId:{not:null}, AND:[{OR:[{validFrom:null},{validFrom:{lte:now}}]},{OR:[{validUntil:null},{validUntil:{gt:now}}]}] };
}
export async function publicEvidence(db: Prisma.TransactionClient, resourceId: string, isDemo = false) {
  const bindings = await db.resourceEvidence.findMany({where:{resourceId}});
  const rows = await db.sourceEvidence.findMany({where:{id:{in:bindings.map(b=>b.evidenceId)},...effectiveEvidence()},select:{...evidencePublicFields,proofAssetId:true},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const proofs=await db.mediaAsset.findMany({where:{id:{in:rows.flatMap(row=>row.proofAssetId?[row.proofAssetId]:[])},status:'READY',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}},select:{id:true}});
  return rows.filter(row=>!row.proofAssetId||proofs.some(proof=>proof.id===row.proofAssetId)).map(({proofAssetId,...row})=>({...row,isDemo,sourceUrl:row.sourceUrl?.startsWith('https://')?row.sourceUrl:null}));
}
// Once an operator attaches a claimed source, it must have a current reviewed edition at publication.
export async function validateEvidencePublication(db: Prisma.TransactionClient, resourceId: string) {
  await db.$queryRaw`SELECT id FROM "Resource" WHERE id=${resourceId} FOR UPDATE`;
  const bindings=await db.resourceEvidence.findMany({where:{resourceId}});
  if(!bindings.length)return;
  const approved=await db.sourceEvidence.findMany({where:{id:{in:bindings.map(b=>b.evidenceId)},...effectiveEvidence()}});
  const proofs=await db.mediaAsset.findMany({where:{id:{in:approved.flatMap(row=>row.proofAssetId?[row.proofAssetId]:[])},status:'READY',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}},select:{id:true}});
  for(const kind of new Set(bindings.map(b=>b.purpose))){
    if(!approved.some(row=>(!row.proofAssetId||proofs.some(proof=>proof.id===row.proofAssetId))&&bindings.some(b=>b.evidenceId===row.id&&b.purpose===kind)))throw new BadRequestException('来源或授权证据尚未审核、已撤回或过期，请先在来源证据中补齐当前有效版本');
  }
}
