// Pemuat .env kecil untuk skrip laptop. Vercel memakai Environment Variables.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export function loadEnv(root = process.cwd()) {
  const f = path.join(root, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
