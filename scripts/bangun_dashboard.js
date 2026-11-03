// Membuat satu file HTML offline mandiri dari public/index.html + laporan hitung ulang.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootDir } from '../lib/config.js';
import { assembleReport } from '../lib/assemble.js';
const root = rootDir(), code = path.dirname(fileURLToPath(import.meta.url));
const r = assembleReport(root);
const tpl = readFileSync(path.join(code, '../public/index.html'), 'utf8');
const json = JSON.stringify(r).replace(/</g, '\\u003c');
const html = tpl.replace('<script id="laporan" type="application/json">null</script>', () => `<script id="laporan" type="application/json">${json}</script>`);
if (html === tpl) throw new Error('penanda laporan tidak ditemukan');
const f = `UAS_${r.identitas.nim}_${r.identitas.nama}.html`;
writeFileSync(path.join(root, f), html);
console.log('Dashboard offline:', f);
