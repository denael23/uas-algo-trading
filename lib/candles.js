// Parsing dan validasi candle. Time dari history_v2 dalam DETIK; server_time dalam MILIDETIK.
import { createHash } from 'node:crypto';

export function parseCandles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(b => ({
    t: Number(b.Time), o: Number(b.Open), h: Number(b.High),
    l: Number(b.Low), c: Number(b.Close), v: Number(b.Volume),
  })).filter(b => Number.isFinite(b.t)).sort((a, b) => a.t - b.t);
}
// Buang candle yang masih berjalan: Time + durasi > server_time.
export function closedOnly(candles, tfMinutes, serverTimeMs) {
  const dur = tfMinutes * 60, now = Math.floor(serverTimeMs / 1000);
  return candles.filter(b => b.t + dur <= now);
}
// Mengembalikan daftar alasan data tidak valid untuk SATU jendela indikator.
export function validateWindow(win, p, nowSec = null) {
  const r = [], dur = p.timeframe_minutes * 60;
  if (win.length < p.window_bars) r.push(`jendela_kurang:${win.length}/${p.window_bars}`);
  for (let i = 0; i < win.length; i++) {
    const b = win[i];
    if (!(b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0)) { r.push(`harga_nol:${b.t}`); break; }
  }
  for (const b of win) if (!(b.v > 0)) { r.push(`volume_nol:${b.t}`); break; }
  for (let i = 1; i < win.length; i++) {
    if (win[i].t - win[i - 1].t !== dur) { r.push(`candle_hilang:${win[i - 1].t}-${win[i].t}`); break; }
  }
  if (nowSec !== null && win.length) {
    const age = nowSec - (win[win.length - 1].t + dur);
    if (age > 2 * dur) r.push(`candle_basi:${age}s`);
  }
  return r;
}
export function windowSha(win) {
  return createHash('sha256').update(JSON.stringify(win)).digest('hex').slice(0, 16);
}
