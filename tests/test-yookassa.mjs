// Тест оплаты через ЮKassa: API ЮKassa подменён, D1 — node:sqlite.
import { DatabaseSync } from 'node:sqlite';
const R = new URL('../functions/api/', import.meta.url).href;
const order = await import(R + 'order.js');
const claim = await import(R + 'claim.js');
const hook = await import(R + 'yookassa-webhook.js');
const status = await import(R + 'status.js');
const tasks = await import(R + 'tasks.js');

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
const call = async (mod, method, path, body, lic, ip = '1.2.3.4') => {
  const request = new Request(H + path, { method, headers: { 'cf-connecting-ip': ip, origin: H, 'content-type': 'application/json', ...(lic ? { authorization: 'Bearer ' + lic } : {}) }, body });
  const res = await mod.onRequest({ request, env: ENV });
  let d; try { d = await res.json(); } catch { d = null; } return { s: res.status, d };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

let r = await call(order, 'POST', '/api/order', JSON.stringify({ plan: 'pro', method: 'sbp' }));
ok(r.s === 200 && r.d.payUrl.startsWith('https://yoomoney.ru/') && !r.d.label, 'order -> yookassa payUrl');
const oid = r.d.orderId; const pid = Object.keys(payments)[0];
ok(created[0].b.amount.value === '399.00' && created[0].b.payment_method_data.type === 'sbp' && created[0].b.metadata.order === oid && created[0].b.confirmation.return_url === H + '/?pay=success&order=' + oid, 'payment body');

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
const lic1 = r.d.license;
r = await call(status, 'GET', '/api/status', undefined, lic1);
const exp1 = Date.parse(r.d.expiresAt);
ok(r.d.pro && r.d.tier === 'pro' && r.d.builderPro && Math.abs(exp1 - Date.now() - 30 * 864e5) < 6e4, 'status: PRO for 30 days');

r = await call(hook, 'POST', '/api/yookassa-webhook', JSON.stringify({ event: 'payment.succeeded', object: { id: pid } }));
ok(r.s === 200 && r.d.status === 'paid', 'webhook after paid -> idempotent');

// Продление: новый срок от конца текущего
r = await call(order, 'POST', '/api/order', JSON.stringify({ plan: 'pro_year', method: 'card', renew: lic1 }));
const oidR = r.d.orderId; let pidR = Object.keys(payments).at(-1);
ok(created.at(-1).b.payment_method_data.type === 'bank_card' && created.at(-1).b.amount.value === '2990.00', 'card + year plan');
Object.assign(payments[pidR], { status: 'succeeded', paid: true });
await call(hook, 'POST', '/api/yookassa-webhook', JSON.stringify({ object: { id: pidR } }));
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oidR }));
r = await call(status, 'GET', '/api/status', undefined, r.d.license);
ok(Math.abs(Date.parse(r.d.expiresAt) - exp1 - 365 * 864e5) < 6e4, 'renewal extends from current expiry');

// Старт: только готовые тексты (30 в сутки), без PRO-конструктора
r = await call(order, 'POST', '/api/order', JSON.stringify({ plan: 'start' }), null, '5.5.5.5');
const oidS = r.d.orderId; Object.assign(payments[Object.keys(payments).at(-1)], { status: 'succeeded', paid: true });
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oidS }), null, '5.5.5.5');
const licS = r.d.license;
r = await call(tasks, 'GET', '/api/tasks', undefined, licS, '5.5.5.5');
ok(r.d.pro === true && r.d.perDay === 30, 'start: 30 texts/day');
r = await call(status, 'GET', '/api/status', undefined, licS, '5.5.5.5');
ok(r.d.tier === 'start' && r.d.builderPro === false, 'start: no builder PRO');

// Пробный — один раз
r = await call(order, 'POST', '/api/order', JSON.stringify({ plan: 'trial' }), null, '7.7.7.7');
const oidT = r.d.orderId; Object.assign(payments[Object.keys(payments).at(-1)], { status: 'succeeded', paid: true });
ok(created.at(-1).b.amount.value === '99.00', 'trial 99');
await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oidT }), null, '7.7.7.7');
r = await call(order, 'POST', '/api/order', JSON.stringify({ plan: 'trial' }), null, '7.7.7.7');
ok(r.s === 409 && r.d.error === 'trial_used', 'trial only once');

// Истёкший доступ
const { ordersStore } = await import('../lib/shared.js');
const o = await ordersStore().get(oidS); await ordersStore().setJSON(oidS, { ...o, expiresAt: new Date(Date.now() - 1000).toISOString() });
r = await call(status, 'GET', '/api/status', undefined, licS, '5.5.5.5');
ok(r.d.pro === false && r.d.licenseInvalid === true, 'expired -> free');

// Недоплата
r = await call(order, 'POST', '/api/order', '{}');
const oid2 = r.d.orderId; const pid2 = Object.keys(payments).at(-1);
Object.assign(payments[pid2], { status: 'succeeded', paid: true, amount: { value: '1.00', currency: 'RUB' } });
r = await call(hook, 'POST', '/api/yookassa-webhook', JSON.stringify({ object: { id: pid2 } }));
ok(r.d.status === 'underpaid', 'underpaid detected');
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid2 }));
ok(r.s === 402, 'underpaid -> no license');

// Без ключей ЮKassa — старая форма ЮMoney
delete ENV.YOOKASSA_SECRET_KEY;
r = await call(order, 'POST', '/api/order', '{}');
ok(r.s === 200 && r.d.label && !r.d.payUrl, 'no yookassa -> yoomoney label');
