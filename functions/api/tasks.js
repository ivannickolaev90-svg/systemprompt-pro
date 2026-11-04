// GET /api/tasks — список сценариев «задача → готовый результат» и остаток задач на сегодня.
import { handler, json, licenseInfo, TIERS, bearer, clientKey, DAY_MS } from '../../lib/shared.js';
import { aiGlobalState, AI_CFG } from '../../lib/ai.js';
import { publicTasks } from '../../lib/tasks.js';
import { peekLimit } from '../../lib/shared.js';

export const onRequest = handler(async (req) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  const cfg = AI_CFG();
  const token = bearer(req);
  const lic = token ? await licenseInfo(token) : null;
  const orderId = lic ? lic.orderId : null;
  const userKey = orderId ? 'pro:' + orderId : 'free:' + (await clientKey(req));
  const perDay = orderId ? TIERS[lic.tier].tasks : cfg.taskFreeDaily;
  const left = await peekLimit('task-user:' + userKey, perDay, DAY_MS);
  let aiOnline = false;
  try { aiOnline = (await aiGlobalState()).ok; } catch (e) { aiOnline = false; }
  return json({ tasks: publicTasks(), pro: !!orderId, left: left.remaining, perDay, resetAt: left.resetAt, aiOnline });
});
