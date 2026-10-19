import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {zegoToken04,ZegoService} from '../../services/api/dist/zego.js';
const {chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const config=new ZegoService().config(),id='academy_probe_'+randomUUID().replaceAll('-',''),stream='probe_'+randomUUID().replaceAll('-','');
const sdk=await readFile(new URL('../../services/api/public/live/sdk.js',import.meta.url));
const server=createServer((req,res)=>{if(req.url==='/sdk.js'){res.setHeader('Content-Type','application/javascript');res.end(sdk);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><div id="video"></div><script src="/sdk.js"></script></body></html>');}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const address='http://127.0.0.1:'+server.address().port;
let browser;const result={appId:config.appId,sdkVersion:'3.13.0',server:config.server,checkedAt:new Date().toISOString(),checks:[],commercialAcceptance:false};
const watchdog=setTimeout(()=>{result.error='Probe exceeded two-minute limit';server.closeAllConnections();void browser?.close();},120000);
const token=(user,host,room=id)=>zegoToken04(config.appId,user,config.secret,180,JSON.stringify({room_id:room,privilege:{1:1,2:host?1:0},stream_id_list:host?[stream]:null}));
async function login(page,user,t,room=id){return page.evaluate(async data=>{
  const engine=window.zg=new ZegoExpressEngine(data.appId,data.server);engine.setLogConfig({logLevel:'disable',remoteLogLevel:'disable'});
  const events=[];let finish;const completed=new Promise(resolve=>finish=resolve);engine.on('roomStateChanged',(_r,reason,code)=>{events.push({reason,code});if(reason==='LOGINED')finish({ok:true,events});if(reason==='LOGIN_FAILED')finish({ok:false,error:{code},events});});
  const timeout=new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'timeout',events}),22000));
  void engine.loginRoom(data.room,data.token,{userID:data.user,userName:'书院接入验证'}).catch(e=>finish({ok:false,error:{code:e.code,detail:String(e),errorCode:e.errorCode,errorMsg:e.errorMsg,keys:Object.keys(e),err:e.err,extendedData:e.extendedData},events}));
  return Promise.race([completed,timeout]);
},{appId:config.appId,server:config.server,user,token:t,room});}
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({permissions:['camera','microphone']});const host=await context.newPage(),viewer=await context.newPage(),wrong=await context.newPage();
  await Promise.all([host.goto(address),viewer.goto(address),wrong.goto(address)]);
  const hostUser='host_'+randomUUID().slice(0,8),viewerUser='viewer_'+randomUUID().slice(0,8),wrongUser='wrong_'+randomUUID().slice(0,8);
  const hostLogin=await login(host,hostUser,token(hostUser,true));result.checks.push({name:'valid_host_login',...hostLogin});
  const wrongLogin=await login(wrong,wrongUser,token(wrongUser,false),id+'_other');result.checks.push({name:'different_room_rejected',passed:hostLogin.ok&&!wrongLogin.ok&&wrongLogin.events?.some(e=>e.reason==='LOGIN_FAILED'&&e.code!==0),...wrongLogin});await wrong.close();
  if(hostLogin.ok){
    const viewerLogin=await login(viewer,viewerUser,token(viewerUser,false));result.checks.push({name:'valid_viewer_login',...viewerLogin});
    if(viewerLogin.ok){
      await viewer.evaluate(stream=>{
        window.played=false;window.playError=null;
        zg.on('roomStreamUpdate',async(_r,type,streams)=>{if(type==='ADD'&&streams.some(s=>s.streamID===stream)){try{const remote=await zg.startPlayingStream(stream);const video=document.createElement('video');video.autoplay=true;video.muted=true;video.srcObject=remote;document.querySelector('#video').append(video);await video.play();window.played=true;}catch(e){window.playError=String(e);}}});
      },stream);
      const published=await host.evaluate(async stream=>{const events=window.publishEvents=[];zg.on('publisherStateUpdate',event=>events.push({state:event.state,code:event.errorCode}));try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const draw=canvas.getContext('2d');window.drawTimer=setInterval(()=>{draw.fillStyle='#245564';draw.fillRect(0,0,320,180);draw.fillStyle='#fff';draw.fillText('Academy RTC '+Date.now(),20,80);},100);const local=window.local=await zg.createStream({custom:{source:canvas.captureStream(10)}});return {accepted:zg.startPublishingStream(stream,local)};}catch(e){return {error:{code:e.code,name:e.name,message:e.message,msg:e.msg,detail:String(e),errorCode:e.errorCode,errorMsg:e.errorMsg,keys:Object.keys(e),err:e.err,extendedData:e.extendedData}};}},stream);
      result.checks.push({name:'host_publish_requested',passed:published.accepted===true,...published});
      try{if(!published.accepted)throw Error("publish rejected");await viewer.waitForFunction(()=>window.played&&document.querySelector('video')?.videoWidth>0,{},{timeout:25000});result.checks.push({name:'rtc_remote_video_decoded',passed:true,stats:await viewer.evaluate(()=>({width:document.querySelector('video').videoWidth,height:document.querySelector('video').videoHeight,frames:document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames}))});}catch{result.checks.push({name:'rtc_remote_video_decoded',passed:false,error:await viewer.evaluate(()=>window.playError)});}
      // A VIEWER Token must not publish even when a caller invokes SDK APIs directly.
      const forbiddenStream=stream+'_viewer';const forbiddenAttempt=await viewer.evaluate(async stream=>{window.forbiddenEvents=[];zg.on('publisherStateUpdate',event=>window.forbiddenEvents.push({state:event.state,code:event.errorCode}));try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const local=window.forbiddenLocal=await zg.createStream({custom:{source:canvas.captureStream(10)}});return {accepted:zg.startPublishingStream(stream,local)};}catch(e){return {error:{code:e.code,name:e.name,message:e.message,msg:e.msg,detail:String(e),errorCode:e.errorCode,errorMsg:e.errorMsg,keys:Object.keys(e),err:e.err,extendedData:e.extendedData}};}},forbiddenStream);
      try{if(!forbiddenAttempt.accepted)throw Error("publish rejected");await viewer.waitForFunction(()=>window.forbiddenEvents.some(e=>e.state==='PUBLISHING'||e.code),{},{timeout:15000});}catch{}
      const forbidden=await viewer.evaluate(()=>window.forbiddenEvents);result.checks.push({name:'viewer_publish_rejected',passed:published.accepted===true&&forbidden.some(e=>e.code)&&!forbidden.some(e=>e.state==='PUBLISHING'),events:forbidden,attempt:forbiddenAttempt});
      result.checks.push({name:'host_publish_events',events:await host.evaluate(()=>window.publishEvents)});
      await viewer.evaluate(stream=>{zg.stopPublishingStream(stream);if(window.forbiddenLocal)zg.destroyStream(window.forbiddenLocal);},forbiddenStream);
    }
    await host.evaluate(stream=>{zg.stopPublishingStream(stream);if(window.local)zg.destroyStream(window.local);},stream);
  }
}catch(error){result.error=error.message;}
finally{clearTimeout(watchdog);await browser?.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));await mkdir('outputs/zego-rtc-2026-10-13',{recursive:true});await writeFile('outputs/zego-rtc-2026-10-13/provider-probe.json',JSON.stringify(result,null,2));}
console.log(JSON.stringify(result));
