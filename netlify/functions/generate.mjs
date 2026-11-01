// POST /api/generate — собирает системный промпт на сервере.
// Бесплатно: 3 генерации в сутки на IP. PRO-функции — только с подтверждённой лицензией.
import {
  json, isSameOrigin, readJsonBody, validateSettings, buildPrompt, ROLES,
  verifyLicense, bearer, clientKey, hitLimit, FREE_PER_DAY, DAY_MS, HOUR_MS
} from '../lib/shared.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody(req);
  if (body.error) return json({ error: body.error }, body.error === 'too_large' ? 413 : 400);

  const settings = validateSettings(body.data.settings);
  if (!settings) return json({ error: 'bad_settings' }, 400);

  try {
    const token = bearer(req);
    const orderId = token ? await verifyLicense(token) : null;
    const pro = !!orderId;

    if (!pro) {
      if (ROLES[settings.role].pro) return json({ error: 'pro_required', reason: 'role' }, 402);
      if (settings.protection) return json({ error: 'pro_required', reason: 'protection' }, 402);

      const q = await hitLimit('free:' + clientKey(req, context), FREE_PER_DAY, DAY_MS);
      if (!q.allowed) {
        return json({ error: q.busy ? 'busy' : 'quota', tokensLeft: 0, freePerDay: FREE_PER_DAY, resetAt: q.resetAt }, q.busy ? 429 : 402);
      }
      return json({ prompt: buildPrompt(settings), pro: false, tokensLeft: q.remaining, freePerDay: FREE_PER_DAY, resetAt: q.resetAt });
    }

    // PRO: безлимит для людей, но защита от автоматического выкачивания
    const rl = await hitLimit('pro:' + orderId, 600, HOUR_MS);
    if (!rl.allowed) return json({ error: 'rate_limited' }, 429);
    return json({ prompt: buildPrompt(settings), pro: true });
  } catch (e) {
    console.error('generate failed:', e && e.message);
    return json({ error: 'server_error' }, 500);
  }
};

export const config = { path: '/api/generate' };
