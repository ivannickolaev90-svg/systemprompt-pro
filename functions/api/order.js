// POST /api/order — создаёт заказ с уникальной случайной меткой для формы ЮMoney.
import { handler, json, isSameOrigin, ordersStore, wasModified, newOrderId, clientKey, hitLimit, HOUR_MS, PRICE_RUB } from '../../lib/shared.js';
import { ykConfigured, ykCreatePayment } from '../../lib/yookassa.js';

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);

  try {
    const rl = await hitLimit('order:' + await clientKey(req), 20, HOUR_MS);
    if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

    const orderId = newOrderId();
    const modified = wasModified(await ordersStore().setJSON(orderId, {
      status: 'pending',
      price: PRICE_RUB,
      createdAt: new Date().toISOString(),
      claims: 0
    }, { onlyIfNew: true }));
    if (!modified) return json({ error: 'server_error' }, 500);

    // ЮKassa (СБП, SberPay, T-Pay, карта), если настроена; иначе — старая форма ЮMoney
    if (ykConfigured()) {
      try {
        const returnUrl = new URL(req.url).origin + '/?pay=success&order=' + orderId;
        const pay = await ykCreatePayment(orderId, returnUrl);
        const store = ordersStore();
        const cur = await store.getWithMetadata(orderId);
        await store.setJSON(orderId, { ...cur.data, ykPaymentId: pay.id }, { onlyIfMatch: cur.etag });
        return json({ orderId, sum: PRICE_RUB, payUrl: pay.url });
      } catch (e) {
        console.error('yookassa create failed:', e && e.message);
      }
    }
    return json({ orderId, label: 'sp_' + orderId, sum: PRICE_RUB });
  } catch (e) {
    console.error('order failed:', e && e.message);
    return json({ error: 'server_error' }, 500);
  }
});

