// Klien API PUBLIK Indodax. Tanpa API key. Berurutan, dibatasi laju, retry terbatas.
export const BASE_URL = 'https://indodax.com';

export function createClient({ fetchImpl = globalThis.fetch, onError = () => {}, minGapMs = 350, timeoutMs = 8000, maxAttempts = 3, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let last = 0, count = 0;
  async function getJson(pathAndQuery, scope = pathAndQuery, pair = null) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now(); count++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(BASE_URL + pathAndQuery, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'uas-algo-trading-dry-run/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text || !text.trim()) throw new Error('respons kosong');
        return JSON.parse(text);
      } catch (e) {
        lastErr = e;
        const msg = e.name === 'AbortError' ? `timeout ${timeoutMs}ms` : String(e.message || e);
        await onError({ scope, pair, attempt, message: msg });
        if (attempt < maxAttempts) await sleep(500 * 3 ** (attempt - 1));
      } finally { clearTimeout(timer); }
    }
    throw lastErr;
  }
  return {
    requestCount: () => count,
    serverTimeMs: async () => {
      const j = await getJson('/api/server_time', 'server_time');
      const t = Number(j.server_time);
      if (!Number.isFinite(t)) throw new Error('server_time tidak valid');
      return t < 1e12 ? t * 1000 : t; // dokumentasi: milidetik
    },
    pairs: () => getJson('/api/pairs', 'pairs'),
    increments: async () => (await getJson('/api/price_increments', 'price_increments')).increments,
    tickerAll: async () => (await getJson('/api/ticker_all', 'ticker_all')).tickers,
    depth: pairId => getJson(`/api/depth/${pairId}`, 'depth', pairId),
    history: (symbol, tf, fromSec, toSec) => getJson(`/tradingview/history_v2?symbol=${symbol}&tf=${tf}&from=${fromSec}&to=${toSec}`, 'history', symbol),
  };
}
