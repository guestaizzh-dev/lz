import {BadRequestException} from '@nestjs/common';
import {IsIn,IsOptional,IsString,IsUUID,Length,Matches} from 'class-validator';
import type {Database} from './database.js';
import {demoScope} from './public-content.js';

export class NoteExportQuery {
  @IsOptional() @IsIn(['all','notes','highlights','favorites']) scope='all';
  @IsOptional() @IsIn(['article','newest','oldest']) sort='article';
  @IsOptional() @IsUUID() articleId?:string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) fromDay?:string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) toDay?:string;
  @IsOptional() @IsString() @Length(0,80) q?:string;
}
const chinaTime=(date:Date)=>new Date(date.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ')+'（北京时间）';
const md=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g,'\\$1');
function day(value:string|undefined){
  if(!value)return undefined;
  const date=new Date(value+'T00:00:00+08:00');
  if(!Number.isFinite(date.getTime())||chinaTime(date).slice(0,10)!==value)throw new BadRequestException('请选择有效的日期');
  return date;
}

export async function exportPrivateNotes(db:Database,userId:string,query:NoteExportQuery){
  const from=day(query.fromDay),to=day(query.toDay),q=query.q?.trim();
  if(from&&to&&from>to)throw new BadRequestException('开始日期不能晚于结束日期');
  const createdAt={...(from?{gte:from}:{}),...(to?{lt:new Date(to.getTime()+86400000)}:{})};
  const scope={userId,createdAt,...(query.articleId?{articleId:query.articleId}:{})};
  // A bounded export fails explicitly instead of exhausting memory or silently losing records.
  const [notes,favorites]=await db.$transaction([
    db.note.findMany({where:{...scope,deletedAt:null,...(query.scope==='favorites'?{id:{in:[]}}:query.scope==='notes'?{text:{not:''}}:query.scope==='highlights'?{rangeStart:{not:null}}:{}),...(q?{OR:[{text:{contains:q,mode:'insensitive'}},{quote:{contains:q,mode:'insensitive'}},{articleTitle:{contains:q,mode:'insensitive'}}]}:{})},orderBy:query.sort==='article'?[{articleTitle:'asc'},{articleId:'asc'},{createdAt:'asc'},{id:'asc'}]:[{createdAt:query.sort==='newest'?'desc':'asc'},{id:'asc'}],take:5001}),
    db.favorite.findMany({where:{...scope,...(!['all','favorites'].includes(query.scope)?{id:{in:[]}}:{})},orderBy:[{createdAt:query.sort==='oldest'?'asc':'desc'},{id:'asc'}],take:5001}),
  ]);
  if(notes.length>5000||favorites.length>5000)throw new BadRequestException('本次记录超过5000条，请按文章或日期缩小范围后导出');
  if(notes.reduce((bytes,n)=>bytes+Buffer.byteLength(n.text+n.quote+n.articleTitle),0)>6*1024*1024)throw new BadRequestException('本次内容过大，请按文章或日期分批导出');
  const articles=await db.article.findMany({where:{id:{in:favorites.map(f=>f.articleId)},status:'PUBLISHED',...await demoScope(db)},select:{id:true,title:true,summary:true}});
  const visible=new Map(articles.map(a=>[a.id,a])),selectedFavorites=favorites.filter(f=>!q||[visible.get(f.articleId)?.title,visible.get(f.articleId)?.summary].some(s=>s?.toLocaleLowerCase().includes(q.toLocaleLowerCase())));
  if(query.sort==='article')selectedFavorites.sort((a,b)=>(visible.get(a.articleId)?.title??'内容已下架').localeCompare(visible.get(b.articleId)?.title??'内容已下架','zh-CN')||a.articleId.localeCompare(b.articleId));
  const exportedAt=new Date(),lines=['# 老子道学书院 · 私人研习记录','',`导出时间：${chinaTime(exportedAt)}`,'','本文件含私人记录，请妥善保存。分享给他人后，书院无法撤回对方已保存的副本。',''];
  if(query.fromDay||query.toDay)lines.push(`记录日期：${query.fromDay??'不限'} 至 ${query.toDay??'不限'}（北京时间）`,'');
  if(query.scope!=='favorites'){
    lines.push('## 笔记与标注','');let previous='';
    for(const note of notes){
      if(query.sort!=='article'||previous!==note.articleId){lines.push(`### ${md(note.articleTitle)}`,'');previous=note.articleId;}
      const ranges=Array.isArray(note.ranges)?note.ranges:[];
      lines.push(`原文版本：${note.articleVersion}${note.rangeStart!==null?' · 划线标注'+(ranges.length>1?`（${ranges.length}段）`:''):''}`,'',...note.quote.split(/\r?\n/).map(line=>'> '+md(line)),'',md(note.text),'',`记录时间：${chinaTime(note.createdAt)}`,'');
    }
    if(!notes.length)lines.push('所选范围暂无笔记或标注。','');
  }
  if(['all','favorites'].includes(query.scope)){
    lines.push('## 收藏','');
    for(const favorite of selectedFavorites){const a=visible.get(favorite.articleId);lines.push(`- ${a?md(a.title)+'：'+md(a.summary):'内容已下架'}（收藏于 ${chinaTime(favorite.createdAt)}）`);}
    if(!selectedFavorites.length)lines.push('所选范围暂无收藏。');
  }
  const markdown=lines.join('\n')+'\n';
  if(Buffer.byteLength(markdown)>8*1024*1024)throw new BadRequestException('本次内容过大，请按文章或日期分批导出');
  return{filename:`daoxue-notes-${chinaTime(exportedAt).slice(0,19).replace(/[-: ]/g,'')}.md`,markdown,counts:{notes:notes.length,favorites:selectedFavorites.length}};
}
