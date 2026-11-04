// ЮKassa: создание платежа и проверка статуса через API v3.
// Уведомлениям ЮKassa не доверяем на слово: статус всегда перепроверяем запросом к API.
// Документация: https://yookassa.ru/developers/api
import { env, ordersStore, isOrderId, PRICE_RUB } from './shared.js';

const API = 'https://api.yookassa.ru/v3/payments';

export function ykConfigured() {
  return !!(env('YOOKASSA_SHOP_ID') && env('YOOKASSA_SECRET_KEY'));
}

function authHeader() {
  return 'Basic ' + btoa(env('YOOKASSA_SHOP_ID') + ':' + env('YOOKASSA_SECRET_KEY'));
}

async function ykFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: authHeader(), 'content-type': 'application/json', ...(init.headers || {}) }
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) throw new Error('yookassa ' + res.status + ' ' + (data && data.code || ''));
  return data;
}

// Создаёт платёж на сумму PRO и возвращает { id, url } для перехода на страницу оплаты.
export async function ykCreatePayment(orderId, returnUrl) {
  const data = await ykFetch(API, {
    method: 'POST',
    headers: { 'idempotence-key': 'sp-' + orderId },
    body: JSON.stringify({
      amount: { value: PRICE_RUB.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: returnUrl },
      description: 'SystemPrompt PRO — бессрочный доступ, заказ ' + orderId.slice(0, 8),
      metadata: { order: orderId }
    })
  });
  const url = data && data.confirmation && data.confirmation.confirmation_url;
  if (!data || !data.id || !url) throw new Error('yookassa: no confirmation url');
  return { id: data.id, url };
}

export async function ykGetPayment(paymentId) {
  if (!/^[0-9a-f-]{20,60}$/i.test(paymentId)) throw new Error('bad payment id');
  return ykFetch(API + '/' + paymentId);
}

// Применяет проверенный платёж к заказу. Возвращает итоговый статус заказа.
export async function ykApplyPayment(payment) {
  const orderId = payment && payment.metadata && payment.metadata.order;
  if (!isOrderId(orderId || '')) return 'ignored';
  if (payment.status !== 'succeeded' || !payment.paid) return 'pending';
  if (!payment.amount || payment.amount.currency !== 'RUB') return 'ignored';

  const store = ordersStore();
  const res = await store.getWithMetadata(orderId);
  if (!res || !res.data) return 'ignored';
  const order = res.data;
  if (order.status === 'paid') return 'paid';
  if (order.ykPaymentId && order.ykPaymentId !== payment.id) return 'ignored';

  const paid = parseFloat(payment.amount.value || '0');
  const status = paid + 0.001 >= (order.price || PRICE_RUB) ? 'paid' : 'underpaid';
  await store.setJSON(orderId, {
    ...order,
    status,
    paidAmount: paid,
    provider: 'yookassa',
    ykPaymentId: payment.id,
    paymentMethod: payment.payment_method && payment.payment_method.type || '',
    paidAt: new Date().toISOString()
  });
  console.log('yookassa: order', orderId, status, paid);
  return status;
}
