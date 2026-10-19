/* ZEGO Express Web SDK 3.13.0; official SDK stays a pinned runtime dependency. */
(() => {
  'use strict';
  const key=location.hash.slice(1);history.replaceState(null,'',location.pathname);
  const el=id=>document.getElementById(id),show=(id,visible)=>{el(id).hidden=!visible;};
  let engine=null,config=null,local=null,remote=null,timer=null,renewing=false,playing=false,closed=false,connecting=false,mic=true,camera=true,publishing=false,generation=0;
  const status=text=>{el('status').textContent=text;};
  const hint=text=>{el('hint').textContent=text;};
  async function request(path){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch('/api/v1/live/rtc/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,...(path==='refresh'?{watching:config?.role==='VIEWER'&&playing&&!document.hidden}:{})}),cache:'no-store',signal:controller.signal});
    const data=await response.json();if(!response.ok){const error=new Error(Array.isArray(data.message)?data.message.join('；'):data.message||'直播暂不可用');error.status=response.status;throw error;}return data;}finally{clearTimeout(timeout);}
  }
  async function teardown(){
    generation++;clearInterval(timer);timer=null;const old=engine;engine=null;playing=false;publishing=false;
    if(old){try{if(local){old.stopPublishingStream(config.streamId);old.destroyStream(local);local=null;}if(remote){old.stopPlayingStream(config.streamId);remote=null;}old.logoutRoom(config.roomId);old.destroyEngine();}catch{}}
    el('video').replaceChildren();show('empty',true);for(const id of ['start','mic','camera','stop','sound'])show(id,false);
  }
  async function play(){
    if(playing||!engine||config.role==='HOST')return;playing=true;const version=generation,active=engine;
    try{
      const stream=await active.startPlayingStream(config.streamId,{video:true,audio:true});
      if(version!==generation){active.stopPlayingStream(config.streamId);return;}
      remote=stream;const view=active.createRemoteStreamView(stream);view.play(el('video'),{muted:true,enableAutoplayDialog:false});show('empty',false);show('sound',true);hint('正在直播 · 点击开启声音聆听主讲');
    }catch{playing=false;status('画面暂时中断，正在等待主播恢复');show('retry',true);}
  }
  async function renew(){
    if(renewing||!engine||closed)return;renewing=true;
    try{const next=await request('refresh');if(engine)engine.renewToken(next.token);hint(publishing?'正在直播 · 连接正常':playing?(el('sound').hidden?'正在直播 · 声音已开启':'正在直播 · 点击开启声音聆听主讲'):'已连接 · 等待主播画面');}
    catch(error){if([400,401,403,404,409,503].includes(error.status)){await teardown();closed=true;status(error.message);hint('返回直播详情后可重新进入');show('retry',false);}else{hint('网络不稳定，正在重试；权限失效后将退出房间');}}
    finally{renewing=false;}
  }
  async function connect(){
    if(connecting||closed)return;connecting=true;show('retry',false);status('正在连接直播…');
    try{
      await teardown();config=await request('refresh');const active=engine=new ZegoExpressEngine(config.appId,config.server);const version=generation;
      active.setLogConfig({logLevel:'error',remoteLogLevel:'disable'});
      let complete;const loggedIn=new Promise((resolve,reject)=>complete={resolve,reject});
      active.on('roomStateChanged',(_room,reason)=>{
        if(version!==generation)return;
        if(reason==='LOGIN_FAILED')complete.resolve(false);
        if(reason==='LOGINED')complete.resolve(true);
        if(['LOGIN_FAILED','RECONNECT_FAILED','KICKOUT'].includes(reason)){status(reason==='KICKOUT'?'已退出直播间':'连接失败，请重试');show('retry',reason!=='KICKOUT');if(reason==='KICKOUT'){closed=true;void teardown();}}
        if(reason==='RECONNECTING'){show('empty',true);status('网络中断，正在重新连接…');}
        if(['LOGINED','RECONNECTED'].includes(reason)){hint('已连接直播间');if(remote)show('empty',false);}
      });
      active.on('tokenWillExpire',renew);
      active.on('roomStreamUpdate',(_room,type,streams)=>{
        if(version!==generation||config.role==='HOST')return;
        if(streams.some(s=>s.streamID===config.streamId)){
          if(type==='ADD')void play();
          else{active.stopPlayingStream(config.streamId);playing=false;remote=null;show('empty',true);status('主播已停止推流，等待恢复或结束确认');}
        }
      });
      active.on('playerStateUpdate',event=>{if(version!==generation)return;if(event.state==='PLAYING'){show('empty',false);show('retry',false);}else if(event.state==='NO_PLAY'&&event.errorCode){playing=false;show('empty',true);status('播放中断，点击重新连接');show('retry',true);}});
      active.on('publisherStateUpdate',event=>{if(version!==generation)return;if(event.state==='PUBLISHING'){publishing=true;hint('已开始推流 · 正在等待服务端确认开播');}else if(event.state==='NO_PUBLISH'&&event.errorCode){publishing=false;if(local){active.destroyStream(local);local=null;}for(const id of ['mic','camera','stop'])show(id,false);status('推流中断，请重新开播');show('empty',true);show('start',true);}});
      const login=Promise.resolve(active.loginRoom(config.roomId,config.token,{userID:config.userId,userName:config.role==='HOST'?'书院主讲':'研习者'},{userUpdate:false})).then(accepted=>accepted===false?false:loggedIn);
      let loginTimeout;
      try{if(!await Promise.race([loggedIn,login,new Promise(resolve=>loginTimeout=setTimeout(()=>resolve(false),20000))]))throw new Error('直播登录失败');}finally{clearTimeout(loginTimeout);}
      if(version!==generation)return;
      status(config.role==='HOST'?'准备就绪，点击开始直播授权摄像头与麦克风':'等待主播画面…');show('start',config.role==='HOST');timer=setInterval(renew,30000);
    }catch(error){await teardown();status(error.status?error.message:'暂时无法连接直播，请检查网络后重试');show('retry',true);}finally{connecting=false;}
  }
  el('start').onclick=async()=>{
    if(!engine||local)return;el('start').disabled=true;const version=generation,active=engine;
    try{const stream=await active.createZegoStream({camera:{video:true,audio:true}});if(version!==generation){active.destroyStream(stream);return;}local=stream;mic=true;camera=true;el('mic').textContent='关闭麦克风';el('camera').textContent='关闭摄像头';local.playVideo(el('video'),{enableAutoplayDialog:true});show('empty',false);if(!active.startPublishingStream(config.streamId,local))throw new Error('推流失败');for(const id of ['mic','camera','stop'])show(id,true);show('start',false);hint('正在开始推流…');}
    catch{if(local){active.destroyStream(local);local=null;}status('无法使用摄像头或麦克风，请检查浏览器权限后重试');show('empty',true);}
    finally{el('start').disabled=false;}
  };
  el('stop').onclick=()=>{if(engine&&local){engine.stopPublishingStream(config.streamId);engine.destroyStream(local);local=null;publishing=false;show('empty',true);show('start',true);status('推流已停止，本场是否结束由服务端确认');for(const id of ['mic','camera','stop'])show(id,false);}};
  el('mic').onclick=()=>{if(engine&&local){mic=!mic;engine.mutePublishStreamAudio(local,!mic);el('mic').textContent=mic?'关闭麦克风':'开启麦克风';}};
  el('camera').onclick=()=>{if(engine&&local){camera=!camera;engine.mutePublishStreamVideo(local,!camera);el('camera').textContent=camera?'关闭摄像头':'开启摄像头';}};
  el('sound').onclick=async()=>{const media=[...el('video').querySelectorAll('video,audio')];if(!media.length)return;el('sound').disabled=true;
    try{await Promise.all(media.map(v=>{v.muted=false;return v.play();}));show('sound',false);hint('正在直播 · 声音已开启');}
    catch{media.forEach(v=>v.muted=true);show('sound',true);hint('声音暂未开启，请再次点击「开启声音」');}
    finally{el('sound').disabled=false;}
  };
  el('retry').onclick=connect;
  el('fullscreen').onclick=()=>{if(document.fullscreenElement)void document.exitFullscreen();else if(el('stage').requestFullscreen)void el('stage').requestFullscreen().catch(()=>hint('当前设备请使用视频画面的全屏按钮'));};
  window.addEventListener('pagehide',()=>{closed=true;void teardown();void fetch('/api/v1/live/rtc/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),keepalive:true}).catch(()=>{});});
  if(!/^[a-zA-Z0-9_-]{43}$/.test(key)){closed=true;status('请从书院直播详情进入');}else void connect();
})();
