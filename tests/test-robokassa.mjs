// Тест оплаты через Робокассу: подпись сверяется с независимым MD5 из node:crypto, D1 — node:sqlite.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const R = new URL('../functions/api/', import.meta.url).href;
const order = await import(R + 'order.js');
const claim = await import(R + 'claim.js');
const hook = await import(R + 'robokassa-webhook.js');
const status = await import(R + 'status.js');

const md5node = (s) => createHash('md5').update(s, 'utf8').digest('hex');

const sql = new DatabaseSync(':memory:');
const DB = { prepare(q) { let args = []; const st = {
  bind(...a) { args = a; return st; },
  async first() { return sql.prepare(q).get(...args) ?? null; },
  async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) } }; } }; return st; } };
const ENV = {
  DB, LICENSE_SECRET: 'x'.repeat(40),
  ROBOKASSA_LOGIN: 'test_shop', ROBOKASSA_PASS1: 'pass_one', ROBOKASSA_PASS2: 'pass_two'
};

const H = 'https://systemprompt-pro.pages.dev';
const call = async (mod, method, path, body, lic, ip = '1.2.3.4', ctype = 'application/json') => {
  const request = new Request(H + path, { method, headers: { 'cf-connecting-ip': ip, origin: H, 'content-type': ctype, ...(lic ? { authorization: 'Bearer ' + lic } : {}) }, body });
  const res = await mod.onRequest({ request, env: ENV });
  const raw = await res.text();
  let d; try { d = JSON.parse(raw); } catch { d = raw; } return { s: res.status, d };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// Заказ -> ссылка Робокассы с корректной подписью
let r = await call(order, 'POST', '/api/order', JSON.stringify({ plan: 'pro', method: 'sbp' }));
ok(r.s === 200 && typeof r.d.payUrl === 'string' && r.d.payUrl.startsWith('https://auth.robokassa.ru/') && !r.d.label, 'order -> robokassa payUrl');
const oid = r.d.orderId;
const pu = new URL(r.d.payUrl);
const invId = pu.searchParams.get('InvId');
const sum = pu.searchParams.get('OutSum');
ok(/^\d{1,10}$/.test(invId) && sum === '399.00' && pu.searchParams.get('Shp_order') === oid && pu.searchParams.get('MerchantLogin') === 'test_shop', 'payUrl params');
const expectPaySign = md5node('test_shop:' + sum + ':' + invId + ':pass_one:Shp_order=' + oid);
ok(pu.searchParams.get('SignatureValue') === expectPaySign, 'payUrl signature matches node md5');

// До оплаты лицензию не дают
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid }));
ok(r.s === 202, 'claim before payment -> pending');

// Поддельное уведомление (неверная подпись) — отказ
const badBody = 'OutSum=' + sum + '&InvId=' + invId + '&SignatureValue=' + md5node('wrong') + '&Shp_order=' + oid;
r = await call(hook, 'POST', '/api/robokassa-webhook', badBody, null, '1.2.3.4', 'application/x-www-form-urlencoded');
ok(r.s === 403, 'forged webhook -> 403');
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid }));
ok(r.s === 202, 'still pending after forged webhook');

// Настоящий Result URL: подпись MD5(OutSum:InvId:Пароль2:Shp_order) в верхнем регистре
const resultSign = md5node(sum + ':' + invId + ':pass_two:Shp_order=' + oid).toUpperCase();
const goodBody = 'OutSum=' + sum + '&InvId=' + invId + '&SignatureValue=' + resultSign + '&Shp_order=' + oid;
r = await call(hook, 'POST', '/api/robokassa-webhook', goodBody, null, '1.2.3.4', 'application/x-www-form-urlencoded');
ok(r.s === 200 && r.d === 'OK' + invId, 'webhook OK<InvId>');
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid }));
ok(r.s === 200 && r.d.status === 'paid' && r.d.license, 'claim after webhook -> license');
const lic1 = r.d.license;
r = await call(status, 'GET', '/api/status', undefined, lic1);
ok(r.d.pro && r.d.tier === 'pro' && Math.abs(Date.parse(r.d.expiresAt) - Date.now() - 30 * 864e5) < 6e4, 'status: PRO for 30 days');

// Повторное уведомление — идемпотентно
r = await call(hook, 'POST', '/api/robokassa-webhook', goodBody, null, '1.2.3.4', 'application/x-www-form-urlencoded');
ok(r.s === 200 && r.d === 'OK' + invId, 'webhook duplicate -> idempotent');

// Недоплата: сумма меньше тарифа -> underpaid, лицензии нет
r = await call(order, 'POST', '/api/order', JSON.stringify({ plan: 'pro' }), null, '5.5.5.5');
const oid2 = r.d.orderId; const inv2 = new URL(r.d.payUrl).searchParams.get('InvId');
const underSign = md5node('100.00:' + inv2 + ':pass_two:Shp_order=' + oid2).toUpperCase();
r = await call(hook, 'POST', '/api/robokassa-webhook', 'OutSum=100.00&InvId=' + inv2 + '&SignatureValue=' + underSign + '&Shp_order=' + oid2, null, '5.5.5.5', 'application/x-www-form-urlencoded');
ok(r.s === 200, 'underpaid webhook accepted');
r = await call(claim, 'POST', '/api/claim', JSON.stringify({ orderId: oid2 }), null, '5.5.5.5');
ok(r.s === 402, 'underpaid -> no license');
