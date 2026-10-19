import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, App, Button, Tag, Typography, Upload } from 'antd';
import MediaUploader from '@/components/MediaUploader';
import { useRef, useState } from 'react';
import { api } from '@/api';
import { formatChinaTime } from '@/utils/date-time';

type Asset={id:string;name:string;mime:string;bytes:number;status:string;durationSeconds:number|null;failureCode:string|null;createdAt:string};
export default function MediaPage(){
  const access=useAccess(),{message}=App.useApp(),table=useRef<ActionType>(undefined),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const columns:ProColumns<Asset>[]=[{title:'文件名称',dataIndex:'q',render:(_,row)=><Typography.Text>{row.name}</Typography.Text>},{title:'类型',dataIndex:'mime',valueType:'select',valueEnum:{'video/mp4':'MP4视频','audio/mpeg':'MP3音频','audio/mp4':'M4A音频','audio/wav':'WAV音频'}},{title:'文件大小',search:false,render:(_,row)=>(row.bytes/1024/1024).toFixed(2)+' MB'},{title:'状态',dataIndex:'assetStatus',valueType:'select',valueEnum:{READY:'可用',PROCESSING:'处理中',UPLOADING:'上传中',REVIEW:'待审核',REJECTED:'审核不通过',DELETED:'已删除'},render:(_,row)=><Tag color={row.status==='READY'?'success':['REJECTED','DELETED'].includes(row.status)?'error':'processing'}>{({READY:'可用',UPLOADING:'上传中',PROCESSING:'处理中',REVIEW:'待审核',REJECTED:'审核不通过',DELETED:'已删除'} as Record<string,string>)[row.status]??'未知状态'}</Tag>},{title:'时长',search:false,render:(_,row)=>row.durationSeconds?Math.floor(row.durationSeconds/60)+'分'+row.durationSeconds%60+'秒':'—'},{title:'上传时间',search:false,render:(_,row)=>formatChinaTime(row.createdAt)},{title:'媒体编号',search:false,render:(_,row)=><Typography.Text copyable>{row.id}</Typography.Text>}];
  return <PageContainer title="音视频媒体库" subTitle="课程课件与人工回放素材；私人作业、打卡与头像通过所属业务访问">{access.canMediaWrite&&<MediaUploader onReady={()=>{table.current?.reload();}}/>}{error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}<ProTable<Asset> rowKey="id" actionRef={table} columns={columns} pagination={{pageSize:20}} polling={5000}  request={async p=>{const query=new URLSearchParams({page:String(p.current??1),size:String(p.pageSize??20)});for(const key of ['q','mime','assetStatus'])if(p[key])query.set(key,String(p[key]));const result=await api<{items:Asset[];total:number}>('/admin/media-library?'+query);return{data:result.items,total:result.total,success:true};}}/></PageContainer>;
}
