// Memory only. Payment, entitlement and media authorization responses are never cached.
export function publicReadLifetime(path: string): number {
  const route = path.split('?')[0];
  if (/^\/catalog\/(courses|teachers|products|events)\/[0-9a-f-]{36}$/i.test(route)) return 30000;
  return [
    '/catalog/home',
    '/catalog/articles',
    '/catalog/courses',
    '/catalog/products',
    '/catalog/teachers',
    '/catalog/categories',
    '/configuration/home-hero',
  ].includes(route)
    ? 60000
    : 0;
}
const copy = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
export class ReadRequests {
  private scope = '';
  private epoch = 0;
  private cache = new Map<string, { value: unknown; until: number }>();
  private pending = new Map<string, Promise<unknown>>();
  revision() {
    return this.epoch;
  }
  setScope(scope: string) {
    if (scope !== this.scope) {
      this.scope = scope;
      this.invalidate();
    }
  }
  invalidate() {
    this.epoch++;
    this.cache.clear();
    this.pending.clear();
  }
  async run<T>(key: string, load: () => Promise<T>, lifetime = 0, fresh = false): Promise<T> {
    const cached = this.cache.get(key);
    if (!fresh && cached && cached.until > Date.now()) return copy(cached.value as T);
    const existing = this.pending.get(key);
    if (existing) return copy((await existing) as T);
    const epoch = this.epoch;
    const pending = Promise.resolve()
      .then(load)
      .then((value) => {
        if (lifetime > 0 && epoch === this.epoch) {
          this.cache.delete(key);
          this.cache.set(key, { value: copy(value), until: Date.now() + lifetime });
          while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
        }
        return value;
      });
    this.pending.set(key, pending);
    try {
      return copy(await pending);
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }
}
