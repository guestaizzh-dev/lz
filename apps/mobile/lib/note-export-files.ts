export function noteExportFolder(userId:string):string {
  if(!/^[a-f0-9-]{36}$/i.test(userId))throw new Error('请重新登录后导出');
  // #ifdef APP
  return uni.env.CACHE_PATH+'/academy-notes-'+userId;
  // #endif
  return '';
}
export function clearNoteExportFiles(userId:string){
  // #ifdef APP
  try{const folder=noteExportFolder(userId),fs=uni.getFileSystemManager();for(const name of fs.readdirSync(folder))if(/^daoxue-notes-\d{14}-[a-z0-9]+\.md$/.test(name))try{fs.unlinkSync(folder+'/'+name);}catch{}}catch{}
  // #endif
}
