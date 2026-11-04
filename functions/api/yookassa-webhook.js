// POST /api/yookassa-webhook — HTTP-уведомления ЮKassa (payment.succeeded / payment.canceled).
// Тело уведомления не считаем доказательством: берём id платежа и перепроверяем его через API.
import { handler, json } from '../../lib/shared.js';
import { ykConfigured, ykGetPayment, ykApplyPayment } from '../../lib/yookassa.js';

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!ykConfigured()) return json({ error: 'not_configured' }, 500);

  const raw = await req.text();
  if (raw.length > 16384) return json({ error: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const id = body && body.object && body.object.id;
  if (typeof id !== 'string') return json({ ok: true, ignored: 'no_id' });

  try {
    const payment = await ykGetPayment(id);
    const status = await ykApplyPayment(payment);
    return json({ ok: true, status });
  } catch (e) {
    console.error('yookassa webhook failed:', e && e.message);
    // 500 — ЮKassa повторит уведомление позже
    return json({ error: 'server_error' }, 500);
  }
});
