'use strict';
const {createHmac,createHash,timingSafeEqual}=require('crypto');
// URL化云函数；仅接收自有API的签名请求。密钥由云函数环境变量注入。
exports.main=async event=>{
  const reply=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const secret=process.env.ACADEMY_PUSH_SECRET,appId=process.env.ACADEMY_PUSH_APP_ID;
  if(!secret||secret.length<32||!appId)return reply(503,{state:'NOT_CONFIGURED'});
  if(event.httpMethod!=='POST')return reply(405,{state:'REJECTED'});
  const headers=Object.fromEntries(Object.entries(event.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
  const raw=event.isBase64Encoded?Buffer.from(event.body??'','base64').toString('utf8'):event.body??'';
  const timestamp=headers['x-academy-timestamp']??'',signature=headers['x-academy-signature']??'';
  if(typeof raw!=='string'||raw.length>3000||!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>300000||!/^[a-f0-9]{64}$/.test(signature))return reply(401,{state:'REJECTED'});
  const expected=createHmac('sha256',secret).update(timestamp+'.'+raw).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return reply(401,{state:'REJECTED'});
  let data;try{data=JSON.parse(raw);}catch{return reply(400,{state:'REJECTED'});}
  if(!/^[a-f0-9]{32}$/.test(data.requestId??'')||!/^[A-Za-z0-9_-]{10,200}$/.test(data.clientId??'')||!/^[a-f0-9-]{36}$/.test(data.notificationId??''))return reply(400,{state:'REJECTED'});
  const ledger=uniCloud.database().collection('academy-push-deliveries'),id=data.requestId,hash=createHash('sha256').update(raw).digest('hex');
  try{await ledger.add({_id:id,hash,state:'SENDING',createdAt:Date.now()});}
  catch{
    const prior=(await ledger.doc(id).get()).data[0];
    if(!prior)return reply(503,{state:'RETRY'});
    if(prior.hash!==hash)return reply(409,{state:'REJECTED'});
    return reply(prior.state==='ACCEPTED'?200:409,{state:prior.state==='ACCEPTED'?'ACCEPTED':'UNKNOWN',messageId:prior.messageId});
  }
  try{
    const result=await uniCloud.getPushManager({appId}).sendMessage({
      push_clientid:data.clientId,title:'老子道学书院',content:'你有一条新的书院消息，请登录查看。',
      payload:{notificationId:data.notificationId},request_id:id,force_notification:true,settings:{ttl:3600000}
    });
    const taskId=result.data?.['$taskid'];
    const messageId=typeof taskId==='string'?taskId:Object.keys(result.data??{}).find(key=>key!=='$taskid');
    if(result.errCode!==0||!messageId)throw Error('Provider result requires reconciliation');
    await ledger.doc(id).update({state:'ACCEPTED',messageId,updatedAt:Date.now()});
    return reply(200,{state:'ACCEPTED',messageId});
  }catch{
    await ledger.doc(id).update({state:'UNKNOWN',updatedAt:Date.now()});
    return reply(409,{state:'UNKNOWN'});
  }
};
