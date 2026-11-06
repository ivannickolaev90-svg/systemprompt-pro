import { DatabaseSync } from 'node:sqlite';
const R = new URL('../functions/api/', import.meta.url).href;
const taskFn = await import(R + 'task.js');
const tasksFn = await import(R + 'tasks.js');
const gen = await import(R + 'generate.js');
const sql = new DatabaseSync(':memory:');
const DB = { prepare(q) { let a = []; const st = { bind(...x) { a = x; return st; }, async first() { return sql.prepare(q).get(...a) ?? null; }, async run() { const r = sql.prepare(q).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return st; } };
const ENV = { DB, LICENSE_SECRET: 'x'.repeat(40), GROQ_API_KEY: 'gsk' };
let mode = 'ok', calls = [];
globalThis.fetch = async (url, init) => {
  const b = JSON.parse(init.body); calls.push(b);
  if (mode === '429first' && b.model === 'openai/gpt-oss-120b') return new Response('rate', { status: 429 });
  if (mode === 'down') return new Response('err', { status: 500 });
  return new Response(JSON.stringify({ choices: [{ message: { content: 'Здравствуйте! Спасибо за отзыв о нашем магазине, нам очень приятно.' } }] }), { status: 200 });
};
const H = 'https://systemprompt-pro.pages.dev';
const call = async (mod, method, body, headers = {}) => { const res = await mod.onRequest({ request: new Request(H + '/api/x', { method, headers: { 'cf-connecting-ip': '5.6.7.8', origin: H, ...headers }, body }), env: ENV }); return { s: res.status, d: await res.json() }; };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

let r = await call(tasksFn, 'GET');
ok(r.s === 200 && r.d.tasks.length === 11 && r.d.tasks.filter((t) => !t.hidden).length === 10 && r.d.left === 5 && !('system' in r.d.tasks[0]) && r.d.tasks[0].fields.length > 0, 'list tasks, no system prompts leaked, 5 left');

const f = { review: 'Пришла куртка не того размера, очень расстроена', rating: '2 ★', shop: 'Магазин курток', tone: 'Вежливо и по делу' };
r = await call(taskFn, 'POST', JSON.stringify({ task: 'otvet-na-otzyv', fields: f }));
ok(r.s === 200 && r.d.result.startsWith('Здравствуйте') && r.d.left === 4 && r.d.prompt.includes('Пришла куртка'), 'run task -> result, prompt, left 4');
ok(calls[0].messages[0].role === 'system' && calls[0].messages[0].content.includes('Никогда не выдумывай') && calls[0].messages[1].content.includes('<<<'), 'messages have system rules and wrapped user data');

r = await call(taskFn, 'POST', JSON.stringify({ task: 'otvet-na-otzyv', fields: { ...f, review: '' } }));
ok(r.s === 400 && r.d.error === 'required' && r.d.field === 'review', 'required field enforced');
r = await call(taskFn, 'POST', JSON.stringify({ task: 'otvet-na-otzyv', fields: { ...f, tone: 'Злобно' } }));
ok(r.s === 400 && r.d.error === 'bad_option', 'select options enforced');
r = await call(taskFn, 'POST', JSON.stringify({ task: 'nope', fields: {} }));
ok(r.s === 400 && r.d.error === 'bad_task', 'unknown task rejected');

calls = [];
r = await call(taskFn, 'POST', JSON.stringify({ task: 'otvet-na-otzyv', fields: f, tweak: 'shorter', previous: 'Длинный ответ' }));
ok(r.s === 200 && calls[0].messages.length === 4 && calls[0].messages[2].role === 'assistant' && calls[0].messages[3].content.includes('короче'), 'tweak shorter builds follow-up messages');
r = await call(taskFn, 'POST', JSON.stringify({ task: 'otvet-na-otzyv', fields: f, tweak: 'evil', previous: 'x' }));
ok(r.s === 400 && r.d.error === 'bad_tweak', 'bad tweak rejected');

mode = '429first'; calls = [];
r = await call(taskFn, 'POST', JSON.stringify({ task: 'post-telegram', fields: { topic: 'Открытие кофейни' } }));
ok(r.s === 200 && calls.length === 2 && calls[1].model === 'llama-3.3-70b-versatile', '429 on main model -> fallback model used');

mode = 'ok';
r = await call(taskFn, 'POST', JSON.stringify({ task: 'post-telegram', fields: { topic: 'x' } }));
r = await call(taskFn, 'POST', JSON.stringify({ task: 'post-telegram', fields: { topic: 'x' } }));
ok(r.s === 200 && r.d.left === 0, 'fifth task ok, 0 left');
r = await call(taskFn, 'POST', JSON.stringify({ task: 'post-telegram', fields: { topic: 'x' } }));
ok(r.s === 402 && r.d.error === 'quota' && r.d.left === 0 && r.d.prompt.length > 50, 'quota after 5 -> 402 with portable prompt');

sql.exec("DELETE FROM kv WHERE store='sp-limits'");
mode = 'down';
r = await call(taskFn, 'POST', JSON.stringify({ task: 'kontent-plan', fields: { about: 'мастер маникюра' } }));
ok(r.s === 503 && r.d.error === 'ai_unavailable' && r.d.prompt.includes('мастер маникюра'), 'AI down -> 503 but prompt returned');

// конструктор по-прежнему работает
sql.exec("DELETE FROM kv"); mode = 'ok';
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '# СИСТЕМНЫЙ ПРОМПТ\n## 1. Роль\n' + 'текст '.repeat(60) } }] }), { status: 200 });
r = await call(gen, 'POST', JSON.stringify({ ai: true, settings: { role: 'marketer', tone: 'friendly', task: 'кофейня' } }));
ok(r.s === 200 && r.d.mode === 'ai', 'constructor AI generation still works after refactor');
