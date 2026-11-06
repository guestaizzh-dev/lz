import { ref, shallowRef } from 'vue';
import { request } from './api';
import type { ContentPage } from './api';

export function useCatalog<T>(
  resource: string,
  filters: () => {
    category: string;
    q?: string;
    format?: string;
    teacherId?: string;
    sort?: string;
    mallCategory?: string;
  },
) {
  const items = shallowRef<T[]>([]),
    loading = ref(true),
    loadingMore = ref(false),
    error = ref(''),
    nextCursor = ref<string | null>(null);
  let generation = 0,
    failedAppend = false,
    activeQuery = '';
  const refreshing = ref(false);
  async function load(append = false, fresh = false) {
    if (append && (loading.value || refreshing.value || loadingMore.value || !nextCursor.value))
      return;
    const values = filters();
    let query = '?size=20';
    if (values.category !== '全部') query += '&category=' + encodeURIComponent(values.category);
    if (values.q?.trim()) query += '&q=' + encodeURIComponent(values.q.trim());
    if (values.sort) query += '&sort=' + encodeURIComponent(values.sort);
    if (values.mallCategory) query += '&mallCategory=' + encodeURIComponent(values.mallCategory);
    if (values.format)
      query +=
        (['TEXT', 'AUDIO', 'VIDEO'].includes(values.format) ? '&contentFormat=' : '&format=') +
        encodeURIComponent(values.format);
    if (values.teacherId) query += '&teacherId=' + encodeURIComponent(values.teacherId);
    if (append && nextCursor.value) query += '&cursor=' + encodeURIComponent(nextCursor.value);
    const changed = !append && activeQuery !== query;
    const current = ++generation;
    if (changed) {
      items.value = [];
      nextCursor.value = null;
      activeQuery = query;
    }
    if (append) loadingMore.value = true;
    else {
      loading.value = items.value.length === 0;
      refreshing.value = true;
      loadingMore.value = false;
    }
    error.value = '';
    failedAppend = append;
    try {
      const page = await request<ContentPage<T>>('/catalog/' + resource + query, { fresh });
      if (current !== generation) return;
      items.value = append ? [...items.value, ...page.items] : page.items;
      nextCursor.value = page.nextCursor;
    } catch (e) {
      if (current === generation) error.value = (e as Error).message;
    } finally {
      if (current === generation) {
        loading.value = false;
        loadingMore.value = false;
        refreshing.value = false;
      }
    }
  }
  return {
    items,
    loading,
    loadingMore,
    error,
    nextCursor,
    refreshing,
    load,
    retry: () => load(failedAppend, true),
  };
}
