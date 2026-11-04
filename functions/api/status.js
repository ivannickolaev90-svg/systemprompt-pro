// GET /api/status — статус посетителя: PRO или сколько бесплатных генераций осталось сегодня,
// плюс остаток ИИ-генераций и доступность ИИ.
import { handler, json, licenseInfo, TIERS, bearer, clientKey, peekLimit, FREE_PER_DAY, DAY_MS, PRICE_RUB } from '../../lib/shared.js';
import { aiGlobalState, peekUserAi, AI_CFG } from '../../lib/ai.js';

export const onRequest = handler(async (req) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  try {
    const cfg = AI_CFG();
    const token = bearer(req);
    const lic = token ? await licenseInfo(token) : null;
    const orderId = lic ? lic.orderId : null;
    const ipKey = await clientKey(req);
    let aiOnline = false;
    try { aiOnline = (await aiGlobalState()).ok; } catch (e) { aiOnline = false; }

    if (orderId) {
      const t = TIERS[lic.tier];
      const aiDaily = t.builder ? Math.max(cfg.proDaily, t.ai) : 0;
      const left = await peekUserAi('pro:' + orderId, Math.max(aiDaily, 1));
      return json({ pro: true, tier: lic.tier, plan: lic.plan, expiresAt: lic.expiresAt, builderPro: t.builder, price: PRICE_RUB, aiOnline, aiLeft: Math.min(left.remaining, aiDaily), aiDaily });
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
});

