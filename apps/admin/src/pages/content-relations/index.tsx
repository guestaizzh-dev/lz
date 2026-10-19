import { PageContainer } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, Card, Select } from 'antd';
import { useState } from 'react';
import ContentRelations, { contentChoices } from '@/components/ContentRelations';
export default function RelationsPage() {
  const access=useAccess(),[items,setItems]=useState<{value:string;label:string;type:string}[]>([]),[source,setSource]=useState<{value:string;label:string;type:string}>(),[error,setError]=useState('');
  const types=Object.entries({ARTICLE:access.canContent,TEACHER:access.canCourses,COURSE:access.canCourses,LIVE:access.canLive,PRODUCT:access.canProducts,EVENT:access.canEvents}).filter(([,allowed])=>allowed).map(([type])=>type);
  async function find(q:string){try{setItems(await contentChoices(q,types));setError('');}catch(e){setError((e as Error).message);}}
  return <PageContainer title="内容联动" subTitle="统一维护六类内容的双向推荐、顺序与展示期限">{error&&<Alert type="error" title={error}/>}<Card style={{marginBottom:20}}><Select style={{width:'100%'}} showSearch={{filterOption:false,onSearch:find}} onOpenChange={open=>{if(open)find('');}} options={items} placeholder="先搜索并选择需要维护的内容" value={source?.value} onChange={value=>setSource(items.find(i=>i.value===value))}/></Card>{source&&<Card title={source.label}><ContentRelations key={source.value} resourceId={source.value} kind={source.type}/></Card>}</PageContainer>;
}
