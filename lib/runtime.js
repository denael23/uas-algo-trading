import { timingSafeEqual, createHash } from 'node:crypto';
export function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  const h = x => createHash('sha256').update(x).digest();
  return timingSafeEqual(h(given), h(secret));
}
export function needAuth(req, res) {
  if (authorized(req)) return true;
  res.status(401).json({ error: 'unauthorized' });
  return false;
}
