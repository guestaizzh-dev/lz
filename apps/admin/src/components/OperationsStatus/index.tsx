import { useQuery } from '@tanstack/react-query';
import { Link, useAccess } from '@umijs/max';
import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
import { api } from '@/api';

export default function OperationsStatus() {
  const access = useAccess();
  const { data, error, isFetching, refetch } = useQuery({ queryKey: ['operations-summary'], queryFn: () => api<{ counts: Record<string, number>; overdue: number; expiredLeases: number }>('/admin/operations/summary'), enabled: access.canOperations });
  if (!access.canOperations) return null;
  return <Card title="运行待处理事项" extra={<Link to="/operations">查看任务监控 →</Link>} style={{ marginBottom: 24 }}>
    {error ? <Alert showIcon type="error" title="任务状态加载失败" action={<Button loading={isFetching} onClick={() => void refetch()}>重试</Button>} /> : <Space wrap size="large">
      <Typography.Text>失败任务 <Tag color={data?.counts.DEAD ? 'red' : 'default'}>{data?.counts.DEAD ?? '—'}</Tag></Typography.Text>
      <Typography.Text>等待执行 <Tag>{data?.counts.READY ?? '—'}</Tag></Typography.Text>
      <Typography.Text>等待超过五分钟 <Tag color={data?.overdue ? 'orange' : 'default'}>{data?.overdue ?? '—'}</Tag></Typography.Text>
      <Typography.Text>租约过期 <Tag color={data?.expiredLeases ? 'orange' : 'default'}>{data?.expiredLeases ?? '—'}</Tag></Typography.Text>
    </Space>}
  </Card>;
}
