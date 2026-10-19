import {formatChinaTime} from '@/utils/date-time';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Alert, Drawer, Table, Typography } from 'antd';
import { useState } from 'react';
import { api } from '@/api';
type Item={id:string;title:string;skuTitle:string;unitPrice:number;quantity:number;subtotal:number};
type Order={id:string;status:string;total:number;shipping:number;createdAt:string;expiresAt:string;closeReason:string|null;items:Item[]};
const money=(value:number)=>'¥'+(value/100).toFixed(2);
export default function Orders(){
  const [error,setError]=useState(''),[selected,setSelected]=useState<Order>();
  const columns:ProColumns<Order>[]=[{title:'订单编号',dataIndex:'id',search:false,copyable:true},{title:'状态',dataIndex:'status',valueEnum:{PENDING:{text:'待付款（开发预占）',status:'Processing'},CLOSED:{text:'已关闭',status:'Default'}}},{title:'应收',dataIndex:'total',search:false,render:(_,row)=>money(row.total)},{title:'运费',dataIndex:'shipping',search:false,render:(_,row)=>money(row.shipping)},{title:'创建时间',dataIndex:'createdAt',valueType:'dateTime', render: (_,row)=>formatChinaTime(row.createdAt),search:false},{title:'到期时间',dataIndex:'expiresAt',valueType:'dateTime', render: (_,row)=>formatChinaTime(row.expiresAt),search:false},{title:'关闭原因',dataIndex:'closeReason',search:false},{title:'操作',valueType:'option',render:(_,row)=><a onClick={()=>setSelected(row)}>明细快照</a>}];
  return <PageContainer title="实物订单" subTitle="库存预占与关闭记录">
    <Alert type="info" showIcon title="支付尚未接入。当前仅能查看开发验证产生的预占订单，没有确认收款、发货或退款操作。" style={{marginBottom:16}}/>
    {error&&<Alert title={error} type="error" showIcon style={{marginBottom:16}}/>}
    <ProTable<Order> rowKey="id" columns={columns} request={async params=>{try{const result=await api<{items:Order[];total:number}>(`/admin/orders?page=${params.current??1}&size=${params.pageSize??20}${params.status?'&status='+params.status:''}`);setError('');return {data:result.items,total:result.total,success:true};}catch(e){setError((e as Error).message);return {data:[],success:false};}}}/>
    <Drawer title="商品与价格快照" open={!!selected} size={700} onClose={()=>setSelected(undefined)}>
      <Typography.Paragraph copyable>{selected?.id}</Typography.Paragraph>
      <Table<Item> rowKey="id" pagination={false} dataSource={selected?.items} columns={[{title:'商品',dataIndex:'title'},{title:'规格',dataIndex:'skuTitle'},{title:'单价',dataIndex:'unitPrice',render:money},{title:'数量',dataIndex:'quantity'},{title:'小计',dataIndex:'subtotal',render:money}]}/>
    </Drawer>
  </PageContainer>;
}
