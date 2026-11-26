// bundles the app with esbuild and stamps brand + cache-busting version into index.html / style.css
import { build } from 'esbuild';
import fs from 'fs';
import { BRAND } from './src/brand.js';
const V = process.env.V || String(Date.now()).slice(-7);
const OUT = process.env.OUT || 'site';
fs.mkdirSync(`${OUT}/data`, { recursive: true });
fs.mkdirSync(`${OUT}/img`, { recursive: true });
await build({ entryPoints: ['src/main.js'], bundle: true, minify: process.env.DEV ? false : true, format: 'iife', target: ['es2020', 'safari15'], outfile: `${OUT}/app.js`, legalComments: 'eof', define: { __V__: JSON.stringify(V) }, logLevel: 'warning', loader: { '.json': 'json' } });
// the source uses a literal __V__ inside a string for the snapshot url
let js = fs.readFileSync(`${OUT}/app.js`, 'utf8').replaceAll('__V__', V);
fs.writeFileSync(`${OUT}/app.js`, js);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const html = fs.readFileSync('src/index.tpl.html', 'utf8').replaceAll('__V__', V).replaceAll('__NAME__', esc(BRAND.name)).replaceAll('__TAGLINE__', esc(BRAND.tagline)).replaceAll('__DESC__', esc(BRAND.description)).replaceAll('__URL__', BRAND.url);
fs.writeFileSync(`${OUT}/index.html`, html);
fs.writeFileSync(`${OUT}/style.css`, fs.readFileSync('src/style.tpl.css', 'utf8').replaceAll('__V__', V));
fs.cpSync('fonts', `${OUT}/fonts`, { recursive: true });
if (fs.existsSync('public')) fs.cpSync('public', OUT, { recursive: true });
fs.writeFileSync(`${OUT}/.nojekyll`, '');
console.log(`built ${OUT}/ v=${V} app.js ${(fs.statSync(`${OUT}/app.js`).size / 1024).toFixed(0)} KB`);
