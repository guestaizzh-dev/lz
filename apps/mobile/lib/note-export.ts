import {request} from './api';
import {currentUser,sessionGeneration} from './session';
import {clearNoteExportFiles,noteExportFolder} from './note-export-files';
export type NoteExportOptions={scope?:'all'|'notes'|'highlights'|'favorites';sort?:'article'|'newest'|'oldest';articleId?:string;fromDay?:string;toDay?:string;q?:string};
type ExportFile={filename:string;markdown:string;counts:{notes:number;favorites:number}};
export async function exportNotes(options:NoteExportOptions={}):Promise<{state:'downloaded'|'shared'|'cancelled'|'empty';filename:string;counts:ExportFile['counts']}> {
  const owner=currentUser.value?.id,generation=sessionGeneration();
  if(!owner)throw new Error('请登录后导出');
  const assertOwner=()=>{if(currentUser.value?.id!==owner||sessionGeneration()!==generation)throw new Error('账号已变化，请重新选择导出范围');};
  const query=Object.entries(options).filter(([,value])=>value).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(value!)).join('&');
  const result=await request<ExportFile>('/me/notes/export'+(query?'?'+query:''));assertOwner();
  if(!/^daoxue-notes-\d{14}\.md$/.test(result.filename)||typeof result.markdown!=='string')throw new Error('导出文件无效，请重试');
  if(!result.counts.notes&&!result.counts.favorites)return{state:'empty',filename:result.filename,counts:result.counts};
  // #ifdef WEB
  const url=URL.createObjectURL(new Blob([result.markdown],{type:'text/markdown;charset=utf-8'}));
  try{const link=document.createElement('a');link.href=url;link.download=result.filename;document.body.appendChild(link);link.click();link.remove();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return{state:'downloaded',filename:result.filename,counts:result.counts};
  // #endif
  // #ifdef APP
  const fs=uni.getFileSystemManager(),folder=noteExportFolder(owner);
  const path=folder+'/'+result.filename.replace('.md','-'+Math.random().toString(36).slice(2,10)+'.md');
  try{
    clearNoteExportFiles(owner);fs.mkdirSync(folder,true);
    await new Promise<void>((resolve,reject)=>{fs.writeFile({filePath:path,data:result.markdown,encoding:'utf-8',success:()=>resolve(),fail:()=>reject(new Error('无法写入导出文件，请检查存储空间后重试'))});});assertOwner();
    const state=await new Promise<'shared'|'cancelled'>((resolve,reject)=>{uni.shareWithSystem({type:'file',filePaths:[path],success:()=>resolve('shared'),fail:error=>{if(error.errCode===1310600)resolve('cancelled');else reject(new Error('无法打开系统文件分享，请重试或选择其他接收应用'));}});});
    assertOwner();if(state==='cancelled')try{fs.unlinkSync(path);}catch{}
    return{state,filename:result.filename,counts:result.counts};
  }catch(error){try{fs.unlinkSync(path);}catch{}throw error;}
  // #endif
}
