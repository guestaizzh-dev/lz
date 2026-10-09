import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const icons = require('@iconify-json/ph/icons.json');
// Asset-only dependency supplied by the development runtime; not shipped in App.
const sharpPath = process.env.DAOXUE_SHARP_PATH;
if (!sharpPath) throw new Error('Set DAOXUE_SHARP_PATH to a local sharp installation for asset generation.');
const sharp = require(sharpPath);
const names = ['house','book-open','compass','bag','user','magnifying-glass','bell','arrow-right','arrow-left',
  'play','bookmark-simple','calendar-blank','clock','check','gear','shopping-cart','heart','chat-circle','leaf','flower-lotus','headphones','video-camera','list','sign-out','shield-check','share-network','cloud-slash','hourglass','star','note-pencil','crown','package','medal','text-aa','minus','plus','lock'];
const dir = resolve('apps/mobile/static/icons');
mkdirSync(dir, { recursive: true });
for (const name of names) {
  const icon = icons.icons[name + '-light'] ?? icons.icons[name];
  if (!icon) throw new Error(`Unknown Phosphor icon ${name}`);
  for (const [suffix, color] of [['', '#536970'], ['-active','#245564'], ['-white','#FFFFFF']]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width ?? icons.width} ${icon.height ?? icons.height}" fill="${color}">${icon.body.replaceAll('currentColor', color)}</svg>`;
    writeFileSync(resolve(dir, `${name}${suffix}.svg`), svg);
    await sharp(Buffer.from(svg)).resize(72,72).png().toFile(resolve(dir, `${name}${suffix}.png`));
  }
}
writeFileSync(resolve(dir,'LICENSE.txt'), 'Phosphor icons / MIT. Source: @iconify-json/ph 1.2.2; https://github.com/phosphor-icons/core\n');
console.log(`Generated ${names.length} Phosphor icons in three color variants.`);
