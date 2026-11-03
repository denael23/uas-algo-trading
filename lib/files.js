import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const readJ = (root, f) => JSON.parse(readFileSync(path.join(root, f), 'utf8'));
export const readJOpt = (root, f) => (existsSync(path.join(root, f)) ? readJ(root, f) : null);
export function writeJ(root, f, v) {
  const p = path.join(root, f);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 1) + '\n');
}
export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = v => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n';
}
export const sha256File = (root, f) => createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex');
export const LOG_FILES = ['calls', 'signals', 'orders', 'equity', 'equity_daily', 'errors', 'events', 'ob_snapshots'];
export function readLogs(root, dir = 'log_mentah') {
  const out = {};
  for (const t of LOG_FILES) out[t] = readJOpt(root, `${dir}/${t}.json`) || [];
  return out;
}
