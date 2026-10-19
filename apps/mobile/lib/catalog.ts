import { ref, shallowRef } from 'vue';
import { request } from './api';
import type { ContentPage } from './api';

export function useCatalog<T>(resource: string, filters: () => { category: string; q?: string; format?: string; teacherId?: string; sort?: string }) {
  const items = shallowRef<T[]>([]), loading = ref(true), loadingMore = ref(false), error = ref(''), nextCursor = ref<string | null>(null);
  let generation = 0, failedAppend = false;
  async function load(append = false) {
    if (append && (loading.value || loadingMore.value || !nextCursor.value)) return;
    const current = ++generation;
    if (append) loadingMore.value = true; else { loading.value = true; loadingMore.value = false; items.value = []; nextCursor.value = null; }
    error.value = ''; failedAppend = append;
    const values = filters();
    let query = '?size=20';
    if (values.category !== '全部') query += '&category=' + encodeURIComponent(values.category);
    if (values.q?.trim()) query += '&q=' + encodeURIComponent(values.q.trim());
    if (values.sort) query += '&sort=' + encodeURIComponent(values.sort);
    if (values.format) query += (['TEXT','AUDIO','VIDEO'].includes(values.format) ? '&contentFormat=' : '&format=') + encodeURIComponent(values.format);
    if (values.teacherId) query += '&teacherId=' + encodeURIComponent(values.teacherId);
    if (append && nextCursor.value) query += '&cursor=' + encodeURIComponent(nextCursor.value);
    try {
      const page = await request<ContentPage<T>>('/catalog/' + resource + query);
      if (current !== generation) return;
      items.value = append ? [...items.value, ...page.items] : page.items;
      nextCursor.value = page.nextCursor;
    } catch (e) { if (current === generation) error.value = (e as Error).message; }
    finally { if (current === generation) { loading.value = false; loadingMore.value = false; } }
  }
  return { items, loading, loadingMore, error, nextCursor, load, retry: () => load(failedAppend) };
}
