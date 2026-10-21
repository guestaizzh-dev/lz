import {apiBase} from './environment';
import {accessToken} from './session';
let reporting=false,windowStart=0,count=0;
// Only technical categories and a fingerprint leave the device; no message, stack, query or request body.
export function reportClientError(kind:'RUNTIME'|'API_5XX',error:unknown,requestId?:string,status?:number){
  try{
    const token=accessToken();if(!token||reporting)return;
    const now=Date.now();if(now-windowStart>=60000){windowStart=now;count=0;}if(count>=5)return;
    const detail=error instanceof Error?error.message:typeof error==='string'?error:'unknown';let hash=2166136261;
    for(let i=0;i<Math.min(detail.length,4000);i++)hash=Math.imul(hash^detail.charCodeAt(i),16777619);
    const fingerprint=(hash>>>0).toString(16).padStart(8,'0'),pages=getCurrentPages(),route=pages[pages.length-1]?.route??'unknown',version=uni.getAppBaseInfo().appVersion??'unknown';
    const name=error instanceof Error?error.name:'Unknown',errorType=['Error','TypeError','RangeError','ReferenceError','SyntaxError'].includes(name)?name:'Unknown';
    const data={kind,route:/^pages\/[a-z0-9_/-]{1,100}$/i.test(route)?route:'unknown',build:/^[a-z0-9._-]{1,40}$/i.test(version)?version:'unknown',errorType,fingerprint,...(requestId&&/^[a-f0-9-]{36}$/i.test(requestId)?{requestId}:{}),...(status&&status>=500&&status<=599?{status}:{})};
    count++;reporting=true;
    uni.request({url:apiBase+'/diagnostics',method:'POST',timeout:5000,header:{'Content-Type':'application/json',Authorization:'Bearer '+token},data,complete:()=>{reporting=false;}});
  }catch{reporting=false;}
}
