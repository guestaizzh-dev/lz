import { useModel } from '@umijs/max';
import { useEffect } from 'react';

export default function PermissionRefresh() {
  const {initialState,setInitialState}=useModel('@@initialState');
  useEffect(()=>{
    let pending=false,disposed=false,last=0;
    const refresh=async()=>{
      if(pending||document.hidden||!initialState?.currentUser||Date.now()-last<5000)return;
      pending=true;last=Date.now();
      try{
        const user=await initialState.fetchUserInfo?.();
        if(user&&!disposed&&JSON.stringify(user)!==JSON.stringify(initialState.currentUser))await setInitialState(state=>({...state,currentUser:user}));
      }finally{pending=false;}
    };
    window.addEventListener('focus',refresh);
    window.addEventListener('daoxue:permissions-changed',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{disposed=true;window.removeEventListener('focus',refresh);window.removeEventListener('daoxue:permissions-changed',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[initialState?.currentUser,initialState?.fetchUserInfo,setInitialState]);
  return null;
}
