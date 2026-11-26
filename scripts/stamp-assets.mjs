// Stamps every assets/ link in index.html with a short hash of that file (?v=...), so a browser never
// combines a new page with an old cached script or stylesheet. Run after editing anything in assets/:
//   node scripts/stamp-assets.mjs
// The data Action runs it too, as a safety net.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

let html = await readFile('index.html', 'utf8');
const before = html;
const refs = [...html.matchAll(/(?:href|src)="(assets\/[^"?]+)(?:\?v=[^"]*)?"/g)].map((m) => m[1])
  .filter((f) => !f.startsWith('assets/fonts/')); // font files never change, and fonts.css links them without ?v
for (const file of new Set(refs)) {
  const hash = createHash('sha1').update(await readFile(file)).digest('hex').slice(0, 10);
  html = html.replace(new RegExp(`((?:href|src)="${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:\\?v=[^"]*)?"`, 'g'), `$1?v=${hash}"`);
}
if (html !== before) await writeFile('index.html', html);
console.log(`assets: ${new Set(refs).size} files stamped${html !== before ? ' (index.html updated)' : ', no change'}`);
