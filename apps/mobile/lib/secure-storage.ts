import {apiBase} from './environment';
// #ifdef APP-ANDROID || APP-IOS
import {secureRead,secureWrite,secureRemove} from '@/uni_modules/academy-secure-storage';
// #endif

export type PrivateStore={read:(key:string)=>string|null;write:(key:string,value:string)=>void;remove:(key:string)=>void};
const memory=new Map<string,string>();
function checked(raw:string):string|null {const result=JSON.parse(raw) as {ok:boolean;value?:string|null};if(!result.ok)throw new Error('安全存储暂时不可用，请解锁设备后重试');return result.value??null;}
const scoped=(key:string):string=>apiBase+'|'+key;
export const privateStore:PrivateStore={
  read(key){
    // #ifdef APP-ANDROID || APP-IOS
    return checked(secureRead(scoped(key)));
    // #endif
    // #ifndef APP-ANDROID || APP-IOS
    return memory.get(scoped(key))??null;
    // #endif
  },
  write(key,value){
    // #ifdef APP-ANDROID || APP-IOS
    checked(secureWrite(scoped(key),value));
    // #endif
    // #ifndef APP-ANDROID || APP-IOS
    memory.set(scoped(key),value);
    // #endif
  },
  remove(key){
    // #ifdef APP-ANDROID || APP-IOS
    checked(secureRemove(scoped(key)));
    // #endif
    // #ifndef APP-ANDROID || APP-IOS
    memory.delete(scoped(key));
    // #endif
  },
};
