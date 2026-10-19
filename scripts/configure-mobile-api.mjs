import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const source=new URL('../apps/mobile/lib/environment.ts',import.meta.url),network=new URL('../apps/mobile/nativeResources/android/res/xml/academy_network_security.xml',import.meta.url);
export const endpoints={development:'http://127.0.0.1:3000/api/v1',demo:'https://academy.43-160-229-173.sslip.io/api/v1',production:'https://academy.43-160-229-173.sslip.io/api/v1'};

export function validateEndpoint(value,environment){
  if(!Object.hasOwn(endpoints,environment))throw Error('Environment must be development, demo or production');
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname.replace(/\/$/,'')!=='/api/v1')throw Error('API URL must end with /api/v1 and contain no credentials, query or fragment');
  if(!/^[a-z0-9.-]+$/i.test(url.hostname))throw Error('Use a DNS hostname or IPv4 address');
  const privateHost=/^(localhost|.*\.localhost|127\..*|0\..*|10\..*|192\.168\..*|172\.(1[6-9]|2\d|3[01])\..*)$/i.test(url.hostname);
  if(environment==='development'?!['http:','https:'].includes(url.protocol):url.protocol!=='https:'||privateHost)throw Error('Release API must use a public HTTPS URL');
  return url.href.replace(/\/$/,'');
}

export function networkPolicy(value,environment){
  const url=new URL(validateEndpoint(value,environment));
  const domain=environment==='development'&&url.protocol==='http:'?`<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">${url.hostname}</domain></domain-config>`:'';
  return `<?xml version="1.0" encoding="utf-8"?>\n<network-security-config><base-config cleartextTrafficPermitted="false"/>${domain}</network-security-config>\n`;
}

async function main(){
  const args=process.argv.slice(2),check=args.includes('--check'),legacyDevelopment=args.includes('--development');
  const option=args.find(a=>a.startsWith('--environment='))?.split('=')[1];
  if(args.some(a=>a.startsWith('--')&&!['--check','--development'].includes(a)&&!a.startsWith('--environment=')))throw Error('Unknown option');
  if(legacyDevelopment&&option&&option!=='development')throw Error('Conflicting environments');
  const text=await readFile(source,'utf8'),current=text.match(/export const apiBase = '([^']+)';/),configured=text.match(/export const apiEnvironment = '(development|demo|production)';/);
  if(!current||!configured)throw Error('Cannot find the current mobile API configuration');
  const environment=option??(legacyDevelopment?'development':check?configured[1]:'production');
  if(check){
    if(environment==='development'||configured[1]!==environment)throw Error('--check requires the configured release environment');
    validateEndpoint(current[1],environment);
    if((await readFile(network,'utf8')).trim()!==networkPolicy(current[1],environment).trim())throw Error('Release network policy does not match HTTPS configuration');
    console.log('Mobile '+environment+' endpoint and HTTPS policy verified.');return;
  }
  const value=validateEndpoint(args.find(a=>!a.startsWith('--'))??process.env.MOBILE_API_URL??endpoints[environment],environment);
  await writeFile(source,text.replace(current[0],"export const apiBase = '"+value+"';").replace(configured[0],"export const apiEnvironment = '"+environment+"';"));
  await writeFile(network,networkPolicy(value,environment));
  console.log('Mobile endpoint configured: '+value+' ('+environment+'). Rebuild before distribution.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
