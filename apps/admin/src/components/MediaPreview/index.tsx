import { api } from '@/api';
import { Alert, Button, Modal, Space } from 'antd';
import { useState } from 'react';
export default function MediaPreview({ id, mime }: { id: string; mime: string }) {
  const [open, setOpen] = useState(false), [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function load() { setOpen(true); setBusy(true); setError(''); try { const result = await api<{ path: string }>('/admin/media/assets/' + id + '/preview', 'POST', {}); setUrl('/api/v1' + result.path); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <><Button size="small" loading={busy} onClick={load}>{mime.startsWith('audio/') ? '试听' : '试看'}</Button><Modal title={mime.startsWith('audio/') ? '试听课件' : '试看课件'} open={open} onCancel={() => { setOpen(false); setUrl(''); }} footer={<Space><Button onClick={load}>重新加载</Button><Button onClick={() => { setOpen(false); setUrl(''); }}>关闭</Button></Space>} width={800}>
    {error && <Alert type="error" title={error} />}{open && url && (mime.startsWith('audio/') ? <audio controls src={url} preload="metadata" style={{ width: '100%' }} onError={() => setError('播放未完成，请重新加载')} /> : <video controls playsInline src={url} preload="metadata" style={{ width: '100%', maxHeight: '65vh', background: '#111' }} onError={() => setError('播放未完成，请重新加载')} />)}
  </Modal></>;
}
