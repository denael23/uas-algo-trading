// KHUSUS PENGUJIAN PERANGKAT LUNAK. Data di sini sintetis dan tidak pernah dipakai untuk hasil.
import { PGlite } from '@electric-sql/pglite';
import { createStore } from '../lib/store.js';
import { fileURLToPath } from 'node:url';
import { loadConfig, rulesHash } from '../lib/config.js';

export async function memStore() {
  const pg = new PGlite();
  const store = createStore({ query: (t, p) => pg.query(t, p), close: () => pg.close() });
  await store.ensureSchema();
  return { store, pg };
}
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// Random walk dengan rezim naik-turun agar kedua modul strategi terpicu.
export function syntheticCandles({ startSec, n, dur = 14400, seed = 7, price = 1000000, inc = 1, phase = 0 }) {
  const r = rng(seed), out = [];
  let p = price;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin((i + phase) / 90) * 0.004;
    const o = p, c = o * (1 + drift + (r() - 0.5) * 0.03);
    const h = Math.max(o, c) * (1 + r() * 0.008), l = Math.min(o, c) * (1 - r() * 0.008);
    const round = x => Math.round(x / inc) * inc;
    out.push({ t: startSec + i * dur, o: round(o), h: round(h), l: round(l), c: round(c), v: 100 + r() * 1000 });
    p = c;
  }
  return out;
}
export function testConfig(over = {}) {
  const cfg = loadConfig(fileURLToPath(new URL('..', import.meta.url)));
  const c = JSON.parse(JSON.stringify(cfg));
  c.fees.official_taker_buy_pct = 0.21; c.fees.official_taker_sell_pct = 0.42;
  c.universe = { status: 'final', pairs: ['btcidr', 'ethidr', 'solidr'] };
  Object.assign(c, over);
  c.rulesHash = rulesHash(c);
  return c;
}
// Tiruan API Indodax mengikuti bentuk respons dokumentasi resmi.
export function fakeExchange({ candles, now, failDepth = () => false, failAll = () => false, emptyBook = () => false, spreadBps = 20 }) {
  const pairs = Object.keys(candles);
  return async function fakeFetch(url) {
    const u = new URL(url), nowMs = now();
    const ok = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (failAll()) throw new Error('jaringan gagal');
    if (u.pathname === '/api/server_time') return ok({ timezone: 'UTC', server_time: nowMs });
    if (u.pathname === '/api/pairs') return ok(pairs.map(p => ({ id: p, symbol: p.toUpperCase(), base_currency: 'idr', traded_currency: p.replace('idr', ''), ticker_id: p.replace('idr', '_idr'), quantity_increment: '0.00000001', trade_min_base_currency: 10000, trade_min_traded_currency: 0.00001, price_precision: 1, trade_fee_percent_taker: 0.2, is_market_suspended: 0, is_maintenance: 0 })));
    if (u.pathname === '/api/price_increments') return ok({ increments: Object.fromEntries(pairs.map(p => [p.replace('idr', '_idr'), '1'])) });
    if (u.pathname.startsWith('/api/depth/')) {
      const p = u.pathname.split('/').pop();
      if (failDepth(p)) return { ok: false, status: 503, text: async () => '' };
      if (emptyBook(p)) return ok({ buy: [], sell: [] });
      const running = candles[p].filter(b => b.t * 1000 <= nowMs).at(-1);
      const mid = running.c, hs = mid * spreadBps / 20000;
      const lv = (s, k) => Array.from({ length: 80 }, (_, i) => [Math.round(mid + s * (hs + i * mid * 0.0005)), String(0.5 + i * 0.1 * k)]);
      return ok({ buy: lv(-1, 1), sell: lv(1, 1) });
    }
    if (u.pathname === '/tradingview/history_v2') {
      const p = u.searchParams.get('symbol').toLowerCase(), a = +u.searchParams.get('from'), z = +u.searchParams.get('to');
      const list = candles[p].filter(b => b.t >= a && b.t <= z && b.t * 1000 <= nowMs);
      return ok(list.map(b => ({ Time: b.t, Open: b.o, High: b.h, Low: b.l, Close: b.c, Volume: String(b.v) })));
    }
    throw new Error('endpoint tidak dikenal ' + url);
  };
}
