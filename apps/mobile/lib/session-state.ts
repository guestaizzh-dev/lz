import type {PrivateStore} from './secure-storage';
export type AppUser={id:string;nickname:string;avatar:string|null;tags:string[];roles:string[]};
export type LoginResult={user:AppUser;accessToken:string;refreshToken:string;expiresIn:number};
type SavedSession=LoginResult&{rotationId?:string};
export function createSessionState(store:PrivateStore,marker:{read:()=>boolean;write:(value:boolean)=>void},publish:(user:AppUser|null)=>void){
  let value:SavedSession|null=null,generation=0,restored=false;
  function restore(){
    if(restored)return;
    if(marker.read()){restored=true;return;}
    const raw=store.read('session');
    if(raw){const parsed=JSON.parse(raw) as SavedSession;if(!parsed.user?.id||typeof parsed.accessToken!=='string'||typeof parsed.refreshToken!=='string'||parsed.refreshToken.length!==43)throw new Error('登录记录无效，请重新登录');value=parsed;generation++;publish(value.user);}
    restored=true;
  }
  function save(next:LoginResult,rotation=false){
    marker.write(true);
    store.write('session',JSON.stringify(next));
    marker.write(false);
    value=next;restored=true;if(!rotation)generation++;publish(next.user);
  }
  function clear(){
    // A non-secret tombstone prevents a failed secure deletion restoring a logged-out account.
    value=null;generation++;publish(null);
    marker.write(true);store.remove('session');restored=true;
  }
  function rotation(id:()=>string):string{
    if(!value)throw new Error('请重新登录');
    if(!value.rotationId){const next={...value,rotationId:id()};store.write('session',JSON.stringify(next));value=next;}
    return value.rotationId!;
  }
  return {restore,save,clear,rotation,generation:()=>generation,access:()=>value?.accessToken??'',refresh:()=>value?.refreshToken??'',user:()=>value?.user??null};
}
