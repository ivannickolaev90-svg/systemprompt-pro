// Переезд на свой домен: всё со старого адреса и с www — постоянным редиректом на https://systemprompt-pro.com.
// /api/* не трогаем: платёжные уведомления и старые вкладки должны продолжать работать.
const MAIN = 'systemprompt-pro.com';
const OLD = new Set(['systemprompt-pro.pages.dev', 'www.systemprompt-pro.com']);

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  if (OLD.has(url.hostname) && !url.pathname.startsWith('/api/')) {
    url.hostname = MAIN;
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }
  return ctx.next();
}
