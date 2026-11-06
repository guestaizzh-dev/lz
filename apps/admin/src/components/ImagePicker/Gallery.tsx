import { useRef, useState } from 'react';
import { Button, Image, Space, Typography } from 'antd';
import ImagePicker from './index';
import BatchImageUpload from './BatchUpload';
export default function Gallery({
  value = [],
  onChange,
  onBusyChange,
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const latest = useRef(value);
  latest.current = value;
  const [busy, setBusy] = useState(false);
  function change(next: string[]) {
    latest.current = next;
    onChange?.(next);
  }
  function append(url: string | null) {
    if (url && latest.current.length < 9 && !latest.current.includes(url))
      change([...latest.current, url]);
  }
  function move(index: number, delta: number) {
    const next = [...latest.current];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    change(next);
  }
  function uploading(active: boolean) {
    setBusy(active);
    onBusyChange?.(active);
  }
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        最多9张，第一张作为封面；上传保留完整图片。
      </Typography.Text>
      {value.map((url, i) => (
        <Space key={url} wrap>
          <Image
            src={url}
            width={96}
            height={96}
            style={{ objectFit: 'contain', background: '#f7f7f7', borderRadius: 8 }}
          />
          <Typography.Text>{i === 0 ? '封面' : '第' + (i + 1) + '张'}</Typography.Text>
          <Button disabled={busy || i === 0} onClick={() => move(i, -1)}>
            前移
          </Button>
          <Button disabled={busy || i === value.length - 1} onClick={() => move(i, 1)}>
            后移
          </Button>
          <Button
            danger
            disabled={busy}
            onClick={() => change(latest.current.filter((_, index) => index !== i))}
          >
            移除
          </Button>
        </Space>
      ))}
      <BatchImageUpload
        limit={9 - value.length}
        disabled={busy}
        onImages={(urls) => change([...new Set([...latest.current, ...urls])].slice(0, 9))}
        onBusyChange={uploading}
      />
      {value.length < 9 && (
        <ImagePicker disabled={busy} onChange={append} onBusyChange={uploading} />
      )}
    </Space>
  );
}
