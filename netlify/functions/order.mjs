// POST /api/order — создаёт заказ с уникальной случайной меткой для формы ЮMoney.
import { json, isSameOrigin, ordersStore, newOrderId, clientKey, hitLimit, HOUR_MS, PRICE_RUB } from '../lib/shared.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);

  try {
    const rl = await hitLimit('order:' + clientKey(req, context), 20, HOUR_MS);
    if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

    const orderId = newOrderId();
    const { modified } = await ordersStore().setJSON(orderId, {
      status: 'pending',
      price: PRICE_RUB,
      createdAt: new Date().toISOString(),
      claims: 0
    }, { onlyIfNew: true });
    if (!modified) return json({ error: 'server_error' }, 500);

    return json({ orderId, label: 'sp_' + orderId, sum: PRICE_RUB });
  } catch (e) {
    console.error('order failed:', e && e.message);
    return json({ error: 'server_error' }, 500);
  }
};

export const config = { path: '/api/order' };
