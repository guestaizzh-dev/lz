import type { Prisma } from './generated/prisma/client.js';
export async function isAdministrator(tx: Prisma.TransactionClient, id: string) {
  return !!await tx.user.findFirst({ where: { id, status: 'ACTIVE', roles: { has: 'ADMIN' } }, select: { id: true } });
}
