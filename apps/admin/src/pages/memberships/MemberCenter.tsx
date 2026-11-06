import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ProTable, type ActionType } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { api } from '@/api';
import MoneyInput from '@/components/MoneyInput';
import { moneyText } from '@/utils/money';
import { formatChinaTime } from '@/utils/date-time';
type Grade = {
  tier: number;
  title: string;
  price: number;
  voucherQuantity: number;
  goodsBasisPoints: number;
  bookBasisPoints: number;
  version: number;
  active: boolean;
};
type Refund = {
  id: string;
  state: string;
  version: number;
  requestedAmount: string;
  description: string;
  reviewNote: string | null;
};
type Order = {
  id: string;
  orderNo: string;
  userId: string;
  state: string;
  amount: string;
  paidAmount: string;
  refundedAmount: string;
  createdAt: string;
  terms: {
    title: string;
    kind: string;
    quantity: number;
    giftQuantity: number;
    previousId: string | null;
  };
  member: { tier: number; state: string } | null;
  lot: { remaining: number; used: number; held: number; refundHeld: number } | null;
  refunds: Refund[];
};
type Result = {
  voucherPolicy: { faceValue: number };
  grades: Grade[];
  orders: { items: Order[]; total: number };
};
const states: Record<string, string> = {
  PENDING: '待付款',
  COMPLETED: '已完成',
  CLOSED: '已关闭',
  REQUESTED: '待审核',
  REFUNDING: '退款中',
  SUCCEEDED: '已退款',
  FAILED: '需重试',
  REJECTED: '已拒绝',
};
const discount = (value: number) => (value / 1000).toFixed(1).replace(/\.0$/, '') + '折';
export default function MemberCenter({ voucherView = false }: { voucherView?: boolean }) {
  const { message, modal } = App.useApp(),
    access = useAccess(),
    table = useRef<ActionType | undefined>(undefined),
    [voucherValue, setVoucherValue] = useState(300),
    [grades, setGrades] = useState<Grade[]>([]),
    [editing, setEditing] = useState<Grade>(),
    [detail, setDetail] = useState<Order>(),
    [reviewing, setReviewing] = useState<{ order: Order; refund: Refund; action: string }>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [form] = Form.useForm(),
    [reviewForm] = Form.useForm();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('orderId');
    if (id && /^[a-f0-9-]{36}$/i.test(id))
      void api<Order>('/admin/membership-center/orders/' + id)
        .then(setDetail)
        .catch((e) => message.error((e as Error).message));
  }, []);
  function edit(row: Grade) {
    form.resetFields();
    form.setFieldsValue({
      ...row,
      goodsPercent: row.goodsBasisPoints / 100,
      bookPercent: row.bookBasisPoints / 100,
    });
    setEditing(row);
  }
  async function save() {
    if (!editing || busy) return;
    try {
      const v = await form.validateFields();
      setBusy(true);
      await api('/admin/membership-center/grades/' + editing.tier, 'PUT', {
        expectedVersion: editing.version,
        price: v.price,
        voucherQuantity: v.voucherQuantity,
        goodsBasisPoints: Math.round(v.goodsPercent * 100),
        bookBasisPoints: Math.round(v.bookPercent * 100),
        active: v.active,
        reason: v.reason,
      });
      setEditing(undefined);
      table.current?.reload();
      message.success('新售等级设置已更新，已有订单及赠券保持原约定');
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  function review(order: Order, refund: Refund, action: string) {
    reviewForm.resetFields();
    setReviewing({ order, refund, action });
  }
  async function submitReview() {
    if (!reviewing || busy) return;
    try {
      const v = await reviewForm.validateFields();
      setBusy(true);
      const updated = await api<Order>(
        '/admin/membership-center/refunds/' + reviewing.refund.id + '/review',
        'POST',
        { expectedVersion: reviewing.refund.version, action: reviewing.action, reason: v.reason },
      );
      setDetail(updated);
      setReviewing(undefined);
      table.current?.reload();
      message.success('退款处理已记录，到账以渠道核实结果为准');
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={<Button onClick={() => table.current?.reload()}>重试</Button>}
        />
      )}
      {!voucherView && (
        <Card
          title={voucherView ? '各等级会员赠券设置' : '会员等级设置'}
          extra={<Typography.Text type="secondary">注册会员免费，无折扣、无赠券</Typography.Text>}
        >
          <Table<Grade>
            rowKey="tier"
            dataSource={grades}
            pagination={false}
            scroll={{ x: 760 }}
            columns={[
              { title: '等级', dataIndex: 'title', width: 130 },
              {
                title: '开通价格',
                dataIndex: 'price',
                render: (v) => moneyText(String(v)),
                align: 'right',
              },
              { title: '生活馆商品', dataIndex: 'goodsBasisPoints', render: discount },
              { title: '图书专享', dataIndex: 'bookBasisPoints', render: discount },
              {
                title: '开通赠券',
                dataIndex: 'voucherQuantity',
                render: (v) => (
                  <Space direction="vertical" size={0}>
                    <span>{v}份</span>
                    <Typography.Text type="secondary">
                      价值 {moneyText(String(v * voucherValue))}
                    </Typography.Text>
                  </Space>
                ),
              },
              { title: '有效期', render: () => '长期有效' },
              {
                title: '新售状态',
                dataIndex: 'active',
                render: (v) => (
                  <Tag color={v ? 'success' : 'default'}>{v ? '开放' : '暂停新售'}</Tag>
                ),
              },
              {
                title: '操作',
                fixed: 'right',
                width: 90,
                render: (_, r) =>
                  access.canAdmin ? (
                    <Button type="link" onClick={() => edit(r)}>
                      调整设置
                    </Button>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        </Card>
      )}
      <ProTable<Order>
        rowKey="id"
        actionRef={table}
        headerTitle={voucherView ? '单独购券与退款订单' : '会员开通与升级订单'}
        search={false}
        options={{ density: true, reload: true, setting: true }}
        scroll={{ x: 960 }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        request={async (p) => {
          try {
            const r = await api<Result>(
              '/admin/membership-center?page=' +
                (p.current ?? 1) +
                '&size=' +
                (p.pageSize ?? 20) +
                '&kind=' +
                (voucherView ? 'VIDEO_VOUCHER' : 'MEMBER_LIFETIME'),
            );
            setGrades(r.grades);
            setVoucherValue(r.voucherPolicy.faceValue);
            setError('');
            return { data: r.orders.items, total: r.orders.total, success: true };
          } catch (e) {
            setError((e as Error).message);
            return { data: [], success: false };
          }
        }}
        columns={[
          { title: '订单编号', dataIndex: 'orderNo', width: 260, copyable: true },
          {
            title: '购买内容',
            render: (_, o) => (
              <Space direction="vertical" size={0}>
                <span>{o.terms.title}</span>
                <Typography.Text type="secondary">
                  {o.terms.kind === 'VIDEO_VOUCHER'
                    ? o.terms.quantity + '份'
                    : o.terms.previousId
                      ? '补差升级'
                      : '新开通'}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '订单金额',
            dataIndex: 'amount',
            align: 'right',
            render: (_, r) => moneyText(r.amount),
          },
          {
            title: '已退',
            dataIndex: 'refundedAmount',
            align: 'right',
            render: (_, r) => moneyText(r.refundedAmount),
          },
          {
            title: '状态',
            dataIndex: 'state',
            render: (v) => <Tag>{states[String(v)] ?? String(v)}</Tag>,
          },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            render: (_, r) => formatChinaTime(r.createdAt),
            width: 180,
          },
          {
            title: '操作',
            valueType: 'option',
            fixed: 'right',
            width: 120,
            render: (_, r) => (
              <Button type="link" onClick={() => setDetail(r)}>
                订单与售后
              </Button>
            ),
          },
        ]}
      />
      <Drawer
        title="订单与权益记录"
        open={!!detail}
        onClose={() => setDetail(undefined)}
        width={680}
      >
        {detail && (
          <>
            <Descriptions
              bordered
              column={1}
              size="small"
              items={[
                { key: 'id', label: '订单', children: detail.orderNo },
                { key: 'user', label: '用户编号', children: detail.userId },
                { key: 'title', label: '购买内容', children: detail.terms.title },
                { key: 'amount', label: '实际支付', children: moneyText(detail.paidAmount) },
                { key: 'refund', label: '已退金额', children: moneyText(detail.refundedAmount) },
                {
                  key: 'lot',
                  label: '代金券',
                  children: detail.lot
                    ? `可用${detail.lot.remaining} / 已用${detail.lot.used} / 占用${detail.lot.held} / 待退${detail.lot.refundHeld}`
                    : '无本次发券',
                },
                {
                  key: 'member',
                  label: '会员资格',
                  children: detail.member ? detail.member.state : '非会员资格订单',
                },
              ]}
            />
            <Typography.Title level={5}>退款申请</Typography.Title>
            {detail.refunds.length ? (
              detail.refunds.map((r) => (
                <Card key={r.id} size="small" style={{ marginBottom: 12 }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Space>
                      <Tag>{states[r.state] ?? r.state}</Tag>
                      <Typography.Text strong>{moneyText(r.requestedAmount)}</Typography.Text>
                    </Space>
                    <span>{r.description}</span>
                    {r.reviewNote && (
                      <Typography.Text type="secondary">{r.reviewNote}</Typography.Text>
                    )}
                    <Space>
                      {r.state === 'REQUESTED' && access.canFinance && (
                        <>
                          <Button onClick={() => review(detail, r, 'REJECT')}>
                            拒绝并恢复权益
                          </Button>
                          <Button type="primary" onClick={() => review(detail, r, 'APPROVE')}>
                            同意原路退款
                          </Button>
                        </>
                      )}
                      {r.state === 'FAILED' && access.canFinance && (
                        <Button onClick={() => review(detail, r, 'RETRY')}>重试原路退款</Button>
                      )}
                    </Space>
                  </Space>
                </Card>
              ))
            ) : (
              <Typography.Text type="secondary">暂无退款申请</Typography.Text>
            )}
          </>
        )}
      </Drawer>
      <Modal
        title={voucherView ? '调整会员赠券与权益' : '调整新售会员设置'}
        open={!!editing}
        confirmLoading={busy}
        onOk={() => void save()}
        onCancel={() => {
          if (busy) return;
          if (form.isFieldsTouched())
            modal.confirm({ title: '放弃未保存的等级设置？', onOk: () => setEditing(undefined) });
          else setEditing(undefined);
        }}
      >
        <Alert
          showIcon
          type="info"
          title="已有会员与已发代金券保持原购买约定"
          style={{ marginBottom: 20 }}
        />
        <Form form={form} layout="vertical" disabled={busy} requiredMark="optional">
          <Form.Item label="开通价格（元）" name="price" rules={[{ required: true }]}>
            <MoneyInput />
          </Form.Item>
          <Space wrap>
            <Form.Item label="生活馆实付比例" name="goodsPercent" rules={[{ required: true }]}>
              <InputNumber min={10} max={100} precision={2} addonAfter="%" />
            </Form.Item>
            <Form.Item label="图书实付比例" name="bookPercent" rules={[{ required: true }]}>
              <InputNumber min={10} max={100} precision={2} addonAfter="%" />
            </Form.Item>
          </Space>
          <Form.Item
            label="本档开通赠券总份数"
            name="voucherQuantity"
            rules={[{ required: true }]}
            extra="升级时只补与原档已购赠券额度的差额，已经使用的券不补回。"
          >
            <InputNumber min={0} max={100000} precision={0} addonAfter="份" />
          </Form.Item>
          <Form.Item label="开放新购买" name="active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            label="调整原因"
            name="reason"
            rules={[{ required: true, whitespace: true, min: 2, max: 500 }]}
          >
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={
          reviewing?.action === 'REJECT'
            ? '拒绝退款申请'
            : reviewing?.action === 'RETRY'
              ? '重试原路退款'
              : '确认原路退款'
        }
        open={!!reviewing}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setReviewing(undefined);
        }}
        onOk={() => void submitReview()}
      >
        <Typography.Paragraph>
          金额 {moneyText(reviewing?.refund.requestedAmount)}
          。退款确认成功后按原来源回收本次权益；升级退款恢复原等级，不撤销另行购买的券。
        </Typography.Paragraph>
        <Form form={reviewForm} layout="vertical" disabled={busy}>
          <Form.Item
            label="处理说明"
            name="reason"
            rules={[{ required: true, whitespace: true, min: 2, max: 500 }]}
          >
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
