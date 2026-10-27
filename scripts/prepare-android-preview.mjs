// User-authorized preview without the unopened uni-push service; release sources stay intact.
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,basename} from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,'apps/mobile');
const manifest=JSON.parse(await readFile(resolve(source,'manifest.json'),'utf8'));
assert(/^\d+\.\d+\.\d+$/.test(manifest.versionName)&&Number.isInteger(Number(manifest.versionCode)));
const suffix=manifest.versionName.replaceAll('.','');
const target=resolve(root,'.runtime/android-preview-'+suffix),evidence=resolve(root,'outputs/android-preview-'+suffix);
const rtc=JSON.parse(await readFile(resolve(source,'uni_modules/academy-rtc/utssdk/app-android/config.json'),'utf8'));
assert(rtc.project?.repositories?.includes("maven { url 'https://maven.zego.im' }")&&!rtc.repositories,'ZEGO must use DCloud project.repositories');
await mkdir(resolve(root,'.runtime'),{recursive:true});
await mkdir(evidence,{recursive:true});
try { await mkdir(target); } catch { throw Error('Preview directory already exists; use its recorded build instead of overwriting it.'); }
await cp(source,target,{recursive:true,filter:path=>!relative(source,path).split(/[\\/]/).some(part=>['unpackage','node_modules','.git','.hbuilderx'].includes(part))});
const notificationPath=resolve(source,'lib/notifications.ts');
const original=await readFile(notificationPath,'utf8');
assert(original.includes('uni.getPushClientId'));
const marker='let listening=false,syncing=false;';
assert(original.includes(marker));
await writeFile(resolve(target,'lib/notifications.ts'),original.slice(0,original.indexOf(marker))+`
// This preview deliberately has no system-push SDK. In-app messages use the original API.
export async function refreshPush():Promise<void>{return;}
export function notificationPermission():string{return '预览包未包含系统推送，请在书院消息中查看通知';}
export function openNotificationPermission():void{uni.showToast({title:'请在书院消息中查看通知',icon:'none'});}
`);
const settingsPath=resolve(target,'pages/profile/settings.uvue');
let settings=await readFile(settingsPath,'utf8');
const start=settings.indexOf('<view v-if="currentUser" class="section notification-section">');
const end=settings.indexOf('<view class="section"><text class="section-heading">本机显示</text>',start);
assert(start>=0&&end>start);
settings=settings.slice(0,start)+`<view v-if="currentUser" class="section notification-section"><text class="section-heading">消息与通知</text><text class="intro">本预览包未包含系统推送，订单、课程和互动通知请在书院消息中查看。</text><button class="setting-action" @click="uni.navigateTo({url:'/pages/profile/messages'})">查看书院消息 ›</button></view>\n`+settings.slice(end);
const onShow="onShow(()=>{permission.value=notificationPermission();void loadPreferences();void refreshPush().catch(()=>{});});";
assert(settings.includes(onShow));
settings=settings.replace(onShow,'onShow(()=>{permission.value=notificationPermission();});');
await writeFile(settingsPath,settings);
assert.equal(await readFile(notificationPath,'utf8'),original);
assert(!(await readFile(resolve(target,'lib/notifications.ts'),'utf8')).includes('uni.getPushClientId'));
const environment=await readFile(resolve(target,'lib/environment.ts'),'utf8');
assert(environment.includes("apiEnvironment = 'production'")&&environment.includes('https://cuecanvas.top/api/v1'));
await writeFile(resolve(evidence,'profile.json'),JSON.stringify({project:basename(target),path:target,version:manifest.versionName,code:Number(manifest.versionCode),environment:'production',systemPush:false,inAppMessages:true,releasePushSourcePreserved:true,createdAt:new Date().toISOString()},null,2)+'\n');
console.log('Isolated Android preview prepared: '+target);
