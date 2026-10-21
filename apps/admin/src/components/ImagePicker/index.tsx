import { api } from '@/api';
import { CloudUploadOutlined, PictureOutlined } from '@ant-design/icons';
import { Alert, App, Button, Image, Input, Modal, Pagination, Slider, Space, Spin, Typography, Upload } from 'antd';
import { useEffect, useRef, useState } from 'react';

type Asset = { id: string; name: string; url: string };
export default function ImagePicker({ value, onChange, id, ratio = 16 / 9, disabled, onBusyChange }: { id?:string; value?: string | null; onChange?: (url: string | null) => void; ratio?: number; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const { message } = App.useApp(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [crop, setCrop] = useState<{ url: string; name: string; width: number; height: number }>(), [zoom, setZoom] = useState(1), [x, setX] = useState(50), [y, setY] = useState(50);
  const [library, setLibrary] = useState(false), [items, setItems] = useState<Asset[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0), [query, setQuery] = useState(''), [loading, setLoading] = useState(false);
  const owner = useRef(0), mounted = useRef(true), drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const callback = useRef(onBusyChange); callback.current = onBusyChange;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; owner.current++; callback.current?.(false); }; }, []);
  useEffect(() => () => { if (crop) URL.revokeObjectURL(crop.url); }, [crop]);
  function state(value: boolean) { setBusy(value); callback.current?.(value); }
  async function select(file: File) {
    if (busy) return false;
    if (file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('请选择10MB以内的JPEG、PNG或WebP图片'); return false; }
    const url = URL.createObjectURL(file), img = new window.Image();
    img.onload = () => { if (!mounted.current) { URL.revokeObjectURL(url); return; } setError(''); setZoom(1); setX(50); setY(50); setCrop({ url, name: file.name, width: img.naturalWidth, height: img.naturalHeight }); callback.current?.(true); };
    img.onerror = () => { URL.revokeObjectURL(url); setError('图片无法读取，请重新选择'); }; img.src = url;
    return false;
  }
  function closeCrop() { setCrop(undefined); callback.current?.(false); }
  async function upload(cropped: boolean) {
    if (!crop || busy) return; state(true); setError('');
    const selected = crop, sequence = ++owner.current;
    try {
      const img = new window.Image(); img.src = selected.url; await img.decode();
      const fullWidth = Math.min(selected.width, selected.height * ratio), sw = cropped ? fullWidth / zoom : selected.width, sh = cropped ? sw / ratio : selected.height;
      const canvas = document.createElement('canvas'); canvas.width = Math.min(2048, Math.round(sw)); canvas.height = Math.max(1, Math.round(canvas.width * sh / sw));
      const ctx = canvas.getContext('2d'); if (!ctx) throw Error('浏览器无法处理图片，请更换浏览器');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, cropped ? (selected.width - sw) * x / 100 : 0, cropped ? (selected.height - sh) * y / 100 : 0, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('图片处理失败')), 'image/jpeg', 0.9));
      const body = new FormData(); body.append('file', blob, selected.name.replace(/\.[^.]+$/, '') + '.jpg');
      const result = await api<Asset>('/admin/images', 'POST', body);
      if (mounted.current && sequence === owner.current) { onChange?.(result.url); setCrop(undefined); message.success('图片已上传'); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) state(false); }
  }
  useEffect(() => {
    if (!library) return; let active = true; setLoading(true);
    void api<{ items: Asset[]; total: number }>('/admin/images?page=' + page + '&size=12&q=' + encodeURIComponent(query)).then(data => { if (active) { setItems(data.items); setTotal(data.total); setError(''); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [library, page, query]);
  const cropWidth = Math.min(360, 300 * ratio, Math.max(160, window.innerWidth - 96)), cropHeight = cropWidth / ratio;
  return <Space onDragOver={event=>{if(!disabled&&!busy)event.preventDefault();}} onDrop={event=>{event.preventDefault();if(disabled||busy)return;const file=event.dataTransfer.files[0];if(file)void select(file);}} orientation="vertical" size={8} style={{ width: '100%' }}>
    {value && <Image src={value} width={Math.min(240, ratio * 160)} height={Math.min(160, 240 / ratio)} style={{ objectFit: 'cover', borderRadius: 8 }} alt="已选图片" />}
    <Space wrap><Upload accept="image/jpeg,image/png,image/webp" showUploadList={false} beforeUpload={select} disabled={disabled || busy}><Button id={id} icon={<CloudUploadOutlined />} loading={busy} disabled={disabled}>{value ? '更换图片' : '上传本地图片'}</Button></Upload><Button icon={<PictureOutlined />} disabled={disabled || busy} onClick={() => { setPage(1); setLibrary(true); }}>从素材库选择</Button>{value && <Button disabled={disabled || busy} onClick={() => onChange?.(null)}>移除</Button>}</Space>
    <Typography.Text type="secondary">支持JPEG、PNG、WebP，最大10MB；也可将图片拖到此处。请使用可公开展示的图片。</Typography.Text>
    {error && <Alert title={error} type="error" showIcon />}
    <Modal title="调整图片" open={!!crop} onCancel={() => { if (!busy) closeCrop(); }} maskClosable={!busy} width={520} footer={<Space wrap><Button disabled={busy} onClick={closeCrop}>取消</Button><Button loading={busy} onClick={() => upload(false)}>使用完整图片</Button><Button type="primary" loading={busy} onClick={() => upload(true)}>使用裁剪图片</Button></Space>}>
      {crop && <><Typography.Paragraph type="secondary">拖动图片调整位置，滑动缩放。</Typography.Paragraph><div style={{ width: '100%', overflow: 'hidden' }}><div style={{ width: cropWidth, height: cropHeight, maxWidth: '100%', margin: 'auto', overflow: 'hidden', background: '#eee', touchAction: 'none', cursor: 'move', position: 'relative', borderRadius: 8 }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, left: x, top: y }; }} onPointerMove={event => { if (!drag.current) return; setX(Math.max(0, Math.min(100, drag.current.left - (event.clientX - drag.current.x) / 2))); setY(Math.max(0, Math.min(100, drag.current.top - (event.clientY - drag.current.y) / 2))); }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}><img src={crop.url} alt="裁剪预览" draggable={false} style={{ position: 'absolute', width: Math.max(cropWidth / crop.width, cropHeight / crop.height) * crop.width * zoom, height: Math.max(cropWidth / crop.width, cropHeight / crop.height) * crop.height * zoom, left: (cropWidth - Math.max(cropWidth / crop.width, cropHeight / crop.height) * crop.width * zoom) * x / 100, top: (cropHeight - Math.max(cropWidth / crop.width, cropHeight / crop.height) * crop.height * zoom) * y / 100 }} /></div></div><Slider aria-label="图片缩放" min={1} max={3} step={0.05} value={zoom} onChange={setZoom} /><Space wrap><Typography.Text>水平位置</Typography.Text><Slider aria-label="水平裁剪位置" style={{ width: 120 }} value={x} onChange={setX} /><Typography.Text>垂直位置</Typography.Text><Slider aria-label="垂直裁剪位置" style={{ width: 120 }} value={y} onChange={setY} /></Space></>}
    </Modal>
    <Modal title="图片素材库" open={library} onCancel={() => setLibrary(false)} footer={null} width={720}>
      <Input.Search placeholder="搜索图片名称" allowClear onSearch={value => { setPage(1); setQuery(value); }} style={{ marginBottom: 16 }} />
      <Spin spinning={loading}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 12 }}>{items.map(item => <Button key={item.id} style={{ height: 'auto', padding: 8, whiteSpace: 'normal' }} onClick={() => { onChange?.(item.url); setLibrary(false); }}><div><img src={item.url} alt={item.name} style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 4 }} /><Typography.Paragraph ellipsis style={{ width: 130, margin: '8px 0 0' }}>{item.name}</Typography.Paragraph></div></Button>)}</div>{!loading && !items.length && <Typography.Paragraph type="secondary">暂无图片，请先上传本地图片。</Typography.Paragraph>}</Spin>
      <Pagination current={page} total={total} pageSize={12} showSizeChanger={false} onChange={setPage} style={{ marginTop: 16 }} />
    </Modal>
  </Space>;
}
