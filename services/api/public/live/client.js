/* ZEGO Express Web SDK 3.13.0; official SDK stays a pinned runtime dependency. */
(() => {
  'use strict';
  const key=location.hash.slice(1);history.replaceState(null,'',location.pathname);
  const embedded=window.self!==window.top;
  if(embedded)document.body.classList.add('embedded');
  const el=id=>document.getElementById(id),show=(id,visible)=>{el(id).hidden=!visible;};
  let engine=null,config=null,local=null,remote=null,timer=null,renewing=false,playing=false,closed=false,connecting=false,mic=true,camera=true,publishing=false,generation=0,fitting='contain',roomState='CONNECTING',startingPlayback=false,startingPublish=false;
  const guests=new Map(),guestViews=new Map();let remoteView=null,publishGuard=null,previewing=false,retryTimer=null,retries=0,lastVerified=0,previewError='',audioEnabled=false;
  const terminalStatus=code=>[400,401,403,404,409].includes(code);
  const safely=action=>{try{action();}catch{}};
  function retryLater(){
    if(closed||config?.role==='HOST'||retryTimer||retries>=5)return;
    retryTimer=setTimeout(()=>{retryTimer=null;if(!closed)void connect();},Math.min(15000,1000*2**retries++));
  }
  let devices={cameras:[],microphones:[]},cameraId='',microphoneId='',switching=false;
  const postState=()=>{if(!embedded)return;try{window.parent.postMessage({type:'studio-state',live:publishing,ready:!!local,starting:startingPublish,soundRequired:!el('sound').hidden,mic,camera,fitting,role:config?.role,playing,state:roomState,status:el('status').textContent,devices,cameraId,microphoneId,switching},'*');}catch{}};
  async function deviceList(){try{const rows=await navigator.mediaDevices.enumerateDevices();devices={cameras:rows.filter(d=>d.kind==='videoinput').map((d,i)=>({id:d.deviceId,label:d.label||'摄像头 '+(i+1)})),microphones:rows.filter(d=>d.kind==='audioinput').map((d,i)=>({id:d.deviceId,label:d.label||'麦克风 '+(i+1)}))};postState();}catch{hint('暂时无法读取设备列表，请检查浏览器设备权限');}}
  async function switchDevice(kind,id){if(switching||!engine||!local||!id)return;switching=true;postState();const active=engine,version=generation;
    try{const result=await(kind==='camera'?active.useVideoDevice(local,id):active.useAudioDevice(local,id));if(version!==generation)return;if(result?.errorCode)throw new Error('Device unavailable');if(kind==='camera')cameraId=id;else microphoneId=id;status('设备已切换，请确认画面和声音');}
    catch{if(version===generation)status('设备切换失败，原设备继续使用；请检查设备是否被占用');}
    finally{switching=false;postState();}}
  const status=(text,state)=>{if(state)roomState=state;el('status').textContent=text;postState();};
  const hint=text=>{el('hint').textContent=text;};
  function setFit(mode){fitting=mode==='contain'?'contain':'cover';el('video').classList.toggle('fit-contain',fitting==='contain');postState();}
  async function request(path){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch('/api/v1/live/rtc/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,...(path==='refresh'?{watching:config?.role==='VIEWER'&&playing&&!document.hidden}:{})}),cache:'no-store',signal:controller.signal});
    const data=await response.json();if(!response.ok){const error=new Error(Array.isArray(data.message)?data.message.join('；'):data.message||'直播暂不可用');error.status=response.status;throw error;}return data;}finally{clearTimeout(timeout);}
  }
  async function teardown(){
    generation++;clearTimeout(publishGuard);publishGuard=null;clearTimeout(retryTimer);retryTimer=null;clearInterval(timer);timer=null;const old=engine;engine=null;playing=false;publishing=false;startingPlayback=false;startingPublish=false;previewing=false;roomState='CONNECTING';
    for(const [id,container] of guests){try{old?.stopPlayingStream(id);}catch{}container.remove();}guests.clear();guestViews.clear();remoteView=null;
    if(old){if(local){safely(()=>old.stopPublishingStream(config.streamId));safely(()=>old.destroyStream(local));local=null;}if(remote){safely(()=>old.stopPlayingStream(config.streamId));remote=null;}safely(()=>old.logoutRoom(config.roomId));safely(()=>old.destroyEngine());}
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
      remote=stream;const view=remoteView=active.createRemoteStreamView(stream);view.on('autoplayFailed',()=>{audioEnabled=false;show('sound',true);postState();});view.play(el('video'),{muted:!audioEnabled,enableAutoplayDialog:false});show('sound',!audioEnabled);hint(audioEnabled?'正在接收主讲画面':'点击开启声音聆听主讲');
    }catch{if(version!==generation)return;playing=false;status('画面暂时中断，正在等待主播恢复','ERROR');show('empty',true);show('retry',true);retryLater();}finally{if(version===generation)startingPlayback=false;}
  }
  async function renew(){
    if(renewing||!engine||closed)return;renewing=true;const version=generation;
    try{const next=await request('refresh');if(version!==generation||!engine)return;const result=await engine.renewToken(next.token);if(version!==generation||!engine)return;if(result?.errorCode)throw new Error('Token renewal pending');config=next;lastVerified=Date.now();await syncGuests();if(config.role!=='HOST'&&!playing&&!startingPlayback)void play();hint(publishing?'正在直播 · 连接正常':playing?(el('sound').hidden?'正在直播 · 声音已开启':'正在直播 · 点击开启声音聆听主讲'):'已连接 · 等待主播画面');}
    catch(error){if(version!==generation||closed)return;if(terminalStatus(error.status)){closed=true;await teardown();status(error.message,'ERROR');hint('返回直播详情后可重新进入');show('retry',false);}else if(Date.now()-lastVerified>=60000){await teardown();status('连接验证超时，请重新进入直播间','ERROR');hint('已停止采集和播放，返回本场详情后重新进入');show('retry',true);}else{hint('网络不稳定，正在重试；当前音视频连接保留');}}
    finally{renewing=false;}
  }
  async function connect(){
    if(connecting||closed)return;connecting=true;show('retry',false);status('正在连接直播…','CONNECTING');
    try{
      await teardown();config=await request('refresh');if(closed)return;lastVerified=Date.now();document.body.classList.toggle('viewer',config.role==='VIEWER');const active=engine=new ZegoExpressEngine(config.appId,config.server);const version=generation;
      active.setLogConfig({logLevel:'error',remoteLogLevel:'disable'});
      let complete;const loggedIn=new Promise((resolve,reject)=>complete={resolve,reject});
      active.on('roomStateChanged',(_room,reason)=>{
        if(version!==generation)return;
        if(reason==='LOGIN_FAILED')complete.resolve(false);
        if(reason==='LOGINED')complete.resolve(true);
        if(['LOGIN_FAILED','RECONNECT_FAILED','KICKOUT'].includes(reason)){playing=false;show('empty',true);status(reason==='KICKOUT'?'已退出直播间':'连接失败，请重试','ERROR');show('retry',reason!=='KICKOUT');if(reason==='KICKOUT'){closed=true;void teardown().then(()=>status('直播会话已在其他位置结束，请重新进入','ERROR'));}else retryLater();}
        if(reason==='RECONNECTING'){playing=false;show('empty',true);status('网络中断，正在重新连接…','CONNECTING');}
        if(['LOGINED','RECONNECTED'].includes(reason)){hint('已连接直播间');if(reason==='RECONNECTED'){status(publishing?'推流连接已恢复':'连接已恢复，等待画面',publishing?'PUBLISHING':'CONNECTED');void renew();}}
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
      active.on('playerStateUpdate',event=>{if(version!==generation)return;if(guests.has(event.streamID)){if(event.state==='NO_PLAY'&&event.errorCode){guests.get(event.streamID).remove();guests.delete(event.streamID);guestViews.delete(event.streamID);hint('学员连麦中断，正在等待恢复');}return;}if(config.role==='HOST'||event.streamID&&event.streamID!==config.streamId)return;if(event.state==='PLAYING'){playing=true;retries=0;clearTimeout(retryTimer);retryTimer=null;status('正在直播','PLAYING');show('empty',false);show('retry',false);}else if(event.state==='NO_PLAY'){playing=false;show('empty',true);status('画面中断，正在尝试恢复','ERROR');show('retry',true);retryLater();}});
      active.on('publisherStateUpdate',event=>{if(version!==generation)return;if(event.state==='PUBLISHING'){publishing=true;clearTimeout(publishGuard);publishGuard=null;startingPublish=false;status('正在直播','PUBLISHING');hint('已开始推流 · 正在等待服务端确认开播');}else if(event.state==='NO_PUBLISH'&&event.errorCode){publishing=false;clearTimeout(publishGuard);publishGuard=null;startingPublish=false;if(local){active.destroyStream(local);local=null;}for(const id of ['mic','camera','stop'])show(id,false);status('推流中断，请重新开播','ERROR');show('empty',true);show('start',true);postState();}});
      const login=Promise.resolve(active.loginRoom(config.roomId,config.token,{userID:config.userId,userName:config.role==='HOST'?'书院主讲':'研习者'},{userUpdate:false})).then(accepted=>accepted===false?false:loggedIn);
      let loginTimeout;
      try{if(!await Promise.race([loggedIn,login,new Promise(resolve=>loginTimeout=setTimeout(()=>resolve(false),20000))]))throw new Error('直播登录失败');}finally{clearTimeout(loginTimeout);}
      if(version!==generation)return;
      status(config.role==='HOST'?'正在检查摄像头和麦克风…':'等待主讲画面…','CONNECTED');show('start',config.role==='HOST');timer=setInterval(renew,15000);await syncGuests();
      if(config.role==='HOST')void preview(active,version);else void play();
    }catch(error){await teardown();if(closed)return;if(terminalStatus(error.status))closed=true;status(error.status?error.message:'暂时无法连接直播，请检查网络后重试','ERROR');show('retry',!closed);if(!closed)retryLater();}finally{connecting=false;}
  }
  async function preview(active,version){
    if(local||previewing||!active||version!==generation)return;previewing=true;previewError='';
    let timedOut=false;const timeout=setTimeout(()=>{if(version!==generation||local)return;timedOut=true;previewError='设备授权等待超时，请完成浏览器授权后重试';status(previewError,'ERROR');show('retry',true);},20000);
    try{
      const stream=await active.createZegoStream({camera:{video:true,audio:true}});
      if(version!==generation||timedOut){active.destroyStream(stream);return;}
      local=stream;mic=true;camera=true;stream.playVideo(el('video'),{enableAutoplayDialog:false});show('empty',false);
      el('video').querySelectorAll('video').forEach(v=>{v.muted=true;v.play().catch(()=>{});});
      el('mic').textContent='关闭麦克风';el('camera').textContent='关闭摄像头';
      hint('预览中 · 点击开始直播后学员才能看到画面');status('预览就绪，尚未向学员推流','PREVIEW');postState();void deviceList();
    }catch(error){if(version!==generation)return;previewError=({NotAllowedError:'设备权限被拒绝，请在浏览器地址栏允许摄像头和麦克风后重试',NotFoundError:'未找到摄像头或麦克风，请连接设备后重试',NotReadableError:'摄像头或麦克风被其他软件占用，请关闭占用程序后重试',OverconstrainedError:'设备不支持当前采集参数，请切换设备后重试'}[error.name])||'无法打开设备，请检查摄像头和麦克风后重试';status(previewError,'ERROR');show('retry',true);}finally{clearTimeout(timeout);if(version===generation)previewing=false;}
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
    }catch{if(version!==generation)return;startingPublish=false;if(local){active.destroyStream(local);local=null;}status('开播未成功，请检查设备和网络后重试','ERROR');show('empty',true);show('start',true);}
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
    try{for(const view of views)view.playAudio({muted:false,enableAutoplayDialog:false});audioEnabled=true;show('sound',false);hint('正在直播 · 已请求开启声音');}
    catch{audioEnabled=false;show('sound',true);hint('声音暂未开启，请再次点击「开启声音」');}
    finally{el('sound').disabled=false;postState();}
  };
  el('retry').onclick=connect;
  window.addEventListener('online',()=>{if(closed)return;if(engine)void renew();else void connect();});
  window.addEventListener('offline',()=>{if(closed)return;playing=false;show('empty',true);status('网络已断开，联网后自动恢复','CONNECTING');});
  el('fullscreen').onclick=()=>{if(document.fullscreenElement)void document.exitFullscreen();else if(el('stage').requestFullscreen)void el('stage').requestFullscreen().catch(()=>hint('当前设备请使用视频画面的全屏按钮'));};
  window.addEventListener('message',event=>{
    if(!embedded||event.source!==window.parent)return;
    const data=event.data||{};if(data.type!=='studio')return;
    if(event.origin!==location.origin&&!['fit','fill','state','sound','muteSound'].includes(data.action))return;
    if(data.action==='state')postState();
    else if(data.action==='start')void startPublish();
    else if(data.action==='mic')toggleMic();
    else if(data.action==='camera')toggleCamera();
    else if(data.action==='fit')setFit('contain');
    else if(data.action==='fill')setFit('cover');
    else if(data.action==='retry')void connect();
    else if(data.action==='sound')void el('sound').onclick();
    else if(data.action==='muteSound'){audioEnabled=false;for(const view of [remoteView,...guestViews.values()].filter(Boolean))safely(()=>view.playAudio({muted:true,enableAutoplayDialog:false}));show('sound',true);postState();}
    else if(data.action==='devices')void deviceList();
    else if(data.action==='device'&&['camera','microphone'].includes(data.kind)&&typeof data.id==='string'&&data.id.length<=256)void switchDevice(data.kind,data.id);
  });
  window.addEventListener('pagehide',()=>{closed=true;void teardown();void fetch('/api/v1/live/rtc/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),keepalive:true}).catch(()=>{});});
  if(!/^[a-zA-Z0-9_-]{43}$/.test(key)){closed=true;status('请从书院直播详情进入');}else void connect();
})();
