// POST /api/order — создаёт заказ по тарифу и платёж в ЮKassa (СБП или карта).
// Тело: { plan, method: 'sbp' | 'card', renew?: <текущая лицензия> }.
// Если ЮKassa не настроена — возвращает метку для старой формы ЮMoney.
import { handler, json, isSameOrigin, readJsonBody, ordersStore, getStore, wasModified, newOrderId, clientKey, hitLimit,
  licenseInfo, isPlan, PLANS, HOUR_MS } from '../../lib/shared.js';
import { ykConfigured, ykCreatePayment } from '../../lib/yookassa.js';

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody(req, 1024);
  if (body.error) return json({ error: body.error }, 400);
  const planId = isPlan(body.data.plan) ? body.data.plan : 'pro';
  const method = body.data.method === 'card' ? 'card' : 'sbp';
  const plan = PLANS[planId];

  try {
    const ipKey = await clientKey(req);
    const rl = await hitLimit('order:' + ipKey, 20, HOUR_MS);
    if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

    if (planId === 'trial' && await getStore('sp-trials').get(ipKey)) return json({ error: 'trial_used' }, 409);

    // Продление: новый срок начнётся после окончания текущего
    let extendFrom = 0;
    if (typeof body.data.renew === 'string' && body.data.renew) {
      const lic = await licenseInfo(body.data.renew);
      if (lic && lic.expiresAt) extendFrom = Date.parse(lic.expiresAt);
    }

    const orderId = newOrderId();
    const store = ordersStore();
    const order = {
      status: 'pending', plan: planId, price: plan.price, method,
      createdAt: new Date().toISOString(), claims: 0,
      ...(extendFrom ? { extendFrom } : {}),
      ...(planId === 'trial' ? { trialKey: ipKey } : {})
    };
    if (!wasModified(await store.setJSON(orderId, order, { onlyIfNew: true }))) return json({ error: 'server_error' }, 500);

    if (ykConfigured()) {
      try {
        const returnUrl = new URL(req.url).origin + '/?pay=success&order=' + orderId;
        const pay = await ykCreatePayment(orderId, returnUrl, { amount: plan.price, title: plan.title, method });
        const cur = await store.getWithMetadata(orderId);
        await store.setJSON(orderId, { ...cur.data, ykPaymentId: pay.id }, { onlyIfMatch: cur.etag });
        return json({ orderId, sum: plan.price, payUrl: pay.url });
      } catch (e) {
        console.error('yookassa create failed:', e && e.message);
      }
    }
    return json({ orderId, label: 'sp_' + orderId, sum: plan.price });
  } catch (e) {
    console.error('order failed:', e && e.message);
    return json({ error: 'server_error' }, 500);
  }
});
