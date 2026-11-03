// Semua waktu internal: detik/ms UTC. Hari trading: WIB (UTC+7), berganti 00.00 WIB = 17.00 UTC.
const WIB_MS = 7 * 3600 * 1000;
export function wibDate(ms) { return new Date(ms + WIB_MS).toISOString().slice(0, 10); }
export function slotUtcMs(ms, intervalMin = 60) {
  const w = intervalMin * 60000;
  return Math.floor(ms / w) * w;
}
export function iso(ms) { return new Date(ms).toISOString(); }
export function modeAt(ms, schedule) {
  const s = Date.parse(schedule.forward_start_iso), e = Date.parse(schedule.forward_end_iso);
  if (ms < s) return 'prep';
  if (ms < e) return 'forward';
  return 'post';
}
export function expectedSlots(startMs, endMs, intervalMin = 60) {
  const out = [], w = intervalMin * 60000;
  for (let t = slotUtcMs(startMs, intervalMin); t < endMs; t += w) out.push(t);
  return out;
}
