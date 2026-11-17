// Посредник к Groq для сервера в России (Groq не пускает российские IP).
// Ключ Groq присылает сам сервер в Authorization; здесь ключей нет. Пускаем только IP нашего сервера.
const ALLOW = ['195.208.122.250', '2a02:408:7722:54:195:208:122:250'];
export async function onRequest({ request, params }) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!ALLOW.includes(ip)) return new Response('forbidden', { status: 403 });
  if (request.method !== 'POST') return new Response('method', { status: 405 });
  const path = [].concat(params.path || []).join('/');
  if (path !== 'chat/completions') return new Response('not found', { status: 404 });
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: request.headers.get('authorization') || '' },
    body: await request.text()
  });
  return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' } });
}
