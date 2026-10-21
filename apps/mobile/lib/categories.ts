import { ref } from 'vue';
import { request } from './api';
export type CategoryOption = { code: string; label: string; icon: string };
const icons: Record<string, string> = { '经典典籍': 'book-open', '文创': 'bag', '养生用品': 'flower-lotus', '修行工具': 'leaf', '线下服务': 'calendar-blank' };
export function useCategories(scope: string, includeAll = true) {
  const categories = ref<CategoryOption[]>(includeAll ? [{ code: '全部', label: '全部', icon: 'squares-four' }] : []), categoryError = ref('');
  let generation = 0;
  async function refreshCategories() {
    const current = ++generation;
    try {
      const rows = await request<{ code: string; label: string }[]>('/catalog/categories?scope=' + scope);
      if (current !== generation) return;
      categories.value = [...(includeAll ? [{ code: '全部', label: '全部', icon: 'squares-four' }] : []), ...rows.map(item => ({ ...item, icon: icons[item.code] ?? 'book-open' }))]; categoryError.value = '';
    } catch { if (current === generation) categoryError.value = '分类加载失败，点击重试'; }
  }
  return { categories, categoryError, refreshCategories };
}
