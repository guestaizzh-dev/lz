import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Upload } from 'antd';
import { api } from '@/api';

export default function BatchImageUpload({
  limit = 9,
  disabled = false,
  onImages,
  onBusyChange,
}: {
  limit?: number;
  disabled?: boolean;
  onImages: (urls: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const running = useRef(false),
    alive = useRef(true),
    callback = useRef(onImages),
    busyCallback = useRef(onBusyChange);
  callback.current = onImages;
  busyCallback.current = onBusyChange;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      busyCallback.current?.(false);
    };
  }, []);
  async function upload(files: File[]) {
    if (running.current || disabled || limit <= 0) return;
    if (files.length > limit) {
      setError('最多还能添加' + limit + '张图片');
      return;
    }
    if (
      files.some(
        (f) =>
          !f.size ||
          f.size > 10 * 1024 * 1024 ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(f.type),
      )
    ) {
      setError('请选择10MB以内的JPEG、PNG或WebP图片');
      return;
    }
    running.current = true;
    setBusy(true);
    setError('');
    busyCallback.current?.(true);
    const failures: string[] = [],
      uploaded: string[] = [];
    try {
      for (const file of files) {
        if (!alive.current) break;
        try {
          const body = new FormData();
          body.append('file', file);
          const result = await api<{ url: string }>('/admin/images', 'POST', body);
          uploaded.push(result.url);
        } catch {
          failures.push(file.name);
        }
      }
      if (alive.current && uploaded.length) callback.current(uploaded);
      if (alive.current && failures.length)
        setError('以下图片未上传成功，请重新选择：' + failures.join('、'));
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(false);
        busyCallback.current?.(false);
      }
    }
  }
  return (
    <div>
      <Upload
        multiple
        accept="image/jpeg,image/png,image/webp"
        showUploadList={false}
        disabled={busy || disabled || limit <= 0}
        beforeUpload={(file, files) => {
          if (file.uid === files[0]?.uid) void upload(files);
          return false;
        }}
      >
        <Button loading={busy} disabled={disabled || limit <= 0}>
          批量上传图片
        </Button>
      </Upload>
      {error && <Alert type="error" title={error} showIcon style={{ marginTop: 8 }} />}
    </div>
  );
}
