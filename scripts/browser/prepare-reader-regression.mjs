import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const source=await readFile(new URL('apps/mobile/static/reader/reader-engine.js',root),'utf8');
const style=await readFile(new URL('apps/mobile/static/reader/reader.css',root),'utf8');
const template=await readFile(new URL('reader-regression.cjs',import.meta.url),'utf8');
await mkdir(new URL('.runtime/',root),{recursive:true});
await writeFile(new URL('.runtime/reader-regression.cjs',root),template.replace("'__READER_SOURCE__'",JSON.stringify(source)).replace("'__READER_STYLE__'",JSON.stringify(style)));
console.log('Ready: .runtime/reader-regression.cjs');
