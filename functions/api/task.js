// POST /api/task — выполняет сценарий: поля формы → готовый текст от ИИ.
// Всегда возвращает и «переносимый» запрос (prompt), чтобы человек мог открыть его в ChatGPT/Claude/…,
// даже если наш ИИ временно недоступен или лимит на сегодня закончился.
import { handler, json, isSameOrigin, readJsonBody, licenseInfo, TIERS, bearer, clientKey, hitLimit, peekLimit, HOUR_MS, DAY_MS } from '../../lib/shared.js';
import { aiComplete, AI_CFG } from '../../lib/ai.js';
import { getTask, validateFields, buildMessages, buildPortablePrompt, TWEAKS } from '../../lib/tasks.js';

export const onRequest = handler(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody(req, 16000);
  if (body.error) return json({ error: body.error }, body.error === 'too_large' ? 413 : 400);
  const d = body.data;

  const task = getTask(d.task);
  if (!task) return json({ error: 'bad_task' }, 400);
  const v = validateFields(task, d.fields);
  if (v.error) return json({ error: v.error, field: v.field || null }, 400);

  let tweak = null;
  let previous = null;
  if (d.tweak !== undefined && d.tweak !== null) {
    if (!Object.prototype.hasOwnProperty.call(TWEAKS, d.tweak)) return json({ error: 'bad_tweak' }, 400);
    if (typeof d.previous !== 'string' || !d.previous.trim() || d.previous.length > 8000) return json({ error: 'bad_previous' }, 400);
    tweak = d.tweak;
    previous = d.previous.trim();
  }

  const cfg = AI_CFG();
  const ipKey = await clientKey(req);
  const token = bearer(req);
  const lic = token ? await licenseInfo(token) : null;
  const orderId = lic ? lic.orderId : null;
  const pro = !!orderId;

  // Защита от ботов: не больше 60 запросов в час с одного адреса (PRO — 300)
  const rl = await hitLimit((pro ? 'taskrl-pro:' + orderId : 'taskrl:' + ipKey), pro ? 300 : 60, HOUR_MS);
  if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

  const userKey = pro ? 'pro:' + orderId : 'free:' + ipKey;
  const perDay = pro ? TIERS[lic.tier].tasks : cfg.taskFreeDaily;
  const prompt = buildPortablePrompt(task, v.fields);

  const r = await aiComplete({
    messages: buildMessages(task, v.fields, tweak, previous),
    maxTokens: (task.maxTokens || 1200) + 1500,
    userLimit: { key: 'task-user:' + userKey, perDay },
    siteLimit: { key: 'task-day', perDay: cfg.taskDailyMax },
    temperature: tweak === 'another' ? 0.9 : 0.7
  });
  const left = await peekLimit('task-user:' + userKey, perDay, DAY_MS);
  const meta = { pro, prompt, left: left.remaining, perDay, resetAt: left.resetAt };

  if (r.fallback === 'user_limit') return json({ error: 'quota', ...meta }, 402);
  if (r.fallback) return json({ error: 'ai_unavailable', reason: r.fallback, ...meta }, 503);

  const result = r.text.replace(/^```(?:markdown|md|text)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  if (result.length < 20) return json({ error: 'ai_unavailable', reason: 'bad_output', ...meta }, 503);
  return json({ result: result.slice(0, 12000), ...meta });
});
