import { PageContainer, ProTable, type ActionType } from '@ant-design/pro-components';
import { useEffect, useRef, useState } from 'react';
import { useAccess, history } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Tag,
} from 'antd';
import { api } from '@/api';
import MoneyInput from '@/components/MoneyInput';
import { moneyText } from '@/utils/money';
import { formatChinaTime } from '@/utils/date-time';
import MemberCenter from './MemberCenter';
type Policy = { title: string; price: number; faceValue: number; active: boolean; version: number };
type Lot = {
  id: string;
  orderId: string;
  nickname: string;
  source: string;
  quantity: number;
  remaining: number;
  held: number;
  used: number;
  refunded: number;
  refundHeld: number;
  unitPrice: number;
  faceValue: number;
  suspended: boolean;
  createdAt: string;
};
type Result = { policy: Policy; lots: { items: Lot[]; total: number } };
export default function VideoVouchers() {
  const access = useAccess(),
    { message } = App.useApp(),
    [form] = Form.useForm(),
    table = useRef<ActionType>(undefined);
  const [policy, setPolicy] = useState<Policy>(),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false);
  async function load() {
    try {
      const r = await api<Result>('/admin/membership-center/voucher-settings');
      setPolicy(r.policy);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    if (!policy || saving) return;
    try {
      const v = await form.validateFields();
      setSaving(true);
      await api('/admin/membership-center/voucher-settings', 'PUT', {
        ...v,
        expectedVersion: policy.version,
      });
      setOpen(false);
      await load();
      table.current?.reload();
      message.success('已保存，后续新发券使用新设置');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <PageContainer title="视频代金券" subTitle="售价、抵扣面额、发放批次与退款">
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        {error && (
          <Alert type="error" title={error} action={<Button onClick={load}>重试</Button>} />
        )}
        <Card
          title="代金券设置"
          extra={
            access.canAdmin && (
              <Button
                type="primary"
                disabled={!policy}
                onClick={() => {
                  form.setFieldsValue(policy);
                  form.setFieldValue('reason', '');
                  setOpen(true);
                }}
              >
                编辑代金券
              </Button>
            )
          }
        >
          {policy && (
            <Descriptions
              items={[
                { key: 'title', label: '名称', children: policy.title },
                { key: 'price', label: '单份售价', children: moneyText(String(policy.price)) },
                { key: 'value', label: '每份抵扣', children: moneyText(String(policy.faceValue)) },
                {
                  key: 'active',
                  label: '单独购买',
                  children: (
                    <Tag color={policy.active ? 'success' : 'default'}>
                      {policy.active ? '在售' : '停售'}
                    </Tag>
                  ),
                },
                { key: 'valid', label: '有效期', children: '长期有效' },
                { key: 'scope', label: '适用范围', children: '付费视频课件' },
              ]}
            />
          )}
          <Alert
            type="info"
            title="售价与抵扣面额分别设置，已发券保留发放时的面额；退款按原购券实付价格。会员赠券数量在会员权益设置。"
          />
          <Button type="link" onClick={() => history.push('/memberships')}>
            设置会员赠券数量
          </Button>
        </Card>
        <ProTable<Lot>
          headerTitle="已发代金券"
          rowKey="id"
          actionRef={table}
          search={false}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1050 }}
          request={async (p) => {
            try {
              const r = await api<Result>(
                '/admin/membership-center/voucher-settings?page=' +
                  (p.current ?? 1) +
                  '&size=' +
                  (p.pageSize ?? 20),
              );
              return { data: r.lots.items, total: r.lots.total, success: true };
            } catch (e) {
              setError((e as Error).message);
              return { data: [], success: false };
            }
          }}
          columns={[
            { title: '用户', dataIndex: 'nickname' },
            {
              title: '来源',
              render: (_, r) => (r.source === 'MEMBERSHIP' ? '会员赠送' : '单独购买'),
            },
            { title: '单份实付', render: (_, r) => moneyText(String(r.unitPrice)) },
            { title: '抵扣面额', render: (_, r) => moneyText(String(r.faceValue)) },
            { title: '发放', dataIndex: 'quantity' },
            { title: '可用', dataIndex: 'remaining' },
            { title: '已用', dataIndex: 'used' },
            { title: '占用', render: (_, r) => r.held + r.refundHeld },
            { title: '已退', dataIndex: 'refunded' },
            { title: '状态', render: (_, r) => (r.suspended ? '暂停' : '有效') },
            { title: '发放时间', render: (_, r) => formatChinaTime(r.createdAt) },
            {
              title: '操作',
              render: (_, r) => (
                <Button
                  type="link"
                  onClick={() => history.push('/video-vouchers?orderId=' + r.orderId)}
                >
                  来源订单
                </Button>
              ),
            },
          ]}
        />
        <MemberCenter voucherView />
      </Space>
      <Modal
        title="编辑视频代金券"
        open={open}
        onCancel={() => !saving && setOpen(false)}
        onOk={() => void save()}
        confirmLoading={saving}
      >
        <Form form={form} layout="vertical" disabled={saving}>
          <Form.Item
            label="名称"
            name="title"
            rules={[{ required: true, whitespace: true, max: 40 }]}
          >
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item label="单份售价（元）" name="price" rules={[{ required: true }]}>
            <MoneyInput />
          </Form.Item>
          <Form.Item label="单份抵扣面额（元）" name="faceValue" rules={[{ required: true }]}>
            <MoneyInput />
          </Form.Item>
          <Form.Item label="开放单独购买" name="active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            label="修改原因"
            name="reason"
            rules={[{ required: true, whitespace: true, min: 2, max: 500 }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
        <Alert
          type="info"
          title="仅影响后续发放和购买，不改变用户已有代金券。停售不影响已发券使用或会员赠券。"
        />
      </Modal>
    </PageContainer>
  );
}
