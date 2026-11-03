// Menyusun laporan lengkap dari file: log_mentah/, log_backtest/, data/. Dipakai hitung_ulang dan dashboard.
import { loadConfig } from './config.js';
import { readJOpt, readLogs } from './files.js';
import { buildAudit, buildBacktestSection, buildForwardSection, buildGapSection, buildOps, identity } from './report.js';

export function assembleReport(root) {
  const cfg = loadConfig(root);
  const logs = readLogs(root);
  const meta = readJOpt(root, 'log_backtest/backtest_meta.json');
  let backtest = null;
  if (meta) {
    const bt = { meta, orders: readJOpt(root, 'log_backtest/backtest_orders.json') || [], equity: readJOpt(root, 'log_backtest/backtest_equity.json') || [], equityDaily: readJOpt(root, 'log_backtest/backtest_equity_daily.json') || [] };
    backtest = buildBacktestSection(bt, readJOpt(root, `data/candles/btcidr_${cfg.strategy.tf_param}.json`) || [], cfg);
  }
  const rm = readJOpt(root, 'log_backtest/replay_meta.json');
  const gap = rm ? buildGapSection(logs, { orders: readJOpt(root, 'log_backtest/replay_orders.json') || [], equity: readJOpt(root, 'log_backtest/replay_equity.json') || [], signals: readJOpt(root, 'log_backtest/replay_signals.json') || [] }, cfg) : null;
  return {
    identitas: identity(cfg),
    sumber_biaya: readJOpt(root, 'config/biaya_terukur.json'),
    sumber_tarif: readJOpt(root, 'hasil/sumber_tarif.json'),
    freeze: readJOpt(root, 'FREEZE.json'),
    data_uji: Boolean(meta?.data_uji || rm?.data_uji),
    backtest,
    forward: buildForwardSection(logs, cfg),
    ops: buildOps(logs, cfg),
    audit: buildAudit(logs, cfg),
    manifest: readJOpt(root, 'data/candles/manifest.json'),
    gap,
    replay_data_sha: rm?.data_sha ?? null,
  };
}
