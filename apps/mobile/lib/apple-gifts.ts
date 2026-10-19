import {request} from './api';import {studyEventId} from './learning';import {currentUser,sessionGeneration} from './session';
// #ifdef APP-IOS
import {storeCommand} from '@/uni_modules/academy-store';
// #endif
type StoreResult={state:string;error?:string;products?:{id:string;displayPrice:string;priceMinor:string;currency:string}[];transactions?:{id:string;signedTransaction:string}[]};
async function command(action:string,data:Record<string,unknown>):Promise<StoreResult>{
// #ifdef APP-IOS
const operationId=studyEventId(),start=JSON.parse(storeCommand(action,JSON.stringify({...data,operationId}))) as {ok:boolean;error?:string};if(!start.ok)throw Error(start.error??'Apple操作失败');
for(let i=0;i<300;i++){await new Promise<void>(resolve=>setTimeout(resolve,1000));const response=JSON.parse(storeCommand('STATUS',JSON.stringify({operationId}))) as {ok:boolean;value:StoreResult;error?:string};if(!response.ok)throw Error(response.error??'Apple状态读取失败');if(response.value.state!=='RUNNING'){storeCommand('CLEAR',JSON.stringify({operationId}));if(response.value.state==='ERROR')throw Error(response.value.error??'Apple操作未完成');return response.value;}}
throw Error('Apple交易仍待确认，请勿重复付款，可稍后恢复未完成交易');
// #endif
// #ifndef APP-IOS
throw Error('Apple购买仅在iOS App中提供');
// #endif
}
export async function appleGiftProducts(ids:string[]){return (await command('PRODUCTS',{productIds:ids})).products??[];}
async function acknowledge(result:StoreResult,owner:string|undefined,generation:number){
let count=0;for(const transaction of result.transactions??[]){if(owner!==currentUser.value?.id||generation!==sessionGeneration())throw Error('登录账号已变化，请用原书院账号恢复购买');const receipt=await request<{acknowledged:boolean;explanation:string}>('/commerce/apple/restore',{method:'POST',data:{signedTransaction:transaction.signedTransaction}});if(!receipt.acknowledged)throw Error(receipt.explanation);await command('FINISH',{transactionId:transaction.id});count++;}return count;
}
export async function buyAppleGift(mapping:{id:string;version:number},quoteHash:string){const owner=currentUser.value?.id,generation=sessionGeneration(),prepared=await request<{productId:string;appAccountToken:string;price:string}>('/commerce/apple/prepare',{method:'POST',data:{mappingId:mapping.id,expectedVersion:mapping.version,quoteHash,accepted:true}});if(owner!==currentUser.value?.id||generation!==sessionGeneration())throw Error('账号已变化，请重新确认');const result=await command('PURCHASE',{productId:prepared.productId,appAccountToken:prepared.appAccountToken,priceMinor:prepared.price});if(result.state==='CANCELLED')return '已取消购买';if(result.state==='PENDING')return 'Apple正在处理，请勿重复付款，稍后恢复未完成交易';await acknowledge(result,owner,generation);return 'Apple购买已确认，余额已入账';}
export async function restoreAppleGifts(){const owner=currentUser.value?.id,generation=sessionGeneration(),result=await command('RESTORE',{});const count=await acknowledge(result,owner,generation);return count?'已恢复 '+count+' 笔交易':'没有待恢复的交易';}
