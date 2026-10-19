import {readFileSync,writeFileSync} from 'node:fs';
const path='docs/26-remaining-development-plan.md';let text=readFileSync(path,'utf8');
const old='52；126关联、3生产配置专项、8实际页面及API/Pro/App Web通过，第39迁移本地应用，161表/160模型；规范数据保持，隔离渠道不是商用证据';
assertCount(text,old,2);text=text.replaceAll(old,'53；180关联回归、9实际页面及API/Pro/App Web通过，第40迁移本地应用，161表/160模型；规范数据保持，隔离渠道不是商用证据');
text=text.replace('与52付费营期收退款本地通过','与52—53付费营期收退款、延期取消和本人同意协商补偿本地通过');writeFileSync(path,text);
function assertCount(text,word,expected){if(text.split(word).length-1!==expected)throw Error('Unexpected documentation evidence matches');}
