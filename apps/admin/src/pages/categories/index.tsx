import { api } from '@/api';
import { PageContainer } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
type Category = { id: string; code: string; label: string; scope: string; position: number; enabled: boolean; version: number; count: number };
export default function Categories() {
  const { message } = App.useApp(), access = useAccess(), [form] = Form.useForm();
  const [scope, setScope] = useState('COURSE'), [items, setItems] = useState<Category[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [editor, setEditor] = useState<Category | null | undefined>();
  const canWrite = access.canConfigWrite;
  async function load() { setLoading(true); try { setItems(await api('/admin/categories?scope=' + scope)); setError(''); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }
  useEffect(() => { let active = true; setLoading(true); void api<Category[]>('/admin/categories?scope=' + scope).then(rows => { if (active) { setItems(rows); setError(''); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [scope]);
  function edit(row?: Category) { form.resetFields(); form.setFieldsValue(row ?? { label: '', enabled: true, position: (items.at(-1)?.position ?? 0) + 10 }); setEditor(row ?? null); }
  async function save() {
    const values = await form.validateFields(); setBusy(true);
    try { await api('/admin/categories' + (editor ? '/' + editor.id : ''), editor ? 'PATCH' : 'POST', { ...values, scope, ...(editor ? { expectedVersion: editor.version } : {}) }); setEditor(undefined); await load(); message.success('分类已保存'); } catch (e) { message.error((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(row: Category) { try { await api('/admin/categories/' + row.id, 'DELETE'); await load(); message.success('分类已删除'); } catch (e) { message.error((e as Error).message); } }
  return <PageContainer title="分类管理" subTitle="调整分类名称、显示顺序与可选状态，App按相同配置展示。">
    {error && <Alert title={error} type="error" action={<Button onClick={load}>重试</Button>} style={{ marginBottom: 16 }} />}
    <Tabs activeKey={scope} onChange={setScope} items={[['COURSE', '课程'], ['ARTICLE', '文章'], ['PRODUCT', '商品'], ['EVENT', '活动']].map(([key, label]) => ({ key, label }))} tabBarExtraContent={canWrite && <Button type="primary" onClick={() => edit()}>新增分类</Button>} />
    <Table<Category> rowKey="id" dataSource={items} loading={loading} pagination={{ pageSize: 20 }} columns={[
      { title: '分类名称', dataIndex: 'label' }, { title: '顺序', dataIndex: 'position', width: 90, sorter: (a, b) => a.position - b.position }, { title: '内容数量', dataIndex: 'count', width: 110 },
      { title: '状态', render: (_, row) => <Tag color={row.enabled ? 'green' : undefined}>{row.enabled ? '启用' : '停用'}</Tag>, width: 90 },
      { title: '操作', render: (_, row) => canWrite && <Space><Button type="link" onClick={() => edit(row)}>编辑</Button><Popconfirm title="删除这个空分类？" description="已有内容的分类请先调整归类，或选择停用。" onConfirm={() => remove(row)}><Button type="link" danger disabled={row.count > 0}>删除</Button></Popconfirm></Space> },
    ]} />
    <Typography.Paragraph type="secondary">顺序数字越小越靠前。停用后不再供新内容选择，既有内容保留。改名不会改变订单、已售课程版本或会员权益。</Typography.Paragraph>
    <Modal title={editor ? '编辑分类' : '新增分类'} open={editor !== undefined} onCancel={() => { if (!busy) setEditor(undefined); }} onOk={save} confirmLoading={busy}>
      <Form form={form} layout="vertical" disabled={busy}><Form.Item name="label" label="分类名称" rules={[{ required: true, whitespace: true, max: 40 }]}><Input maxLength={40} /></Form.Item><Form.Item name="position" label="显示顺序" rules={[{ required: true }]}><InputNumber min={0} max={9999} /></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item></Form>
    </Modal>
  </PageContainer>;
}
