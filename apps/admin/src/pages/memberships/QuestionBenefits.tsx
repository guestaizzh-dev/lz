import {Alert,App,Button,Form,Input,InputNumber,Modal,Select,Switch,Typography} from 'antd';
import {useEffect,useRef,useState} from 'react';
import {api} from '@/api';
type Plan={id:string;version:number;title:string};
export default function QuestionBenefits({plan,onClose,onSaved}:{plan:Plan;onClose:()=>void;onSaved:()=>void}){
  const {message,modal}=App.useApp(),[form]=Form.useForm(),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[options,setOptions]=useState<{value:string;label:string}[]>([]),generation=useRef(0),searchGeneration=useRef(0),quota=Form.useWatch('monthlyQuestions',form);
  async function search(q=''){const g=++searchGeneration.current;try{const r=await api<{items:{id:string;name:string;status:string;userId:string|null}[]}>('/admin/teachers?size=50&q='+encodeURIComponent(q));if(g===searchGeneration.current)setOptions(r.items.filter(t=>t.status==='PUBLISHED'&&t.userId).map(t=>({value:t.id,label:t.name})));}catch(e){if(g===searchGeneration.current)setError((e as Error).message);}}
  async function load(){const g=++generation.current;setLoading(true);setError('');try{const r=await api<{current:{benefits:{definition:{code:string};parameters:{priority?:boolean};quota:number|null;periodKind:string;scopes:{resourceId:string|null;offerId:string|null;categoryCode:string|null}[]}[]}|null}>('/admin/membership-benefits/plans/'+plan.id+'?size=1');if(g!==generation.current)return;if(!r.current)throw Error('暂无套餐权益版本，请刷新重试');const b=r.current.benefits.find(x=>x.definition.code==='TEACHER_QUESTION');if(b&&(b.periodKind!=='MONTH'||b.scopes.some(s=>s.offerId||s.categoryCode)))throw Error('此版本采用其他周期或范围，请保留原约定并联系管理员核对。');form.resetFields();form.setFieldsValue({monthlyQuestions:b?.quota??0,priority:b?.parameters.priority??false,teacherIds:b?.scopes.flatMap(s=>s.resourceId?[s.resourceId]:[])??[]});await search();}catch(e){if(g===generation.current)setError((e as Error).message);}finally{if(g===generation.current)setLoading(false);}}
  useEffect(()=>{void load();return()=>{generation.current++;searchGeneration.current++;};},[plan.id]);
  async function save(){if(loading||saving||error)return;try{const v=await form.validateFields();setSaving(true);await api('/admin/membership-benefits/plans/'+plan.id+'/questions','POST',{expectedVersion:plan.version,monthlyQuestions:v.monthlyQuestions,priority:v.monthlyQuestions?v.priority:false,teacherIds:v.monthlyQuestions?v.teacherIds??[]:[],reason:v.reason});message.success('新售问答权益已发布，原会员保留原版本');onSaved();}catch(e){if(e instanceof Error)message.error(e.message);}finally{setSaving(false);}}
  function close(){if(saving)return;if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的问答权益？',onOk:onClose});else onClose();}
  return <Modal open title={plan.title+' · 新售问答权益'} onOk={()=>void save()} onCancel={close} confirmLoading={saving} okText="发布问答权益版本" okButtonProps={{disabled:loading||!!error}}>
    <Typography.Paragraph>按北京时间自然月计算。提交预占，私人答复或公开审核通过后计次；答复前取消或老师拒绝释放预占。已接收的问题在会员到期后继续处理，不承诺即时答复。</Typography.Paragraph>
    {error&&<Alert type="error" showIcon title={error} action={<Button size="small" onClick={()=>void load()}>重试</Button>}/>}
    <Form form={form} layout="vertical" name="membership-question-benefits" disabled={saving||loading||!!error}>
      <Form.Item name="monthlyQuestions" label="每自然月专属提问次数" extra="0表示不包含；24小时内仍受通用10条提问上限限制。" rules={[{required:true}]}><InputNumber min={0} max={100} precision={0}/></Form.Item>
      <Form.Item name="priority" label="待答问题优先排列" valuePropName="checked"><Switch disabled={!quota}/></Form.Item>
      <Form.Item name="teacherIds" label="适用名师" extra="不选择表示所有已开放问答的名师；仅列出已发布且关联答复账号的名师。"><Select mode="multiple" disabled={!quota||loading||saving||!!error} showSearch filterOption={false} options={options} onSearch={q=>void search(q)}/></Form.Item>
      <Form.Item name="reason" label="调整原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item>
    </Form>
  </Modal>;
}
