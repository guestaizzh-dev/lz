import { createCipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

// Token04 AES-GCM packet matches ZEGO's current official Node server assistant.
// ServerSecret is its 32-character UTF-8 key, not a hex-decoded 16-byte key.
export function zegoToken04(appId:number,userId:string,secret:string,seconds:number,payload:string,now=Math.floor(Date.now()/1000)) {
  if(!Number.isInteger(appId)||appId<=0||appId>0xffffffff||!userId||userId.length>64||Buffer.byteLength(secret)!==32||!Number.isInteger(seconds)||seconds<1)throw new Error('Invalid ZEGO Token04 inputs');
  const expires=now+seconds,iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(secret),iv);
  const body=JSON.stringify({app_id:appId,user_id:userId,nonce:randomInt(-2147483648,2147483648),ctime:now,expire:expires,payload});
  const encrypted=Buffer.concat([cipher.update(body,'utf8'),cipher.final(),cipher.getAuthTag()]);
  const head=Buffer.alloc(10),length=Buffer.alloc(2);head.writeBigInt64BE(BigInt(expires));head.writeUInt16BE(iv.length,8);length.writeUInt16BE(encrypted.length);
  return '04'+Buffer.concat([head,iv,length,encrypted,Buffer.from([1])]).toString('base64');
}
export function zegoCallbackSignature(secret:string,timestamp:string,nonce:string){return createHash('sha1').update([secret,timestamp,nonce].sort().join('')).digest('hex');}
export const rtcRoomId=(id:string)=>'academy_'+id.replace(/-/g,'');
export const rtcStreamId=(id:string)=>'lecture_'+id.replace(/-/g,'');

@Injectable()
export class ZegoService {
  private sequence=0;
  config(){
    const appId=Number(process.env.ZEGO_APP_ID),secret=process.env.ZEGO_SERVER_SECRET??'',server=process.env.ZEGO_RTC_SERVER??'';
    if(process.env.ZEGO_RTC_ENABLED!=='true'||!Number.isInteger(appId)||appId<=0||appId>0xffffffff||Buffer.byteLength(secret)!==32||!/^wss:\/\/[a-z0-9.-]+\.(zego\.im|zego\.com|zegocloud\.com)(\/[^?#]*)?$/i.test(server))throw new ServiceUnavailableException('直播服务尚未配置，请联系书院');
    return {appId,secret,server};
  }
  ready(){try{this.config();return process.env.ZEGO_ROOM_TOKEN_AUTH_ENABLED==='true'||process.env.ZEGO_ALLOW_UNVERIFIED_TOKEN_AUTH==='true';}catch{return false;}}
  token(userId:string,sessionId:string,host:boolean,publishStreamId?:string){
    return this.roomToken(userId,rtcRoomId(sessionId),rtcStreamId(sessionId),host,publishStreamId);
  }
  roomToken(userId:string,roomId:string,streamId:string,publish:boolean,publishStreamId=streamId){
    const {appId,secret,server}=this.config();
    if(!this.ready())throw new ServiceUnavailableException('ZEGO 房间及推流权限认证尚未核验，直播入口暂不开放');
    const payload=JSON.stringify({room_id:roomId,privilege:{1:1,2:publish?1:0},stream_id_list:publish?[publishStreamId]:null});
    return {appId,server,roomId,streamId,userId,token:zegoToken04(appId,userId,secret,120,payload),expiresAt:new Date(Date.now()+120000).toISOString()};
  }
  verifyCallback(body:Record<string,unknown>){
    const secret=process.env.ZEGO_CALLBACK_SECRET??'',signature=body.signature,timestamp=body.timestamp,nonce=body.nonce;
    if(!secret||typeof signature!=='string'||!/^[a-f0-9]{40}$/i.test(signature)||typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||typeof nonce!=='string'||nonce.length<1||nonce.length>128||String(body.appid)!==String(process.env.ZEGO_APP_ID)||Math.abs(Date.now()/1000-Number(timestamp))>300)throw new UnauthorizedException('直播回调无效');
    const expected=zegoCallbackSignature(secret,timestamp,nonce);
    if(!timingSafeEqual(Buffer.from(signature.toLowerCase()),Buffer.from(expected)))throw new UnauthorizedException('直播回调验签失败');
  }
  async request(action:'KickoutUser'|'DescribeRTCStreamState',params:Record<string,string>){
    // The deployment has one API process; concurrent polling must still use increasing sequences.
    if(action==='DescribeRTCStreamState'){this.sequence=Math.max(Date.now(),this.sequence+1);params={...params,Sequence:String(this.sequence)};}
    const {appId,secret}=this.config(),nonce=randomBytes(8).toString('hex'),timestamp=String(Math.floor(Date.now()/1000));
    const query=new URLSearchParams({Action:action,AppId:String(appId),SignatureNonce:nonce,Timestamp:timestamp,Signature:createHash('md5').update(String(appId)+nonce+secret+timestamp).digest('hex'),SignatureVersion:'2.0',...params});
    try{
      const response=await fetch('https://rtc-api.zego.im/?'+query,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('RTC unavailable');
      const data=await response.json() as {Code:number;RequestId?:string;Data?:{create_time?:string;close_time?:string}};
      if(!Number.isInteger(data.Code))throw new Error('Invalid RTC response');
      return data;
    }catch{throw new ServiceUnavailableException('暂时无法连接直播服务，操作已保留，请稍后重试');}
  }
  async kickRoom(roomId:string,userId:string){const result=await this.request('KickoutUser',{RoomId:roomId,'UserId[]':userId,CustomReason:'研习连接权限已失效'});if(result.Code!==0)throw new ServiceUnavailableException('退房仍待确认');return result;}
  async kick(sessionId:string,userId:string){return this.kickRoom(rtcRoomId(sessionId),userId);}
}
