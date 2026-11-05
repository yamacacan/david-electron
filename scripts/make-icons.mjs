// web/img/logo.svg'den uygulama ikonlarını (PNG + çok boyutlu ICO) üretir.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, '../web/img/logo.svg'));
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

writeFileSync(join(root, 'build/icon.png'), render(512));
const ico = await pngToIco([256, 128, 64, 48, 32, 24, 16].map(render));
writeFileSync(join(root, 'build/icon.ico'), ico);
console.log('build/icon.png ve build/icon.ico üretildi');
