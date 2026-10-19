import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Link, useAccess } from '@umijs/max';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Col, Descriptions, Drawer, Form, Input, Modal, Row, Select, Space, Statistic, Tag, Timeline, Typography } from 'antd';
import { useRef, useState } from 'react';
import { api } from '@/api';
import { formatChinaTime } from '@/utils/date-time';
import { orderLink } from '@/operations/business-links';

const kinds: Record<string, string> = {
  CONSUMPTION_SYNC:'消费积分与退款核对',GIFT_PAYMENT_CHECK:'礼物余额收款核查',GIFT_REFUND:'礼物余额原路退款',AUTH_APPLE_REVOKE:'Apple登录授权撤销', NOTIFICATION_PUSH: '书院消息推送', COURSE_PAYMENT_CHECK: '课程收款核查', COURSE_REFUND: '课程退款', COURSE_DELIVERY_NOTICE: '课程交付通知',
  MEMBERSHIP_PAYMENT_CHECK: '会员收款核查', MEMBERSHIP_REFUND: '会员退款', PRODUCT_PAYMENT_CHECK: '商品收款核查', PRODUCT_REFUND: '商品退款',
  BOOKING_PAYMENT_CHECK: '预约 / 活动收款核查', BOOKING_REFUND: '预约 / 活动退款', BOOKING_CANCEL_COMPENSATION: '预约 / 活动取消补偿',
  COHORT_PAYMENT_CHECK: '训练营收款核查', COHORT_REFUND: '训练营退款', COHORT_SCHEDULE_COMPENSATION: '营期变更补偿',
};
const states: Record<string, string> = { DEAD: '失败待处理', READY: '等待执行', RUNNING: '执行中', DONE: '已完成' };
const errors: Record<string, string> = { CONSUMPTION_SOURCE_UNAVAILABLE:'消费来源或账务暂不可核实，请核对原订单和收入后重试',APPLE_REVOKE_UNAVAILABLE:'Apple授权撤销尚未完成，请核查登录密钥配置或服务状态后重试', PUSH_NOT_CONFIGURED:'推送网关未开通，站内消息保留', PUSH_AMBIGUOUS:'服务商结果不确定，请核对云网关记录，禁止盲目重发', PUSH_GATEWAY_REJECTED:'推送网关拒绝请求，请核查配置', PUSH_UNAVAILABLE:'推送服务暂不可用', PROVIDER_OR_PROCESSING_ERROR: '渠道查询或业务处理失败，请核查渠道与相关订单', PROVIDER_OR_POSTING_UNAVAILABLE: '渠道或账务处理不可用，请核查业务状态' };
type Job = { id: string; revision: string; kind: string; aggregateId: string; aggregateType: string; state: string; attempts: number; availableAt: string; lockedUntil: string | null; lastErrorCode: string | null; completedAt: string | null; createdAt: string; updatedAt: string; retryable: boolean };
type Detail = Job & { pushDeliveries?:{id:string;state:string;attempts:number;providerMessageId:string|null;failureCode:string|null;updatedAt:string}[]; order: { id: string; orderNo: string; kind: string; state: string } | null; audit: { id: string; createdAt: string; actorId: string; reason: string }[] };
type Summary = { counts: Record<string, number>; overdue: number; expiredLeases: number; oldestPendingAt: string | null; checkedAt: string };

export default function Operations() {
  const access = useAccess(), { message } = App.useApp(), table = useRef<ActionType>(undefined), sequence = useRef(0);
  const [state, setState] = useState<string | undefined>('DEAD'), [kind, setKind] = useState<string>(), [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Detail>(), [retry, setRetry] = useState<Detail>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [opening, setOpening] = useState(false), [actionError, setActionError] = useState(''), [form] = Form.useForm();
  const summary = useQuery({ queryKey: ['operations-summary'], queryFn: () => api<Summary>('/admin/operations/summary'), enabled: access.canOperations });
  async function open(id: string) {
    const current = ++sequence.current; setOpening(true); setError('');
    try { const detail = await api<Detail>('/admin/operations/jobs/' + id); if (current === sequence.current) setSelected(detail); }
    catch (e) { if (current === sequence.current) setError((e as Error).message); }
    finally { if (current === sequence.current) setOpening(false); }
  }
  async function save(values: { reason: string }) {
    if (!retry || busy) return; setBusy(true); setActionError('');
    try {
      await api('/admin/operations/jobs/' + retry.id + '/retry', 'POST', { reason: values.reason, expectedRevision: retry.revision });
      setRetry(undefined); message.success('已重新排队，执行结果请刷新核查'); table.current?.reload(); void summary.refetch(); await open(retry.id);
    } catch (e) { setActionError((e as Error).message); } finally { setBusy(false); }
  }
  const columns: ProColumns<Job>[] = [
    { title: '任务', dataIndex: 'kind', renderText: value => kinds[value] ?? '其他任务（暂不支持人工恢复）', width: 200 },
    { title: '状态', dataIndex: 'state', render: (_, row) => <Tag color={row.state === 'DEAD' ? 'red' : row.state === 'DONE' ? 'green' : 'blue'}>{states[row.state] ?? row.state}</Tag> },
    { title: '尝试次数', dataIndex: 'attempts' },
    { title: '计划执行（北京）', dataIndex: 'availableAt', renderText: formatChinaTime, width: 180 },
    { title: '最近问题', render: (_, row) => row.lastErrorCode ? errors[row.lastErrorCode] ?? '执行失败，请查看详情中的错误代码' : '—', width: 280 },
    { title: '操作', valueType: 'option', render: (_, row) => <Button type="link" loading={opening} onClick={() => void open(row.id)}>查看与处理</Button> },
  ];
  return <PageContainer title="任务监控与恢复" subTitle="先核查失败原因，再重新排队；任务成功以实际业务结果为准">
    <Alert showIcon type="info" title="无需修改底层数据" description="本页集中查看原收款、退款、通知与补偿执行器的任务。仅支持明确失败任务的可审计重试，不允许手工改为成功、改写业务内容或抢占运行中的任务。" style={{ marginBottom: 20 }} />
    {(error || summary.error) && <Alert closable onClose={() => setError('')} showIcon type="error" title={error || (summary.error as Error).message} style={{ marginBottom: 20 }} />}
    <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>{[
      ['失败待处理', summary.data ? summary.data.counts.DEAD ?? 0 : '—'], ['等待执行', summary.data ? summary.data.counts.READY ?? 0 : '—'], ['执行中', summary.data ? summary.data.counts.RUNNING ?? 0 : '—'], ['超时等待 / 租约过期', summary.data ? `${summary.data.overdue} / ${summary.data.expiredLeases}` : '—'],
    ].map(([title, value]) => <Col xs={12} xl={6} key={title}><Card><Statistic title={title} value={value} loading={summary.isLoading} /></Card></Col>)}</Row>
    <Card style={{ marginBottom: 20 }}><Space wrap>
      <Select aria-label="任务状态" style={{ width: 170 }} allowClear placeholder="全部状态" value={state} onChange={setState} options={Object.entries(states).map(([value, label]) => ({ value, label }))} />
      <Select aria-label="任务类型" style={{ width: 230 }} allowClear placeholder="全部任务类型" value={kind} onChange={setKind} options={Object.entries(kinds).map(([value, label]) => ({ value, label }))} />
      <Input.Search aria-label="搜索任务" allowClear placeholder="任务或业务标识（排查用）" style={{ width: 280 }} onSearch={setQuery} onChange={e => { if (!e.target.value) setQuery(''); }} />
      <Button loading={summary.isFetching} onClick={() => { void summary.refetch(); table.current?.reload(); }}>刷新状态</Button>
    </Space><Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>统计来自全部持久任务，不随列表筛选变化。等待超过五分钟不必然是失败；租约过期由原执行器自动恢复。{summary.data?.checkedAt && `核查时间：${formatChinaTime(summary.data.checkedAt)}`}</Typography.Paragraph></Card>
    <ProTable<Job> key={`${state}-${kind}-${query}`} actionRef={table} rowKey="id" search={false} columns={columns} scroll={{ x: 1000 }} pagination={{ pageSize: 20 }} request={async params => {
      const filters = new URLSearchParams({ page: String(params.current ?? 1), size: String(params.pageSize ?? 20), ...(state ? { state } : {}), ...(kind ? { kind } : {}), ...(query ? { q: query } : {}) });
      try { setError(''); const result = await api<{ items: Job[]; total: number }>('/admin/operations/jobs?' + filters); return { data: result.items, total: result.total, success: true }; }
      catch (e) { setError((e as Error).message); return { data: [], total: 0, success: false }; }
    }} />
    <Drawer title="任务详情与处理" size={760} open={!!selected} onClose={() => { if (!busy) { sequence.current++; setSelected(undefined); } }} extra={<Button loading={opening} onClick={() => selected && void open(selected.id)}>刷新详情</Button>}>
      {selected && <>
        <Descriptions column={1} bordered items={[
          { key: 'kind', label: '任务', children: kinds[selected.kind] ?? selected.kind }, { key: 'state', label: '状态', children: states[selected.state] ?? selected.state },
          { key: 'attempts', label: '尝试次数', children: selected.attempts }, { key: 'available', label: '计划执行', children: formatChinaTime(selected.availableAt) },
          { key: 'lease', label: '执行租约截止', children: selected.lockedUntil ? formatChinaTime(selected.lockedUntil) : '无有效租约' },
          { key: 'error', label: '最近错误', children: selected.lastErrorCode ? <>{errors[selected.lastErrorCode] ?? '请交开发维护人员核查'}<br /><Typography.Text type="secondary">{selected.lastErrorCode}</Typography.Text></> : '无' },
          { key: 'done', label: '完成时间', children: selected.completedAt ? formatChinaTime(selected.completedAt) : '尚未完成' },
          { key: 'order', label: '关联订单', children: selected.order ? <Space><Typography.Text copyable>{selected.order.orderNo}</Typography.Text>{access.canViewOrders && orderLink(selected.order) && <Link to={orderLink(selected.order)!}>打开订单处理 →</Link>}</Space> : '本任务不直接对应单笔订单，请按业务范围核查' },
          { key: 'id', label: '排查标识', children: <Typography.Text copyable>{selected.id}</Typography.Text> },
        ]} />
        {selected.kind==='NOTIFICATION_PUSH'&&<Card title="推送投递记录" size="small" style={{marginTop:20}}><Typography.Paragraph type="secondary">服务商接受不等于设备送达。结果不确定须核查网关事实，站内消息不受影响。</Typography.Paragraph>{selected.pushDeliveries?.length?selected.pushDeliveries.map(item=><Typography.Paragraph key={item.id}>{({READY:'等待重试',SENDING:'发送中',ACCEPTED:'服务商已接受',UNKNOWN:'结果不确定，待核查',SKIPPED:'绑定失效，已跳过'} as Record<string,string>)[item.state]??'待核查'} · {item.attempts}次 · {formatChinaTime(item.updatedAt)}{item.providerMessageId&&<><br/><Typography.Text copyable>服务商任务：{item.providerMessageId}</Typography.Text></>}{item.failureCode&&<><br/>{errors[item.failureCode]??'请核查设备绑定与网关状态'}</>}</Typography.Paragraph>):<Typography.Text type="secondary">无符合条件的设备或通知已读、已过期、未开启对应推送。</Typography.Text>}</Card>}
        <Alert showIcon style={{ marginTop: 20 }} type={selected.retryable ? 'warning' : 'info'} title={selected.retryable ? '先核实原订单 / 渠道问题是否已解决' : '当前任务不可手工重试'} description="重新排队会沿用原任务身份和补偿游标，既有执行器再次查询并处理。重新排队不等于支付、退款或交付成功；其他任务须先接通安全人工恢复。" />
        {access.canOperationsRetry && selected.retryable && <Button type="primary" style={{ marginTop: 16 }} onClick={() => { form.resetFields(); setActionError(''); setRetry(selected); }}>核查后重新排队</Button>}
        <Typography.Title level={5} style={{ marginTop: 28 }}>最近人工恢复记录</Typography.Title>
        {selected.audit.length ? <Timeline items={selected.audit.map(row => ({ key: row.id, children: <><Typography.Text>{formatChinaTime(row.createdAt)}</Typography.Text><Typography.Paragraph>{row.reason}</Typography.Paragraph></> }))} /> : <Typography.Text type="secondary">尚无人工重新排队记录</Typography.Text>}
      </>}
    </Drawer>
    <Modal title="核查后重新排队" open={!!retry} confirmLoading={busy} maskClosable={!busy} onCancel={() => { if (!busy) setRetry(undefined); }} onOk={() => form.submit()}>
      <Typography.Paragraph>确认失败原因已核查，再交给原执行器重试。此操作不改变订单、付款或退款事实。</Typography.Paragraph>
      {actionError && <Alert type="error" showIcon title={actionError} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" onFinish={save} disabled={busy}><Form.Item name="reason" label="核查结果与恢复依据" rules={[{ required: true, whitespace: true, min: 2, max: 500 }]}><Input.TextArea rows={4} maxLength={500} /></Form.Item></Form>
    </Modal>
  </PageContainer>;
}
