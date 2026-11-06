// POST /api/promo {code} — активация промокода канала. Возвращает лицензию, как /api/claim.
// life — бессрочный PRO (до 10 устройств), m30 — PRO на 30 дней с момента активации (одноразовый, до 2 устройств).
import { handler, json, isSameOrigin, readJsonBody, clientKey, hitLimit, HOUR_MS, ordersStore, signLicense, wasModified, MAX_DEVICES_PER_ORDER } from '../../lib/shared.js';
import { PROMO } from '../../lib/promo-codes.js';

const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
export const normPromo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^SP/, '');

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const body = await readJsonBody(req, 512);
  if (body.error) return json({ error: body.error }, 400);
  const raw = normPromo(body.data.code);
  if (raw.length !== 12) return json({ error: 'not_found' }, 404);
  const code = 'SP-' + raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8);

  // Защита от перебора: 10 попыток в час с одного адреса
  const rl = await hitLimit('promo:' + await clientKey(req), 10, HOUR_MS);
  if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

  const p = PROMO[await sha('p:' + code)];
  if (!p) return json({ error: 'not_found' }, 404);
  const orderId = (await sha('o:' + code)).slice(0, 32);
  const maxClaims = p.t === 'life' ? MAX_DEVICES_PER_ORDER : 2;
  const store = ordersStore();

  for (let attempt = 0; attempt < 3; attempt++) {
    let res = await store.getWithMetadata(orderId);
    if (!res) {
      const now = new Date();
      const order = {
        status: 'paid', price: 0, paidAmount: 0, source: 'promo', promo: p.t, channel: p.c,
        createdAt: now.toISOString(), paidAt: now.toISOString(), claims: 0,
        ...(p.t === 'm30' ? { plan: 'pro', expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString() } : {})
      };
      await store.setJSON(orderId, order, { onlyIfNew: true });
      res = await store.getWithMetadata(orderId);
    }
    const order = res.data;
    if (order.revoked) return json({ error: 'revoked' }, 403);
    if (order.expiresAt && Date.parse(order.expiresAt) <= Date.now()) return json({ error: 'expired' }, 410);
    const claims = order.claims || 0;
    if (claims >= maxClaims) return json({ error: 'used' }, 409);
    if (!wasModified(await store.setJSON(orderId, { ...order, claims: claims + 1, lastClaimAt: new Date().toISOString() }, { onlyIfMatch: res.etag }))) continue;
    return json({ status: 'paid', license: await signLicense(orderId), orderId, plan: order.plan || 'lifetime', type: p.t, channel: p.c, expiresAt: order.expiresAt || null });
  }
  return json({ error: 'server_error' }, 500);
});
