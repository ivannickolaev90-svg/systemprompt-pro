// POST /api/claim — выдаёт подписанную лицензию, если ЮMoney подтвердил оплату заказа.
// Код заказа служит ключом восстановления доступа на другом устройстве.
import { handler,
  json, isSameOrigin, readJsonBody, ordersStore, isOrderId, signLicense,
  clientKey, hitLimit, HOUR_MS, MAX_DEVICES_PER_ORDER
} from '../../lib/shared.js';
import { ykConfigured, ykGetPayment, ykApplyPayment } from '../../lib/yookassa.js';

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody(req, 512);
  if (body.error) return json({ error: body.error }, 400);

  const orderId = String(body.data.orderId || '').trim().toLowerCase();
  if (!isOrderId(orderId)) return json({ error: 'bad_order' }, 400);

  try {
    // Защита от перебора кодов
    const rl = await hitLimit('claim:' + await clientKey(req), 60, HOUR_MS);
    if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

    const store = ordersStore();
    let res = await store.getWithMetadata(orderId);
    if (!res || !res.data) return json({ error: 'not_found' }, 404);
    let order = res.data;

    // Уведомление ЮKassa могло задержаться — спрашиваем статус платежа напрямую
    if (order.status === 'pending' && order.ykPaymentId && ykConfigured()) {
      try {
        if ((await ykApplyPayment(await ykGetPayment(order.ykPaymentId))) !== 'pending') {
          res = await store.getWithMetadata(orderId);
          order = res.data;
        }
      } catch (e) { console.warn('yookassa check failed:', e && e.message); }
    }

    if (order.revoked) return json({ error: 'revoked' }, 403);
    if (order.status === 'underpaid') return json({ status: 'underpaid' }, 402);
    if (order.status !== 'paid') return json({ status: 'pending' }, 202);

    const claims = typeof order.claims === 'number' ? order.claims : 0;
    if (claims >= MAX_DEVICES_PER_ORDER) return json({ error: 'device_limit' }, 403);
    await store.setJSON(orderId, { ...order, claims: claims + 1, lastClaimAt: new Date().toISOString() }, { onlyIfMatch: res.etag });

    return json({ status: 'paid', license: await signLicense(orderId), plan: order.plan || 'lifetime', price: order.paidAmount || order.price || 0 });
  } catch (e) {
    console.error('claim failed:', e && e.message);
    return json({ error: 'server_error' }, 500);
  }
});

