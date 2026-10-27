import {createRequire} from 'node:module';
const require=createRequire(new URL('../../services/api/package.json',import.meta.url));const WebSocket=require('ws');
for(const host of ['cuecanvas.top','academy.43-160-229-173.sslip.io']){
 await new Promise((resolve,reject)=>{
  const ws=new WebSocket('wss://'+host+'/api/v1/live/socket',{origin:'https://'+host,family:4,lookup:(_h,_o,cb)=>cb(null,'43.160.229.173',4),handshakeTimeout:15000});
  ws.on('open',()=>ws.send(JSON.stringify({type:'auth',key:'invalid'})));
  ws.on('close',code=>code===4401?resolve():reject(Error('Unexpected close '+code)));
  ws.on('error',reject);
 });console.log(host+' websocket upgrade and authorization: passed');
}
