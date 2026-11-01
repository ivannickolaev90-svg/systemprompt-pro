// GET /api/status — статус посетителя: PRO или сколько бесплатных генераций осталось сегодня,
// плюс остаток ИИ-генераций и доступность ИИ.
import { json, verifyLicense, bearer, clientKey, peekLimit, FREE_PER_DAY, DAY_MS, PRICE_RUB } from '../lib/shared.mjs';
import { aiGlobalState, peekUserAi, AI_CFG } from '../lib/ai.mjs';

export default async (req, context) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  try {
    const cfg = AI_CFG();
    const token = bearer(req);
    const orderId = token ? await verifyLicense(token) : null;
    const ipKey = clientKey(req, context);
    let aiOnline = false;
    try { aiOnline = (await aiGlobalState()).ok; } catch (e) { aiOnline = false; }

    if (orderId) {
      const left = await peekUserAi('pro:' + orderId, cfg.proDaily);
      return json({ pro: true, price: PRICE_RUB, aiOnline, aiLeft: left.remaining, aiDaily: cfg.proDaily });
    }
    const q = await peekLimit('free2:' + ipKey, FREE_PER_DAY, DAY_MS);
    const left = await peekUserAi('free:' + ipKey, cfg.freeTrialDaily);
    return json({
      pro: false,
      licenseInvalid: !!token,
      tokensLeft: q.remaining,
      freePerDay: FREE_PER_DAY,
      resetAt: q.resetAt,
      price: PRICE_RUB,
      aiOnline,
      aiLeft: left.remaining,
      aiDaily: cfg.freeTrialDaily
    });
  } catch (e) {
    console.error('status failed:', e && e.message);
    return json({ error: 'server_error' }, 500);
  }
};

export const config = { path: '/api/status' };
