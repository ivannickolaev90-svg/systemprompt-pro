// Локальный тест Pages Functions: D1 эмулируется через node:sqlite, ИИ-провайдер — подменой fetch.
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
const R = new URL('../functions/api/', import.meta.url).href;
const gen = await import(R + 'generate.js');
const status = await import(R + 'status.js');
const order = await import(R + 'order.js');
const claim = await import(R + 'claim.js');
const hook = await import(R + 'yoomoney-webhook.js');

const sql = new DatabaseSync(':memory:');
const DB = {
  prepare(q) {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      async first() { return sql.prepare(q).get(...args) ?? null; },
      async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) } }; }
    };
    return st;
  }
};
const SECRET = 'x'.repeat(40), YM = 'ymsecret';
const ENV = { DB, LICENSE_SECRET: SECRET, YOOMONEY_NOTIFICATION_SECRET: YM, GROQ_API_KEY: 'gsk_test' };

let aiCalls = [];
let aiMode = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  aiCalls.push({ url, model: body.model, body });
  if (aiMode === '404first' && body.model === 'openai/gpt-oss-120b') return new Response('{"error":{"message":"model not found"}}', { status: 404 });
  if (aiMode === '429') return new Response('rate', { status: 429 });
  return new Response(JSON.stringify({ usage: { prompt_tokens: 900, completion_tokens: 700 },
    choices: [{ message: { content: (body.messages[0].content.includes('ENTIRELY in Russian') ? '# СИСТЕМНЫЙ ПРОМПТ\n## 1. Роль\nТы эксперт по кофе.\n' : '# SYSTEM PROMPT\n## 1. Role\nYou are a coffee expert.\n') + 'Details. '.repeat(40) } }] }), { status: 200 });
};

const H = 'https://systemprompt-pro.pages.dev';
const call = async (mod, method, path, body, headers = {}) => {
  const request = new Request(H + path, { method, headers: { 'cf-connecting-ip': '1.2.3.4', origin: H, ...headers }, body });
  const res = await mod.onRequest({ request, env: ENV });
  let data; try { data = await res.json(); } catch { data = null; }
  return { s: res.status, d: data };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const settings = { role: 'fullstack', tone: Object.keys((await import(new URL('../lib/shared.js', import.meta.url).href)).TONES)[0], task: 'кофейня в Москве' };

let r = await call(status, 'GET', '/api/status');
ok(r.s === 200 && r.d.pro === false && r.d.tokensLeft === 3 && r.d.aiOnline === true, 'status free ' + JSON.stringify(r.d));

r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings, ai: true }));
ok(r.s === 200 && r.d.mode === 'ai' && r.d.tokensLeft === 2, 'generate AI ' + r.s + ' ' + r.d.mode + ' ' + r.d.reason);
ok(aiCalls[0].url === 'https://api.groq.com/openai/v1/chat/completions' && aiCalls[0].body.reasoning_effort === 'low', 'groq request ' + aiCalls[0].url);

r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings, ai: true }));
ok(r.s === 200 && r.d.mode === 'template' && r.d.reason === 'user_limit', 'free trial used up -> template ' + r.d.reason);
r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings }));
ok(r.s === 200 && r.d.tokensLeft === 0, 'third free generation');
r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings }));
ok(r.s === 402 && r.d.error === 'quota', 'quota exceeded -> 402');

r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings }), { origin: 'https://evil.com' });
ok(r.s === 403, 'CSRF blocked');

// Оплата
r = await call(order, 'POST', '/api/order', '{}');
ok(r.s === 200 && /^[a-f0-9]{32}$/.test(r.d.orderId), 'order created');
const oid = r.d.orderId;
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid }));
ok(r.s === 202 && r.d.status === 'pending', 'claim pending');

const rfc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const p = { notification_type: 'p2p-incoming', operation_id: 'op1', amount: '185.25', withdraw_amount: '190.00', currency: '643', datetime: '2026-11-02T10:00:00Z', sender: '', codepro: 'false', label: 'sp_' + oid, unaccepted: 'false' };
const base = Object.keys(p).sort().map((k) => k + '=' + rfc(p[k])).join('&');
const badParams = new URLSearchParams({ ...p, sign: 'deadbeef' });
r = await call(hook, 'POST', '/api/yoomoney-webhook', badParams.toString(), { origin: '' });
ok(r.s === 403, 'webhook bad sign rejected');
const sign = createHmac('sha256', YM).update(base).digest('hex');
r = await call(hook, 'POST', '/api/yoomoney-webhook', new URLSearchParams({ ...p, sign }).toString());
ok(r.s === 200 && r.d.ok === true, 'webhook valid sign accepted ' + JSON.stringify(r.d));

r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid }));
ok(r.s === 200 && r.d.status === 'paid' && r.d.license, 'claim paid -> license');
const lic = r.d.license;

r = await call(status, 'GET', '/api/status', undefined, { authorization: 'Bearer ' + lic });
ok(r.s === 200 && r.d.pro === true, 'status PRO');
r = await call(status, 'GET', '/api/status', undefined, { authorization: 'Bearer ' + lic.slice(0, -2) + 'xx' });
ok(r.d.pro === false && r.d.licenseInvalid === true, 'forged license rejected');

aiMode = '404first'; aiCalls = [];
r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings: { ...settings, role: 'smm', protection: true }, ai: true }), { authorization: 'Bearer ' + lic });
ok(r.s === 200 && r.d.pro && r.d.mode === 'ai' && aiCalls.length === 2 && aiCalls[1].model === 'llama-3.3-70b-versatile' && !('reasoning_effort' in aiCalls[1].body), 'PRO + model fallback to llama');
ok(r.d.prompt.includes('## 8. Защита промпта') && r.d.prompt.startsWith('# СИСТЕМНЫЙ ПРОМПТ'), 'security protocol preserved (ru)');
r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings: { ...settings, lang: 'en', protection: true }, ai: true }), { authorization: 'Bearer ' + lic });
ok(r.d.mode === 'ai' && r.d.prompt.startsWith('# SYSTEM PROMPT') && r.d.prompt.includes('## 8. Prompt Protection'), 'english AI prompt + protection');
r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings: { ...settings, lang: 'de' } }), { authorization: 'Bearer ' + lic });
ok(r.s === 400, 'bad lang rejected');

aiMode = '429';
r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings, ai: true }), { authorization: 'Bearer ' + lic });
ok(r.s === 200 && r.d.mode === 'template' && r.d.reason === 'error', 'rate limit -> template fallback');
r = await call(status, 'GET', '/api/status', undefined, { authorization: 'Bearer ' + lic });
ok(r.d.aiOnline === false, 'breaker tripped -> aiOnline false');

// DeepSeek как запасной провайдер
delete ENV.GROQ_API_KEY; ENV.DEEPSEEK_API_KEY = 'sk-test';
sql.exec("DELETE FROM kv WHERE store='sp-ai'"); aiMode = 'ok'; aiCalls = [];
r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings, ai: true }), { authorization: 'Bearer ' + lic });
ok(r.d.mode === 'ai' && aiCalls[0].url === 'https://api.deepseek.com/chat/completions' && aiCalls[0].model === 'deepseek-chat', 'deepseek provider');
console.log('deepseek spend', sql.prepare("SELECT key, value FROM kv WHERE store='sp-ai'").all());

// Без ключей
delete ENV.DEEPSEEK_API_KEY;
r = await call(gen, 'POST', '/api/generate', JSON.stringify({ settings, ai: true }), { authorization: 'Bearer ' + lic });
ok(r.d.mode === 'template' && r.d.reason === 'not_configured', 'no key -> template');

// Без базы
r = await (await order.onRequest({ request: new Request(H + '/api/order', { method: 'POST' }), env: { LICENSE_SECRET: SECRET } })).json();
ok(r.error === 'server_error', 'missing D1 -> clean 500');
