/* ZEGO Express Web SDK 3.13.0; official SDK stays a pinned runtime dependency. */
(() => {
  'use strict';
  const key=location.hash.slice(1);history.replaceState(null,'',location.pathname);
  const embedded=window.self!==window.top;
  if(embedded)document.body.classList.add('embedded');
  const el=id=>document.getElementById(id),show=(id,visible)=>{el(id).hidden=!visible;};
  let engine=null,config=null,local=null,remote=null,timer=null,renewing=false,playing=false,closed=false,connecting=false,mic=true,camera=true,publishing=false,generation=0,fitting='contain',roomState='CONNECTING',startingPlayback=false,startingPublish=false;
  const guests=new Map(),guestViews=new Map();let remoteView=null,publishGuard=null;
  const postState=()=>{if(!embedded)return;try{window.parent.postMessage({type:'studio-state',live:publishing,ready:!!local,starting:startingPublish,soundRequired:!el('sound').hidden,mic,camera,fitting,role:config?.role,playing,state:roomState,status:el('status').textContent},'*');}catch{}};
  const status=(text,state)=>{if(state)roomState=state;el('status').textContent=text;postState();};
  const hint=text=>{el('hint').textContent=text;};
  function setFit(mode){fitting=mode==='contain'?'contain':'cover';el('video').classList.toggle('fit-contain',fitting==='contain');postState();}
  async function request(path){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch('/api/v1/live/rtc/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,...(path==='refresh'?{watching:config?.role==='VIEWER'&&playing&&!document.hidden}:{})}),cache:'no-store',signal:controller.signal});
    const data=await response.json();if(!response.ok){const error=new Error(Array.isArray(data.message)?data.message.join('；'):data.message||'直播暂不可用');error.status=response.status;throw error;}return data;}finally{clearTimeout(timeout);}
  }
  async function teardown(){
    generation++;clearTimeout(publishGuard);publishGuard=null;clearInterval(timer);timer=null;const old=engine;engine=null;playing=false;publishing=false;startingPlayback=false;startingPublish=false;roomState='CONNECTING';
    for(const [id,container] of guests){try{old?.stopPlayingStream(id);}catch{}container.remove();}guests.clear();guestViews.clear();remoteView=null;
    if(old){try{if(local){old.stopPublishingStream(config.streamId);old.destroyStream(local);local=null;}if(remote){old.stopPlayingStream(config.streamId);remote=null;}old.logoutRoom(config.roomId);old.destroyEngine();}catch{}}
    el('video').replaceChildren();show('empty',true);for(const id of ['start','mic','camera','stop','sound'])show(id,false);postState();
  }
  async function syncGuests(){
    if(!engine||!config)return;
    const desired=(config.playStreamIds??[]).filter(id=>id!==config.streamId&&id!==config.publishStreamId),active=engine,version=generation;
    for(const [id,container] of guests)if(!desired.includes(id)){active.stopPlayingStream(id);container.remove();guests.delete(id);guestViews.delete(id);}
    for(const id of desired){
      if(guests.has(id))continue;
      const container=document.createElement('div');container.className='guest-video';container.setAttribute('aria-label','连麦学员');guests.set(id,container);el('guests').append(container);
      try{
        const stream=await active.startPlayingStream(id,{video:true,audio:true});
        if(version!==generation||guests.get(id)!==container){active.stopPlayingStream(id);container.remove();continue;}
        const view=active.createRemoteStreamView(stream);guestViews.set(id,view);view.on('autoplayFailed',()=>{show('sound',true);postState();});view.play(container,{muted:true,enableAutoplayDialog:false});
        const label=document.createElement('span');label.textContent='学员连麦中';container.append(label);
        // Autoplay policy may require a fresh click even when camera permission was granted.
        show('sound',true);postState();
      }catch{container.remove();guests.delete(id);guestViews.delete(id);hint('连麦声音暂未接通，正在重试');}
    }
  }
  async function play(){
    if(playing||startingPlayback||!engine||config.role==='HOST')return;startingPlayback=true;const version=generation,active=engine;
    try{
      const stream=await active.startPlayingStream(config.streamId,{video:true,audio:true});
      if(version!==generation){active.stopPlayingStream(config.streamId);return;}
      remote=stream;const view=remoteView=active.createRemoteStreamView(stream);view.on('autoplayFailed',()=>{show('sound',true);postState();});view.play(el('video'),{muted:true,enableAutoplayDialog:false});show('empty',false);show('sound',true);hint('正在直播 · 点击开启声音聆听主讲');
    }catch{playing=false;status('画面暂时中断，正在等待主播恢复','ERROR');show('retry',true);}finally{if(version===generation)startingPlayback=false;}
  }
  async function renew(){
    if(renewing||!engine||closed)return;renewing=true;
    try{const version=generation,next=await request('refresh');if(version!==generation||!engine)return;engine.renewToken(next.token);config=next;await syncGuests();hint(publishing?'正在直播 · 连接正常':playing?(el('sound').hidden?'正在直播 · 声音已开启':'正在直播 · 点击开启声音聆听主讲'):'已连接 · 等待主播画面');}
    catch(error){if([400,401,403,404,409,503].includes(error.status)){await teardown();closed=true;status(error.message,'ERROR');hint('返回直播详情后可重新进入');show('retry',false);}else{hint('网络不稳定，正在重试；权限失效后将退出房间');}}
    finally{renewing=false;}
  }
  async function connect(){
    if(connecting||closed)return;connecting=true;show('retry',false);status('正在连接直播…','CONNECTING');
    try{
      await teardown();config=await request('refresh');document.body.classList.toggle('viewer',config.role==='VIEWER');const active=engine=new ZegoExpressEngine(config.appId,config.server);const version=generation;
      active.setLogConfig({logLevel:'error',remoteLogLevel:'disable'});
      let complete;const loggedIn=new Promise((resolve,reject)=>complete={resolve,reject});
      active.on('roomStateChanged',(_room,reason)=>{
        if(version!==generation)return;
        if(reason==='LOGIN_FAILED')complete.resolve(false);
        if(reason==='LOGINED')complete.resolve(true);
        if(['LOGIN_FAILED','RECONNECT_FAILED','KICKOUT'].includes(reason)){playing=false;status(reason==='KICKOUT'?'已退出直播间':'连接失败，请重试','ERROR');show('retry',reason!=='KICKOUT');if(reason==='KICKOUT'){closed=true;void teardown();}}
        if(reason==='RECONNECTING'){show('empty',true);status('网络中断，正在重新连接…','CONNECTING');}
        if(['LOGINED','RECONNECTED'].includes(reason)){hint('已连接直播间');if(remote){status('正在直播','PLAYING');show('empty',false);}}
      });
      active.on('tokenWillExpire',renew);
      active.on('roomStreamUpdate',(_room,type,streams)=>{
        if(version!==generation)return;
        if(type==='DELETE')for(const stream of streams){const container=guests.get(stream.streamID);if(container){active.stopPlayingStream(stream.streamID);container.remove();guests.delete(stream.streamID);guestViews.delete(stream.streamID);}}
        // A room event is only a hint: recheck the server before playing any guest stream.
        if(type==='ADD')void renew();
        if(config.role!=='HOST'&&streams.some(s=>s.streamID===config.streamId)){
          if(type==='ADD')void play();
          else{active.stopPlayingStream(config.streamId);playing=false;remote=null;show('empty',true);status('主讲暂时离开，正在等待画面恢复','CONNECTED');}
        }
      });
      active.on('playerStateUpdate',event=>{if(version!==generation)return;if(guests.has(event.streamID)){if(event.state==='NO_PLAY'&&event.errorCode){guests.get(event.streamID).remove();guests.delete(event.streamID);hint('学员连麦中断，正在等待恢复');}return;}if(config.role==='HOST')return;if(event.state==='PLAYING'){playing=true;status('正在直播','PLAYING');show('empty',false);show('retry',false);}else if(event.state==='NO_PLAY'&&event.errorCode){playing=false;show('empty',true);status('播放中断，点击重新连接','ERROR');show('retry',true);}});
      active.on('publisherStateUpdate',event=>{if(version!==generation)return;if(event.state==='PUBLISHING'){publishing=true;clearTimeout(publishGuard);publishGuard=null;startingPublish=false;status('正在直播','PUBLISHING');hint('已开始推流 · 正在等待服务端确认开播');}else if(event.state==='NO_PUBLISH'&&event.errorCode){publishing=false;clearTimeout(publishGuard);publishGuard=null;startingPublish=false;if(local){active.destroyStream(local);local=null;}for(const id of ['mic','camera','stop'])show(id,false);status('推流中断，请重新开播','ERROR');show('empty',true);show('start',true);postState();}});
      const login=Promise.resolve(active.loginRoom(config.roomId,config.token,{userID:config.userId,userName:config.role==='HOST'?'书院主讲':'研习者'},{userUpdate:false})).then(accepted=>accepted===false?false:loggedIn);
      let loginTimeout;
      try{if(!await Promise.race([loggedIn,login,new Promise(resolve=>loginTimeout=setTimeout(()=>resolve(false),20000))]))throw new Error('直播登录失败');}finally{clearTimeout(loginTimeout);}
      if(version!==generation)return;
      status(config.role==='HOST'?'正在检查摄像头和麦克风…':'等待主讲画面…','CONNECTED');show('start',config.role==='HOST');timer=setInterval(renew,15000);await syncGuests();
      if(config.role==='HOST')void preview(active,version);
    }catch(error){await teardown();status(error.status?error.message:'暂时无法连接直播，请检查网络后重试','ERROR');show('retry',true);}finally{connecting=false;}
  }
  async function preview(active,version){
    if(local||!active||version!==generation)return;
    try{
      const stream=await active.createZegoStream({camera:{video:true,audio:true}});
      if(version!==generation){active.destroyStream(stream);return;}
      local=stream;mic=true;camera=true;stream.playVideo(el('video'),{enableAutoplayDialog:false});show('empty',false);
      el('video').querySelectorAll('video').forEach(v=>{v.muted=true;v.play().catch(()=>{});});
      el('mic').textContent='关闭麦克风';el('camera').textContent='关闭摄像头';
      hint('预览中 · 点击开始直播后学员才能看到画面');status('预览就绪，尚未向学员推流','PREVIEW');postState();
    }catch{status('无法使用摄像头或麦克风，请检查浏览器权限后重试','ERROR');show('retry',true);}
  }
  async function startPublish(){
    if(!engine||publishing||startingPublish)return;startingPublish=true;postState();
    const active=engine,version=generation;
    try{
      if(!local)await preview(active,version);
      if(!local||version!==generation){startingPublish=false;postState();return;}
      el('start').disabled=true;
      if(!active.startPublishingStream(config.streamId,local))throw new Error('推流失败');status('正在推流…');
      if(!publishing)publishGuard=setTimeout(()=>{if(version!==generation||publishing)return;active.stopPublishingStream(config.streamId);startingPublish=false;status('开播超时，请检查网络后重试','ERROR');show('start',true);postState();},20000);
      for(const id of ['mic','camera','stop'])show(id,true);show('start',false);hint('正在开始推流…');postState();
    }catch{startingPublish=false;if(local){active.destroyStream(local);local=null;}status('无法使用摄像头或麦克风，请检查浏览器权限后重试','ERROR');show('empty',true);show('start',true);}
    finally{el('start').disabled=false;}
  }
  function toggleMic(){if(engine&&local){mic=!mic;engine.mutePublishStreamAudio(local,!mic);el('mic').textContent=mic?'关闭麦克风':'开启麦克风';postState();}}
  function toggleCamera(){if(engine&&local){camera=!camera;engine.mutePublishStreamVideo(local,!camera);el('camera').textContent=camera?'关闭摄像头':'开启摄像头';postState();}}
  function stopPublish(){if(engine&&local){engine.stopPublishingStream(config.streamId);engine.destroyStream(local);local=null;publishing=false;show('empty',true);show('start',true);status('推流已停止，本场是否结束由服务端确认');for(const id of ['mic','camera','stop'])show(id,false);postState();}}
  el('start').onclick=()=>void startPublish();
  el('stop').onclick=stopPublish;
  el('mic').onclick=toggleMic;
  el('camera').onclick=toggleCamera;
  el('sound').onclick=()=>{const views=[...(config?.role==='HOST'?[]:remoteView?[remoteView]:[]),...guestViews.values()];if(!views.length)return;el('sound').disabled=true;
    try{for(const view of views)view.playAudio({muted:false,enableAutoplayDialog:false});show('sound',false);hint('正在直播 · 已请求开启声音');}
    catch{show('sound',true);hint('声音暂未开启，请再次点击「开启声音」');}
    finally{el('sound').disabled=false;postState();}
  };
  el('retry').onclick=connect;
  el('fullscreen').onclick=()=>{if(document.fullscreenElement)void document.exitFullscreen();else if(el('stage').requestFullscreen)void el('stage').requestFullscreen().catch(()=>hint('当前设备请使用视频画面的全屏按钮'));};
  window.addEventListener('message',event=>{
    if(!embedded||event.source!==window.parent)return;
    const data=event.data||{};if(data.type!=='studio')return;
    if(event.origin!==location.origin&&!['fit','fill','state'].includes(data.action))return;
    if(data.action==='state')postState();
    else if(data.action==='start')void startPublish();
    else if(data.action==='mic')toggleMic();
    else if(data.action==='camera')toggleCamera();
    else if(data.action==='fit')setFit('contain');
    else if(data.action==='fill')setFit('cover');
    else if(data.action==='retry')void connect();
    else if(data.action==='sound')void el('sound').onclick();
  });
  window.addEventListener('pagehide',()=>{closed=true;void teardown();void fetch('/api/v1/live/rtc/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),keepalive:true}).catch(()=>{});});
  if(!/^[a-zA-Z0-9_-]{43}$/.test(key)){closed=true;status('请从书院直播详情进入');}else void connect();
})();
