import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {ZegoService} from '../../services/api/dist/zego.js';

// Real WHIP/RTC transport with a generated teaching picture; no production business records are created.
const {chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const zego=new ZegoService(),session=randomUUID(),publisherId='obs_'+randomUUID().replaceAll('-',''),output=resolve(process.env.ACADEMY_LIVE_OUTPUT??'outputs/live-whip');
await mkdir(output,{recursive:true});const credential=zego.whip(publisherId,session),streamId=new URL(credential.url).pathname.split('/').at(-1);
const sdk=await readFile('services/api/public/live/sdk.js'),server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/sdk.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/sdk.js'?sdk:'<!doctype html><html><body style="margin:0;background:#101719;color:#e7d5b5;font:16px sans-serif"><p>WHIP 真实传输 · 合成测试画面</p><div id="video" style="height:70vh"></div><script src="/sdk.js"></script></body></html>');});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+server.address().port;
let browser,publisher,viewer,resource,recorder,recorderResult,recorderStopped=false,recorderExit=null,answerStatus=0;
const recorderEvents=[];
async function recorderEvent(name,timeout=30000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const found=recorderEvents.find(e=>e.event===name);if(found)return found;if(recorderExit!==null)throw Error('Recorder exited before '+name);await new Promise(ok=>setTimeout(ok,100));}throw Error('Recorder timed out waiting for '+name);}
try{
  browser=await chromium.launch({headless:true,channel:'msedge',args:['--autoplay-policy=no-user-gesture-required']});publisher=await browser.newPage();viewer=await browser.newPage({viewport:{width:1280,height:800}});await publisher.goto(origin);
  const offer=await publisher.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;document.body.append(canvas);const ctx=canvas.getContext('2d');let n=0;
    window.paint=setInterval(()=>{ctx.fillStyle=n%2?'#233c36':'#30483f';ctx.fillRect(0,0,960,540);ctx.fillStyle='#ead7b0';ctx.font='48px serif';ctx.fillText('Academy WHIP live test',70,200);ctx.font='36px monospace';ctx.fillText('Frame '+n++,70,290);},33);
    const audio=new AudioContext({sampleRate:48000}),osc=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination();gain.gain.value=.02;osc.frequency.value=440;osc.connect(gain).connect(destination);osc.start();await audio.resume();window.audio=audio;
    const pc=window.pc=new RTCPeerConnection();for(const t of canvas.captureStream(30).getVideoTracks())pc.addTrack(t);for(const t of destination.stream.getAudioTracks())pc.addTrack(t);
    for(const transceiver of pc.getTransceivers()){if(transceiver.sender.track.kind==='video'){const codecs=RTCRtpSender.getCapabilities('video').codecs.filter(c=>c.mimeType==='video/H264');if(codecs.length)transceiver.setCodecPreferences(codecs);}}
    await pc.setLocalDescription(await pc.createOffer());if(pc.iceGatheringState!=='complete')await new Promise(ok=>{const timer=setTimeout(ok,8000);pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);ok();}});});return pc.localDescription.sdp;
  });
  if(process.env.ACADEMY_RECORDER_PROBE_SCRIPT){
    const config=zego.roomToken('rec_'+randomUUID().replaceAll('-',''),'academy_'+session.replaceAll('-',''),streamId,false);
    recorder=spawn(process.env.ACADEMY_PYTHON??'python',[process.env.ACADEMY_RECORDER_PROBE_SCRIPT],{windowsHide:true,stdio:['pipe','pipe','pipe']});recorder.on('exit',code=>{recorderExit=code??1;});recorder.on('error',()=>{recorderExit=1;});recorder.stdin.on('error',()=>{});recorder.stderr.on('data',()=>{});createInterface({input:recorder.stdout}).on('line',line=>{try{recorderEvents.push(JSON.parse(line));}catch{}});recorder.stdin.write(JSON.stringify(config)+'\n');assert.equal((await recorderEvent('login')).code,0);
  }
  const response=await fetch(credential.url,{method:'POST',headers:{'Content-Type':'application/sdp'},body:offer,signal:AbortSignal.timeout(20000)});answerStatus=response.status;const answer=await response.text();assert.ok(response.ok&&answer.startsWith('v=0'),`WHIP negotiation failed (HTTP ${response.status}): ${answer.slice(0,500)}`);
  if(response.headers.get('location')){const location=new URL(response.headers.get('location'),credential.url);assert.equal(location.origin,new URL(credential.url).origin);resource=location.href;}
  await publisher.evaluate(sdp=>window.pc.setRemoteDescription({type:'answer',sdp}),answer);await publisher.waitForFunction(()=>window.pc.connectionState==='connected',{},{timeout:30000});
  const provider=await zego.request('DescribeRTCStreamState',{StreamId:streamId});assert.equal(provider.Code,0,'WHIP must be visible to the same provider query used to confirm classroom start');
  const rtc=zego.roomToken('viewer_'+randomUUID().replaceAll('-',''),'academy_'+session.replaceAll('-',''),streamId,false);
  await viewer.goto(origin);await viewer.evaluate(async c=>{
    const engine=window.engine=new ZegoExpressEngine(c.appId,c.server);engine.setLogConfig({logLevel:'error',remoteLogLevel:'disable'});engine.on('roomStateChanged',(_room,reason)=>{window.roomState=reason;});await engine.loginRoom(c.roomId,c.token,{userID:c.userId,userName:'WHIP验收'},{userUpdate:false});
  },rtc);
  await viewer.waitForFunction(()=>window.roomState==='LOGINED',{},{timeout:25000});
  await viewer.evaluate(async id=>{const stream=await window.engine.startPlayingStream(id,{video:true,audio:true});window.trackKinds=stream.getTracks().map(t=>t.kind);const view=window.engine.createRemoteStreamView(stream);view.play(document.getElementById('video'),{muted:true,enableAutoplayDialog:false});},streamId);
  await viewer.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.videoWidth>0&&v.getVideoPlaybackQuality().totalVideoFrames>=15),{},{timeout:30000});
  const evidence=await viewer.evaluate(()=>({tracks:window.trackKinds,video:[...document.querySelectorAll('video')].map(v=>({width:v.videoWidth,height:v.videoHeight,frames:v.getVideoPlaybackQuality().totalVideoFrames}))}));assert.ok(evidence.tracks.includes('audio')&&evidence.tracks.includes('video'));
  if(recorder){await recorderEvent('recording');await new Promise(ok=>setTimeout(ok,7000));recorder.stdin.write('STOP\n');recorderStopped=true;recorderResult=await recorderEvent('probeResult',45000);assert.ok(recorderResult.duration>=5);assert.ok(recorderResult.streams.some(s=>s.type==='video')&&recorderResult.streams.some(s=>s.type==='audio'));}
  await viewer.screenshot({path:output+'/whip-rtc.png'});await writeFile(output+'/result.json',JSON.stringify({whipHttpStatus:answerStatus,providerStreamCode:provider.Code,realWhipTransport:true,realZegoRtcPlayback:true,syntheticMedia:true,actualObsApplication:false,productionBusinessRecordsCreated:false,recorder:recorderResult??null,...evidence},null,2));await rm(output+'/failure.json',{force:true});console.log(JSON.stringify({whipHttpStatus:answerStatus,recorder:recorderResult??null,...evidence}));
}catch(e){await writeFile(output+'/failure.json',JSON.stringify({error:e.message,whipHttpStatus:answerStatus},null,2));throw e;}
finally{
  if(recorder&&!recorderStopped)recorder.stdin.write('STOP\n');
  if(resource)await fetch(resource,{method:'DELETE',signal:AbortSignal.timeout(10000)}).catch(()=>{});
  await publisher?.evaluate(()=>{window.pc?.getSenders().forEach(s=>s.track?.stop());window.pc?.close();window.audio?.close();clearInterval(window.paint);}).catch(()=>{});await viewer?.evaluate(()=>window.engine?.destroyEngine()).catch(()=>{});await browser?.close();await new Promise(ok=>server.close(ok));
}
