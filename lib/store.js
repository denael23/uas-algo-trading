// Penyimpanan persisten (Postgres). db: { query(text, params) -> {rows}, close() }.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY, mode TEXT NOT NULL, slot_utc TIMESTAMPTZ NOT NULL, started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ, source TEXT, status TEXT NOT NULL, duration_ms INTEGER, http_requests INTEGER,
  n_errors INTEGER DEFAULT 0, rules_hash TEXT, git_sha TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS calls_slot ON calls(mode, slot_utc);
CREATE TABLE IF NOT EXISTS signals (
  mode TEXT NOT NULL, pair TEXT NOT NULL, candle_time INTEGER NOT NULL, call_id INTEGER, processed_at TIMESTAMPTZ NOT NULL,
  raw_action TEXT NOT NULL, raw_reason TEXT, module TEXT, final_action TEXT NOT NULL, block_reason TEXT,
  invalid_reasons JSONB, ind JSONB, ohlcv JSONB, window_hash TEXT, PRIMARY KEY (mode, pair, candle_time));
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY, mode TEXT NOT NULL, call_id INTEGER, ts TIMESTAMPTZ NOT NULL, pair TEXT NOT NULL, side TEXT NOT NULL,
  qty DOUBLE PRECISION, best_bid DOUBLE PRECISION, best_ask DOUBLE PRECISION, avg_fill DOUBLE PRECISION, notional_idr DOUBLE PRECISION,
  fee_idr DOUBLE PRECISION, fee_rate DOUBLE PRECISION, spread_cost_idr DOUBLE PRECISION, slippage_cost_idr DOUBLE PRECISION,
  signal_price DOUBLE PRECISION, signal_candle INTEGER, diff_vs_signal_pct DOUBLE PRECISION, position_id INTEGER, module TEXT, reason TEXT,
  levels_used INTEGER, partial BOOLEAN, on_tick BOOLEAN, fee_api_pct DOUBLE PRECISION, fee_official_buy_pct DOUBLE PRECISION, fee_official_sell_pct DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS equity (
  id SERIAL PRIMARY KEY, mode TEXT NOT NULL, call_id INTEGER, ts TIMESTAMPTZ NOT NULL,
  cash DOUBLE PRECISION, position_value DOUBLE PRECISION, equity DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS equity_daily (
  mode TEXT NOT NULL, wib_date TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL, equity DOUBLE PRECISION, call_id INTEGER, PRIMARY KEY (mode, wib_date));
CREATE TABLE IF NOT EXISTS errors (
  id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, call_id INTEGER, mode TEXT, scope TEXT, pair TEXT, attempt INTEGER, message TEXT);
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, call_id INTEGER, mode TEXT, type TEXT NOT NULL, detail JSONB);
CREATE TABLE IF NOT EXISTS ob_snapshots (
  id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, call_id INTEGER, mode TEXT, pair TEXT NOT NULL,
  best_bid DOUBLE PRECISION, best_ask DOUBLE PRECISION, spread_pct DOUBLE PRECISION, bids JSONB, asks JSONB);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY, until TIMESTAMPTZ NOT NULL, owner TEXT);
INSERT INTO lease (id, until, owner) VALUES (1, '2000-01-01T00:00:00Z', NULL) ON CONFLICT DO NOTHING;
`;

export const LOG_TABLES = ['calls', 'signals', 'orders', 'equity', 'equity_daily', 'errors', 'events', 'ob_snapshots'];

export function createStore(db) {
  const q = (t, p = []) => db.query(t, p);
  const j = v => (v == null ? null : JSON.stringify(v));
  const d = ms => new Date(ms).toISOString();
  return {
    q,
    async ensureSchema() { for (const s of SCHEMA.split(';').map(x => x.trim()).filter(Boolean)) await q(s); },
    async tx(fn) {
      await q('BEGIN');
      try { const r = await fn(); await q('COMMIT'); return r; }
      catch (e) { await q('ROLLBACK'); throw e; }
    },
    async startCall({ mode, slotMs, startMs, source, rulesHash, gitSha }) {
      const r = await q(`INSERT INTO calls (mode, slot_utc, started_at, source, status, rules_hash, git_sha) VALUES ($1,$2,$3,$4,'running',$5,$6) RETURNING id`,
        [mode, d(slotMs), d(startMs), source, rulesHash, gitSha]);
      return Number(r.rows[0].id);
    },
    async finishCall(id, { status, endMs, startMs, http, nErrors, note }) {
      await q(`UPDATE calls SET status=$2, finished_at=$3, duration_ms=$4, http_requests=$5, n_errors=$6, note=$7 WHERE id=$1`,
        [id, status, d(endMs), Math.round(endMs - startMs), http ?? 0, nErrors ?? 0, note ?? null]);
    },
    async slotDone(mode, slotMs) {
      const r = await q(`SELECT id FROM calls WHERE mode=$1 AND slot_utc=$2 AND status IN ('ok','ok_with_errors') LIMIT 1`, [mode, d(slotMs)]);
      return r.rows.length > 0;
    },
    async acquireLease(owner, nowMs, ttlMs) {
      const r = await q(`UPDATE lease SET until=$1, owner=$2 WHERE id=1 AND until < $3 RETURNING id`, [d(nowMs + ttlMs), owner, d(nowMs)]);
      return r.rows.length > 0;
    },
    async releaseLease(owner) { await q(`UPDATE lease SET until='2000-01-01T00:00:00Z' WHERE id=1 AND owner=$1`, [owner]); },
    async getKv(key) {
      const r = await q(`SELECT value FROM kv WHERE key=$1`, [key]);
      if (!r.rows.length) return null;
      const v = r.rows[0].value;
      return typeof v === 'string' ? JSON.parse(v) : v;
    },
    async setKv(key, value, nowMs) {
      await q(`INSERT INTO kv (key, value, updated_at) VALUES ($1,$2::jsonb,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`, [key, j(value), d(nowMs)]);
    },
    async logError({ ts, callId, mode, scope, pair, attempt, message }) {
      await q(`INSERT INTO errors (ts, call_id, mode, scope, pair, attempt, message) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [d(ts), callId, mode, scope, pair ?? null, attempt ?? null, String(message).slice(0, 500)]);
    },
    async logEvent({ ts, callId, mode, type, detail }) {
      await q(`INSERT INTO events (ts, call_id, mode, type, detail) VALUES ($1,$2,$3,$4,$5::jsonb)`, [d(ts), callId ?? null, mode, type, j(detail ?? {})]);
    },
    async saveSnapshot({ ts, callId, mode, pair, bestBid, bestAsk, spreadPct, bids, asks }) {
      await q(`INSERT INTO ob_snapshots (ts, call_id, mode, pair, best_bid, best_ask, spread_pct, bids, asks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
        [d(ts), callId, mode, pair, bestBid, bestAsk, spreadPct, j(bids), j(asks)]);
    },
    async lastProcessed(mode) {
      const r = await q(`SELECT pair, MAX(candle_time) AS t FROM signals WHERE mode=$1 GROUP BY pair`, [mode]);
      return Object.fromEntries(r.rows.map(x => [x.pair, Number(x.t)]));
    },
    async claimSignal(s) { // Idempotency: satu baris per (mode, pair, candle). Panggilan kedua mendapat false.
      const r = await q(`INSERT INTO signals (mode, pair, candle_time, call_id, processed_at, raw_action, raw_reason, module, final_action, block_reason, invalid_reasons, ind, ohlcv, window_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14) ON CONFLICT DO NOTHING RETURNING pair`,
        [s.mode, s.pair, s.candle_time, s.call_id, s.processed_at, s.raw_action, s.raw_reason, s.module, s.final_action, s.block_reason, j(s.invalid_reasons), j(s.ind), j(s.ohlcv), s.window_hash]);
      return r.rows.length > 0;
    },
    async updateSignalFinal(mode, pair, t, finalAction, blockReason) {
      await q(`UPDATE signals SET final_action=$4, block_reason=$5 WHERE mode=$1 AND pair=$2 AND candle_time=$3`, [mode, pair, t, finalAction, blockReason]);
    },
    async insertOrder(o) {
      const cols = ['mode', 'call_id', 'ts', 'pair', 'side', 'qty', 'best_bid', 'best_ask', 'avg_fill', 'notional_idr', 'fee_idr', 'fee_rate', 'spread_cost_idr', 'slippage_cost_idr', 'signal_price', 'signal_candle', 'diff_vs_signal_pct', 'position_id', 'module', 'reason', 'levels_used', 'partial', 'on_tick', 'fee_api_pct', 'fee_official_buy_pct', 'fee_official_sell_pct'];
      await q(`INSERT INTO orders (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, cols.map(c => o[c]));
    },
    async insertEquity({ mode, callId, ts, cash, positionValue, equity }) {
      await q(`INSERT INTO equity (mode, call_id, ts, cash, position_value, equity) VALUES ($1,$2,$3,$4,$5,$6)`, [mode, callId, d(ts), cash, positionValue, equity]);
    },
    async dayStartEquity({ mode, wib, ts, equity, callId }) {
      await q(`INSERT INTO equity_daily (mode, wib_date, ts, equity, call_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [mode, wib, d(ts), equity, callId]);
      const r = await q(`SELECT equity FROM equity_daily WHERE mode=$1 AND wib_date=$2`, [mode, wib]);
      return Number(r.rows[0].equity);
    },
    async dumpTable(table, where = '', params = []) {
      const order = table === 'signals' ? 'candle_time, pair' : table === 'equity_daily' ? 'wib_date' : 'id';
      const r = await q(`SELECT * FROM ${table} ${where} ORDER BY ${order}`, params);
      return r.rows.map(normalizeRow);
    },
  };
}
export function normalizeRow(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) o[k] = v.toISOString();
    else if (typeof v === 'bigint') o[k] = Number(v);
    else o[k] = v;
  }
  return o;
}
export async function createPgDb(url) {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, query_timeout: 20000, ssl: /sslmode=disable/.test(url) ? false : { rejectUnauthorized: true } });
  await client.connect();
  return { query: (t, p) => client.query(t, p), close: () => client.end() };
}
