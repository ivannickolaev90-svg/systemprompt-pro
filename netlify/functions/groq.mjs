// Посредник к Groq для сервера в России (Groq не пускает российские IP, Cloudflare с сервера недоступен).
// Ключ Groq присылает сам сервер в Authorization; здесь ключей нет. Пускаем только IP нашего сервера.
const ALLOW = ['195.208.122.250', '2a02:408:7722:54:195:208:122:250'];
export default async (req, context) => {
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '';
  if (!ALLOW.includes(ip)) return new Response('forbidden ' + ip, { status: 403 });
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: req.headers.get('authorization') || '' },
    body: await req.text()
  });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' } });
};
export const config = { path: '/groq/chat/completions', preferStatic: false };
