// Тест оплаты через ЮKassa: API ЮKassa подменён, D1 — node:sqlite.
import { DatabaseSync } from 'node:sqlite';
const R = new URL('../functions/api/', import.meta.url).href;
const order = await import(R + 'order.js');
const claim = await import(R + 'claim.js');
const hook = await import(R + 'yookassa-webhook.js');

const sql = new DatabaseSync(':memory:');
const DB = { prepare(q) { let args = []; const st = {
  bind(...a) { args = a; return st; },
  async first() { return sql.prepare(q).get(...args) ?? null; },
  async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) } }; } }; return st; } };
const ENV = { DB, LICENSE_SECRET: 'x'.repeat(40), YOOKASSA_SHOP_ID: '1516450', YOOKASSA_SECRET_KEY: 'live_test' };

const payments = {}; let created = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (!init.headers.authorization.startsWith('Basic ')) return new Response('{}', { status: 401 });
  if (url === 'https://api.yookassa.ru/v3/payments' && init.method === 'POST') {
    const b = JSON.parse(init.body); created.push({ b, key: init.headers['idempotence-key'] });
    const id = '2f' + String(created.length).padStart(6, '0') + '-000f-5000-9000-1b2c3d4e5f60';
    payments[id] = { id, status: 'pending', paid: false, amount: b.amount, metadata: b.metadata };
    return new Response(JSON.stringify({ ...payments[id], confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=' + id } }));
  }
  const id = url.split('/').pop();
  if (payments[id]) return new Response(JSON.stringify(payments[id]));
  return new Response('{"code":"not_found"}', { status: 404 });
};

const H = 'https://systemprompt-pro.pages.dev';
const call = async (mod, method, path, body) => {
  const request = new Request(H + path, { method, headers: { 'cf-connecting-ip': '1.2.3.4', origin: H, 'content-type': 'application/json' }, body });
  const res = await mod.onRequest({ request, env: ENV });
  let d; try { d = await res.json(); } catch { d = null; } return { s: res.status, d };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

let r = await call(order, 'POST', '/api/order', '{}');
ok(r.s === 200 && r.d.payUrl.startsWith('https://yoomoney.ru/') && !r.d.label, 'order -> yookassa payUrl');
const oid = r.d.orderId; const pid = Object.keys(payments)[0];
ok(created[0].b.amount.value === '190.00' && created[0].b.metadata.order === oid && created[0].b.confirmation.return_url === H + '/?pay=success&order=' + oid, 'payment body');

r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid }));
ok(r.s === 202, 'claim before payment -> pending');

// Поддельное уведомление: платёж ещё не оплачен в API -> доступ не выдаётся
r = await call(hook, 'POST', '/api/yookassa-webhook', JSON.stringify({ event: 'payment.succeeded', object: { id: pid, status: 'succeeded' } }));
ok(r.s === 200 && r.d.status === 'pending', 'forged webhook ignored');
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid }));
ok(r.s === 202, 'still pending after forged webhook');

// Реальная оплата, уведомление потерялось -> claim сам проверяет статус
payments[pid].status = 'succeeded'; payments[pid].paid = true;
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid }));
ok(r.s === 200 && r.d.status === 'paid' && r.d.license, 'claim checks yookassa directly -> license');

r = await call(hook, 'POST', '/api/yookassa-webhook', JSON.stringify({ event: 'payment.succeeded', object: { id: pid } }));
ok(r.s === 200 && r.d.status === 'paid', 'webhook after paid -> idempotent');

// Недоплата
r = await call(order, 'POST', '/api/order', '{}');
const oid2 = r.d.orderId; const pid2 = Object.keys(payments)[1];
Object.assign(payments[pid2], { status: 'succeeded', paid: true, amount: { value: '1.00', currency: 'RUB' } });
r = await call(hook, 'POST', '/api/yookassa-webhook', JSON.stringify({ object: { id: pid2 } }));
ok(r.d.status === 'underpaid', 'underpaid detected');
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid2 }));
ok(r.s === 402, 'underpaid -> no license');

// Без ключей ЮKassa — старая форма ЮMoney
delete ENV.YOOKASSA_SECRET_KEY;
r = await call(order, 'POST', '/api/order', '{}');
ok(r.s === 200 && r.d.label && !r.d.payUrl, 'no yookassa -> yoomoney label');
