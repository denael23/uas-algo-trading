import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const rootDir = () => process.env.UAS_ROOT || process.cwd();
const readJson = (root, f) => JSON.parse(readFileSync(path.join(root, f), 'utf8'));

export function loadConfig(root = rootDir()) {
  const cfg = {
    strategy: readJson(root, 'config/strategy.json'),
    schedule: readJson(root, 'config/schedule.json'),
    universe: readJson(root, 'config/universe.json'),
    fees: readJson(root, 'config/fees.json'),
  };
  cfg.strategy.volume_unit = cfg.universe.volume_unit || 'coin';
  cfg.rulesHash = rulesHash(cfg);
  return cfg;
}
export function rulesHash(cfg) {
  return createHash('sha256').update(JSON.stringify({ s: cfg.strategy, u: cfg.universe.pairs })).digest('hex').slice(0, 16);
}
export function readOptional(root, f) {
  const p = path.join(root, f);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
// Tarif taker per sisi: yang lebih mahal antara /api/pairs dan halaman resmi.
export function effectiveFee(fees, apiTakerPct) {
  const ob = fees.official_taker_buy_pct, os = fees.official_taker_sell_pct;
  if (ob == null || os == null) return null;
  const api = Number.isFinite(apiTakerPct) ? apiTakerPct : 0;
  return { buyPct: Math.max(ob, api), sellPct: Math.max(os, api), apiPct: Number.isFinite(apiTakerPct) ? apiTakerPct : null, officialBuyPct: ob, officialSellPct: os };
}
export function pairMeta(pairsList, increments) {
  const out = {};
  for (const x of pairsList || []) {
    const incKey = x.ticker_id;
    out[x.id] = {
      id: x.id, symbol: x.symbol, base: x.base_currency, tickerId: x.ticker_id,
      qtyInc: Number(x.quantity_increment) || 1e-8,
      priceInc: Number(increments?.[incKey]) || Number(x.price_precision) || 0,
      minBaseIdr: Number(x.trade_min_base_currency) || 0,
      minQty: Number(x.trade_min_traded_currency) || 0,
      takerPct: x.trade_fee_percent_taker == null ? null : Number(x.trade_fee_percent_taker),
      suspended: Boolean(Number(x.is_market_suspended || 0) || Number(x.is_maintenance || 0)),
    };
  }
  return out;
}
export const minOrderIdr = (m, p) => Math.max(p.min_order_idr, m?.minBaseIdr || 0);
