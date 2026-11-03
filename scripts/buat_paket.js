// ZIP pengumpulan: salinan bersih dari commit terakhir beserta folder .git utuh.
// Hanya berkas yang sudah di-commit yang ikut, jadi .env dan node_modules tidak terbawa.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(process.env.UAS_ROOT || process.cwd());
const nama = 'UAS_25120200024_Denael';
const stop = m => { console.error('BERHENTI: ' + m); process.exit(1); };
const run = (c, a, cwd) => execFileSync(c, a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 });
if (!existsSync(path.join(root, '.git'))) stop('folder .git tidak ada.');
const kotor = run('git', ['status', '--porcelain'], root).trim();
if (kotor) stop('ada perubahan yang belum di-commit:\n' + kotor);
try { run('git', ['rev-parse', 'freeze^{commit}'], root); } catch { stop('tag freeze tidak ditemukan.'); }
const tmp = mkdtempSync(path.join(tmpdir(), 'paket-'));
const dir = path.join(tmp, nama), out = path.join(root, '..', nama + '.zip');
run('git', ['clone', '--quiet', '--no-hardlinks', root, dir], tmp);
const wajib = ['.git/HEAD', 'README.md', '.env.example', 'FREEZE.json', 'hasil/bukti_freeze.json', 'docs/STRATEGI.md', 'docs/REFLEKSI.md', 'scripts/hitung_ulang.js', 'log_mentah/calls.json', 'log_mentah/orders.json', 'log_mentah/equity_daily.json', 'log_mentah/errors.json', 'log_mentah/ob_snapshots.json', `${nama}.html`];
const kurang = wajib.filter(f => !existsSync(path.join(dir, f)));
if (kurang.length) { rmSync(tmp, { recursive: true, force: true }); stop('belum di-commit atau belum dibuat: ' + kurang.join(', ')); }
if (existsSync(path.join(dir, '.env')) || existsSync(path.join(dir, 'node_modules'))) stop('.env atau node_modules ikut ter-commit.');
rmSync(out, { force: true });
if (process.platform === 'linux') run('zip', ['-qr', out, nama], tmp);
else run('tar', ['-a', '-cf', out, nama], tmp); // Windows 10+ dan macOS
const isi = process.platform === 'linux' ? run('unzip', ['-l', out], tmp) : run('tar', ['-tf', out], tmp);
if (!isi.includes('.git/HEAD')) stop('.git tidak masuk ke ZIP.');
rmSync(tmp, { recursive: true, force: true });
console.log(`Paket siap: ${path.resolve(out)}\nFolder .git ikut, tanpa .env dan node_modules.`);
