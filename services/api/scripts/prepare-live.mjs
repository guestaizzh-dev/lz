import {createRequire} from 'node:module';
import {copyFile,mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
await mkdir(new URL('../public/live/',import.meta.url),{recursive:true});
await copyFile(require.resolve('zego-express-engine-webrtc'),new URL('../public/live/sdk.js',import.meta.url));
