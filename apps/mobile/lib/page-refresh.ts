import { sessionGeneration } from './session';
import { readRevision } from './api';
// Browsing only: checkout, orders, RTC and playback keep their normal revalidation.
export function pageRefresh(
  load: () => Promise<unknown>,
  healthy: () => boolean,
  lifetime = 60000,
) {
  let last = 0,
    key = '',
    pendingKey = '',
    pending: Promise<void> | null = null;
  async function refresh(force = false): Promise<void> {
    const current = sessionGeneration() + ':' + readRevision();
    if (!force && key === current && healthy() && Date.now() - last < lifetime) return;
    if (pending) {
      if (pendingKey === current) return pending;
      await pending;
      return refresh(force);
    }
    const run = async () => {
      await load();
      if (healthy() && current === sessionGeneration() + ':' + readRevision()) {
        last = Date.now();
        key = current;
      }
    };
    pendingKey = current;
    const task = run();
    pending = task;
    try {
      await task;
    } finally {
      if (pending === task) pending = null;
    }
  }
  return refresh;
}
