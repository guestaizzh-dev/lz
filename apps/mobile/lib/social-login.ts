import {request} from './api';
import {sessionGeneration} from './session';
import type {LoginResult} from './session';
export type SocialProvider='WECHAT'|'APPLE';
export type SocialTicket={ticketId:string;state:string;expiresAt:string};
export type SocialResult=LoginResult|{requiresPhone:true;ticketId:string;expiresAt:string};
export function requiresSocialPhone(result:SocialResult):result is {requiresPhone:true;ticketId:string;expiresAt:string}{return'requiresPhone'in result;}
export async function availableSocialProviders():Promise<SocialProvider[]>{
  // #ifdef WEB
  return[];
  // #endif
  // #ifdef APP
  const configured=await request<{items:{provider:SocialProvider;enabled:boolean}[]}>('/auth/social/providers');
  const installed=await new Promise<string[]>(resolve=>uni.getProvider({service:'oauth',success:r=>resolve(r.providers.map(p=>p.id)),fail:()=>resolve([])}));
  let result=configured.items.filter(p=>p.enabled&&installed.includes(p.provider==='WECHAT'?'weixin':'apple')).map(p=>p.provider);
  // #ifdef APP-IOS
  if(!result.includes('APPLE'))result=[];
  // #endif
  return result;
  // #endif
}
export async function authorizeSocial(provider:SocialProvider,binding=false):Promise<{ticket:SocialTicket;result:SocialResult}>{
  const generation=sessionGeneration(),base=binding?'/me/identities':'/auth/social',ticket=await request<SocialTicket>(base+'/challenge',{method:'POST',data:{provider}});
  let authorizationCode='';
  // #ifdef WEB
  throw new Error('请在书院App内使用第三方授权');
  // #endif
  // #ifdef APP
  authorizationCode=await new Promise<string>((resolve,reject)=>uni.login({provider:provider==='WECHAT'?'weixin':'apple',onlyAuthorize:true,success:r=>{const code=provider==='APPLE'?r.appleInfo?.authorizationCode:r.code;if(code)resolve(code);else reject(new Error('未获取到授权码，请重新授权'));},fail:e=>reject(new Error(e.errCode===1310509?'已取消授权':e.errCode===1310502?'请先安装微信，再重试':'授权未完成，请重试或使用手机号登录'))}));
  // #endif
  if(generation!==sessionGeneration())throw new Error('账号已变化，请重新授权');
  const result=await request<SocialResult>(base+'/authorize',{method:'POST',data:{ticketId:ticket.ticketId,state:ticket.state,authorizationCode}});return{ticket,result};
}
