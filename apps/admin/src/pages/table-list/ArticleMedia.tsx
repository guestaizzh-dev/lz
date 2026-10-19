import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { api } from '@/api';
import type { Block } from '@/api';
import MediaUploader from '@/components/MediaUploader';

type Asset = { id: string; name: string; mime: string; status: string };
export function ArticleBlockFields({ form, name }: { form: FormInstance; name: number }) {
  const type = Form.useWatch(['blocks', name, 'type'], form), selected = Form.useWatch(['blocks', name, 'mediaId'], form);
  const [assets, setAssets] = useState<Asset[]>([]), [query, setQuery] = useState(''), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const media = type === 'audio' || type === 'video';
  useEffect(() => {
    if (!media) return;
    let active = true;
    const timer = setTimeout(() => {
      setError('');
      void Promise.all([api<{ items: Asset[] }>('/admin/media-library?assetStatus=READY&size=50&q=' + encodeURIComponent(query)), selected ? api<Asset>('/admin/media/assets/' + selected) : null])
        .then(([result, current]) => { if (active) setAssets([...result.items, ...(current && !result.items.some(a => a.id === current.id) ? [current] : [])]); })
        .catch(e => { if (active) setError(e.message); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [media, query, selected, revision]);
  return <>
    {media ? <>
      {error && <Alert type="error" title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} />}
      <Form.Item name={[name, 'mediaId']} label={type === 'video' ? '视频课件' : '音频讲解'} rules={[{ required: true, message: '请选择处理完成的媒体' }]} extra="仅处理完成且类型匹配的媒体可以送审；文章下架会同时停止播放。">
        <Select showSearch={{ onSearch: setQuery, filterOption: false }} placeholder="搜索媒体名称" options={assets.filter(a => a.status === 'READY' && (type === 'video' ? a.mime === 'video/mp4' : a.mime.startsWith('audio/'))).map(a => ({ value: a.id, label: a.name }))} />
      </Form.Item>
      <MediaUploader onReady={asset => { if (type === 'video' ? asset.mime === 'video/mp4' : asset.mime.startsWith('audio/')) form.setFieldValue(['blocks', name, 'mediaId'], asset.id); setRevision(value => value + 1); }} />
    </> : type === 'image' ? <Form.Item name={[name, 'url']} label="图片地址" rules={[{ required: true, pattern: /^https:\/\/[^\s]+$/, message: '请填写 HTTPS 图片地址' }]}><Input maxLength={2000} /></Form.Item> :
      <Form.Item name={[name, 'text']} label="段落内容" rules={[{ required: true, whitespace: true, message: '请填写段落内容' }]}><Input.TextArea rows={5} maxLength={10000} showCount /></Form.Item>}
    {(media || type === 'image') && <Form.Item name={[name, 'caption']} label="说明（可选）"><Input maxLength={500} /></Form.Item>}
  </>;
}

export function ArticleMediaPreview({ articleId, block }: { articleId: string; block: Block }) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError('');
    try { const result = await api<{ path: string }>(`/admin/articles/${articleId}/blocks/${block.id}/media`, 'POST'); setUrl('/api/v1' + result.path); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div style={{ margin: '20px 0' }}>
    {url ? block.type === 'video' ? <video src={url} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: 360 }} onError={() => setError('播放失败，请重新获取预览')} /> : <audio src={url} controls preload="metadata" style={{ width: '100%' }} onError={() => setError('播放失败，请重新获取预览')} /> : null}
    <Space direction="vertical"><Button loading={busy} onClick={load}>{url ? '重新获取预览' : block.type === 'video' ? '试看视频' : '试听音频'}</Button>{error && <Alert type="error" title={error} />}{block.caption && <Typography.Text type="secondary">{block.caption}</Typography.Text>}</Space>
  </div>;
}
