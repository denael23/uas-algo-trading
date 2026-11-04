// Pemeriksaan sebelum commit dan pengumpulan: tidak boleh ada secret di berkas proyek.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const root = process.env.UAS_ROOT || process.cwd();
const SKIP = new Set(['node_modules', '.git', '.vercel', 'candles', 'candles_replay', 'log_mentah', 'log_backtest']);
const P = [[/postgres(ql)?:\/\/[^\s"'<>]*:[^\s"'<>@]+@/i, 'connection string berisi kata sandi'], [/\bnpg_[A-Za-z0-9]{8,}/, 'token Neon'], [/\bghp_[A-Za-z0-9]{20,}/, 'token GitHub'], [/CRON_SECRET\s*[=:]\s*["']?[A-Za-z0-9_-]{12,}/, 'nilai CRON_SECRET'], [/Bearer\s+[A-Fa-f0-9]{32,}/, 'Bearer token']];
let bad = 0, n = 0;
(function walk(d) {
  for (const e of readdirSync(d)) {
    const f = path.join(d, e), rel = path.relative(root, f);
    if (SKIP.has(e)) continue;
    if (statSync(f).isDirectory()) { walk(f); continue; }
    if (e === '.env' || (/^\.env\./.test(e) && e !== '.env.example')) { let ikut = true; if (existsSync(path.join(root, '.git'))) { try { execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: root, stdio: 'ignore' }); } catch { ikut = false; } } if (!ikut) continue; console.error('DILARANG ADA:', rel); bad++; continue; }
    if (statSync(f).size > 5e6) continue;
    n++;
    const t = readFileSync(f, 'utf8');
    for (const [re, label] of P) if (re.test(t)) { console.error(`TEMUAN ${label}: ${rel}`); bad++; }
  }
})(root);
// Repositori publik memperlihatkan seluruh riwayat, jadi riwayat commit ikut diperiksa.
let riwayat = 'riwayat git tidak ada';
if (existsSync(path.join(root, '.git'))) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  const names = git('log', '--all', '--name-only', '--format=').split('\n');
  for (const nm of new Set(names)) if (/(^|\/)\.env(\.(?!example$).*)?$/.test(nm)) { console.error('RIWAYAT GIT memuat:', nm); bad++; }
  const diff = git('log', '--all', '-p', '--format=', '--', '.', ':(exclude)data', ':(exclude)log_mentah', ':(exclude)log_backtest', ':(exclude)package-lock.json');
  for (const [re, label] of P) if (re.test(diff)) { console.error(`RIWAYAT GIT memuat ${label}`); bad++; }
  riwayat = 'riwayat git bersih';
}
console.log(bad ? `GAGAL: ${bad} temuan` : `LOLOS: ${n} berkas diperiksa, tidak ada secret; ${riwayat}.`);
process.exit(bad ? 1 : 0);
