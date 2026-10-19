import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Link, useAccess } from '@umijs/max';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, DatePicker, Descriptions, Drawer, Empty, Input, Row, Select, Space, Statistic, Table, Tag, Tabs, Typography } from 'antd';
import dayjs from 'dayjs';
import { useRef, useState } from 'react';
import { api } from '@/api';
import { formatChinaTime } from '@/utils/date-time';
import { businessNames, channelNames, currencyAmount, orderLink } from '@/operations/business-links';

const states: Record<string, string> = { ACCEPTED: '正常收款', AMOUNT_MISMATCH: '金额不符', REFUND_REQUIRED: '需原路退款', INELIGIBLE: '不符合交付条件', APPROVED: '审核通过', REVIEW: '待复核', RETURNING: '等待寄回', RETURN_REQUIRED: '等待退货', RETURN_RECEIVED: '已收到退货', REFUND_PENDING: '异常款待退', DUPLICATE: '重复收款', LATE: '迟到收款', REQUESTED: '申请待审核', REFUNDING: '退款处理中', SUCCEEDED: '退款已确认', FAILED: '退款待处理', REJECTED: '已驳回', CANCELLED: '已取消', REVERSED: 'Apple 撤回退款', AWAITING_ACCEPTANCE: '等待用户确认' };
type RowData = { id: string; orderId: string; orderNo: string; orderKind: string; currency: string; amount?: string; state?: string; channel?: string; occurredAt: string; succeededAt?: string | null; externalTransactionId?: string; failureCode?: string | null; description?: string; debit?: string; credit?: string; balanced?: boolean };
type Payment = { id: string; channel: string; amount: string; currency: string; disposition: string; externalTransactionId: string; paidAt: string; verifiedAt: string };
type Refund = { id: string; state: string; requestedAmount: string; approvedAmount: string | null; reasonCode: string; createdAt: string; succeededAt: string | null; failureCode: string | null };
type Journal = { id: string; kind: string; description: string; currency: string; postedAt: string; balanced: boolean; entries: { id: string; accountCode: string; accountName: string; debit: string; credit: string }[] };
type Detail = { order: { id: string; orderNo: string; kind: string; state: string; currency: string; payableTotal: string; paidTotal: string; refundedTotal: string; createdAt: string }; payments: Payment[]; refunds: Refund[]; journals: Journal[]; journalsLimited: boolean };
type Summary = { currencies: { currency: string; accepted: string; abnormal: string; refunded: string; cashDifference: string; paymentCount: number; refundCount: number; reversalCount: number; refundReversed: string }[] };
type View = 'payments' | 'refunds' | 'journals';

export default function Finance() {
  const access = useAccess(), table = useRef<ActionType>(undefined), sequence = useRef(0);
  const [dates, setDates] = useState<[string, string]>(() => {
    const china = dayjs(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()));
    return [china.subtract(29, 'day').format('YYYY-MM-DD'), china.format('YYYY-MM-DD')];
  });
  const [kind, setKind] = useState<string>(), [channel, setChannel] = useState<string>(), [q, setQ] = useState(''), [view, setView] = useState<View>('payments');
  const [detail, setDetail] = useState<Detail>(), [opening, setOpening] = useState(false), [error, setError] = useState('');
  const filters = new URLSearchParams({ from: `${dates[0]}T00:00:00+08:00`, to: `${dayjs(dates[1]).add(1, 'day').format('YYYY-MM-DD')}T00:00:00+08:00`, ...(kind ? { kind } : {}), ...(channel ? { channel } : {}), ...(q ? { q } : {}) }).toString();
  const summary = useQuery({ queryKey: ['finance-summary', filters], queryFn: () => api<Summary>('/admin/finance/summary?' + filters), enabled: access.canFinanceRead });
  async function open(id: string) {
    const current = ++sequence.current; setOpening(true); setError('');
    try { const row = await api<Detail>('/admin/finance/orders/' + id); if (current === sequence.current) setDetail(row); }
    catch (e) { if (current === sequence.current) setError((e as Error).message); }
    finally { if (current === sequence.current) setOpening(false); }
  }
  const columns: ProColumns<RowData>[] = [
    { title: '订单编号', dataIndex: 'orderNo', copyable: true, width: 220 },
    { title: '业务', dataIndex: 'orderKind', renderText: value => businessNames[value] ?? value, width: 110 },
    ...(view !== 'journals' ? [
      { title: '渠道', dataIndex: 'channel', renderText: (value: string) => channelNames[value] ?? value ?? '尚未确认', width: 120 },
      { title: view === 'payments' ? '实际收款' : '退款申请 / 批准金额', render: (_: unknown, row: RowData) => currencyAmount(row.amount, row.currency), width: 160 },
      { title: '状态', dataIndex: 'state', render: (_: unknown, row: RowData) => <Tag color={row.state === 'ACCEPTED' || row.state === 'SUCCEEDED' ? 'green' : 'orange'}>{states[row.state ?? ''] ?? row.state}</Tag>, width: 160 },
    ] : [
      { title: '账务摘要', dataIndex: 'description', width: 230 },
      { title: '借方合计', render: (_: unknown, row: RowData) => currencyAmount(row.debit, row.currency), width: 130 },
      { title: '贷方合计', render: (_: unknown, row: RowData) => currencyAmount(row.credit, row.currency), width: 130 },
      { title: '借贷核对', render: (_: unknown, row: RowData) => <Tag color={row.balanced ? 'green' : 'red'}>{row.balanced ? '平衡' : '需核查'}</Tag>, width: 100 },
    ]),
    { title: view === 'payments' ? '收款时间（北京）' : view === 'refunds' ? '申请时间（北京）' : '记账时间（北京）', dataIndex: 'occurredAt', renderText: formatChinaTime, width: 190 },
    { title: '操作', valueType: 'option', fixed: 'right', width: 150, render: (_, row) => <Button type="link" loading={opening} onClick={() => void open(row.orderId)}>查看资金链路</Button> },
  ];
  return <PageContainer title="收退款与账务" subTitle="按业务和渠道集中核查交易，关联原订单与实际账务记录">
    <Alert showIcon type="info" title="这是交易与账务核查，不是渠道日对账或可提现收入" description="只展示服务端已保存的交易事实。异常款单列，收款可能属于预收；渠道日账单、正式合作分成和银行打款仍需独立验收。本页不修改收退款事实。" style={{ marginBottom: 20 }} />
    {(error || summary.error) && <Alert showIcon type="error" title={error || (summary.error as Error).message} style={{ marginBottom: 20 }} />}
    <Card style={{ marginBottom: 20 }}><Space wrap>
      <DatePicker.RangePicker aria-label="财务日期范围" allowClear={false} disabledDate={(date, info) => !!info.from && Math.abs(date.startOf('day').diff(info.from.startOf('day'), 'day')) > 365} value={[dayjs(dates[0]), dayjs(dates[1])]} onChange={value => { if (value?.[0] && value[1]) setDates([value[0].format('YYYY-MM-DD'), value[1].format('YYYY-MM-DD')]); }} />
      <Select aria-label="财务业务类型" style={{ width: 160 }} allowClear placeholder="全部业务" value={kind} onChange={setKind} options={Object.entries(businessNames).map(([value, label]) => ({ value, label }))} />
      <Select aria-label="财务支付渠道" style={{ width: 160 }} allowClear placeholder="全部渠道" value={channel} onChange={setChannel} options={Object.entries(channelNames).map(([value, label]) => ({ value, label }))} />
      <Input.Search aria-label="搜索财务订单" allowClear placeholder="输入订单编号" style={{ width: 260 }} onSearch={setQ} onChange={e => { if (!e.target.value) setQ(''); }} />
      <Button loading={summary.isFetching} onClick={() => { table.current?.reload(); void summary.refetch(); }}>刷新</Button>
    </Space><Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>北京时间，最多366天。收款按实际收款日统计，确认退款按渠道成功日、撤回按反向记账日统计；退款列表按申请日检索。不同币种分开显示。</Typography.Paragraph></Card>
    {summary.isLoading && <Card loading style={{ marginBottom: 20 }} />}
    {summary.data?.currencies.map(row => <Card key={row.currency} title={`${row.currency === 'CNY' ? '人民币' : row.currency} · 所选范围资金事实`} style={{ marginBottom: 20 }}>
      <Row gutter={[20, 20]}>{[
        ['正常确认收款', row.accepted], ['异常确认收款', row.abnormal], ['退款净支出（含异常款及撤回）', row.refunded], ['收退款差额（含异常款）', row.cashDifference],
      ].map(([title, amount]) => <Col xs={12} xl={6} key={title}><Statistic title={title} value={currencyAmount(amount, row.currency)} /></Col>)}</Row>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>{row.paymentCount} 笔确认收款，{row.refundCount} 笔确认退款、{row.reversalCount ?? 0} 笔退款撤回；净支出扣除撤回回补，换货不计入。差额是期间现金变化，不是利润、合作方结算额或余额。</Typography.Paragraph>
    </Card>)}
    {summary.data && !summary.data.currencies.length && <Card style={{ marginBottom: 20 }}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选范围暂无已确认收退款，仍可在下方核查退款申请和账务记录" /></Card>}
    <Tabs activeKey={view} onChange={value => setView(value as View)} items={[{ key: 'payments', label: '确认收款' }, { key: 'refunds', label: '退款跟踪' }, { key: 'journals', label: '账务明细' }]} />
    <ProTable<RowData> key={view + filters} actionRef={table} rowKey="id" columns={columns} search={false} scroll={{ x: 1180 }} pagination={{ pageSize: 20 }} request={async params => {
      try { setError(''); const result = await api<{ items: RowData[]; total: number }>(`/admin/finance/${view}?${filters}&page=${params.current ?? 1}&size=${params.pageSize ?? 20}`); return { data: result.items, total: result.total, success: true }; }
      catch (e) { setError((e as Error).message); return { data: [], total: 0, success: false }; }
    }} />
    <Drawer title="订单资金链路" size={920} open={!!detail} onClose={() => { sequence.current++; setDetail(undefined); }} extra={<Button loading={opening} onClick={() => detail && void open(detail.order.id)}>刷新详情</Button>}>
      {detail && <>
        <Descriptions column={2} bordered items={[
          { key: 'order', label: '订单编号', children: <Typography.Text copyable>{detail.order.orderNo}</Typography.Text>, span: 2 },
          { key: 'kind', label: '业务', children: businessNames[detail.order.kind] ?? detail.order.kind },
          { key: 'date', label: '创建时间', children: formatChinaTime(detail.order.createdAt) },
          { key: 'due', label: '订单应付', children: currencyAmount(detail.order.payableTotal, detail.order.currency) },
          { key: 'paid', label: '订单接受收款', children: currencyAmount(detail.order.paidTotal, detail.order.currency) },
          { key: 'refund', label: '订单累计退款', children: currencyAmount(detail.order.refundedTotal, detail.order.currency) },
          { key: 'link', label: '售后处理', children: access.canViewOrders && orderLink(detail.order) ? <Link to={orderLink(detail.order)!}>打开对应订单 →</Link> : '需要对应订单查看权限' },
        ]} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>订单接受金额与所有渠道收款可能不同；重复 / 迟到等异常款会单独保存并补偿退回。</Typography.Paragraph>
        <Typography.Title level={5}>实际渠道收款</Typography.Title>
        <Table<Payment> size="small" rowKey="id" pagination={false} scroll={{ x: 700 }} dataSource={detail.payments} columns={[
          { title: '渠道', dataIndex: 'channel', render: value => channelNames[value] ?? value }, { title: '金额', render: (_, row) => currencyAmount(row.amount, row.currency) },
          { title: '处理归类', dataIndex: 'disposition', render: value => states[value] ?? value }, { title: '渠道交易号', dataIndex: 'externalTransactionId' }, { title: '收款时间', dataIndex: 'paidAt', render: formatChinaTime },
        ]} />
        <Typography.Title level={5} style={{ marginTop: 24 }}>退款申请与确认</Typography.Title>
        <Table<Refund> size="small" rowKey="id" pagination={false} scroll={{ x: 700 }} dataSource={detail.refunds} columns={[
          { title: '状态', dataIndex: 'state', render: value => states[value] ?? value }, { title: '申请', render: (_, row) => currencyAmount(row.requestedAmount, detail.order.currency) },
          { title: '批准', render: (_, row) => currencyAmount(row.approvedAmount, detail.order.currency) }, { title: '已确认成功时间', dataIndex: 'succeededAt', render: value => value ? formatChinaTime(value) : '尚未确认成功' }, { title: '失败代码', dataIndex: 'failureCode', render: value => value ?? '—' },
        ]} />
        <Typography.Title level={5} style={{ marginTop: 24 }}>实际账务分录</Typography.Title>
        {detail.journalsLimited && <Alert type="warning" title="此处显示最近100笔账务记录，完整记录请按日期在账务明细检索" style={{ marginBottom: 16 }} />}
        {!detail.journals.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无相关记账事实" />}
        {detail.journals.map(journal => <Card size="small" key={journal.id} style={{ marginBottom: 16 }} title={journal.description} extra={<Tag color={journal.balanced ? 'green' : 'red'}>{journal.balanced ? '借贷平衡' : '需核查'}</Tag>}>
          <Typography.Paragraph type="secondary">{formatChinaTime(journal.postedAt)} · {journal.currency}</Typography.Paragraph>
          <Table<Journal['entries'][number]> size="small" rowKey="id" pagination={false} dataSource={journal.entries} columns={[
            { title: '科目', dataIndex: 'accountName' }, { title: '借方', render: (_, row) => currencyAmount(row.debit, journal.currency) }, { title: '贷方', render: (_, row) => currencyAmount(row.credit, journal.currency) },
          ]} />
        </Card>)}
      </>}
    </Drawer>
  </PageContainer>;
}
