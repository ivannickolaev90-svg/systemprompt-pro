// POST /api/generate — собирает системный промпт на сервере.
// Бесплатно: 3 генерации в сутки на IP (из них 1 пробная через ИИ). PRO: шаблоны + до 30 ИИ-генераций в сутки.
// ИИ вызывается только по явной кнопке (ai: true) и только при заполненной нише; иначе — локальный шаблон.
import { handler,
  json, isSameOrigin, readJsonBody, validateSettings, buildPrompt, ROLES,
  verifyLicense, bearer, clientKey, hitLimit, cleanupLimits, FREE_PER_DAY, DAY_MS, HOUR_MS
} from '../../lib/shared.js';
import { aiGenerate, peekUserAi, AI_CFG } from '../../lib/ai.js';

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody(req);
  if (body.error) return json({ error: body.error }, body.error === 'too_large' ? 413 : 400);

  const settings = validateSettings(body.data.settings);
  if (!settings) return json({ error: 'bad_settings' }, 400);
  const wantAi = body.data.ai === true;

  try {
    const token = bearer(req);
    const orderId = token ? await verifyLicense(token) : null;
    const pro = !!orderId;
    const cfg = AI_CFG();
    const ipKey = await clientKey(req);
    const result = { pro };

    if (!pro) {
      if (ROLES[settings.role].pro) return json({ error: 'pro_required', reason: 'role' }, 402);
      if (settings.protection) return json({ error: 'pro_required', reason: 'protection' }, 402);

      const q = await hitLimit('free2:' + ipKey, FREE_PER_DAY, DAY_MS);
      if (!q.allowed) {
        return json({ error: q.busy ? 'busy' : 'quota', tokensLeft: 0, freePerDay: FREE_PER_DAY, resetAt: q.resetAt }, q.busy ? 429 : 402);
      }
      Object.assign(result, { tokensLeft: q.remaining, freePerDay: FREE_PER_DAY, resetAt: q.resetAt });
    } else {
      // Защита от ботов даже для PRO
      const rl = await hitLimit('pro:' + orderId, 600, HOUR_MS);
      if (!rl.allowed) return json({ error: 'rate_limited' }, 429);
    }

    const base = buildPrompt(settings);
    const userKey = pro ? 'pro:' + orderId : 'free:' + ipKey;
    const userDaily = pro ? cfg.proDaily : cfg.freeTrialDaily;

    let mode = 'template';
    let reason = null;
    let prompt = base;

    if (!wantAi) reason = 'live';
    else if (!settings.task) reason = 'no_task';
    else {
      const ai = await aiGenerate({ basePrompt: base, task: settings.task, lang: settings.lang, userKey, userDaily });
      if (ai.prompt) { prompt = ai.prompt; mode = 'ai'; }
      else reason = ai.fallback;
    }

    await cleanupLimits();
    const left = await peekUserAi(userKey, userDaily);
    return json({ ...result, prompt, mode, reason, aiLeft: left.remaining, aiDaily: userDaily });
  } catch (e) {
    console.error('generate failed:', e && e.message);
    return json({ error: 'server_error' }, 500);
  }
});

