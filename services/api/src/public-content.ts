import type { Database } from './database.js';

// Presentation only: demo content never becomes eligible for real payments.
export async function demoContentVisible(store: Pick<Database, 'featureConfig'>): Promise<boolean> {
  const row = await store.featureConfig.findFirst({ where: { configKey: 'presentation', effectiveAt: { lte: new Date() } }, orderBy: { revision: 'desc' } });
  return row ? (row.value as { showDemoContent?: unknown }).showDemoContent === true : process.env.NODE_ENV !== 'production';
}

export async function publicContentScope(store: Pick<Database, 'featureConfig'>) {
  return { status: 'PUBLISHED' as const, ...await demoScope(store) };
}

export async function demoScope(store: Pick<Database, 'featureConfig'>) {
  return await demoContentVisible(store) ? {} : { isDemo: false };
}
