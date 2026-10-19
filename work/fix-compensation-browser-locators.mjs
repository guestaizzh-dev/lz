import {readFileSync,writeFileSync} from 'node:fs';
const path='scripts/browser/cohort-compensation.mjs';let text=readFileSync(path,'utf8');
text=text.replaceAll("mobile.getByText('确认最新营期安排',{exact:true})", "mobile.locator('uni-button').filter({hasText:'确认最新营期安排'})");
writeFileSync(path,text);
