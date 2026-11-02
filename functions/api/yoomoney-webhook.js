// POST /api/yoomoney-webhook — HTTP-уведомления ЮMoney о входящих платежах.
// Подлинность проверяется подписью `sign` (HMAC-SHA256 с секретом из настроек ЮMoney).
// Документация: https://yoomoney.ru/docs/payment-buttons/using-api/notifications
import { handler, env, json, safeEqual, hmacHex, ordersStore, isOrderId, PRICE_RUB } from '../../lib/shared.js';

// RFC 3986: encodeURIComponent + экранирование !'()*
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function verifySign(params, secret) {
  const sign = params.get('sign');
  if (!sign) return false;
  const keys = [...new Set([...params.keys()])].filter((k) => k !== 'sign').sort();
  const base = keys.map((k) => k + '=' + rfc3986(params.get(k) ?? '')).join('&');
  const expected = await hmacHex(secret, base);
  return safeEqual(sign.toLowerCase(), expected);
}

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });

  const secret = env('YOOMONEY_NOTIFICATION_SECRET');
  if (!secret) {
    console.error('YOOMONEY_NOTIFICATION_SECRET is not configured');
    return json({ error: 'not_configured' }, 500);
  }

  const raw = await req.text();
  if (raw.length > 8192) return json({ error: 'too_large' }, 413);
  const params = new URLSearchParams(raw);

  if (!(await verifySign(params, secret))) {
    console.warn('yoomoney: invalid signature');
    return json({ error: 'invalid_signature' }, 403);
  }

  const label = params.get('label') || '';
  const operationId = params.get('operation_id') || '';
  // Тестовое уведомление или платёж без нашей метки — подпись верна, просто подтверждаем получение
  if (!label.startsWith('sp_') || !isOrderId(label.slice(3))) return json({ ok: true, ignored: 'label' });

  if (params.get('currency') !== '643') return json({ ok: true, ignored: 'currency' });
  if (params.get('unaccepted') === 'true' || params.get('codepro') === 'true') return json({ ok: true, ignored: 'held' });

  const orderId = label.slice(3);
  const paid = parseFloat(params.get('withdraw_amount') || params.get('amount') || '0');

  try {
    const store = ordersStore();
    const res = await store.getWithMetadata(orderId);
    if (!res || !res.data) {
      console.warn('yoomoney: unknown order', orderId);
      return json({ ok: true, ignored: 'unknown_order' });
    }
    const order = res.data;
    if (order.status === 'paid') return json({ ok: true, duplicate: true });

    const status = paid + 0.001 >= PRICE_RUB ? 'paid' : 'underpaid';
    await store.setJSON(orderId, {
      ...order,
      status,
      paidAmount: paid,
      operationId,
      notificationType: params.get('notification_type') || '',
      paidAt: new Date().toISOString()
    });
    console.log('yoomoney: order', orderId, status, paid);
    return json({ ok: true });
  } catch (e) {
    console.error('yoomoney webhook failed:', e && e.message);
    // 500 — ЮMoney повторит уведомление позже
    return json({ error: 'server_error' }, 500);
  }
});

