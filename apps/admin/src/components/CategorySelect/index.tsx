import { api } from '@/api';
import { Button, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';

export type Category = { code: string; label: string;enabled?:boolean };
export default function CategorySelect({ scope, value, onChange, disabled, id }: { scope: string; id?:string; value?: string; onChange?: (value: string) => void; disabled?: boolean }) {
  const [items, setItems] = useState<Category[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  async function load() { setLoading(true); try { setItems(await api('/catalog/categories?scope=' + scope+(value?'&current='+encodeURIComponent(value):''))); setError(''); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }
  useEffect(() => { let active = true; setLoading(true); void api<Category[]>('/catalog/categories?scope=' + scope+(value?'&current='+encodeURIComponent(value):'')).then(rows => { if (active) { setItems(rows); setError(''); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [scope,value]);
  const options = items.map(row => ({ value: row.code, label: row.label+(row.enabled===false?'（已停用）':'') }));
  if (value && !options.some(row => row.value === value)) options.push({ value, label: '原分类已失效，请重新选择' });
  return <Space orientation="vertical" style={{ width: '100%', minWidth: 180 }} size={4}>
    <Select id={id} allowClear style={{ width: '100%' }} value={value} onChange={onChange} disabled={disabled} loading={loading} showSearch optionFilterProp="label" options={options} placeholder="选择分类" onOpenChange={open => { if (open) void load(); }} />
    {error && <Typography.Text type="danger">分类加载失败 <Button type="link" size="small" onClick={load}>重试</Button></Typography.Text>}
  </Space>;
}
