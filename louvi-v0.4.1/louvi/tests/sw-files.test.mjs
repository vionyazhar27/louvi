// Checks that sw.js lists every app file and that VERSION matches APP_VERSION.
// Run: node tests/sw-files.test.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION } from '../js/schema.js';

const root = new URL('..', import.meta.url).pathname;
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const listed = [...sw.matchAll(/^\s*'([^']+)',?$/gm)].map((m) => m[1]);
const version = /const VERSION = '([^']+)'/.exec(sw)?.[1];

const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
const needed = ['index.html', 'manifest.webmanifest', ...walk('css'), ...walk('js'), ...walk('fonts').filter((f) => f.endsWith('.woff2')), ...walk('icons')];

const problems = [];
for (const f of needed) if (!listed.includes(f)) problems.push(`missing in sw.js: ${f}`);
for (const f of listed) if (f !== './' && !existsSync(join(root, f))) problems.push(`listed but not found: ${f}`);
if (version !== APP_VERSION) problems.push(`sw.js VERSION ${version} ≠ APP_VERSION ${APP_VERSION}`);
console.log(problems.length ? problems.join('\n') : `sw.js OK (${listed.length} files, version ${version})`);
process.exit(problems.length ? 1 : 0);
