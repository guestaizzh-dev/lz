import { Injectable, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AppStoreServerAPIClient, Environment, InAppOwnershipType, SignedDataVerifier, Type, type JWSTransactionDecodedPayload } from '@apple/app-store-server-library';
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

type Config = { bundleId:string; environment:Environment; client:AppStoreServerAPIClient; verifier:SignedDataVerifier };
export type AppleFact = { transactionId:string; originalTransactionId:string; productId:string; accountToken:string; bundleId:string; environment:string; type:string; amount:bigint; currency:string; purchasedAt:Date; signedAt:Date; revokedAt:Date|null; revocationType:string|null; revocationPercentage:number|null };
const rootFingerprint='63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Called only after Apple's verifier has authenticated the JWS chain and application scope.
export function appleFact(data:JWSTransactionDecodedPayload,bundleId:string,environment:string):AppleFact {
  const date=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=Date.now()+300000;
  if(data.bundleId!==bundleId||data.environment!==environment||!data.transactionId||!/^\d{1,40}$/.test(data.transactionId)||!data.originalTransactionId||!/^\d{1,40}$/.test(data.originalTransactionId)||!data.productId||!/^[-\w.]{1,255}$/.test(data.productId)||!data.appAccountToken||!uuid.test(data.appAccountToken)||data.inAppOwnershipType!==InAppOwnershipType.PURCHASED||data.quantity!==1||!Object.values(Type).includes(data.type as Type)||!date(data.purchaseDate)||!date(data.signedDate)||data.signedDate!<data.purchaseDate!||data.currency!=='CNY'||!Number.isSafeInteger(data.price)||data.price!<=0||data.price!>1000000000||data.price!%10!==0||data.revocationDate!==undefined&&!date(data.revocationDate)||data.revocationDate!==undefined&&data.revocationDate<data.purchaseDate!)throw new UnauthorizedException('Apple交易身份、环境、金额或归属无效');
    if(data.revocationPercentage!==undefined&&(!Number.isInteger(data.revocationPercentage)||data.revocationPercentage<=0||data.revocationPercentage>100000)||data.revocationDate!==undefined&&data.revocationDate>data.signedDate!||data.revocationDate===undefined&&(data.revocationPercentage!==undefined||data.revocationType!==undefined))throw new UnauthorizedException('Apple退款比例或撤销时间无效');
  return{transactionId:data.transactionId,originalTransactionId:data.originalTransactionId,productId:data.productId,accountToken:data.appAccountToken.toLowerCase(),bundleId,environment,type:data.type!,amount:BigInt(data.price!/10),currency:data.currency,purchasedAt:new Date(data.purchaseDate!),signedAt:new Date(data.signedDate!),revokedAt:data.revocationDate===undefined?null:new Date(data.revocationDate),revocationType:data.revocationType??null,revocationPercentage:data.revocationPercentage??null};
}

@Injectable()
export class AppleStoreService implements OnModuleInit {
  private configured?:Config;
  onModuleInit(){if(process.env.APPLE_IAP_ENABLED==='true')this.config();}
  identity(){const config=this.config();return{bundleId:config.bundleId,environment:config.environment,appScope:config.bundleId+':'+config.environment};}
  private config():Config {
    if(process.env.APPLE_IAP_ENABLED!=='true')throw new ServiceUnavailableException('Apple内购尚未开放');
    if(this.configured)return this.configured;
    try {
      const bundleId=process.env.APPLE_BUNDLE_ID!,keyId=process.env.APPLE_KEY_ID!,issuerId=process.env.APPLE_ISSUER_ID!,environment=process.env.APPLE_ENVIRONMENT;
      if(!/^[\w-]+(?:\.[\w-]+)+$/.test(bundleId)||!/^\w{10}$/.test(keyId)||!uuid.test(issuerId)||!['Production','Sandbox'].includes(environment!)||process.env.NODE_ENV==='production'&&environment!=='Production')throw new Error('Invalid Apple scope');
      const key=createPrivateKey(readFileSync(process.env.APPLE_PRIVATE_KEY_FILE!));
      if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw new Error('Invalid Apple signing key');
      const root=readFileSync(process.env.APPLE_ROOT_CA_FILE!),certificate=new X509Certificate(root);
      if(digest(root)!==rootFingerprint||!certificate.ca||!certificate.verify(certificate.publicKey))throw new Error('Invalid Apple trust anchor');
      const appId=Number(process.env.APPLE_APP_ID);
      if(environment==='Production'&&(!Number.isSafeInteger(appId)||appId<=0))throw new Error('Missing Apple application ID');
      const env=environment as Environment;
      this.configured={bundleId,environment:env,client:new AppStoreServerAPIClient(key.export({type:'pkcs8',format:'pem'}).toString(),keyId,issuerId,bundleId,env),verifier:new SignedDataVerifier([root],true,env,bundleId,environment==='Production'?appId:undefined)};
      return this.configured;
    }catch{throw new ServiceUnavailableException('Apple内购配置不完整或环境不安全，暂不收取费用');}
  }
  private async decode(signed:string):Promise<AppleFact>{
    const config=this.config();
    if(typeof signed!=='string'||signed.length>65536||signed.split('.').length!==3)throw new UnauthorizedException('Apple签名格式无效');
    try{return appleFact(await config.verifier.verifyAndDecodeTransaction(signed),config.bundleId,config.environment);}catch{throw new UnauthorizedException('Apple交易签名或身份验证失败');}
  }
  async latest(transactionId:string):Promise<AppleFact>{
    if(!/^\d{1,40}$/.test(transactionId))throw new UnauthorizedException('Apple交易编号无效');
    const config=this.config();let signed:string|undefined;
    try{signed=(await config.client.getTransactionInfo(transactionId)).signedTransactionInfo;}catch{throw new ServiceUnavailableException('暂时无法向Apple核实交易，请保留交易并稍后恢复');}
    if(!signed)throw new ServiceUnavailableException('Apple尚未返回可验证的交易');
    const fact=await this.decode(signed);if(fact.transactionId!==transactionId)throw new UnauthorizedException('Apple查询结果与交易编号不一致');return fact;
  }
  async restore(signed:string,accountToken:string){
    const original=await this.decode(signed);
    if(original.accountToken!==accountToken.toLowerCase())throw new UnauthorizedException('此Apple交易属于其他书院账号，请使用原账号恢复');
    const latest=await this.latest(original.transactionId);
    if(latest.accountToken!==original.accountToken||latest.originalTransactionId!==original.originalTransactionId||latest.productId!==original.productId||latest.type!==original.type||latest.currency!==original.currency||latest.amount!==original.amount||latest.purchasedAt.getTime()!==original.purchasedAt.getTime())throw new UnauthorizedException('Apple交易的原始购买事实不一致');
    return latest;
  }
  async notification(signed:string){
    const config=this.config();
    if(typeof signed!=='string'||signed.length>131072||signed.split('.').length!==3)throw new UnauthorizedException('Apple通知格式无效');
    let payload;
    try{payload=await config.verifier.verifyAndDecodeNotification(signed);}catch{throw new UnauthorizedException('Apple通知签名或环境无效');}
    if(!payload.notificationUUID||!uuid.test(payload.notificationUUID)||payload.version!=='2.0')throw new UnauthorizedException('Apple通知身份无效');
    if(payload.notificationType==='TEST')return{id:payload.notificationUUID,kind:'TEST',payloadHash:digest(signed),fact:null};
    if(!payload.data?.signedTransactionInfo)throw new UnauthorizedException('Apple通知缺少受支持的交易事实');
    const original=await this.decode(payload.data.signedTransactionInfo),latest=await this.latest(original.transactionId);
    if(latest.originalTransactionId!==original.originalTransactionId||latest.productId!==original.productId||latest.accountToken!==original.accountToken)throw new UnauthorizedException('Apple通知查询的归属不一致');
    return{id:payload.notificationUUID,kind:payload.notificationType??'UNKNOWN',payloadHash:digest(signed),fact:latest};
  }
}
