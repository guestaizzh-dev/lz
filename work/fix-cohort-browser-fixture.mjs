import {readFile,writeFile} from 'node:fs/promises';
const path='scripts/browser/cohort-sales.mjs';let text=await readFile(path,'utf8');text=text.replace("body:'人法地，地法天，天法道，道法自然。',required:true","body:'人法地，地法天，天法道，道法自然。',durationSeconds:0,trial:false,required:true");await writeFile(path,text);
