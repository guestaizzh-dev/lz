import {Alert,Button,Segmented,Space,Typography} from 'antd';
import {useEffect,useRef,useState} from 'react';
import type {Block} from '@/api';
import '../../../../mobile/static/reader/reader-engine.js';
import '../../../../mobile/static/reader/reader.css';

export const articleTemplates=[{value:'PLAIN',label:'清简 · 默认'},{value:'CLASSIC',label:'古籍 · 疏朗'},{value:'INK',label:'淡墨 · 留白'}];
type Engine={render:(data:unknown)=>void;destroy:()=>void};
export default function ArticleTemplatePreview({blocks,templateCode='PLAIN'}:{blocks:Block[];templateCode?:string|null}){
  const root=useRef<HTMLDivElement>(null),reader=useRef<Engine|null>(null),[fontSize,setFontSize]=useState(16),[visible,setVisible]=useState(false);
  useEffect(()=>{if(!visible||!root.current)return;const engine=(globalThis as unknown as {AcademyReader:{create:(root:HTMLElement,send:(value:unknown)=>void)=>Engine}}).AcademyReader;reader.current=engine.create(root.current,()=>{});return()=>{reader.current?.destroy();reader.current=null;};},[visible]);
  useEffect(()=>{reader.current?.render({blocks:blocks.filter(b=>['paragraph','quote','image'].includes(b.type)),templateCode,fontSize,annotations:[],selectionMode:'native'});},[visible,blocks,templateCode,fontSize]);
  return <div style={{marginBottom:20}}><Space wrap><Typography.Text type="secondary">版式预览复用 App 阅读器，宋体引用、黑体正文。</Typography.Text><Button onClick={()=>setVisible(!visible)}>{visible?'收起预览':'预览手机排版'}</Button>{visible&&<Segmented aria-label="预览正文字号" value={fontSize} onChange={setFontSize} options={[{value:16,label:'标准字'},{value:20,label:'大字'},{value:24,label:'特大字'}]}/>}</Space>{visible&&<><Alert type="info" showIcon title="这里预览文字与图片；音视频保存草稿后可在查看页受控试看。切换模板不会改变段落标识或笔记引用。" style={{marginTop:12}}/><div style={{maxWidth:390,width:'100%',margin:'16px auto',background:'#FAF8F2',padding:'0 18px',border:'1px solid #DFD9CF',borderRadius:8,boxSizing:'border-box'}}><div ref={root} className="academy-reader article-template-preview"/></div></>}</div>;
}
