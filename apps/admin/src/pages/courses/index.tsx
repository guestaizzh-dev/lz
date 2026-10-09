import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Tabs, Typography, Upload } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useRef, useState } from 'react';
import { api } from '@/api';

type Teacher = { id: string; version: number; name: string; title: string; bio: string; portrait: string | null; expertise: string[]; status: string };
type Chapter = { title: string; format: string; body: string; mediaId: string | null; durationSeconds: number; trial: boolean; required: boolean };
type Course = { id: string; version: number; title: string; subtitle: string; description: string; category: string; format: string; price: number; cover: string; teacherId: string; teacher?: Teacher; membershipTier: number | null; accessDays: number | null; refundPolicy: string; tags: string[]; featured: boolean; chapters: Chapter[]; status: string; updatedAt: string; chaptersCount: number };
type Asset = { id: string; name: string; mime: string; bytes: number };
type Audit = { id: string; action: string; changes: unknown; createdAt: string };
const states = { DRAFT: { text: '草稿', status: 'Default' }, REVIEW: { text: '待审核', status: 'Processing' }, PUBLISHED: { text: '已发布', status: 'Success' }, REJECTED: { text: '已驳回', status: 'Error' }, ARCHIVED: { text: '已下架', status: 'Default' } };
const labels: Record<string, string> = { submit: '提交审核', publish: '审核发布', reject: '驳回', archive: '下架', revise: '修订' };
const formats = [{ value: 'VIDEO', label: '视频课' }, { value: 'AUDIO', label: '音频课' }];
const required = [{ required: true, message: '请填写此项' }];
const blankChapter = (): Chapter => ({ title: '', format: 'TEXT', body: '', mediaId: null, durationSeconds: 0, trial: false, required: true });
const blankCourse = () => ({ title: '', subtitle: '', description: '', category: '经典研习', format: 'VIDEO', cover: '/static/art/books.svg', price: 0, teacherId: undefined, membershipTier: null, accessDays: null, refundPolicy: '未开始学习可申请退款，具体以订单售前规则为准', tags: [], featured: false, chapters: [blankChapter()] });

export default function Courses() {
  const access = useAccess(), { message } = App.useApp(), table = useRef<ActionType | undefined>(undefined), teacherTable = useRef<ActionType | undefined>(undefined);
  const [form] = Form.useForm(), [teacherForm] = Form.useForm();
  const [editor, setEditor] = useState<{ item?: Course; read: boolean }>(), [teacherEditor, setTeacherEditor] = useState<Teacher | null | undefined>();
  const [teachers, setTeachers] = useState<Teacher[]>([]), [assets, setAssets] = useState<Asset[]>([]), [error, setError] = useState(''), [editError, setEditError] = useState(''), [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{ kind: string; item: Course | Teacher; verb: string }>(), [reason, setReason] = useState(''), [actionError, setActionError] = useState('');
  const [audit, setAudit] = useState<Audit[] | null>(null);
  async function edit(item?: Course, read = false) {
    setError('');
    try {
      const [roster, media, detail] = await Promise.all([api<Teacher[]>('/admin/teachers'), api<Asset[]>('/admin/media'), item ? api<Course>('/admin/courses/' + item.id) : Promise.resolve(undefined)]);
      setTeachers(roster); setAssets(media); form.resetFields(); form.setFieldsValue(detail ? { ...detail, chapters: detail.chapters.map(c => ({ title: c.title, format: c.format, body: c.body, mediaId: c.mediaId, durationSeconds: c.durationSeconds, trial: c.trial, required: c.required })) } : blankCourse());
      setEditError(''); setEditor({ item: detail, read });
    } catch (e) { setError((e as Error).message); }
  }
  async function save(values: ReturnType<typeof blankCourse>) {
    if (busy) return; setBusy(true); setEditError('');
    try {
      const fields = ['title','subtitle','description','category','format','cover','price','teacherId','membershipTier','accessDays','refundPolicy','tags','featured','chapters'] as const;
      const body = Object.fromEntries(fields.map(key => [key, values[key]]));
      await api(editor?.item ? '/admin/courses/' + editor.item.id : '/admin/courses', editor?.item ? 'PATCH' : 'POST', { ...body, ...(editor?.item ? { expectedVersion: editor.item.version } : {}) });
      setEditor(undefined); message.success('课程草稿已保存'); table.current?.reload();
    } catch (e) { setEditError((e as Error).message); } finally { setBusy(false); }
  }
  function begin(kind: string, item: Course | Teacher, verb: string) { setAction({ kind, item, verb }); setReason(''); setActionError(''); }
  async function transition() {
    if (!action || busy) return; if (!reason.trim()) { setActionError('请填写原因'); return; } setBusy(true);
    try { await api(`/admin/${action.kind}/${action.item.id}/transition`, 'POST', { action: action.verb, reason, expectedVersion: action.item.version }); setAction(undefined); table.current?.reload(); teacherTable.current?.reload(); message.success('状态已更新'); } catch (e) { setActionError((e as Error).message); } finally { setBusy(false); }
  }
  function controls(kind: string, item: Course | Teacher) {
    const verbs = access.canEdit && ['DRAFT','REJECTED'].includes(item.status) ? ['submit'] : access.canReview && item.status === 'REVIEW' ? ['publish','reject'] : access.canEdit && item.status === 'PUBLISHED' ? ['archive'] : access.canEdit && item.status === 'ARCHIVED' ? ['revise'] : [];
    return verbs.map(verb => <Button type="link" size="small" key={verb} danger={verb === 'archive' || verb === 'reject'} onClick={() => begin(kind, item, verb)}>{labels[verb]}</Button>);
  }
  function editTeacher(item?: Teacher) { teacherForm.resetFields(); teacherForm.setFieldsValue(item ? { name: item.name, title: item.title, bio: item.bio, portrait: item.portrait, expertise: item.expertise } : { name: '', title: '', bio: '', portrait: null, expertise: [] }); setEditError(''); setTeacherEditor(item ?? null); }
  async function saveTeacher(values: Teacher) {
    if (busy) return; setBusy(true);
    try { await api(teacherEditor ? '/admin/teachers/' + teacherEditor.id : '/admin/teachers', teacherEditor ? 'PATCH' : 'POST', { ...values, portrait: values.portrait || null, ...(teacherEditor ? { expectedVersion: teacherEditor.version } : {}) }); setTeacherEditor(undefined); teacherTable.current?.reload(); message.success('名师草稿已保存'); } catch (e) { setEditError((e as Error).message); } finally { setBusy(false); }
  }
  const columns: ProColumns<Course>[] = [
    { title: '课程', dataIndex: 'title', render: (_, item) => <Button type="link" onClick={() => edit(item, true)}>{item.title}</Button> },
    { title: '名师', dataIndex: ['teacher','name'], search: false },
    { title: '价格', dataIndex: 'price', search: false, renderText: value => '¥' + (value / 100).toFixed(2) },
    { title: '章节', dataIndex: 'chaptersCount', search: false },
    { title: '状态', dataIndex: 'status', valueEnum: states },
    { title: '更新时间', dataIndex: 'updatedAt', valueType: 'dateTime', search: false },
    { title: '操作', valueType: 'option', width: 290, render: (_, item) => [<Button key="view" type="link" onClick={() => edit(item, true)}>查看章节</Button>, ...(access.canEdit && ['DRAFT','REJECTED'].includes(item.status) ? [<Button key="edit" type="link" onClick={() => edit(item)}>编辑</Button>] : []), ...controls('courses', item), <Button key="audit" type="link" onClick={async () => { try { setAudit(await api<Audit[]>('/admin/courses/' + item.id + '/audit')); } catch (e) { setError((e as Error).message); } }}>记录</Button>] },
  ];
  return <PageContainer title="课程与研习" subTitle="名师审核、章节编辑与版本交付">
    {error && <Alert type="error" showIcon title={error} closable onClose={() => setError('')} />}
    <Tabs items={[
      { key: 'courses', label: '课程', children: <ProTable<Course> rowKey="id" actionRef={table} columns={columns} scroll={{ x: 1100 }} pagination={{ pageSize: 20 }} request={async params => { try { const query = new URLSearchParams({ page: String(params.current ?? 1), size: String(params.pageSize ?? 20) }); if (params.title) query.set('q', params.title); if (params.status) query.set('status', params.status); const result = await api<{items: Course[];total:number}>('/admin/courses?' + query); return { data: result.items, total: result.total, success: true }; } catch (e) { setError((e as Error).message); return { data: [], success: false }; } }} toolBarRender={() => access.canEdit ? [<Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => edit()}>新建课程</Button>] : []} /> },
      { key: 'teachers', label: '名师', children: <ProTable<Teacher> rowKey="id" actionRef={teacherTable} search={false} columns={[{title:'姓名',dataIndex:'name'},{title:'职称 / 方向',dataIndex:'title'},{title:'简介',dataIndex:'bio',ellipsis:true},{title:'状态',dataIndex:'status',valueEnum:states},{title:'操作',valueType:'option',render:(_,item)=>[...(access.canEdit && ['DRAFT','REJECTED'].includes(item.status) ? [<Button type="link" key="edit" onClick={()=>editTeacher(item)}>编辑</Button>] : []),...controls('teachers',item)]}]} request={async()=>{try{return {data:await api<Teacher[]>('/admin/teachers'),success:true};}catch(e){setError((e as Error).message);return {data:[],success:false};}}} toolBarRender={()=>access.canEdit?[<Button key="new" type="primary" onClick={()=>editTeacher()}>新建名师</Button>]:[]} /> },
    ]} />
    <Drawer open={!!editor} size={850} title={editor?.read?'课程与章节':'课程草稿'} onClose={()=>{if(!busy)setEditor(undefined);}} extra={!editor?.read&&<Button type="primary" loading={busy} onClick={()=>form.submit()}>保存草稿</Button>}>
      {editError&&<Alert type="error" showIcon title={editError} />}
      <Form name="course-editor" form={form} layout="vertical" onFinish={save} disabled={busy||editor?.read}>
        <Form.Item name="title" label="课程标题" rules={required}><Input maxLength={120}/></Form.Item>
        <Form.Item name="subtitle" label="副标题" rules={required}><Input maxLength={500}/></Form.Item>
        <Form.Item name="description" label="课程介绍" rules={required}><Input.TextArea rows={4} maxLength={10000}/></Form.Item>
        <Space align="start"><Form.Item name="category" label="分类" rules={required}><Select style={{width:150}} options={['经典研习','实践修行','生活应用','少儿启蒙'].map(value=>({value,label:value}))}/></Form.Item><Form.Item name="format" label="授课方式"><Select style={{width:150}} options={formats}/></Form.Item><Form.Item name="teacherId" label="名师" rules={required}><Select style={{width:260}} showSearch optionFilterProp="label" options={teachers.map(t=>({value:t.id,label:t.name+'（'+states[t.status as keyof typeof states].text+'）'}))}/></Form.Item></Space>
        <Form.Item name="cover" label="封面 HTTPS 地址或内置图片" rules={required}><Input/></Form.Item>
        <Space align="start"><Form.Item name="price" label="价格（分）" rules={required}><InputNumber min={0} max={100000000}/></Form.Item><Form.Item name="membershipTier" label="会员课程层级"><Select allowClear style={{width:180}} options={[{value:1,label:'入门及以上'},{value:2,label:'进阶及以上'},{value:3,label:'至尊'}]} onClear={()=>form.setFieldValue('membershipTier',null)}/></Form.Item><Form.Item name="accessDays" label="独立购课有效天数（空为长期）"><InputNumber min={1} max={3650}/></Form.Item></Space>
        <Form.Item name="refundPolicy" label="售前退课规则" rules={required}><Input.TextArea maxLength={1000}/></Form.Item><Form.Item name="tags" label="标签"><Select mode="tags"/></Form.Item><Form.Item name="featured" label="首页推荐" valuePropName="checked"><Switch/></Form.Item>
        <Typography.Title level={5}>章节目录</Typography.Title>
        {!editor?.read&&access.canEdit&&<Upload showUploadList={false} accept="video/mp4,audio/mpeg,audio/mp4,audio/wav,.m4a,.wav" customRequest={async options=>{try{const data=new FormData();data.append('file',options.file as File);await api('/admin/media','POST',data);setAssets(await api<Asset[]>('/admin/media'));options.onSuccess?.({});message.success('媒体已上传，可在章节中选择');}catch(e){options.onError?.(e as Error);setEditError((e as Error).message);}}}><Button icon={<UploadOutlined/>}>上传媒体（100 MB以内）</Button></Upload>}
        <Form.List name="chapters">{(fields,{add,remove,move})=><>{fields.map((field,index)=><div key={field.key} style={{padding:16,marginTop:16,border:'1px solid #e8e8e8',borderRadius:6}}><Space style={{width:'100%',justifyContent:'space-between'}}><Typography.Text strong>第{index+1}章</Typography.Text>{!editor?.read&&<Space><Button disabled={busy||index===0} onClick={()=>move(index,index-1)}>上移</Button><Button danger onClick={()=>remove(field.name)}>删除</Button></Space>}</Space><Form.Item name={[field.name,'title']} label="章节名称" rules={required}><Input maxLength={120}/></Form.Item><Form.Item name={[field.name,'format']} label="章节内容"><Select options={[{value:'TEXT',label:'图文'},{value:'VIDEO',label:'视频'},{value:'AUDIO',label:'音频'}]}/></Form.Item><Form.Item name={[field.name,'body']} label="正文 / 研习提示"><Input.TextArea rows={4} maxLength={50000}/></Form.Item><Form.Item name={[field.name,'mediaId']} label="音视频媒体（图文章节无需选择）"><Select allowClear options={assets.map(a=>({value:a.id,label:a.name+' · '+a.mime}))}/></Form.Item><Form.Item name={[field.name,'durationSeconds']} label="媒体时长（秒）"><InputNumber min={0} max={86400}/></Form.Item><Space><Form.Item name={[field.name,'trial']} label="允许试听" valuePropName="checked"><Switch/></Form.Item><Form.Item name={[field.name,'required']} label="必修章节" valuePropName="checked"><Switch/></Form.Item></Space></div>)}{!editor?.read&&<Button block type="dashed" style={{marginTop:16}} disabled={fields.length>=100} onClick={()=>add(blankChapter())}>添加章节</Button>}</>}</Form.List>
      </Form>
    </Drawer>
    <Drawer open={teacherEditor!==undefined} size={620} title="名师草稿" onClose={()=>{if(!busy)setTeacherEditor(undefined);}} extra={<Button type="primary" loading={busy} onClick={()=>teacherForm.submit()}>保存</Button>}>
      {editError&&<Alert title={editError} type="error"/>}<Form name="teacher-editor" form={teacherForm} layout="vertical" disabled={busy} onFinish={saveTeacher}><Form.Item name="name" label="姓名" rules={required}><Input maxLength={100}/></Form.Item><Form.Item name="title" label="职称 / 授课方向" rules={required}><Input maxLength={200}/></Form.Item><Form.Item name="bio" label="已核实的简介与背景" rules={required}><Input.TextArea rows={6} maxLength={10000}/></Form.Item><Form.Item name="portrait" label="头像 HTTPS 地址"><Input/></Form.Item><Form.Item name="expertise" label="研究方向"><Select mode="tags"/></Form.Item></Form>
    </Drawer>
    <Modal open={!!action} title={action?labels[action.verb]:''} onCancel={()=>{if(!busy)setAction(undefined);}} onOk={transition} confirmLoading={busy}><Typography.Paragraph>{action&&('name' in action.item?action.item.name:action.item.title)}</Typography.Paragraph><Input.TextArea placeholder="操作原因（写入审计）" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/>{actionError&&<Alert title={actionError} type="error"/>}</Modal>
    <Drawer open={audit!==null} size={620} title="课程操作记录" onClose={()=>setAudit(null)}>{audit?.map(row=><div key={row.id}><Typography.Text strong>{row.action}</Typography.Text><Typography.Paragraph type="secondary">{new Date(row.createdAt).toLocaleString('zh-CN')}</Typography.Paragraph><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(row.changes,null,2)}</pre></div>)}</Drawer>
  </PageContainer>;
}


