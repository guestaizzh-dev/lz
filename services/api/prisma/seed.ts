// Legacy entrypoint delegates to the complete manual fixture dataset.
// Prefer pnpm db:seed, which builds the existing business services first.
await import('./manual-seed.mjs');
