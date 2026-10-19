import {readFile,writeFile} from 'node:fs/promises';
const path='services/api/test/cohort-sales.test.mjs';let text=await readFile(path,'utf8');text=text.replace("'/refresh',operator,'POST',{})).status,500","'/refresh',finance,'POST',{})).status,500");text=text.replace("title:'原文诵读',position:3,format:'AUDIO'","title:'原文诵读',body:'原文诵读说明',position:3,format:'AUDIO'");await writeFile(path,text);
