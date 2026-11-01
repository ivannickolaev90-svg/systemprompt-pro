// GET /api/status — статус посетителя: PRO или сколько бесплатных генераций осталось сегодня.
import { json, verifyLicense, bearer, clientKey, peekLimit, FREE_PER_DAY, DAY_MS, PRICE_RUB } from '../lib/shared.mjs';

export default async (req, context) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  try {
    const token = bearer(req);
    const orderId = token ? await verifyLicense(token) : null;
    if (orderId) return json({ pro: true, price: PRICE_RUB });
    const q = await peekLimit('free:' + clientKey(req, context), FREE_PER_DAY, DAY_MS);
    return json({
      pro: false,
      licenseInvalid: !!token,
      tokensLeft: q.remaining,
      freePerDay: FREE_PER_DAY,
      resetAt: q.resetAt,
      price: PRICE_RUB
    });
  } catch (e) {
    console.error('status failed:', e && e.message);
    return json({ error: 'server_error' }, 500);
  }
};

export const config = { path: '/api/status' };
