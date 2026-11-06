// POST /api/ref {rid} — код реферальной ссылки и остаток бонусных текстов.
import { handler, json, isSameOrigin, readJsonBody, isRid, refCode, refBalance, refStore, clientKey, REF_BONUS } from '../../lib/shared.js';

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const body = await readJsonBody(req, 1000);
  if (body.error || !isRid(body.data.rid)) return json({ error: 'bad_rid' }, 400);
  const code = await refCode(body.data.rid);
  // Запоминаем адрес владельца ссылки (хэш), чтобы не засчитывать «друзей» с того же адреса
  await refStore().setJSON('ip:' + code, await clientKey(req), { onlyIfNew: true });
  return json({ code, bonus: await refBalance(code), per: REF_BONUS });
});
