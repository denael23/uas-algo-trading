// Satu panggilan bot: baca state, ambil data, hitung sinyal, eksekusi simulasi, simpan state dan log.
import { closedOnly, parseCandles } from './candles.js';
import { computeStep, entryBudget, orderSteps } from './signal.js';
import { bookIssue, fillBuy, fillSell, parseBook, spreadPct } from './orderbook.js';
import { applyBuy, applySell, markEquity, newPortfolio, orderRecord } from './portfolio.js';
import { effectiveFee, minOrderIdr, pairMeta } from './config.js';
import { modeAt, slotUtcMs, wibDate } from './time.js';

export const BENCHMARK_PAIR = 'btcidr';

export async function runTick({ store, cfg, createClient, nowMs = () => Date.now(), source = 'manual', gitSha = null, sleepBudgetMs = 100000 }) {
  const startMs = nowMs();
  const p = cfg.strategy;
  const mode = modeAt(startMs, cfg.schedule);
  const slotMs = slotUtcMs(startMs, cfg.schedule.tick_interval_minutes);
  const callId = await store.startCall({ mode, slotMs, startMs, source, rulesHash: cfg.rulesHash, gitSha });
  let nErrors = 0;
  const err = async ({ scope, pair, attempt, message }) => {
    nErrors++;
    await store.logError({ ts: nowMs(), callId, mode, scope, pair, attempt, message });
  };
  const client = createClient({ onError: err });
  const done = async (status, note, extra = {}) => {
    await store.finishCall(callId, { status, endMs: nowMs(), startMs, http: client.requestCount(), nErrors, note });
    return { callId, mode, status, note, nErrors, ...extra };
  };

  if (mode === 'post') return done('post_forward', 'forward test selesai; tidak ada transaksi');
  if (await store.slotDone(mode, slotMs)) return done('duplicate_slot', 'slot ini sudah terlaksana');
  const owner = `call-${callId}`;
  if (!await store.acquireLease(owner, startMs, 180000)) return done('skipped_locked', 'panggilan lain sedang berjalan');

  try {
    const out = await tickBody();
    return await done(nErrors ? 'ok_with_errors' : 'ok', out.note, out);
  } catch (e) {
    await err({ scope: 'tick_fatal', message: e?.stack || String(e) });
    return await done('error', String(e?.message || e));
  } finally {
    await store.releaseLease(owner);
  }

  async function tickBody() {
    const deadline = startMs + sleepBudgetMs;
    let serverMs = null;
    try { serverMs = await client.serverTimeMs(); } catch { /* sudah dicatat */ }
    const serverSec = serverMs === null ? null : Math.floor(serverMs / 1000);

    let meta = await store.getKv('meta_cache');
    try {
      const [pairs, inc] = [await client.pairs(), await client.increments()];
      meta = pairMeta(pairs, inc);
      await store.setKv('meta_cache', meta, nowMs());
    } catch { /* memakai cache; sudah dicatat */ }
    meta = meta || {};

    const universe = cfg.universe.pairs;
    let tradingOk = true, disabledReason = null;
    if (cfg.fees.official_taker_buy_pct == null || cfg.fees.official_taker_sell_pct == null) {
      tradingOk = false; disabledReason = 'fee_resmi_belum_diisi';
    }
    if (mode === 'forward' && cfg.universe.status !== 'final') { tradingOk = false; disabledReason = 'universe_belum_final'; }
    if (!tradingOk) await err({ scope: 'config', message: disabledReason });

    const pfKey = `portfolio:${mode}`;
    let pf = await store.getKv(pfKey);
    if (!pf) {
      pf = newPortfolio(p.initial_capital_idr);
      pf.modeStartSec = mode === 'forward' ? Math.floor(Date.parse(cfg.schedule.forward_start_iso) / 1000) : Math.floor(startMs / 1000);
    }
    const kill = (await store.getKv('kill_switch'))?.on === true;

    // Order book + snapshot mentah
    const books = {}, issues = {};
    const toSnap = [...new Set([...universe, BENCHMARK_PAIR])];
    for (const pair of toSnap) {
      if (nowMs() > deadline) { await err({ scope: 'deadline', pair, message: 'melewati batas waktu internal' }); continue; }
      try {
        const book = parseBook(await client.depth(pair));
        books[pair] = book;
        issues[pair] = bookIssue(book, p.max_spread_pct);
        const n = p.book_levels_saved;
        await store.saveSnapshot({ ts: nowMs(), callId, mode, pair, bestBid: book.bids[0]?.[0] ?? null, bestAsk: book.asks[0]?.[0] ?? null, spreadPct: spreadPct(book), bids: book.bids.slice(0, n), asks: book.asks.slice(0, n) });
        if (issues[pair]) await store.logEvent({ ts: nowMs(), callId, mode, type: 'data_tidak_valid', detail: { pair, reason: issues[pair] } });
      } catch { issues[pair] = 'order_book_gagal'; await store.logEvent({ ts: nowMs(), callId, mode, type: 'data_tidak_valid', detail: { pair, reason: 'order_book_gagal' } }); }
    }

    // Candle tertutup
    const dur = p.timeframe_minutes * 60;
    const closed = {};
    if (serverSec !== null) {
      for (const pair of universe) {
        if (nowMs() > deadline) { await err({ scope: 'deadline', pair, message: 'melewati batas waktu internal' }); continue; }
        const symbol = meta[pair]?.symbol || pair.toUpperCase();
        try {
          const raw = await client.history(symbol, p.tf_param, serverSec - (p.window_bars + 12) * dur, serverSec);
          const bars = closedOnly(parseCandles(raw), p.timeframe_minutes, serverMs);
          if (!bars.length) throw new Error('respons candle kosong');
          closed[pair] = bars;
          const age = serverSec - (bars.at(-1).t + dur);
          if (age > 2 * dur) await store.logEvent({ ts: nowMs(), callId, mode, type: 'data_tidak_valid', detail: { pair, reason: `candle_basi:${age}s` } });
        } catch (e) {
          if (String(e.message).includes('kosong')) await err({ scope: 'history', pair, message: e.message });
        }
      }
    }

    const feeFor = pair => effectiveFee(cfg.fees, meta[pair]?.takerPct);
    const bidOf = pair => books[pair]?.bids[0]?.[0];
    const mark = () => markEquity(pf, bidOf);

    // Equity awal hari (panggilan pertama setelah 00.00 WIB) + daily loss limit
    const m0 = mark();
    const wib = wibDate(nowMs());
    const dayStart = await store.dayStartEquity({ mode, wib, ts: nowMs(), equity: m0.equity, callId });
    const lossLimitHit = () => (mark().equity / dayStart - 1) * 100 <= -p.daily_loss_limit_pct;
    const checkDll = async () => {
      if (pf.dllDate === wib) return true; // Terkunci sampai 00.00 WIB berikutnya, meski equity pulih.
      const hit = lossLimitHit();
      if (hit) {
        pf.dllDate = wib;
        await store.logEvent({ ts: nowMs(), callId, mode, type: 'daily_loss_limit', detail: { wib, dayStart, equity: mark().equity, limit_pct: p.daily_loss_limit_pct } });
      }
      return hit;
    };

    let nOrders = 0;
    const execSell = async (pair, qtyWanted, ctx) => {
      const book = books[pair], fee = feeFor(pair);
      if (!book?.bids.length || !fee) return null;
      const fill = fillSell(book, qtyWanted, fee.sellPct / 100, meta[pair]);
      if (!fill) return null;
      const posId = applySell(pf, pair, fill);
      await store.insertOrder(orderRecord({ mode, callId, ts: nowMs(), pair, fill, signalPrice: ctx.signalPrice, signalCandle: ctx.candle, positionId: posId, module: ctx.module, reason: ctx.reason, feeInfo: fee }));
      nOrders++;
      return fill;
    };

    // Exit yang tertunda (order book sebelumnya kosong atau gagal)
    for (const [pair, x] of Object.entries(pf.positions)) {
      if (!x.pendingExit) continue;
      const snapshot = JSON.stringify(pf);
      try {
        await store.tx(async () => {
          const fill = await execSell(pair, x.qty, x.pendingExit);
          if (fill && pf.positions[pair]) pf.positions[pair].pendingExit = x.pendingExit;
          await store.setKv(pfKey, pf, nowMs());
        });
      } catch (e) { pf = JSON.parse(snapshot); await err({ scope: 'exit_tertunda', pair, message: e.message }); }
    }

    // Antrean candle baru. Satu candle hanya diproses sekali.
    const last = await store.lastProcessed(mode);
    const times = new Set();
    for (const pair of universe) {
      for (const b of closed[pair] || []) {
        if (b.t + dur > pf.modeStartSec && b.t > (last[pair] ?? -1)) times.add(b.t);
      }
    }
    let nSignals = 0, nDup = 0;
    for (const t of [...times].sort((a, b) => a - b)) {
      const eqAtClose = mark().equity;
      const items = [];
      for (const pair of universe) {
        const bars = closed[pair];
        if (!bars) continue;
        const idx = bars.findIndex(b => b.t === t);
        if (idx < 0 || t <= (last[pair] ?? -1)) continue;
        const win = bars.slice(Math.max(0, idx - p.window_bars + 1), idx + 1);
        const held = pf.positions[pair];
        const ctx = held ? { positionValue: held.qty * bars[idx].c, equity: eqAtClose } : {};
        const step = computeStep(win, held?.strat ?? null, p, { nowSec: serverSec, ctx });
        if (held?.pendingExit) step.decision = { raw: 'HOLD', reason: 'menunggu_exit', module: held.strat.module, pos: held.strat };
        items.push({ pair, step, bar: bars[idx], held });
      }
      for (const { pair, step, bar, held } of orderSteps(items, pf.positions)) {
        const dec = step.decision;
        const row = {
          mode, pair, candle_time: t, call_id: callId, processed_at: new Date(nowMs()).toISOString(),
          raw_action: dec.raw, raw_reason: dec.reason, module: dec.module, final_action: dec.raw, block_reason: null,
          invalid_reasons: step.invalid, ind: step.ev, ohlcv: bar, window_hash: step.hash,
        };
        const snapshot = JSON.stringify(pf);
        try {
          await store.tx(async () => {
            if (!await store.claimSignal(row)) { nDup++; return; }
            nSignals++;
            if (step.invalid.length) await store.logEvent({ ts: nowMs(), callId, mode, type: 'data_tidak_valid', detail: { pair, candle: t, reasons: step.invalid } });
            if (dec.raw === 'BUY') {
              const blocked = await entryBlock(pair, step, dec);
              if (blocked) await store.updateSignalFinal(mode, pair, t, 'BLOCKED', blocked);
              else await store.updateSignalFinal(mode, pair, t, 'BUY_FILLED', null);
            } else if (dec.raw === 'SELL') {
              const ctx = { signalPrice: bar.c, candle: t, module: dec.module, reason: dec.reason };
              const fill = await execSell(pair, pf.positions[pair].qty, ctx);
              if (!fill || pf.positions[pair]) {
                pf.positions[pair].pendingExit = ctx;
                pf.positions[pair].strat = dec.pos;
                await store.updateSignalFinal(mode, pair, t, 'SELL_PENDING', fill ? 'pengisian_parsial' : 'order_book_tidak_tersedia');
              } else await store.updateSignalFinal(mode, pair, t, 'SELL_FILLED', null);
            } else if (dec.raw === 'HOLD' && pf.positions[pair] && !held.pendingExit) {
              pf.positions[pair].strat = dec.pos;
            }
            await store.setKv(pfKey, pf, nowMs());
          });
        } catch (e) { pf = JSON.parse(snapshot); await err({ scope: 'proses_candle', pair, message: e.message }); }
      }
    }

    async function entryBlock(pair, step, dec) {
      if (kill) return 'kill_switch';
      if (await checkDll()) return 'daily_loss_limit';
      if (!tradingOk) return disabledReason;
      if (step.invalid.length) return 'data_tidak_valid:' + step.invalid[0];
      if (meta[pair]?.suspended) return 'pasar_ditangguhkan';
      if (issues[pair] || !books[pair]) return issues[pair] || 'order_book_tidak_tersedia';
      if (Object.keys(pf.positions).length >= p.max_open_positions) return 'batas_posisi';
      const fee = feeFor(pair);
      const { equity } = mark();
      const budget = entryBudget({ equity, cash: pf.cash, adtv: dec.adtv }, p);
      const minIdr = minOrderIdr(meta[pair], p);
      if (budget < minIdr) return 'di_bawah_minimum_order';
      const fill = fillBuy(books[pair], budget, fee.buyPct / 100, meta[pair]);
      if (!fill || fill.notional < minIdr || fill.qty < (meta[pair]?.minQty || 0)) return 'di_bawah_minimum_order';
      const posId = applyBuy(pf, pair, fill, dec.pos);
      await store.insertOrder(orderRecord({ mode, callId, ts: nowMs(), pair, fill, signalPrice: dec.pos.refPrice, signalCandle: dec.pos.entryCandle, positionId: posId, module: dec.module, reason: dec.reason, feeInfo: fee }));
      nOrders++;
      return null;
    }

    await checkDll();
    const m1 = mark();
    await store.insertEquity({ mode, callId, ts: nowMs(), cash: m1.cash, positionValue: m1.positionValue, equity: m1.equity });
    await store.setKv(pfKey, pf, nowMs());
    return { note: `sinyal=${nSignals} order=${nOrders} duplikat=${nDup}`, nSignals, nOrders, nDup, equity: m1.equity, kill };
  }
}
