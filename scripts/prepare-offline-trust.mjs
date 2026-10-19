import {createPrivateKey,createPublicKey} from 'node:crypto';import {writeFile} from 'node:fs/promises';
const kid=process.env.OFFLINE_LICENSE_KEY_ID,key=process.env.OFFLINE_LICENSE_PRIVATE_KEY;
if(!kid||!/^[A-Za-z0-9_-]{1,64}$/.test(kid)||!key)throw Error('Configure the server offline signing identity before preparing App public trust keys.');
const privateKey=createPrivateKey(key.replace(/\\n/g,'\n'));if(privateKey.asymmetricKeyType!=='rsa'||(privateKey.asymmetricKeyDetails?.modulusLength??0)<2048)throw Error('At least 2048-bit RSA is required');
const publicKey=createPublicKey(privateKey).export({format:'pem',type:'spki'}).toString();
await writeFile(new URL('../apps/mobile/lib/offline-trust.ts',import.meta.url),'// Generated public verification keys; never include the server signing private key.\nexport const offlineTrustKeys:Record<string,string>='+JSON.stringify({[kid]:publicKey})+';\n');
console.log('Prepared the App public offline verification key. No private key was exported.');
