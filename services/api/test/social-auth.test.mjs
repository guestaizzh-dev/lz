import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {LoginProviders,socialLoginConfig,verifyAppleLoginToken} from '../dist/login-providers.js';
import {SocialAuth} from '../dist/social-auth.js';
import {phoneLookup,encryptPrivate} from '../dist/private-data.js';

const appleKey=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({type:'pkcs8',format:'pem'});
const configured={SOCIAL_WECHAT_ENABLED:'true',SOCIAL_WECHAT_APP_ID:'wx0123456789abcdef',SOCIAL_WECHAT_SECRET:'a'.repeat(32),SOCIAL_APPLE_ENABLED:'true',SOCIAL_APPLE_CLIENT_ID:'com.academy.login',SOCIAL_APPLE_TEAM_ID:'TEAM123456',SOCIAL_APPLE_KEY_ID:'KEY1234567',SOCIAL_APPLE_PRIVATE_KEY:appleKey};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
test('login providers validate configuration and Apple signed tokens without trusting client subjects',async()=>{
  assert.equal(socialLoginConfig('WECHAT',{}),null);assert.equal(socialLoginConfig('APPLE',{}),null);
  for(const changes of [{SOCIAL_WECHAT_ENABLED:'yes'},{SOCIAL_WECHAT_APP_ID:''},{SOCIAL_WECHAT_SECRET:''}])assert.throws(()=>socialLoginConfig('WECHAT',{...configured,...changes}));
  for(const changes of [{SOCIAL_APPLE_PRIVATE_KEY:''},{SOCIAL_APPLE_CLIENT_ID:''},{SOCIAL_APPLE_KEY_ID:''}])assert.throws(()=>socialLoginConfig('APPLE',{...configured,...changes}));
  assert.equal(socialLoginConfig('APPLE',configured).appScope,configured.SOCIAL_APPLE_CLIENT_ID);
  const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'key-1',use:'sig'},now=Math.floor(Date.now()/1000),claims={iss:'https://appleid.apple.com',aud:'com.academy.login',sub:'apple-subject',iat:now,exp:now+300};
  function token(changes={},header={}){const input=b64({alg:'RS256',kid:'key-1',...header})+'.'+b64({...claims,...changes});return input+'.'+sign('RSA-SHA256',Buffer.from(input),pair.privateKey).toString('base64url');}
  assert.equal(verifyAppleLoginToken(token(),[jwk],claims.aud),claims.sub);
  for(const bad of [token({aud:'another.app'}),token({iss:'https://wrong.example'}),token({exp:now-1}),token({iat:now-700}),token({}, {alg:'none'}),token({}, {kid:'unknown'}),token().slice(0,-12)+'wrong'])assert.throws(()=>verifyAppleLoginToken(bad,[jwk],claims.aud),e=>e.getStatus()===401);
  Object.assign(process.env,configured);const platform=new LoginProviders(),calls=[];
  platform.json=async(url,options)=>{calls.push({url,options});return url.includes('api.weixin.qq.com')?{openid:'server-verified-subject',access_token:'private-provider-token'}:url.includes('/keys')?{keys:[jwk]}:{id_token:token(),refresh_token:'apple-private-refresh'};};
  assert.equal((await platform.exchange('WECHAT','single-code')).subject,'server-verified-subject');
  assert.equal((await platform.exchange('APPLE','apple-code')).subject,claims.sub);
  assert.ok(calls.find(c=>c.url.includes('/auth/token')).options.body.get('client_secret').split('.').length===3);
  platform.json=async()=>({errcode:40029});await assert.rejects(platform.exchange('WECHAT','invalid'),e=>e.getStatus()===401);
  process.env.SOCIAL_WECHAT_ENABLED='false';process.env.SOCIAL_APPLE_ENABLED='false';
});

test('social login and safe binding: actual HTTP, phone proof, concurrency, conflicts and revocation',{timeout:120000},async t=>{
  Object.assign(process.env,{...configured,SMS_ENABLED:'true',DEV_OTP_CODE:'123456',PREVIEW_LOGIN_ENABLED:'false'});
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',platform=app.get(LoginProviders),social=app.get(SocialAuth);let providerCalls=0,revoked=[];
  platform.exchange=async(provider,code)=>{providerCalls++;if(code==='bad')throw new Error('provider unavailable');return{subject:code.split(':')[0],refreshToken:provider==='APPLE'?'private-refresh-'+code:null};};
  platform.revokeApple=async value=>{revoked.push(value);};
  async function call(path,data,bearer){const r=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},...(data?{body:JSON.stringify(data)}:{})});return{status:r.status,body:await r.json()};}
  async function otp(phone){await db.rateLimit.deleteMany({where:{key:'sms-phone-minute:'+phoneLookup(phone)}});const r=await call('/auth/sms',{phone});assert.equal(r.status,201,JSON.stringify(r.body));return{phone,code:'123456',challengeId:r.body.challengeId};}
  async function login(phone){const r=await call('/auth/login',await otp(phone));assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
  async function begin(provider='WECHAT',bearer){const r=await call(bearer?'/me/identities/challenge':'/auth/social/challenge',{provider},bearer);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  async function authorize(ticket,code,bearer){return call(bearer?'/me/identities/authorize':'/auth/social/authorize',{ticketId:ticket.ticketId,state:ticket.state,authorizationCode:code},bearer);}
  const a=await login('19900002001'),b=await login('19900002002');let ticket,identity,loginResult;
  try{
    await t.test('disabled providers have no challenge and forged client subjects are rejected',async()=>{
      process.env.SOCIAL_WECHAT_ENABLED='false';assert.equal((await call('/auth/social/challenge',{provider:'WECHAT'})).status,503);process.env.SOCIAL_WECHAT_ENABLED='true';
      ticket=await begin();assert.equal((await call('/auth/social/authorize',{ticketId:ticket.ticketId,state:ticket.state,authorizationCode:'verified-a:1',openid:'forged'})).status,400);
      assert.equal((await authorize({...ticket,state:'x'.repeat(43)},'verified-a:1')).status,401);assert.equal(providerCalls,0);
    });
    await t.test('first authorization creates no duplicate account; SMS attaches the original account atomically',async()=>{
      const users=await db.user.count(),r=await authorize(ticket,'verified-a:1');assert.equal(r.status,200);assert.equal(r.body.requiresPhone,true);assert.equal(await db.user.count(),users);assert.equal(await db.authIdentity.count(),0);
      const invalid=await otp('19900002001');assert.equal((await call('/auth/social/phone',{...invalid,code:'654321',ticketId:ticket.ticketId,state:ticket.state})).status,401);assert.equal((await db.otpChallenge.findUniqueOrThrow({where:{id:invalid.challengeId}})).attempts,1);
      const r2=await call('/auth/social/phone',{...invalid,ticketId:ticket.ticketId,state:ticket.state});assert.equal(r2.status,200,JSON.stringify(r2.body));assert.equal(r2.body.user.id,a.user.id);identity=await db.authIdentity.findFirstOrThrow({where:{userId:a.user.id}});assert.notEqual(identity.subjectHash,'verified-a');assert.equal(await db.user.count(),users);
      assert.equal((await call('/auth/social/phone',{...invalid,ticketId:ticket.ticketId,state:ticket.state})).status,401);
      const list=await call('/me/identities',null,a.accessToken);assert.equal(list.body.items.length,1);assert.equal(list.body.phone,'199****2001');assert.equal(list.body.items[0].subjectHash,undefined);assert.equal(list.body.items[0].refreshCipher,undefined);
    });
    await t.test('code and challenge replay do not issue multiple sessions; freezing and stale authorization close access',async()=>{
      const ticket2=await begin(),results=await Promise.all([authorize(ticket2,'verified-a:2'),authorize(ticket2,'verified-a:2')]);assert.equal(results.filter(r=>r.status===200).length,1);assert.ok(results.some(r=>[401,409].includes(r.status)));loginResult=results.find(r=>r.status===200).body;assert.equal(loginResult.user.id,a.user.id);
      assert.equal((await call('/auth/me',null,loginResult.accessToken)).status,200);const replay=await begin();assert.equal((await authorize(replay,'verified-a:2')).status,409);
      await db.user.update({where:{id:a.user.id},data:{status:'FROZEN'}});assert.equal((await authorize(await begin(),'verified-a:3')).status,401);await db.user.update({where:{id:a.user.id},data:{status:'ACTIVE'}});
      const expired=await begin();await db.socialChallenge.update({where:{id:expired.ticketId},data:{expiresAt:new Date(Date.now()-1000),createdAt:new Date(Date.now()-60000)}});assert.equal((await authorize(expired,'verified-a:4')).status,401);
    });
    await t.test('binding is bound to the initiating session and current phone; conflicts preserve both users',async()=>{
      const other=await begin('WECHAT',b.accessToken);assert.equal((await authorize(other,'verified-a:5',a.accessToken)).status,401);assert.equal((await authorize(other,'verified-a:5',b.accessToken)).status,409);
      const own=await begin('APPLE',a.accessToken);assert.equal((await authorize(own,'apple-a:1',a.accessToken)).body.requiresPhone,true);assert.equal(await db.authIdentity.count({where:{provider:'APPLE'}}),0);
      const dto={...await otp('19900002002'),ticketId:own.ticketId,state:own.state};assert.equal((await call('/me/identities/phone',dto,a.accessToken)).status,401);assert.equal(await db.authIdentity.count({where:{provider:'APPLE'}}),0);
      const bound=await call('/me/identities/phone',{...await otp('19900002001'),ticketId:own.ticketId,state:own.state},a.accessToken);assert.equal(bound.status,200,JSON.stringify(bound.body));assert.equal(bound.body.user.id,a.user.id);
      const replacement=await begin('WECHAT',a.accessToken);await authorize(replacement,'different-a:1',a.accessToken);assert.equal((await call('/me/identities/phone',{...await otp('19900002001'),ticketId:replacement.ticketId,state:replacement.state},a.accessToken)).status,409);assert.equal((await db.authIdentity.findUniqueOrThrow({where:{id:identity.id}})).subjectHash,identity.subjectHash);
    });
    await t.test('unbind requires the same phone, revokes third-party sessions and queues Apple token cleanup',async()=>{
      assert.equal((await call('/me/identities/WECHAT/unbind',await otp('19900002002'),a.accessToken)).status,401);
      const unbound=await call('/me/identities/WECHAT/unbind',await otp('19900002001'),a.accessToken);assert.equal(unbound.status,200);assert.equal((await call('/auth/me',null,loginResult.accessToken)).status,401);assert.equal((await call('/auth/me',null,unbound.body.accessToken)).status,200);
      assert.equal((await call('/me/identities/APPLE/unbind',await otp('19900002001'),a.accessToken)).status,200);const job=await db.outboxJob.findFirstOrThrow({where:{kind:'AUTH_APPLE_REVOKE'}});assert.ok(!JSON.stringify(job.payload).includes('private-refresh'));await social.runJobs();assert.equal(revoked.length,1);assert.equal((await db.outboxJob.findUniqueOrThrow({where:{id:job.id}})).state,'DONE');assert.deepEqual((await db.outboxJob.findUniqueOrThrow({where:{id:job.id}})).payload,{});
    });
    await t.test('account closure erases bindings and queues retained Apple revocation; expired unclaimed tokens also clean up',async()=>{
      const own=await begin('APPLE',b.accessToken);await authorize(own,'apple-b:1',b.accessToken);assert.equal((await call('/me/identities/phone',{...await otp('19900002002'),ticketId:own.ticketId,state:own.state},b.accessToken)).status,200);
      const closing=await call('/me/close-account',{confirmation:'确认注销'},b.accessToken);assert.equal(closing.status,201,JSON.stringify(closing.body));assert.equal(await db.authIdentity.count({where:{userId:b.user.id}}),0);await social.runJobs();assert.equal(revoked.length,2);
      const stale=await db.socialChallenge.create({data:{provider:'APPLE',appScope:configured.SOCIAL_APPLE_CLIENT_ID,stateHash:'a'.repeat(64),refreshCipher:encryptPrivate('unclaimed-token'),createdAt:new Date(Date.now()-120000),expiresAt:new Date(Date.now()-60000)}});await social.runJobs();assert.equal((await db.socialChallenge.findUniqueOrThrow({where:{id:stale.id}})).refreshCipher,null);assert.ok(revoked.includes('unclaimed-token'));
    });
    await t.test('the recovery worker retains failed revocations for retry without leaking credentials',async()=>{
      await db.outboxJob.create({data:{eventKey:'revoke-test-'+randomUUID(),kind:'AUTH_APPLE_REVOKE',aggregateType:'AUTH_IDENTITY',aggregateId:identity.id,payload:{cipher:encryptPrivate('retry-token')},availableAt:new Date()}});platform.revokeApple=async()=>{throw Error('private-provider-details');};await social.runJobs();const job=await db.outboxJob.findFirstOrThrow({where:{kind:'AUTH_APPLE_REVOKE',state:'READY'}});assert.equal(job.lastErrorCode,'APPLE_REVOKE_UNAVAILABLE');assert.equal(job.attempts,1);assert.ok(!JSON.stringify(job).includes('private-provider-details'));
    });
  }finally{await app.close();await db.$disconnect();process.env.SOCIAL_WECHAT_ENABLED='false';process.env.SOCIAL_APPLE_ENABLED='false';}
});
