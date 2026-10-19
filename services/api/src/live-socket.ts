import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { Database } from './database.js';
import { LiveService } from './live.js';
import { liveEvents } from './live-chat.js';

// Sockets carry invalidations only; authorised HTTP reads own the visible content.
export function installLiveSocket(server:Server,db:Database,live:LiveService){
  const sockets=new Map<WebSocket,{keyHash:string;sessionId:string;roomId:string;userId:string}>();
  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  const origins=(process.env.CORS_ORIGINS??'').split(',').filter(Boolean);
  const send=(socket:WebSocket,type:string)=>{if(socket.readyState===WebSocket.OPEN){if(socket.bufferedAmount>65536)socket.terminate();else socket.send(JSON.stringify({type}));}};
  async function check(keyHash:string){
    const lease=await db.liveRtcLease.findUnique({where:{keyHash}}),now=new Date();
    if(!lease||lease.revokedAt||lease.expiresAt<=now||lease.absoluteExpiresAt<=now)throw Error('expired');
    const session=await live.refreshCheck(lease);
    if(session.state!=='LIVE')throw Error('ended');
    return {keyHash,sessionId:session.id,roomId:session.roomId,userId:lease.userId};
  }
  const changed=(sessionId:string)=>{for(const [socket,data] of sockets)if(data.sessionId===sessionId)send(socket,'refresh');};
  const roomChanged=(roomId:string)=>{for(const [socket,data] of sockets)if(data.roomId===roomId)send(socket,'refresh');};
  liveEvents.on('change',changed);liveEvents.on('room',roomChanged);
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/api/v1/live/socket'){socket.destroy();return;}
    if(wss.clients.size>=1024||req.headers.origin&&!origins.includes(req.headers.origin)){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',socket=>{
    let authenticating=false;
    const timeout=setTimeout(()=>socket.close(4401,'authentication required'),5000);
    socket.on('error',()=>socket.terminate());
    socket.on('close',()=>{clearTimeout(timeout);sockets.delete(socket);});
    socket.on('message',async(raw,binary)=>{
      if(binary){socket.close(4400,'invalid frame');return;}
      if(sockets.has(socket)){if(raw.toString()==='{"type":"ping"}')send(socket,'pong');else socket.close(4400,'invalid frame');return;}
      if(authenticating){socket.close(4400,'authentication pending');return;}authenticating=true;
      try{
        const data=JSON.parse(raw.toString()) as {type?:string;key?:string};
        if(data.type!=='auth'||typeof data.key!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(data.key))throw Error('invalid');
        const access=await check(createHash('sha256').update(data.key).digest('hex'));
        if([...sockets.values()].filter(s=>s.userId===access.userId).length>=4)throw Error('limit');
        if(socket.readyState!==WebSocket.OPEN)return;
        sockets.set(socket,access);clearTimeout(timeout);send(socket,'ready');
      }catch{socket.close(4401,'live access unavailable');}
    });
  });
  let checking=false;
  const timer=setInterval(async()=>{
    if(checking)return;checking=true;
    try{for(const [socket,data] of sockets){try{await check(data.keyHash);send(socket,'refresh');}catch{socket.close(4403,'live access expired');}}}
    finally{checking=false;}
  },10000);timer.unref();
  server.once('close',()=>{clearInterval(timer);liveEvents.off('change',changed);liveEvents.off('room',roomChanged);for(const socket of wss.clients)socket.terminate();wss.close();});
}
