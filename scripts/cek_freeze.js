// Bukti freeze: file aturan sama dengan saat freeze, commit bertag "freeze" dibuat sebelum batas,
// riwayatnya masih utuh, dan semua panggilan forward memakai rules_hash yang sama.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, rootDir } from '../lib/config.js';
import { readJOpt, sha256File, writeJ } from '../lib/files.js';
const root = rootDir(), fz = readJOpt(root, 'FREEZE.json');
if (!fz) { console.error('FREEZE.json belum ada'); process.exit(1); }
let bad = 0;
const fail = m => { console.error(m); bad++; };
for (const [f, h] of Object.entries(fz.sha256_file)) if (sha256File(root, f) !== h) fail('BERUBAH: ' + f);
const cfg = loadConfig(root);
if (cfg.rulesHash !== fz.rules_hash) fail('rules_hash berubah');
const calls = (readJOpt(root, 'log_mentah/calls.json') || []).filter(c => c.mode === 'forward');
const hs = new Set(calls.map(c => c.rules_hash));
if (hs.size > 1 || (hs.size === 1 && !hs.has(fz.rules_hash))) fail('rules_hash di log forward tidak konsisten: ' + [...hs]);

let bukti = null;
if (!existsSync(path.join(root, '.git'))) fail('Folder .git tidak ada. Tanpa riwayat commit, komponen kecocokan dinilai 0.');
else {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const hash = git('rev-parse', 'freeze^{commit}'), waktu = git('show', '-s', '--format=%cI', hash);
    if (Date.parse(waktu) > Date.parse(cfg.schedule.forward_start_iso)) fail(`Commit freeze ${waktu} melewati batas ${cfg.schedule.forward_start_iso}.`);
    try { git('merge-base', '--is-ancestor', hash, 'HEAD'); } catch { fail('Commit freeze bukan leluhur HEAD: riwayat terputus.'); }
    let fzHash = null;
    try { fzHash = JSON.parse(git('show', `${hash}:FREEZE.json`)).rules_hash; } catch { fail('FREEZE.json tidak ada di commit freeze.'); }
    if (fzHash && fzHash !== fz.rules_hash) fail('FREEZE.json berbeda dari yang ada di commit freeze.');
    const berubah = git('diff', '--name-only', hash, 'HEAD', '--', ...Object.keys(fz.sha256_file));
    if (berubah) fail('File aturan berubah sejak commit freeze: ' + berubah.split('\n').join(', '));
    let remote = null; try { remote = git('remote', 'get-url', 'origin').replace(/\/\/[^@/]+@/, '//'); } catch { /* opsional */ }
    bukti = { commit_freeze: hash, waktu_commit: waktu, batas_freeze: cfg.schedule.forward_start_iso, jumlah_commit_sesudah_freeze: Number(git('rev-list', '--count', `${hash}..HEAD`)), repositori: remote, hash_aturan: fz.rules_hash, commit_berjalan_di_vercel: [...new Set(calls.map(c => c.git_sha).filter(Boolean))] };
  } catch (e) { if (!bukti) fail('Tag "freeze" tidak ditemukan.'); }
}
if (!bad && bukti) writeJ(root, 'hasil/bukti_freeze.json', bukti);
console.log(bad ? `GAGAL: ${bad} temuan` : `LOLOS: commit freeze ${bukti.commit_freeze.slice(0, 10)} pada ${bukti.waktu_commit}; aturan tidak berubah; ${calls.length} panggilan forward memakai rules_hash ${fz.rules_hash}. Bukti: hasil/bukti_freeze.json`);
process.exit(bad ? 1 : 0);
