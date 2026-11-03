// FUNGSI SINYAL TUNGGAL: "Pullback Searah Tren", strategi UTS yang diadaptasi ke kripto.
// Dipakai oleh lib/tick.js (bot) dan lib/backtest.js (backtest & replay).
// Keluaran hanya ditentukan oleh candle tertutup, posisi strategi, nilai posisi, dan parameter.
// Level stop memakai Close candle sinyal, bukan harga fill, supaya sinyal bisa dicocokkan candle demi candle.
import { sma, atrWilder, rsiWilder } from './indicators.js';
import { validateWindow, windowSha } from './candles.js';

export function evaluateWindow(win, p) {
  const c = win.map(b => b.c), h = win.map(b => b.h), l = win.map(b => b.l);
  const i = win.length - 1;
  const smaArr = sma(c, p.trend_len);
  const smaNow = smaArr[i], smaPrev = smaArr[i - p.slope_bars];
  const atr = atrWilder(h, l, c, p.atr_period)[i], rsi = rsiWilder(c, p.rsi_len)[i];
  const mom = c[i] / c[i - p.mom_len] - 1;
  // ADTV: rata-rata nilai transaksi per bar pada adtv_bars terakhir, disetarakan ke per hari.
  const turnover = b => (p.volume_unit === 'idr' ? b.v : b.v * b.c);
  const barsPerDay = 1440 / p.timeframe_minutes;
  const adtv = win.slice(-p.adtv_bars).reduce((a, b) => a + turnover(b), 0) / p.adtv_bars * barsPerDay;
  const close = c[i], low = l[i], volume = win[i].v;
  const defined = [smaNow, smaPrev, atr, rsi, mom].every(Number.isFinite);
  const trendUp = defined && close > smaNow && smaNow > smaPrev;
  const pullback = defined && rsi < p.rsi_entry;
  const liquid = adtv >= p.min_adtv_idr && volume > 0;
  return { close, low, volume, sma: smaNow, smaPrev, atr, rsi, mom, adtv, trendUp, pullback, liquid, entrySetup: trendUp && pullback && liquid };
}

// pos: null | { module, entryCandle, refPrice, stopLevel, highestClose, barsHeld }
// ctx: { positionValue, equity } untuk batas bobot.
export function decide(pos, ev, candleTime, p, ctx = {}) {
  if (!pos) {
    if (!ev.entrySetup) return { raw: 'NONE', reason: null, module: null, pos: null };
    return {
      raw: 'BUY', reason: 'pullback_searah_tren', module: 'PULLBACK', adtv: ev.adtv,
      pos: { module: 'PULLBACK', entryCandle: candleTime, refPrice: ev.close, stopLevel: ev.close - p.stop_atr * ev.atr, highestClose: ev.close, barsHeld: 0 },
    };
  }
  const highestClose = Math.max(pos.highestClose, ev.close);
  const next = { ...pos, barsHeld: pos.barsHeld + 1, highestClose };
  let reason = null;
  if (ev.low <= pos.stopLevel) reason = 'stop_trailing'; // level dari penutupan sebelumnya
  else if (ev.close < ev.sma) reason = 'trend_patah';
  else if (next.barsHeld >= p.max_hold_bars) reason = 'batas_waktu';
  else if (ctx.equity > 0 && ctx.positionValue > ctx.equity * (p.wcap_pct / 100)) reason = 'batas_bobot';
  next.stopLevel = Math.max(pos.stopLevel, highestClose - p.stop_atr * ev.atr); // berlaku mulai candle berikutnya
  return reason ? { raw: 'SELL', reason, module: pos.module, pos: next } : { raw: 'HOLD', reason: null, module: pos.module, pos: next };
}

// Satu langkah strategi untuk satu pasangan pada satu candle tertutup.
// Data tidak valid: entry diblok. Exit tetap dievaluasi selama harga dan panjang jendela memadai.
export function computeStep(win, pos, p, { nowSec = null, withHash = true, ctx = {} } = {}) {
  const invalid = validateWindow(win, p, nowSec);
  const last = win[win.length - 1];
  const hash = withHash ? windowSha(win) : null;
  const fatal = invalid.some(r => r.startsWith('jendela_kurang') || r.startsWith('harga_nol'));
  if (fatal) {
    const d = pos ? { raw: 'HOLD', reason: 'data_tidak_valid', module: pos.module, pos }
      : { raw: 'NONE', reason: 'data_tidak_valid', module: null, pos: null };
    return { candleTime: last?.t ?? null, ev: null, invalid, hash, decision: d };
  }
  const ev = evaluateWindow(win, p);
  return { candleTime: last.t, ev, invalid, hash, decision: decide(pos, ev, last.t, p, ctx) };
}

// Sizing: 10% equity, dibatasi 5% ADTV dan kas.
export function entryBudget({ equity, cash, adtv }, p) {
  return Math.min(equity * (p.position_pct / 100), adtv * (p.adtv_cap_pct / 100), cash);
}

// Urutan proses dalam satu candle: pasangan berposisi dulu (exit), lalu kandidat Mom tertinggi; seri -> abjad.
export function orderSteps(items, positions) {
  const held = items.filter(x => positions[x.pair]);
  const free = items.filter(x => !positions[x.pair]).sort((a, b) => {
    const d = (b.step.ev?.mom ?? -Infinity) - (a.step.ev?.mom ?? -Infinity);
    return d !== 0 ? d : (a.pair < b.pair ? -1 : 1);
  });
  return [...held, ...free];
}
