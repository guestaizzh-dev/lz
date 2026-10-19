import {request} from './api';
import {currentUser,needLogin,sessionGeneration} from './session';
import type {Message} from './teaching';
export type NotificationPreferences={version:number;pushEnabled:boolean;transactions:boolean;learning:boolean;community:boolean;gatewayReady:boolean};
export async function openNotification(id:string){
  if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('无法识别这条消息');
  if(needLogin('/pages/profile/messages?id='+id))return;
  const generation=sessionGeneration(),row=await request<Message>('/me/messages/'+id);
  if(generation!==sessionGeneration())return;
  await request('/me/messages/'+id+'/read',{method:'POST'});
  if(generation!==sessionGeneration())return;
  // Push payloads never supply navigation URLs; resolve the owner-authorized message from our API.
  if(row.target)uni.navigateTo({url:row.target.path});
}
let listening=false,syncing=false;
export async function refreshPush(){
  // #ifdef APP-ANDROID || APP-IOS
  if(!currentUser.value||syncing)return;
  const generation=sessionGeneration();syncing=true;
  try{
    const preferences=await request<NotificationPreferences>('/me/notification-preferences');
    if(generation!==sessionGeneration()||!preferences.pushEnabled)return;
    if(!listening){
      uni.onPushMessage(result=>{if(result.type!=='click')return;const payload=result.data.payload as {notificationId?:string}|null;if(payload?.notificationId)void openNotification(payload.notificationId).catch(e=>uni.showToast({title:(e as Error).message,icon:'none'}));});
      listening=true;
    }
    const clientId=await new Promise<string>((resolve,reject)=>uni.getPushClientId({success:r=>resolve(r.cid),fail:e=>reject(Error(e.errMsg))}));
    if(generation!==sessionGeneration())return;
    const permissionGranted=uni.getAppAuthorizeSetting().notificationAuthorized==='authorized';
    await request('/me/push-device',{method:'POST',data:{clientId,permissionGranted,platform:uni.getDeviceInfo().platform==='ios'?'IOS':'ANDROID'}});
  }finally{syncing=false;}
  // #endif
}
export function notificationPermission():string{
  // #ifdef APP-ANDROID || APP-IOS
  const status=uni.getAppAuthorizeSetting().notificationAuthorized;
  return status==='authorized'?'系统通知已允许':status==='denied'?'系统通知未允许':'请在系统设置中允许通知';
  // #endif
  // #ifndef APP-ANDROID || APP-IOS
  return '浏览器预览保留站内消息，系统通知请在App内设置';
  // #endif
}
export function openNotificationPermission(){
  // #ifdef APP-ANDROID || APP-IOS
  uni.openAppAuthorizeSetting({fail:()=>uni.showToast({title:'请到系统设置中找到本应用，允许通知',icon:'none'})});
  // #endif
  // #ifndef APP-ANDROID || APP-IOS
  uni.showToast({title:'请在安装的App内设置系统通知',icon:'none'});
  // #endif
}
