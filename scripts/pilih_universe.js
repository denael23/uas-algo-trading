// Seleksi universe tanpa survivorship bias sejauh yang dimungkinkan API:
// peringkat likuiditas diukur pada 90 hari SEBELUM awal backtest, bukan hari ini.
// Keterbatasan: /api/pairs hanya memuat pasangan yang masih terdaftar. Pasangan yang sudah delisting bisa
// ditambahkan lewat config/kandidat_tambahan.json (daftar symbol) dan akan ikut diperingkat bila datanya ada.
import { createClient } from '../lib/indodax.js';
import { closedOnly, parseCandles } from '../lib/candles.js';
import { bookIssue, parseBook } from '../lib/orderbook.js';
import { loadConfig, readOptional, rootDir } from '../lib/config.js';
import { median } from '../lib/metrics.js';
import { writeJ } from '../lib/files.js';

const root = rootDir(), cfg = loadConfig(root);
const TOP = Number(process.argv.find(a => a.startsWith('--top='))?.split('=')[1] || 6);
const STABIL = new Set(['usdt', 'usdc', 'dai', 'busd', 'tusd', 'fdusd', 'usdd', 'pyusd', 'xaut', 'idrt', 'bidr', 'idrx']);
const c = createClient({ minGapMs: 400, onError: e => console.error('API:', e.scope, e.pair ?? '', e.message) });
const T0 = Math.floor(Date.parse(cfg.schedule.backtest_start_iso) / 1000), DAY = 86400;
const serverMs = await c.serverTimeMs();
const pairs = (await c.pairs()).filter(x => x.base_currency === 'idr');
const extra = readOptional(root, 'config/kandidat_tambahan.json') || [];
const tickers = await c.tickerAll();

// Satuan Volume pada history_v2 tidak disebut di dokumentasi. Deteksi dari BTC: bandingkan 7 hari candle dengan vol 24 jam ticker.
const btc = closedOnly(parseCandles(await c.history('BTCIDR', '1D', Math.floor(serverMs / 1000) - 8 * DAY, Math.floor(serverMs / 1000))), 1440, serverMs);
const btcV = median(btc.map(b => b.v)), tk = tickers.btc_idr;
const unit = Math.abs(Math.log(btcV / Number(tk.vol_idr))) < Math.abs(Math.log(btcV / Number(tk.vol_btc))) ? 'idr' : 'coin';
console.log(`Satuan Volume history_v2 terdeteksi: ${unit} (median candle=${btcV}, vol_idr=${tk.vol_idr}, vol_btc=${tk.vol_btc})`);
const toIdr = b => (unit === 'idr' ? b.v : b.v * b.c);

const list = [...pairs.map(x => ({ id: x.id, symbol: x.symbol, ticker: x.ticker_id, traded: x.traded_currency, suspended: Boolean(Number(x.is_market_suspended || 0) || Number(x.is_maintenance || 0)), terdaftar: true })),
  ...extra.map(s => ({ id: s.toLowerCase(), symbol: s.toUpperCase(), ticker: null, traded: s.toLowerCase().replace(/idr$/, ''), suspended: true, terdaftar: false }))];
const rows = [];
let n = 0;
for (const x of list) {
  if (STABIL.has(x.traded)) continue;
  n++; if (n % 25 === 0) console.log(`... ${n}/${list.length}`);
  let bars = [];
  try { bars = parseCandles(await c.history(x.symbol, '1D', T0 - 90 * DAY, T0)).filter(b => b.t + DAY <= T0); } catch { continue; }
  if (!bars.length) continue;
  const active = bars.filter(b => b.v > 0).length;
  rows.push({ ...x, hari_data: bars.length, hari_aktif: active, median_vol_idr_t0: median(bars.map(toIdr)), vol_idr_hari_ini: Number(tickers[x.ticker]?.vol_idr || 0) });
}
rows.sort((a, b) => b.median_vol_idr_t0 - a.median_vol_idr_t0);
rows.forEach((r, i) => { r.peringkat_t0 = i + 1; });

const terpilih = [], ditolak = [];
const dur = cfg.strategy.timeframe_minutes * 60;
for (const r of rows) {
  if (terpilih.length >= TOP) break;
  const alasan = [];
  if (r.hari_data < 85) alasan.push('riwayat_kurang_dari_85_hari_pada_t0');
  if (r.hari_aktif / r.hari_data < 0.95) alasan.push('hari_aktif_kurang_95pct');
  if (!r.terdaftar) alasan.push('sudah_tidak_terdaftar');
  if (r.suspended && r.terdaftar) alasan.push('pasar_ditangguhkan');
  if (!alasan.length) {
    const b4 = parseCandles(await c.history(r.symbol, cfg.strategy.tf_param, T0 - 90 * DAY, T0)).filter(b => b.t + dur <= T0);
    const zero = b4.filter(b => !(b.v > 0)).length / Math.max(b4.length, 1) * 100;
    r.pct_bar_volume_nol_t0 = zero;
    if (zero > 1) alasan.push('bar_volume_nol_lebih_1pct');
    const issue = bookIssue(parseBook(await c.depth(r.id)), cfg.strategy.max_spread_pct);
    if (issue) alasan.push('kondisi_hari_ini:' + issue);
  }
  if (alasan.length) ditolak.push({ pair: r.id, peringkat_t0: r.peringkat_t0, alasan }); else terpilih.push(r);
}
if (terpilih.length < 3) { console.error('Universe kurang dari 3 pasangan.'); process.exit(1); }
writeJ(root, 'hasil/seleksi_universe.json', { dibuat_pada: new Date(serverMs).toISOString(), t0: new Date(T0 * 1000).toISOString(), satuan_volume: unit, kriteria: 'median volume IDR harian 90 hari sebelum T0; >=85 hari riwayat; >=95% hari aktif; <=1% bar bervolume nol pada T0; masih bisa diperdagangkan dan spread <=2% saat seleksi', terpilih, ditolak, semua_kandidat: rows });
writeJ(root, 'config/universe.json', { status: 'final', ditetapkan_pada: new Date(serverMs).toISOString(), kriteria_lihat: 'hasil/seleksi_universe.json', volume_unit: unit, pairs: terpilih.map(r => r.id) });
console.log('Universe final:', terpilih.map(r => `${r.id} (#${r.peringkat_t0})`).join(', '));
console.log('Ditolak:', JSON.stringify(ditolak));
