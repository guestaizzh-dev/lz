import {Alert,App,Button,Form,Input,InputNumber,Modal,Select,Switch,Typography} from 'antd';
import {useEffect,useRef,useState} from 'react';
import {api} from '@/api';

type Plan={id:string;version:number;title:string};
type Benefit={definition:{code:string};parameters:{basisPoints?:number};scopes:{resourceId:string|null;offerId:string|null;categoryCode:string|null}[]};
export default function CourseBenefits({plan,onClose,onSaved}:{plan:Plan;onClose:()=>void;onSaved:()=>void}){
  const {message,modal}=App.useApp(),[form]=Form.useForm(),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[options,setOptions]=useState<{value:string;label:string}[]>([]),generation=useRef(0),searchGeneration=useRef(0);
  async function search(q=''){const g=++searchGeneration.current;try{const r=await api<{items:{id:string;title:string;status:string;format:string}[]}>('/admin/courses?size=50&q='+encodeURIComponent(q));if(g===searchGeneration.current)setOptions(r.items.filter(c=>c.status==='PUBLISHED'&&['VIDEO','AUDIO'].includes(c.format)).map(c=>({value:c.id,label:c.title})));}catch(e){if(g===searchGeneration.current)setError((e as Error).message);}}
  async function load(){const g=++generation.current;setLoading(true);setError('');try{
    const r=await api<{current:{benefits:Benefit[]}|null}>('/admin/membership-benefits/plans/'+plan.id+'?size=1');if(g!==generation.current)return;
    if(!r.current)throw Error('套餐暂无权益版本，请刷新后重试');
    const discount=r.current.benefits.find(b=>b.definition.code==='COURSE_DISCOUNT'),early=r.current.benefits.find(b=>b.definition.code==='COURSE_EARLY_ACCESS'),scopes=[...(discount?.scopes??[]),...(early?.scopes??[])];
    if(scopes.some(s=>s.offerId||s.categoryCode))throw Error('此版本使用售卖项或分类范围，请保留原版本并联系管理员核对，当前页面仅编辑按课程划定的范围。');
    const discountIds=(discount?.scopes??[]).map(s=>s.resourceId).sort(),earlyIds=(early?.scopes??[]).map(s=>s.resourceId).sort();
    if(discount&&early&&JSON.stringify(discountIds)!==JSON.stringify(earlyIds))throw Error('折扣与提前学习的既有范围不同，请保留原版本并联系管理员核对。');
    form.resetFields();form.setFieldsValue({coursePercent:(discount?.parameters.basisPoints??10000)/100,earlyAccess:!!early,courseIds:[...new Set(scopes.flatMap(s=>s.resourceId?[s.resourceId]:[]))]});await search();
  }catch(e){if(g===generation.current)setError((e as Error).message);}finally{if(g===generation.current)setLoading(false);}}
  useEffect(()=>{void load();return()=>{generation.current++;searchGeneration.current++;};},[plan.id]);
  function cancel(){if(busy)return;if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的课程权益？',onOk:onClose});else onClose();}
  async function save(){if(busy||loading||error)return;try{const v=await form.validateFields();setBusy(true);await api('/admin/membership-benefits/plans/'+plan.id+'/courses','POST',{expectedVersion:plan.version,courseBasisPoints:Math.round(v.coursePercent*100),earlyAccess:v.earlyAccess,courseIds:v.courseIds??[],reason:v.reason});message.success('新售课程权益已发布，原会员和原订单保持原约定');onSaved();}catch(e){if(e instanceof Error)message.error(e.message);}finally{setBusy(false);}}
  return <Modal open title={plan.title+' · 新售课程权益'} onOk={()=>void save()} onCancel={cancel} confirmLoading={busy} okText="发布新权益版本" okButtonProps={{disabled:loading||!!error}}>
    <Typography.Paragraph>折扣仅用于已启用会员优惠的录播课程，与优惠券、公益价自动择优；拼团按团价。提前学习仍须同时拥有该课内容权限，并遵守课程公布的开放时间。</Typography.Paragraph>
    {error&&<Alert showIcon type="error" title={error} action={<Button size="small" onClick={()=>void load()}>重试</Button>} style={{marginBottom:16}}/>}
    <Form form={form} name="membership-course-benefits" layout="vertical" disabled={busy||loading||!!error}>
      <Form.Item name="coursePercent" label="课程按原价的百分比计费" extra="90表示按原价90%计费，100表示无购课折扣。iOS不使用此金额替代商店价格。" rules={[{required:true}]}><InputNumber min={10} max={100} precision={2} addonAfter="%"/></Form.Item>
      <Form.Item name="earlyAccess" label="新课提前研习" valuePropName="checked"><Switch/></Form.Item>
      <Form.Item name="courseIds" label="适用课程" extra="不选择表示适用于课程已启用的范围；指定范围同时用于折扣和提前学习。"><Select mode="multiple" showSearch filterOption={false} onSearch={q=>void search(q)} options={options} placeholder="可选：指定录播课程"/></Form.Item>
      <Form.Item name="reason" label="调整原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item>
    </Form>
  </Modal>;
}
