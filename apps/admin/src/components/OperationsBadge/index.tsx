import {useEffect,useState} from 'react';
import {Badge,Button} from 'antd';
import {Link} from '@umijs/max';
import {api} from '@/api';
export default function OperationsBadge(){
 const [count,setCount]=useState(0);
 useEffect(()=>{let active=true;const load=()=>void api<{active:number}>('/admin/operations/incidents/summary').then(r=>{if(active)setCount(r.active);}).catch(()=>{if(active)setCount(0);});load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer);};},[]);
 return <Link to="/operations/incidents"><Badge count={count} size="small" offset={[-4,4]}><Button type="text">运行告警</Button></Badge></Link>;
}
