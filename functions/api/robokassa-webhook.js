// POST /api/robokassa-webhook — Result URL Робокассы: подтверждение оплаты.
// Подпись: MD5(OutSum:InvId:Пароль2:Shp_order). Отвечаем текстом OK<InvId> — иначе Робокасса шлёт повторы.
// Документация: https://docs.robokassa.ru/pay-interface/#notification
import { handler, env, ordersStore, isOrderId, PRICE_RUB, paidPeriod, afterPaid } from '../../lib/shared.js';
import { rkConfigured, rkVerifyResult } from '../../lib/robokassa.js';

const text = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return text('method_not_allowed', 405);
  if (!rkConfigured()) {
    console.error('robokassa: secrets are not configured');
    return text('not_configured', 500);
  }

  const raw = await req.text();
  if (raw.length > 4096) return text('too_large', 413);
  const p = new URLSearchParams(raw);

  const outSum = p.get('OutSum') || '';
  const invId = p.get('InvId') || '';
  const sign = p.get('SignatureValue') || '';
  const orderId = (p.get('Shp_order') || '').toLowerCase();
  if (!/^\d{1,10}$/.test(invId)) return text('bad_invid', 400);

  if (!rkVerifyResult({ outSum, invId, shpOrder: orderId, sign })) {
    console.warn('robokassa: invalid signature, InvId', invId);
    return text('invalid_signature', 403);
  }

  // Тестовое уведомление из кабинета Робокассы или платёж без нашей метки — подпись верна, просто подтверждаем
  if (!isOrderId(orderId)) return text('OK' + invId);

  try {
    const store = ordersStore();
    const res = await store.getWithMetadata(orderId);
    if (!res || !res.data) {
      console.warn('robokassa: unknown order', orderId);
      return text('OK' + invId);
    }
    const order = res.data;
    // Счёт должен быть именно тем, что мы выставляли по этому заказу
    if (order.rkInvId && String(order.rkInvId) !== invId) {
      console.warn('robokassa: invId mismatch for order', orderId);
      return text('invalid_invid', 403);
    }
    if (order.status === 'paid') return text('OK' + invId);

    const paid = parseFloat(outSum || '0');
    const status = paid + 0.001 >= (order.price || PRICE_RUB) ? 'paid' : 'underpaid';
    await store.setJSON(orderId, {
      ...order,
      ...(status === 'paid' ? paidPeriod(order) : {}),
      status,
      paidAmount: paid,
      provider: 'robokassa',
      rkInvId: invId,
      paidAt: new Date().toISOString()
    });
    if (status === 'paid') await afterPaid(order);
    console.log('robokassa: order', orderId, status, paid);
    return text('OK' + invId);
  } catch (e) {
    console.error('robokassa webhook failed:', e && e.message);
    // 500 — Робокасса повторит уведомление позже
    return text('server_error', 500);
  }
});
