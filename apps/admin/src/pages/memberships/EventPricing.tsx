import {Alert,App,Button,Form,Input,InputNumber,Modal,Select,Typography} from 'antd';
import {useEffect,useRef,useState} from 'react';
import {api} from '@/api';
type Plan={id:string;version:number;title:string};
export default function EventPricing({plan,onClose,onSaved}:{plan:Plan;onClose:()=>void;onSaved:()=>void}){
  const {message,modal}=App.useApp(),[form]=Form.useForm(),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[options,setOptions]=useState<{value:string;label:string}[]>([]),generation=useRef(0),searchGeneration=useRef(0);
  async function search(q=''){const g=++searchGeneration.current;try{const r=await api<{items:{id:string;title:string;status:string}[]}>('/admin/events?size=50&q='+encodeURIComponent(q));if(g===searchGeneration.current)setOptions(r.items.filter(e=>e.status==='PUBLISHED').map(e=>({value:e.id,label:e.title})));}catch(e){if(g===searchGeneration.current)setError((e as Error).message);}}
  async function load(){const g=++generation.current;setLoading(true);setError('');try{const r=await api<{current:{benefits:{definition:{code:string};parameters:{basisPoints?:number};scopes:{resourceId:string|null;offerId:string|null;categoryCode:string|null}[]}[]}|null}>('/admin/membership-benefits/plans/'+plan.id+'?size=1');if(g!==generation.current)return;if(!r.current)throw Error('套餐暂无权益版本');const b=r.current.benefits.find(x=>x.definition.code==='EVENT_DISCOUNT');if(b?.scopes.some(s=>s.offerId||s.categoryCode))throw Error('原版本采用售卖项或分类范围，请保留原范围并联系管理员核对。');form.resetFields();form.setFieldsValue({percent:(b?.parameters.basisPoints??10000)/100,eventIds:b?.scopes.flatMap(s=>s.resourceId?[s.resourceId]:[])??[]});await search();}catch(e){if(g===generation.current)setError((e as Error).message);}finally{if(g===generation.current)setLoading(false);}}
  useEffect(()=>{void load();return()=>{generation.current++;searchGeneration.current++;};},[plan.id]);
  function cancel(){if(saving)return;if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的活动票价权益？',onOk:onClose});else onClose();}
  async function save(){if(loading||saving||error)return;try{const v=await form.validateFields();setSaving(true);await api('/admin/membership-benefits/plans/'+plan.id+'/event-pricing','POST',{expectedVersion:plan.version,basisPoints:Math.round(v.percent*100),eventIds:v.percent===100?[]:v.eventIds??[],reason:v.reason});message.success('新售活动票价权益已发布，原会员与已确认报名保持原约定');onSaved();}catch(e){if(e instanceof Error)message.error(e.message);}finally{setSaving(false);}}
  return <Modal open title={plan.title+' · 新售活动票价权益'} onCancel={cancel} onOk={()=>void save()} confirmLoading={saving} okText="发布活动票价权益" okButtonProps={{disabled:loading||!!error}}>
    <Typography.Paragraph>仅参与优惠的票种生效。免费报名也使用同一库存和人数上限；报名确认后保留安排，会员到期不取消。优惠按所选人数计算，退费按实付金额。此设置不包含独立咨询费用。</Typography.Paragraph>
    {error&&<Alert showIcon type="error" title={error} action={<Button size="small" onClick={()=>void load()}>重试</Button>}/>}
    <Form form={form} layout="vertical" name="member-event-pricing" disabled={loading||saving||!!error}>
      <Form.Item name="percent" label="参与票种按原价的百分比计费" extra="80表示八折，0表示会员免费，100表示不包含票价优惠。" rules={[{required:true}]}><InputNumber min={0} max={100} precision={2} addonAfter="%"/></Form.Item>
      <Form.Item name="eventIds" label="适用活动" extra="不选择表示所有启用了会员优惠的活动票种。报名优先窗口是另一项权益，不因票价减免自动提前开放。"><Select mode="multiple" showSearch filterOption={false} options={options} onSearch={q=>void search(q)}/></Form.Item>
      <Form.Item name="reason" label="调整原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item>
    </Form>
  </Modal>;
}
