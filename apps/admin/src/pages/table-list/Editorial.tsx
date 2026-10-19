import ContentRelations from '@/components/ContentRelations';
import {useEffect,useState} from 'react';
import {Alert,App,Button,Card,Checkbox,Empty,Form,Input,Modal,Select,Space,Tag,Typography,Upload} from 'antd';
import {useAccess} from '@umijs/max';
import {api} from '@/api';
import {formatChinaTime} from '@/utils/date-time';

type Evidence={id:string;version:number;kind:string;title:string;author:string;edition:string;reviewState:string;sourceUrl:string;rightsHolder:string;licenseScope:string;proofAssetId:string|null;validFrom:string|null;validUntil:string|null;reviewNote:string|null};
const states:Record<string,string>={PENDING:'待核查',APPROVED:'已审核',REJECTED:'已驳回 / 撤回'};
export default function Editorial({articleId,resourceKind='article'}:{articleId:string;resourceKind?:'article'|'product'|'teacher'}){
  const access=useAccess(),{message}=App.useApp(),[form]=Form.useForm();
  const [data,setData]=useState<{isDemo:boolean;evidence:Evidence[]}>({isDemo:false,evidence:[]}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[fileName,setFileName]=useState('');
  const [review,setReview]=useState<{item:Evidence;state:string}>(),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[reviewError,setReviewError]=useState('');
  const [proof,setProof]=useState<{path:string;mime:string}>();
  const base='/admin/'+({article:'articles',product:'products',teacher:'teachers'}[resourceKind])+'/'+articleId+'/editorial';
  const canEdit=resourceKind==='product'?access.canProductsEdit:resourceKind==='teacher'?access.canCoursesEdit:access.canContentEdit;
  const canReview=resourceKind==='product'?access.canProductsReview:resourceKind==='teacher'?access.canCoursesReview:access.canContentReview;
  const kinds=[...(resourceKind==='product'?[{value:'CULTURAL',label:'文化来源'},{value:'QUALITY',label:'质量证明'}]:resourceKind==='teacher'?[{value:'CREDENTIAL',label:'师资资质'},{value:'LINEAGE',label:'传承依据'}]:[{value:'ANNOTATION',label:'注释版本'}]),{value:'LICENSE',label:'授权证据'},{value:'SOURCE',label:'文献来源'}];
  async function load(){try{setData(await api(base));setError('');}catch(e){setError((e as Error).message);}}
  useEffect(()=>{void load();form.resetFields();setFileName('');setProof(undefined);setReview(undefined);},[articleId,resourceKind]);
  async function save(values:Record<string,unknown>){if(busy||uploading)return;setBusy(true);setError('');try{await api(base+'/evidence','POST',{...values,validFrom:values.validFrom||undefined,validUntil:values.validUntil||undefined});message.success('新版本已保存，待核查');form.resetFields();setFileName('');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function upload(file:File){setUploading(true);setError('');try{const body=new FormData();body.append('file',file);const asset=await api<{id:string;name:string}>(base+'/evidence-files','POST',body);form.setFieldValue('proofAssetId',asset.id);setFileName(asset.name);}catch(e){setError((e as Error).message);}finally{setUploading(false);}return false;}
  async function viewProof(item:Evidence){try{const result=await api<{path:string;mime:string}>(base+'/evidence/'+item.id+'/proof','POST');setProof({...result,path:'/api/v1'+result.path});}catch(e){setError((e as Error).message);}}
  async function submitReview(){if(!review||busy)return;if(!reason.trim()){setReviewError('请填写实际核查依据或撤回原因');return;}if(review.state==='APPROVED'&&review.item.proofAssetId&&!confirmed){setReviewError('请查看证据文件，并勾选核查确认');return;}setBusy(true);setReviewError('');try{await api(base+'/evidence/'+review.item.id+'/review','POST',{state:review.state,expectedVersion:review.item.version,reason:reason.trim(),proofReviewed:confirmed});setReview(undefined);message.success('核查结果已保存');await load();}catch(e){setReviewError((e as Error).message);}finally{setBusy(false);}}
  return <Space orientation="vertical" style={{width:'100%'}} size="middle">
    {error&&<Alert type="error" title={error} action={<Button onClick={load}>刷新</Button>}/>}
    <Alert type={data.isDemo?'warning':'info'} title={data.isDemo?'演示档案：审核不会将样例变成真实资质':'仅展示审核通过且在有效期内的来源摘要'} description="证据原件仅限有权限的运营与审核人员查看。正文资料不直接改写；修订请新增版本，旧版本保留以便追溯。已绑定的来源失效后，重新发布前需补齐有效版本。"/>
    {data.evidence.map(e=><Card key={e.id} size="small" title={<>{e.title} <Tag>{states[e.reviewState]??'待核查'}</Tag>{e.validUntil&&Date.parse(e.validUntil)<=Date.now()&&<Tag color="error">已过期</Tag>}</>}>
      <Typography.Paragraph>{e.author} · {e.edition} · 记录版本 {e.version}</Typography.Paragraph>
      <Typography.Paragraph>权利人：{e.rightsHolder}；范围：{e.licenseScope}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">生效：{e.validFrom?formatChinaTime(e.validFrom):'未限定'}；截止：{e.validUntil?formatChinaTime(e.validUntil):'未限定'}</Typography.Paragraph>
      <Space wrap><Typography.Link href={e.sourceUrl} target="_blank" rel="noopener noreferrer">查看公开来源</Typography.Link>{e.proofAssetId&&<Button onClick={()=>viewProof(e)}>查看证据文件</Button>}{canEdit&&<Button onClick={()=>{form.setFieldsValue({kind:e.kind,title:e.title,author:e.author,edition:e.edition,sourceUrl:e.sourceUrl,rightsHolder:e.rightsHolder,licenseScope:e.licenseScope,validFrom:undefined,validUntil:undefined,proofAssetId:undefined});setFileName('');message.info('已复制资料，请填写新版本与有效期，重新上传原件后保存');}}>据此新增版本</Button>}</Space>
      {e.reviewNote&&<Typography.Paragraph type="secondary" style={{marginTop:12}}>核查记录：{e.reviewNote}</Typography.Paragraph>}
      {canReview&&<Space style={{display:'flex',marginTop:12}}><Button disabled={busy||e.reviewState==='APPROVED'} onClick={()=>{setReview({item:e,state:'APPROVED'});setReason('');setConfirmed(false);setReviewError('');}}>审核通过</Button><Button danger disabled={busy||e.reviewState==='REJECTED'} onClick={()=>{setReview({item:e,state:'REJECTED'});setReason('');setConfirmed(false);setReviewError('');}}>驳回 / 撤回</Button></Space>}
    </Card>)}
    {!data.evidence.length&&<Empty description="尚未录入来源证据"/>}
    {canEdit&&<Card title="新增来源 / 授权版本" size="small"><Form name={'evidence-'+resourceKind+'-'+articleId} form={form} layout="vertical" initialValues={{kind:kinds[0].value}} onFinish={save} disabled={busy}>
      <Form.Item name="kind" label="证据类型" rules={[{required:true}]}><Select options={kinds}/></Form.Item>
      {[['title','标题',150],['author','作者 / 核发单位',100],['edition','版本 / 出版信息',150],['rightsHolder','权利人',150],['licenseScope','授权使用范围',1000]].map(([key,label,max])=><Form.Item key={key} name={key} label={label} rules={[{required:true,whitespace:true}]}><Input maxLength={Number(max)}/></Form.Item>)}
      <Form.Item name="sourceUrl" label="公开来源链接" rules={[{required:true,pattern:/^https:\/\/[^\s]+$/,message:'请填写 HTTPS 地址'}]}><Input maxLength={2000}/></Form.Item>
      <Form.Item name="proofAssetId" hidden><Input/></Form.Item>
      <Form.Item label="证据原件（可选，运营可见）" extra="支持 PDF、PNG、JPEG、WebP，最大10MB。勿将私人合同地址填到公开来源。"><Space wrap><Upload accept=".pdf,.png,.jpg,.jpeg,.webp" showUploadList={false} beforeUpload={file=>{if(file.size>10*1024*1024){setError('证据文件不能超过10MB');return false;}return upload(file);}} disabled={uploading||busy}><Button loading={uploading}>上传证据原件</Button></Upload><Typography.Text>{fileName}</Typography.Text></Space></Form.Item>
      <Form.Item name="validFrom" label="生效日期（北京时间，可选）" rules={[{pattern:/^\d{4}-\d{2}-\d{2}$/,message:'请使用 YYYY-MM-DD'}]}><Input placeholder="2026-10-15"/></Form.Item>
      <Form.Item name="validUntil" label="截止日期（北京时间，可选）" rules={[{pattern:/^\d{4}-\d{2}-\d{2}$/,message:'请使用 YYYY-MM-DD'}]}><Input placeholder="2030-12-31"/></Form.Item>
      <Button htmlType="submit" type="primary" loading={busy} disabled={uploading}>保存并待审核</Button>
    </Form></Card>}
    <ContentRelations resourceId={articleId} kind={resourceKind.toUpperCase()}/>
    <Modal open={!!review} title={review?.state==='APPROVED'?'核查来源与授权':'驳回 / 撤回来源'} onCancel={()=>{if(!busy)setReview(undefined);}} onOk={submitReview} confirmLoading={busy} okText="保存核查结果" cancelText="取消">
      <Typography.Paragraph>{review?.item.title} · {review?.item.edition}</Typography.Paragraph>
      {review?.item.proofAssetId&&<Button onClick={()=>viewProof(review.item)}>查看证据文件</Button>}
      {review?.state==='APPROVED'&&review.item.proofAssetId&&<Checkbox checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}>已核对原件、权利人、授权范围与有效期</Checkbox>}
      <Input.TextArea aria-label="证据核查原因" value={reason} onChange={e=>setReason(e.target.value)} rows={3} maxLength={500} placeholder="填写核查依据或撤回原因" style={{marginTop:16}}/>
      {reviewError&&<Alert type="error" title={reviewError} style={{marginTop:12}}/>}
    </Modal>
    <Modal open={!!proof} title="受控证据原件" onCancel={()=>setProof(undefined)} footer={<Button onClick={()=>setProof(undefined)}>关闭</Button>}>
      <Typography.Paragraph type="secondary">临时链接5分钟内有效，权限撤销或记录更新后失效。</Typography.Paragraph>
      {proof?.mime==='application/pdf'?<Button href={proof.path} target="_blank" rel="noopener noreferrer">下载 PDF 核对</Button>:proof&&<img src={proof.path} alt="来源证据原件" style={{maxWidth:'100%'}}/>}
    </Modal>
  </Space>;
}
