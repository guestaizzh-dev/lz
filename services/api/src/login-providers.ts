import {createHash,createPrivateKey,createPublicKey,sign,verify,type JsonWebKey} from 'node:crypto';
import {Injectable,ServiceUnavailableException,UnauthorizedException} from '@nestjs/common';

export type LoginProvider='WECHAT'|'APPLE';
type Config={provider:LoginProvider;appScope:string};
export function socialLoginConfig(provider:LoginProvider,env:NodeJS.ProcessEnv=process.env):Config|null{
  const flag=env['SOCIAL_'+provider+'_ENABLED'];
  if(flag!==undefined&&!['true','false'].includes(flag))throw new Error('SOCIAL_'+provider+'_ENABLED must be true or false');
  if(flag!=='true')return null;
  if(provider==='WECHAT'){
    if(!/^wx[a-fA-F0-9]{16}$/.test(env.SOCIAL_WECHAT_APP_ID??'')||!/^\w{32}$/.test(env.SOCIAL_WECHAT_SECRET??''))throw new Error('WeChat login requires its own open-platform AppID and server secret');
    return{provider,appScope:env.SOCIAL_WECHAT_APP_ID!};
  }
  if(!/^[A-Za-z0-9.-]{3,200}$/.test(env.SOCIAL_APPLE_CLIENT_ID??'')||!/^\w{10}$/.test(env.SOCIAL_APPLE_TEAM_ID??'')||!/^\w{10}$/.test(env.SOCIAL_APPLE_KEY_ID??''))throw new Error('Apple login requires client, team and key identifiers');
  try{const key=createPrivateKey((env.SOCIAL_APPLE_PRIVATE_KEY??'').replaceAll('\\n','\n'));if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error();}catch{throw new Error('Apple login requires its own P-256 private key');}
  return{provider,appScope:env.SOCIAL_APPLE_CLIENT_ID!};
}
const encoded=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function appleSecret(){
  const now=Math.floor(Date.now()/1000),body=encoded({alg:'ES256',kid:process.env.SOCIAL_APPLE_KEY_ID})+'.'+encoded({iss:process.env.SOCIAL_APPLE_TEAM_ID,iat:now,exp:now+300,aud:'https://appleid.apple.com',sub:process.env.SOCIAL_APPLE_CLIENT_ID});
  return body+'.'+sign('sha256',Buffer.from(body),{key:createPrivateKey(process.env.SOCIAL_APPLE_PRIVATE_KEY!.replaceAll('\\n','\n')),dsaEncoding:'ieee-p1363'}).toString('base64url');
}
export function verifyAppleLoginToken(token:string,keys:JsonWebKey[],audience:string){
  try{
    if(token.length>16384)throw Error();const parts=token.split('.');if(parts.length!==3)throw Error();
    const header=JSON.parse(Buffer.from(parts[0]!,'base64url').toString()),claims=JSON.parse(Buffer.from(parts[1]!,'base64url').toString()),now=Math.floor(Date.now()/1000);
    const key=keys.find(k=>(k as JsonWebKey&{kid?:string}).kid===header.kid&&k.kty==='RSA'&&(k as JsonWebKey&{use?:string}).use==='sig');
    if(header.alg!=='RS256'||!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2]!,'base64url')))throw Error();
    if(claims.iss!=='https://appleid.apple.com'||claims.aud!==audience||typeof claims.sub!=='string'||!claims.sub.length||claims.sub.length>255||!Number.isInteger(claims.exp)||claims.exp<=now||!Number.isInteger(claims.iat)||claims.iat>now+60||claims.iat<now-600)throw Error();
    return claims.sub as string;
  }catch{throw new UnauthorizedException('Apple授权无效或已过期，请重新授权');}
}

@Injectable()
export class LoginProviders{
  private appleKeys:{expires:number;keys:JsonWebKey[]}|null=null;
  private pendingKeys:Promise<JsonWebKey[]>|null=null;
  async json(url:string,options:RequestInit={}):Promise<Record<string,unknown>>{
    try{const response=await fetch(url,{...options,signal:AbortSignal.timeout(8000),redirect:'error'});const raw=await response.text();if(raw.length>65536)throw Error();const data=raw?JSON.parse(raw):{};if(!data||typeof data!=='object'||Array.isArray(data))throw Error();if(!response.ok){if(response.status===400&&['invalid_grant','invalid_request'].includes(data.error))throw new UnauthorizedException('授权已失效，请重新授权');throw Error();}return data;}
    catch(e){if(e instanceof UnauthorizedException)throw e;throw new ServiceUnavailableException('授权服务暂不可用，请重新授权后再试');}
  }
  private async keys(){
    if(this.appleKeys&&this.appleKeys.expires>Date.now())return this.appleKeys.keys;
    if(this.pendingKeys)return this.pendingKeys;
    this.pendingKeys=this.json('https://appleid.apple.com/auth/keys').then(data=>{if(!Array.isArray(data.keys)||data.keys.length>20)throw new ServiceUnavailableException('Apple公钥暂不可用');const keys=data.keys as JsonWebKey[];this.appleKeys={keys,expires:Date.now()+3600000};return keys;});
    try{return await this.pendingKeys;}finally{this.pendingKeys=null;}
  }
  async exchange(provider:LoginProvider,code:string){
    const config=socialLoginConfig(provider);if(!config)throw new ServiceUnavailableException('该登录方式尚未开通，请使用手机号登录');
    if(provider==='WECHAT'){
      const query=new URLSearchParams({appid:config.appScope,secret:process.env.SOCIAL_WECHAT_SECRET!,code,grant_type:'authorization_code'}),data=await this.json('https://api.weixin.qq.com/sns/oauth2/access_token?'+query);
      if(data.errcode||typeof data.openid!=='string'||!data.openid||data.openid.length>255||typeof data.access_token!=='string')throw new UnauthorizedException('微信授权无效或已使用，请重新授权');
      // Only the server exchange establishes identity; client openid, profile and email are ignored.
      return{subject:data.openid,refreshToken:null};
    }
    const body=new URLSearchParams({client_id:config.appScope,client_secret:appleSecret(),code,grant_type:'authorization_code'}),data=await this.json('https://appleid.apple.com/auth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    if(data.error||typeof data.id_token!=='string'||typeof data.refresh_token!=='string'||!data.refresh_token)throw new UnauthorizedException('Apple授权无效或已使用，请重新授权');
    const subject=verifyAppleLoginToken(data.id_token,await this.keys(),config.appScope);
    return{subject,refreshToken:data.refresh_token};
  }
  async revokeApple(token:string){
    if(!socialLoginConfig('APPLE'))throw new ServiceUnavailableException('Apple撤销配置未就绪');
    const body=new URLSearchParams({client_id:process.env.SOCIAL_APPLE_CLIENT_ID!,client_secret:appleSecret(),token,token_type_hint:'refresh_token'});
    await this.json('https://appleid.apple.com/auth/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  }
}
export const loginCodeHash=(provider:string,scope:string,code:string)=>createHash('sha256').update(JSON.stringify([provider,scope,code])).digest('hex');
