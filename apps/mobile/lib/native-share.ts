import {sessionGeneration} from './session';
export type SharePayload={title:string;description:string;url:string;coverUrl:string};
export function shareOutcome(error:{errCode?:number;errMsg?:string}):string{return error.errCode===1310600||/cancel|取消/i.test(error.errMsg??'')?'CANCELLED':'FAILED';}
export async function nativeShare(payload:SharePayload):Promise<void>{
 const generation=sessionGeneration();
 const copy=()=>uni.setClipboardData({data:payload.title+'\n'+payload.url,success:()=>uni.showToast({title:'链接已复制',icon:'none'})});
 // #ifdef WEB
 copy();return;
 // #endif
 // #ifdef APP
 const providers=await new Promise<string[]>(resolve=>uni.getProvider({service:'share',success:r=>resolve(r.providers.map(p=>p.id)),fail:()=>resolve([])}));
 if(generation!==sessionGeneration())return;
 const choices=providers.includes('weixin')?['微信好友','微信朋友圈','系统分享','复制链接']:['系统分享','复制链接'];
 uni.showActionSheet({itemList:choices,success:selection=>{
  if(generation!==sessionGeneration())return;
  const choice=choices[selection.tapIndex];if(choice==='复制链接'){copy();return;}
  const fail=(e:{errCode?:number;errMsg?:string})=>{if(generation!==sessionGeneration())return;uni.showToast({title:shareOutcome(e)==='CANCELLED'?'已取消分享':'分享未完成，可重试或复制链接',icon:'none'});};
  if(choice==='系统分享'){uni.shareWithSystem({summary:payload.title+'\n'+payload.description,href:payload.url,fail});return;}
  uni.share({provider:'weixin',scene:choice==='微信朋友圈'?'WXSceneTimeline':'WXSceneSession',type:0,title:payload.title,summary:payload.description,href:payload.url,...(/^https:\/\//.test(payload.coverUrl)?{imageUrl:payload.coverUrl}:{}),fail});
 }});
 // #endif
}
