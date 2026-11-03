// Indikator murni. Tidak ada I/O. Dipakai bersama oleh backtest dan bot melalui lib/signal.js.
export function sma(v, n) {
  const out = new Array(v.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
export function ema(v, n) {
  const out = new Array(v.length).fill(NaN);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let s = 0;
  for (let i = 0; i < n; i++) s += v[i];
  out[n - 1] = s / n;
  for (let i = n; i < v.length; i++) out[i] = v[i] * k + out[i - 1] * (1 - k);
  return out;
}
export function stdevLast(v, n) { // simpangan baku populasi n elemen terakhir
  const a = v.slice(-n), m = a.reduce((x, y) => x + y, 0) / n;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / n);
}
export function atrWilder(h, l, c, n) {
  const out = new Array(c.length).fill(NaN);
  if (c.length <= n) return out;
  const tr = c.map((_, i) => i === 0 ? h[0] - l[0]
    : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr[i];
  a /= n; out[n] = a;
  for (let i = n + 1; i < c.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}
export function rsiWilder(c, n) {
  const out = new Array(c.length).fill(NaN);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  }
  return out;
}
