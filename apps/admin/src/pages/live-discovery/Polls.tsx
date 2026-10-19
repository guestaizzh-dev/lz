import {Alert,App,Button,Card,Checkbox,DatePicker,Drawer,Empty,Form,Input,Modal,Progress,Select,Space,Spin,Tag,Typography} from 'antd';
import {useEffect,useRef,useState} from 'react';
import {api,session} from '@/api';
import {chinaPickerIso,chinaPickerValue,formatChinaTime} from '@/utils/date-time';

type Question={id:string;type:string;prompt:string;required:boolean;options:{id:string;label:string}[]};
type Answer={questionId:string;optionIds?:string[];text?:string};
type Poll={id:string;kind:string;version:number;question:string;questions:Question[];state:string;storedState:string;closesAt:string;resultVisibility:string;participants:number;results?:{optionId:string;count:number}[]};
type Page={items:Poll[];sessionState:string};
type ResponsePage={items:{number:number;answers:Answer[]}[];hasMore:boolean};
const states:Record<string,string>={DRAFT:'草稿',OPEN:'进行中',CLOSED:'已截止',REVOKED:'已撤回'};
const types=[{value:'SINGLE',label:'单选题'},{value:'MULTIPLE',label:'多选题'},{value:'TEXT',label:'文字题'}];
const blankQuestion={type:'SINGLE',prompt:'',required:true,optionText:''};
const optionRules=[{required:true,message:'请填写选项，每行一个'},{validator:(_:unknown,value:string)=>{const rows=(value??'').split('\n').map(s=>s.trim()).filter(Boolean);return rows.length<2||rows.length>8||new Set(rows).size!==rows.length||rows.some(s=>s.length>100)?Promise.reject(new Error('请输入2至8个不重复选项，每项最多100字')):Promise.resolve();}}];

export default function Polls({sessionId,title,host=false,canEdit,onClose}:{sessionId:string;title:string;host?:boolean;canEdit:boolean;onClose:()=>void}){
  const {message}=App.useApp(),[data,setData]=useState<Page>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editor,setEditor]=useState<{row?:Poll}>(),[operation,setOperation]=useState<{row:Poll;action:string}>(),[responses,setResponses]=useState<{poll:Poll;page:number;data?:ResponsePage}>(),[form]=Form.useForm(),[reasonForm]=Form.useForm();
  const alive=useRef(true),loading=useRef(false),revision=useRef(0),owner=useRef(session?.user.id),kind=Form.useWatch('kind',form),base=host?'/admin/live-host/'+sessionId+'/polls':'/admin/live/sessions/'+sessionId+'/polls';
  const valid=()=>alive.current&&owner.current===session?.user.id;
  async function load(){if(loading.current)return;loading.current=true;const request=++revision.current;try{const next=await api<Page>(base);if(valid()&&request===revision.current){setData(next);setError('');}}catch(e){if(valid()&&request===revision.current){setError((e as Error).message);if([401,403,404].includes((e as {status:number}).status)){setData(undefined);setResponses(undefined);setEditor(undefined);}}}finally{loading.current=false;}}
  useEffect(()=>{alive.current=true;void load();const timer=setInterval(()=>void load(),5000);return()=>{alive.current=false;revision.current++;clearInterval(timer);};},[base]);
  function edit(row?:Poll){form.resetFields();form.setFieldsValue(row?{kind:row.kind,question:row.question,allowMultiple:row.questions[0]?.type==='MULTIPLE',resultVisibility:row.resultVisibility,closesAt:chinaPickerValue(row.closesAt),optionText:row.questions[0]?.options.map(o=>o.label).join('\n'),questions:row.questions.map(q=>({...q,optionText:q.options.map(o=>o.label).join('\n')}))}:{kind:'POLL',allowMultiple:false,resultVisibility:'AFTER_VOTE',closesAt:chinaPickerValue(new Date(Date.now()+30*60000).toISOString()),questions:[blankQuestion]});setEditor({row});}
  async function save(values:any){if(busy||!editor)return;setBusy(true);try{const options=(s:string)=>(s??'').split('\n').map(s=>s.trim()).filter(Boolean);const payload={kind:values.kind,question:values.question.trim(),allowMultiple:values.kind==='POLL'&&!!values.allowMultiple,resultVisibility:values.kind==='SURVEY'?'HOST_ONLY':values.resultVisibility,closesAt:chinaPickerIso(values.closesAt),...(values.kind==='POLL'?{options:options(values.optionText)}:{questions:values.questions.map((q:any)=>({type:q.type,prompt:q.prompt.trim(),required:!!q.required,...(q.type==='TEXT'?{}:{options:options(q.optionText)})}))}),...(editor.row?{expectedVersion:editor.row.version}:{})};await api(base+(editor.row?'/'+editor.row.id:''),editor.row?'PATCH':'POST',payload);if(valid()){setEditor(undefined);message.success('草稿已保存，直播中可发布');await load();}}catch(e){if(valid())message.error((e as Error).message);}finally{if(valid())setBusy(false);}}
  async function transition(values:{reason:string}){if(busy||!operation)return;setBusy(true);try{await api(base+'/'+operation.row.id+'/state','POST',{expectedVersion:operation.row.version,action:operation.action,reason:values.reason.trim()});if(valid()){setOperation(undefined);message.success('互动状态已更新');await load();}}catch(e){if(valid()){message.error((e as Error).message);await load();}}finally{if(valid())setBusy(false);}}
  async function viewResponses(poll:Poll,page=1){if(busy)return;setBusy(true);setResponses({poll,page});try{const result=await api<ResponsePage>(base+'/'+poll.id+'/responses?page='+page);if(valid())setResponses({poll,page,data:result});}catch(e){if(valid()){setResponses(undefined);message.error((e as Error).message);}}finally{if(valid())setBusy(false);}}
  function action(row:Poll,action:string){reasonForm.resetFields();setOperation({row,action});}
  const editable=canEdit&&!error&&!!data&&['SCHEDULED','PREPARING','LIVE'].includes(data.sessionState);
  return <Drawer title={'投票与问卷 · '+title} size={880} open onClose={onClose} extra={<Space><Button onClick={()=>void load()}>刷新</Button>{editable&&<Button type="primary" onClick={()=>edit()}>新建互动</Button>}</Space>}>
    <Typography.Paragraph type="secondary">提前保存草稿，直播中发布；截止或结束场次后停止提交。投票可展示汇总，问卷仅向本人、授权主持和运营提供答案，不显示答题者身份。请勿收集手机号、证件或健康等敏感信息。</Typography.Paragraph>
    {error&&<Alert showIcon type="error" title={error} style={{marginBottom:16}}/>}
    {!data&&!error?<Spin/>:data&&!data.items.length?<Empty description="尚未安排互动，可先准备一份投票或问卷"/>:null}
    <Space orientation="vertical" size={16} style={{width:'100%'}}>{data?.items.map(row=><Card key={row.id} title={<Space wrap><Tag>{row.kind==='POLL'?'投票':'问卷'}</Tag><span>{row.question}</span><Tag color={row.state==='OPEN'?'green':'default'}>{states[row.state]??row.state}</Tag></Space>}>
      <Typography.Paragraph type="secondary">截止：{formatChinaTime(row.closesAt)}（北京） · {row.participants} 人参与 · {({AFTER_VOTE:'提交后可看结果',AFTER_CLOSE:'截止后可看结果',HOST_ONLY:'仅主持与运营可看结果'} as Record<string,string>)[row.resultVisibility]}</Typography.Paragraph>
      {row.kind==='POLL'?row.questions[0]?.options.map(o=>{const count=row.results?.find(r=>r.optionId===o.id)?.count??0;return <div key={o.id}><Typography.Text>{o.label} · {count} 票</Typography.Text><Progress percent={row.participants?Math.round(count/row.participants*100):0} strokeColor="#245564" size="small"/></div>;}):row.questions.map((q,i)=><Typography.Paragraph key={q.id}>{i+1}. {q.prompt}（{types.find(t=>t.value===q.type)?.label}{q.required?' · 必答':' · 选答'}）</Typography.Paragraph>)}
      <Space wrap style={{marginTop:12}}>
        {editable&&row.storedState==='DRAFT'&&<><Button onClick={()=>edit(row)}>编辑草稿</Button><Button type="primary" disabled={data?.sessionState!=='LIVE'||new Date(row.closesAt)<=new Date()} onClick={()=>action(row,'OPEN')}>发布到本场</Button></>}
        {canEdit&&!error&&row.storedState==='OPEN'&&<Button onClick={()=>action(row,'CLOSE')}>提前截止</Button>}
        {canEdit&&!error&&row.kind==='SURVEY'&&row.participants>0&&<Button onClick={()=>void viewResponses(row)}>查看匿名答案</Button>}
        {canEdit&&!error&&row.storedState!=='REVOKED'&&<Button danger onClick={()=>action(row,'REVOKE')}>撤回互动</Button>}
      </Space>
    </Card>)}</Space>
    <Modal title={editor?.row?'编辑互动草稿':'新建投票 / 问卷'} open={!!editor} width={680} confirmLoading={busy} onOk={()=>form.submit()} onCancel={()=>{if(!busy)setEditor(undefined);}} destroyOnHidden>
      <Form name="live-poll-editor" form={form} layout="vertical" onFinish={save} disabled={busy}>
        <Form.Item name="kind" label="互动形式" rules={[{required:true}]}><Select options={[{value:'POLL',label:'投票 · 一道选择题'},{value:'SURVEY',label:'问卷 · 多道题，匿名查看答案'}]}/></Form.Item>
        <Form.Item name="question" label={kind==='SURVEY'?'问卷标题':'投票问题'} rules={[{required:true,whitespace:true}]}><Input maxLength={300}/></Form.Item>
        <Form.Item name="closesAt" label="截止时间（北京时间）" rules={[{required:true}]} extra="须晚于现在且不超过30天；直播结束时提前截止。"><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{width:'100%'}}/></Form.Item>
        {kind==='POLL'?<><Form.Item name="optionText" label="投票选项" extra="每行一个，2至8个选项，每项最多100字。" rules={optionRules}><Input.TextArea rows={5} maxLength={810}/></Form.Item><Form.Item name="allowMultiple" valuePropName="checked"><Checkbox>允许多选</Checkbox></Form.Item><Form.Item name="resultVisibility" label="学员何时能看汇总" rules={[{required:true}]}><Select options={[{value:'AFTER_VOTE',label:'提交之后'},{value:'AFTER_CLOSE',label:'互动截止之后'},{value:'HOST_ONLY',label:'不向学员展示'}]}/></Form.Item></>:<Form.List name="questions" rules={[{validator:(_,value)=>value?.length>=1&&value.length<=20?Promise.resolve():Promise.reject(new Error('问卷须有1至20题'))}]}>{(fields,{add,remove},{errors})=><><Form.ErrorList errors={errors}/>{fields.map(({key,name,...rest})=><Card key={key} size="small" title={'第 '+(name+1)+' 题'} style={{marginBottom:12}} extra={<Button danger type="link" disabled={fields.length===1} onClick={()=>remove(name)}>删除题目</Button>}>
          <Form.Item {...rest} name={[name,'type']} label="题型" rules={[{required:true}]}><Select options={types}/></Form.Item><Form.Item {...rest} name={[name,'prompt']} label="题目" rules={[{required:true,whitespace:true}]}><Input maxLength={300}/></Form.Item><Form.Item noStyle shouldUpdate>{()=>form.getFieldValue(['questions',name,'type'])!=='TEXT'&&<Form.Item {...rest} name={[name,'optionText']} label="选项（每行一个）" rules={optionRules}><Input.TextArea rows={3} maxLength={810}/></Form.Item>}</Form.Item><Form.Item {...rest} name={[name,'required']} valuePropName="checked"><Checkbox>必答题</Checkbox></Form.Item>
        </Card>)}<Button disabled={fields.length>=20} onClick={()=>add({...blankQuestion})}>添加题目</Button></>}</Form.List>}
      </Form>
    </Modal>
    <Modal title={operation?.action==='OPEN'?'发布互动':operation?.action==='CLOSE'?'提前截止互动':'撤回互动'} open={!!operation} confirmLoading={busy} onCancel={()=>{if(!busy)setOperation(undefined);}} onOk={()=>reasonForm.submit()}>
      <Typography.Paragraph>{operation?.row.question}</Typography.Paragraph><Typography.Paragraph type="secondary">{operation?.action==='OPEN'?'发布后题目和选项固定，不能修改。':'截止后不能继续作答；撤回后学员端隐藏，操作记录保留。'}</Typography.Paragraph><Form name="live-poll-action" form={reasonForm} layout="vertical" onFinish={transition}><Form.Item name="reason" label="操作说明" rules={[{required:true,whitespace:true,min:2}]}><Input.TextArea maxLength={500} rows={3}/></Form.Item></Form>
    </Modal>
    <Drawer title={'匿名答案 · '+(responses?.poll.question??'')} size={640} open={!!responses} onClose={()=>setResponses(undefined)}>
      <Alert type="info" showIcon title="仅展示答案，不显示答题者身份或联系方式；此次查看会记录审计。" style={{marginBottom:16}}/>
      {!responses?.data?<Spin/>:!responses.data.items.length?<Empty description="暂无答案"/>:responses.data.items.map(row=><Card key={row.number} size="small" title={'答卷 '+row.number} style={{marginBottom:12}}>{responses.poll.questions.map(q=>{const a=row.answers.find(a=>a.questionId===q.id);return <div key={q.id}><Typography.Text strong>{q.prompt}</Typography.Text><Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{q.type==='TEXT'?a?.text||'未填写':q.options.filter(o=>a?.optionIds?.includes(o.id)).map(o=>o.label).join('、')||'未选择'}</Typography.Paragraph></div>;})}</Card>)}
      {responses?.data&&<Space><Button disabled={busy||responses.page<=1} onClick={()=>void viewResponses(responses.poll,responses.page-1)}>上一页</Button><span>第 {responses.page} 页</span><Button disabled={busy||!responses.data.hasMore} onClick={()=>void viewResponses(responses.poll,responses.page+1)}>下一页</Button></Space>}
    </Drawer>
  </Drawer>;
}
