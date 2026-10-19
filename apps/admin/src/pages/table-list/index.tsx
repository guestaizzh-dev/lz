import ArticleTemplatePreview,{articleTemplates} from './ArticleTemplatePreview';
import {ArticleBlockFields,ArticleMediaPreview} from './ArticleMedia';
import {formatChinaTime} from '@/utils/date-time';
// ProTable query/action pattern adapted from Ant Design Pro's table-list template.
import Editorial from './Editorial';
import { PlusOutlined } from '@ant-design/icons';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, App, Button, Descriptions, Divider, Drawer, Empty, Form, Input, Modal, Select, Space, Switch, Tag, Timeline, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import type { Article, Block } from '@/api';

const states: Record<string, { text: string; status: string }> = {
  DRAFT: { text: '草稿', status: 'Default' },
  REVIEW: { text: '待审核', status: 'Processing' },
  PUBLISHED: { text: '已发布', status: 'Success' },
  REJECTED: { text: '已驳回', status: 'Error' },
  ARCHIVED: { text: '已下架', status: 'Default' },
};
const actions: Record<string, string> = { submit: '提交审核', publish: '审核并发布', reject: '驳回文章', archive: '下架文章', revise: '开始修订' };
const categories = ['经典原文', '名师解读', '实践心得', '道学常识'];
type Draft = Pick<Article, 'title' | 'summary' | 'category' | 'author' | 'source' | 'cover' | 'visibility' | 'membershipTier' | 'featured' | 'tags' | 'blocks' | 'draftTemplateCode'>;
type Audit = { id: string; action: string; actorId: string; changes: unknown; createdAt: string };
const newBlock = (): Block => ({ id: 'p-' + crypto.randomUUID(), type: 'paragraph', text: '' });
const blank = (): Draft => ({ title: '', summary: '', category: '经典原文', author: '', source: '', cover: '/static/art/books.svg', visibility: 'PUBLIC', membershipTier: 1, featured: false, tags: [], draftTemplateCode:'PLAIN', blocks: [newBlock()] });
const required = [{ required: true, whitespace: true, message: '请填写此项' }];

export default function Articles() {
  const access = useAccess();
  const { message, modal } = App.useApp();
  const table = useRef<ActionType | undefined>(undefined);
  const [form] = Form.useForm<Draft>();
  const previewBlocks=Form.useWatch('blocks',form),previewTemplate=Form.useWatch('draftTemplateCode',form);
  const [editor, setEditor] = useState<{ item?: Article; read: boolean }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editorError, setEditorError] = useState('');
  const [transition, setTransition] = useState<{ item: Article; action: string }>();
  const [reason, setReason] = useState('');
  const [transitionError, setTransitionError] = useState('');
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [audit, setAudit] = useState<{ title: string; items: Audit[]; loading: boolean; error?: string }>();

  useEffect(()=>{const id=new URLSearchParams(window.location.search).get('articleId');if(id)api<Article>('/admin/articles/'+id).then(item=>edit(item,true)).catch(e=>setError(e.message));},[]);
  function edit(item?: Article, read = false) {
    form.resetFields();
    form.setFieldsValue(item ? { title: item.title, summary: item.summary, category: item.category, author: item.author, source: item.source, cover: item.cover, visibility: item.visibility, membershipTier: item.membershipTier, featured: item.featured, tags: [...item.tags], blocks: structuredClone(item.blocks),draftTemplateCode:articleTemplates.some(t=>t.value===item.draftTemplateCode)?item.draftTemplateCode:'PLAIN' } : blank());
    setEditorError(''); setEditor({ item, read });
  }
  function closeEditor() {
    if (saving) return;
    if (!editor?.read && form.isFieldsTouched()) modal.confirm({ title: '放弃尚未保存的修改？', content: '关闭后，未保存的内容不会写入草稿。', okText: '放弃修改', cancelText: '继续编辑', onOk: () => setEditor(undefined) });
    else setEditor(undefined);
  }
  async function save(values: Draft) {
    if (saving) return;
    setSaving(true); setEditorError('');
    try {
      const body = { ...values, title: values.title.trim(), author: values.author.trim(), source: values.source.trim(), cover: values.cover.trim(), tags: values.tags ?? [], blocks: values.blocks.map(block => ({ id:block.id,type:block.type,text:['paragraph','quote'].includes(block.type)?(block.text??'').trim():'',...(['audio','video'].includes(block.type)?{mediaId:block.mediaId}:block.type==='image'?{url:block.url}:{}),...(['audio','video','image'].includes(block.type)?{caption:block.caption}:{} ) })) };
      await api(editor?.item ? '/admin/articles/' + editor.item.id : '/admin/articles', editor?.item ? 'PATCH' : 'POST', { ...body, ...(editor?.item ? { expectedVersion: editor.item.version } : {}) });
      setEditor(undefined); message.success('草稿已保存'); table.current?.reload();
    } catch (e) { setEditorError((e as Error).message); }
    finally { setSaving(false); }
  }
  function startTransition(item: Article, action: string) { setReason(''); setTransitionError(''); setTransition({ item, action }); }
  async function confirmTransition() {
    if (!transition || transitionBusy) return;
    if (!reason.trim()) { setTransitionError('请填写操作原因'); return; }
    setTransitionBusy(true); setTransitionError('');
    try {
      await api('/admin/articles/' + transition.item.id + '/transition', 'POST', { action: transition.action, reason: reason.trim(), expectedVersion: transition.item.version });
      setTransition(undefined); message.success('文章状态已更新'); table.current?.reload();
    } catch (e) { setTransitionError((e as Error).message); }
    finally { setTransitionBusy(false); }
  }
  async function showAudit(item: Article) {
    setAudit({ title: item.title, items: [], loading: true });
    try { const items = await api<Audit[]>('/admin/articles/' + item.id + '/audit'); setAudit({ title: item.title, items, loading: false }); }
    catch (e) { setAudit({ title: item.title, items: [], loading: false, error: (e as Error).message }); }
  }

  const columns: ProColumns<Article>[] = [
    { title: '文章标题', dataIndex: 'title', width: 290, fieldProps: { placeholder: '搜索文章标题', maxLength: 80 }, render: (_, item) => <div className="article-title"><Button type="link" style={{ padding: 0, whiteSpace: 'normal', height: 'auto', textAlign: 'left' }} onClick={() => edit(item, true)}>{item.title}</Button><Space><Typography.Text type="secondary">{item.author}</Typography.Text>{item.isDemo && <Tag>示例</Tag>}</Space></div> },
    { title: '分类', dataIndex: 'category', width: 120, search: false },
    { title: '可见范围', dataIndex: 'visibility', width: 120, search: false, renderText: value => value === 'MEMBER' ? '会员专享' : '公开阅读' },
    { title: '状态', dataIndex: 'status', width: 115, valueEnum: states, fieldProps: { placeholder: '全部状态' } },
    { title: '更新时间', dataIndex: 'updatedAt', valueType: 'dateTime', render: (_,row)=>formatChinaTime(row.updatedAt), width: 170, search: false },
    { title: '操作', valueType: 'option', width: 280, fixed: 'right', render: (_, item) => [
      <Button type="link" size="small" key="view" onClick={() => edit(item, true)}>查看</Button>,
      ...(access.canContentEdit && ['DRAFT', 'REJECTED'].includes(item.status) ? [<Button type="link" size="small" key="edit" onClick={() => edit(item)}>编辑</Button>, <Button type="link" size="small" key="submit" onClick={() => startTransition(item, 'submit')}>提交审核</Button>] : []),
      ...(access.canContentReview && item.status === 'REVIEW' ? [<Button type="link" size="small" key="publish" onClick={() => startTransition(item, 'publish')}>发布</Button>, <Button type="link" danger size="small" key="reject" onClick={() => startTransition(item, 'reject')}>驳回</Button>] : []),
      ...(access.canContentEdit && item.status === 'PUBLISHED' ? [<Button type="link" danger size="small" key="archive" onClick={() => startTransition(item, 'archive')}>下架</Button>] : []),
      ...(access.canContentEdit && item.status === 'ARCHIVED' ? [<Button type="link" size="small" key="revise" onClick={() => startTransition(item, 'revise')}>修订</Button>] : []),
      <Button type="link" size="small" key="audit" onClick={() => showAudit(item)}>记录</Button>,
    ] },
  ];

  return <PageContainer title="文章与经典" subTitle="编辑、审核和维护书院内容">
    {error && <Alert title="文章列表加载失败" description={error} type="error" showIcon style={{ marginBottom: 16 }} action={<Button size="small" onClick={() => table.current?.reload()}>重试</Button>} />}
    <ProTable<Article> actionRef={table} rowKey="id" headerTitle="内容列表" columns={columns} scroll={{ x: 1200 }}
      search={{ labelWidth: 'auto', defaultCollapsed: false }}
      form={{ initialValues: { title: new URLSearchParams(window.location.search).get('q') || undefined, status: new URLSearchParams(window.location.search).get('status') || undefined } }}
      pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }}
      options={{ density: true, fullScreen: true, reload: true, setting: true }}
      request={async params => {
        setError('');
        try {
          const query = new URLSearchParams({ page: String(params.current ?? 1), size: String(Math.min(params.pageSize ?? 20, 50)) });
          if (params.title?.trim()) query.set('q', params.title.trim());
          if (params.status) query.set('status', params.status);
          const result = await api<{ items: Article[]; total: number }>('/admin/articles?' + query);
          return { data: result.items, total: result.total, success: true };
        } catch (e) { setError((e as Error).message); return { data: [], total: 0, success: false }; }
      }}
      toolBarRender={() => access.canContentEdit ? [<Button key="create" type="primary" icon={<PlusOutlined />} onClick={() => edit()}>新建文章</Button>] : []}
    />
    <Drawer open={!!editor} size={820} title={editor?.read ? '查看文章' : editor?.item ? '编辑草稿' : '新建文章'} onClose={closeEditor} mask={{ closable: !saving }} keyboard={!saving} extra={<Space><Button onClick={closeEditor}>{editor?.read ? '关闭' : '取消'}</Button>{!editor?.read && <Button type="primary" loading={saving} onClick={() => form.submit()}>保存草稿</Button>}</Space>}>
      {editor?.read && editor.item ? <>
        <Typography.Title level={3}>{editor.item.title}</Typography.Title>
        <Descriptions column={1} bordered items={[
          { key: 'category', label: '分类', children: editor.item.category }, { key: 'status', label: '状态', children: states[editor.item.status]?.text },
          { key: 'author', label: '作者', children: editor.item.author }, { key: 'source', label: '来源 / 版本', children: editor.item.source },
          { key: 'visibility', label: '可见范围', children: editor.item.visibility === 'MEMBER' ? '会员专享' : '公开阅读' },
          { key: 'tags', label: '标签', children: editor.item.tags.join('、') || '—' }, { key: 'version', label: '版本', children: editor.item.version },
        ]} />
        <Divider titlePlacement="start">摘要</Divider><Typography.Paragraph>{editor.item.summary}</Typography.Paragraph>
        <Divider titlePlacement="start">阅读版式</Divider><ArticleTemplatePreview blocks={editor.item.blocks} templateCode={editor.item.draftTemplateCode}/><Divider titlePlacement="start">正文</Divider>{editor.item.blocks.map(block => ['audio','video'].includes(block.type) ? <ArticleMediaPreview key={block.id} articleId={editor.item!.id} block={block}/> : block.type === 'image' ? <div key={block.id}><img src={block.url} alt={block.caption??''} style={{maxWidth:'100%'}}/><Typography.Paragraph>{block.caption}</Typography.Paragraph></div> : <Typography.Paragraph key={block.id} className={'article-body ' + (block.type === 'quote' ? 'article-quote' : '')}>{block.text}</Typography.Paragraph>)}
        <Divider titlePlacement="start">来源证据与研习引导</Divider><Editorial articleId={editor.item.id}/>
      </> : <Form name="article-editor" form={form} layout="vertical" onFinish={save} disabled={saving}>
        {editorError && <Alert showIcon type="error" title={editorError} style={{ marginBottom: 24 }} />}
        <Form.Item name="title" label="标题" rules={required}><Input maxLength={120} showCount /></Form.Item>
        <Space align="start" style={{ width: '100%' }}><Form.Item name="category" label="内容分类" rules={required}><Select style={{ width: 220 }} options={categories.map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="visibility" label="阅读权限" rules={required}><Select style={{ width: 220 }} options={[{ value: 'PUBLIC', label: '公开阅读' }, { value: 'MEMBER', label: '会员专享' }]} /></Form.Item></Space>
        <Form.Item name="membershipTier" label="会员最低层级（会员专享生效）" rules={[{required:true}]}><Select style={{width:220}} options={[{value:1,label:'入门及以上'},{value:2,label:'进阶及以上'},{value:3,label:'至尊'}]} /></Form.Item>
        <Form.Item name="summary" label="摘要" rules={required}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
        <Form.Item name="author" label="作者" rules={required}><Input maxLength={100} /></Form.Item>
        <Form.Item name="source" label="来源 / 版本 / 授权说明" rules={required}><Input maxLength={500} /></Form.Item>
        <Form.Item name="cover" label="封面地址" extra="填写HTTPS图片地址，或已有书院素材路径。" rules={[...required, { pattern: /^(https:\/\/[^\s]+|\/static\/art\/[a-z-]+\.svg)$/, message: '请填写HTTPS地址或已有书院素材路径' }]}><Input /></Form.Item>
        <Form.Item name="tags" label="标签" rules={[{ validator: (_, value: string[] = []) => value.some(tag => !tag.trim() || tag.length > 30) || value.length > 10 ? Promise.reject(new Error('最多10个标签，每个1—30字')) : Promise.resolve() }]}><Select mode="tags" maxCount={10} placeholder="输入标签后按回车" /></Form.Item>
        <Form.Item name="featured" label="首页推荐" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="draftTemplateCode" label="文章排版模板" extra="仅调整本文的段落留白和引用样式；随文章审核发布。选「清简」可恢复默认。" rules={[{required:true}]}><Select options={articleTemplates}/></Form.Item><ArticleTemplatePreview blocks={previewBlocks??[]} templateCode={previewTemplate}/><Divider titlePlacement="start">正文段落</Divider>
        <Form.List name="blocks">{(fields, { add, remove, move }) => <>
          {fields.map((field, index) => <div key={field.key}>
            <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
            <Space style={{ justifyContent: 'space-between', width: '100%' }}><Typography.Text strong>第{index + 1}段</Typography.Text><Space><Button type="text" disabled={index===0} onClick={()=>move(index,index-1)}>上移</Button><Button type="text" disabled={index===fields.length-1} onClick={()=>move(index,index+1)}>下移</Button></Space><Button danger type="text" disabled={fields.length === 1} onClick={() => remove(field.name)}>删除段落</Button></Space>
            <Form.Item name={[field.name, 'type']} label="段落类型"><Select options={[{ value: 'paragraph', label: '正文' }, { value: 'quote', label: '经典引用' }, { value: 'image', label: '图片' }, { value: 'audio', label: '音频' }, { value: 'video', label: '视频' }]} /></Form.Item>
            <ArticleBlockFields form={form} name={field.name}/>
            <Divider />
          </div>)}
          <Button type="dashed" block icon={<PlusOutlined />} disabled={fields.length >= 100} onClick={() => add(newBlock())}>添加段落</Button>
        </>}</Form.List>
      </Form>}
    </Drawer>
    <Modal open={!!transition} title={transition ? actions[transition.action] : ''} onCancel={() => { if (!transitionBusy) setTransition(undefined); }} onOk={confirmTransition} confirmLoading={transitionBusy} mask={{ closable: !transitionBusy }} keyboard={!transitionBusy} cancelButtonProps={{ disabled: transitionBusy }} okText="确认操作" cancelText="取消">
      <Typography.Paragraph>{transition?.item.title}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">操作原因会写入文章记录。</Typography.Paragraph>
      <Input.TextArea aria-label="操作原因" value={reason} maxLength={500} rows={3} showCount disabled={transitionBusy} onChange={event => { setReason(event.target.value); setTransitionError(''); }} placeholder="请填写操作原因" />
      {transitionError && <Alert type="error" title={transitionError} showIcon style={{ marginTop: 16 }} />}
    </Modal>
    <Drawer open={!!audit} title="文章操作记录" size={620} onClose={() => setAudit(undefined)} loading={audit?.loading}>
      <Typography.Title level={5}>{audit?.title}</Typography.Title>
      {audit?.error ? <Alert type="error" showIcon title={audit.error} /> : audit?.items.length === 0 ? <Empty description="暂无操作记录" /> : <Timeline items={audit?.items.map(record => ({ key: record.id, content: <><Typography.Text strong>{actions[record.action.replace('article.', '')] ?? ({ 'article.create': '创建草稿', 'article.edit': '编辑草稿' }[record.action] || record.action)}</Typography.Text><Typography.Paragraph type="secondary">{formatChinaTime(record.createdAt)}</Typography.Paragraph><Typography.Paragraph type="secondary">操作人：{record.actorId}</Typography.Paragraph><pre className="audit-json">{JSON.stringify(record.changes, null, 2)}</pre></> }))} />}
    </Drawer>
  </PageContainer>;
}

