// POST /api/admin-import — разовый перенос заказов со старого хостинга на свой сервер.
// Работает только если задан ADMIN_TOKEN (на Cloudflare его нет — там это 404).
// Тело: { rows: [{ store, key, value }] }; существующие записи не перезаписываются.
import { handler, json, env, getStore, safeEqual, wasModified } from '../../lib/shared.js';

const ALLOWED = new Set(['sp-orders', 'sp-trials', 'sp-ref']);

export const onRequest = handler(async (req) => {
  const token = env('ADMIN_TOKEN');
  if (!token || token.length < 16) return json({ error: 'not_found' }, 404);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  const auth = req.headers.get('authorization') || '';
  if (!safeEqual(auth, 'Bearer ' + token)) return json({ error: 'forbidden' }, 403);

  let body;
  try { body = JSON.parse(await req.text()); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const rows = Array.isArray(body && body.rows) ? body.rows : [];
  let added = 0, skipped = 0;
  for (const r of rows.slice(0, 5000)) {
    if (!r || !ALLOWED.has(r.store) || typeof r.key !== 'string' || typeof r.value !== 'string') { skipped++; continue; }
    let value;
    try { value = JSON.parse(r.value); } catch (e) { skipped++; continue; }
    const res = await getStore(r.store).setJSON(r.key, value, { onlyIfNew: true });
    if (wasModified(res)) added++; else skipped++;
  }
  return json({ ok: true, added, skipped });
});
