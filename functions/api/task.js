// POST /api/task — выполняет сценарий: поля формы → готовый текст от ИИ.
// Всегда возвращает и «переносимый» запрос (prompt), чтобы человек мог открыть его в ChatGPT/Claude/…,
// даже если наш ИИ временно недоступен или лимит на сегодня закончился.
import { handler, json, isSameOrigin, readJsonBody, licenseInfo, TIERS, bumpCounter, bearer, clientKey, hitLimit, peekLimit, HOUR_MS, DAY_MS, isRid, isRefCode, refCode, refBalance, refAdd, refTake, refStore, REF_BONUS, REF_DAILY_FRIENDS } from '../../lib/shared.js';
import { aiComplete, AI_CFG } from '../../lib/ai.js';
import { getTask, validateFields, buildMessages, buildPortablePrompt, TWEAKS, splitReviews, BATCH_FREE } from '../../lib/tasks.js';

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

  // Профиль магазина (необязательно): хранится в браузере, приходит с каждым запросом
  let profile = '';
  if (d.profile !== undefined && d.profile !== null && d.profile !== '') {
    if (typeof d.profile !== 'string' || d.profile.length > 800) return json({ error: 'bad_profile' }, 400);
    profile = d.profile.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  }

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
  // PRO-сценарии (ответы пачкой) — только для тарифов с PRO-возможностями
  if (task.pro && !(lic && TIERS[lic.tier] && TIERS[lic.tier].builder) && splitReviews(v.fields.reviews).length > BATCH_FREE) {
    return json({ error: 'pro_only', pro, prompt: buildPortablePrompt(task, v.fields, profile) }, 402);
  }

  // Защита от ботов: не больше 60 запросов в час с одного адреса (PRO — 300)
  const rl = await hitLimit((pro ? 'taskrl-pro:' + orderId : 'taskrl:' + ipKey), pro ? 300 : 60, HOUR_MS);
  if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

  const userKey = pro ? 'pro:' + orderId : 'free:' + ipKey;
  const perDay = pro ? TIERS[lic.tier].tasks : cfg.taskFreeDaily;
  const prompt = buildPortablePrompt(task, v.fields, profile);

  // «Приведи друга»: когда бесплатные на сегодня кончились — тратим бонусные тексты
  const myRef = !pro && isRid(d.rid) ? await refCode(d.rid) : null;
  let useBonus = false;
  if (myRef) {
    const before = await peekLimit('task-user:' + userKey, perDay, DAY_MS);
    if (before.remaining <= 0) useBonus = await refTake(myRef);
  }

  const r = await aiComplete({
    messages: buildMessages(task, v.fields, tweak, previous, profile),
    maxTokens: (task.maxTokens || 1200) + 1500,
    userLimit: useBonus ? null : { key: 'task-user:' + userKey, perDay },
    siteLimit: { key: 'task-day', perDay: cfg.taskDailyMax },
    temperature: tweak === 'another' ? 0.9 : 0.7
  });
  const left = await peekLimit('task-user:' + userKey, perDay, DAY_MS);
  if (useBonus && r.fallback) { try { await refAdd(myRef, 1); } catch (e) { /* бонус не вернулся */ } }
  const meta = { pro, prompt, left: left.remaining, perDay, resetAt: left.resetAt };
  if (myRef) meta.bonus = await refBalance(myRef);

  if (r.fallback === 'user_limit') return json({ error: 'quota', ...meta }, 402);
  if (r.fallback) return json({ error: 'ai_unavailable', reason: r.fallback, ...meta }, 503);

  const result = r.text.replace(/^```(?:markdown|md|text)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  if (result.length < 20) return json({ error: 'ai_unavailable', reason: 'bad_output', ...meta }, 503);
  await bumpCounter('texts');
  // Новый человек пришёл по чужой ссылке и получил первый текст → владельцу ссылки +3
  if (!pro && !tweak && isRefCode(d.ref) && d.ref !== myRef) {
    try {
      const st = refStore();
      const ownerIp = await st.get('ip:' + d.ref);
      if (ownerIp && ownerIp !== ipKey) {
        const first = await st.setJSON('seen:' + ipKey, d.ref, { onlyIfNew: true });
        if (first.modified) {
          const cap = await hitLimit('refcap:' + d.ref, REF_DAILY_FRIENDS, DAY_MS);
          if (cap.allowed) await refAdd(d.ref, REF_BONUS);
        }
      }
    } catch (e) { console.warn('ref credit failed:', e && e.message); }
  }
  return json({ result: result.slice(0, 12000), ...meta });
});
