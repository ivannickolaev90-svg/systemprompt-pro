// Запуск сайта на своём сервере (VPS) вместо Cloudflare Pages.
// - статика из public/ с заголовками из public/_headers и «чистыми» адресами, как на Pages;
// - /api/<имя> → functions/api/<имя>.js (тот же код, что на Cloudflare);
// - база D1 заменена файлом SQLite (node:sqlite) с тем же интерфейсом prepare/bind/first/run/all.
// Секреты берутся из переменных окружения (файл /etc/systemprompt-pro.env, его подключает systemd).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || '/var/lib/systemprompt-pro/db.sqlite';

/* ---------- База: SQLite с интерфейсом D1 ---------- */
const sql = new DatabaseSync(DB_PATH);
sql.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
const DB = {
  prepare(q) {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      async first() { return sql.prepare(q).get(...args) ?? null; },
      async all() { return { results: sql.prepare(q).all(...args) }; },
      async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) } }; }
    };
    return st;
  }
};

const SECRET_KEYS = ['LICENSE_SECRET', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'YOOMONEY_NOTIFICATION_SECRET',
  'YOOKASSA_SHOP_ID', 'YOOKASSA_SECRET_KEY', 'ADMIN_TOKEN'];
const ENV = { DB };
for (const [k, v] of Object.entries(process.env)) {
  if (SECRET_KEYS.includes(k) || /^(AI_|TASK_|FREE_|PRO_)/.test(k)) ENV[k] = v;
}

/* ---------- Заголовки из public/_headers ---------- */
async function loadHeaderRules() {
  const rules = [];
  let cur = null;
  let text = '';
  try { text = await fs.readFile(path.join(PUBLIC, '_headers'), 'utf8'); } catch (e) { return rules; }
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), headers: [] }; rules.push(cur); continue; }
    const i = line.indexOf(':');
    if (cur && i > 0) cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules.map((r) => ({ ...r, re: new RegExp('^' + r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$') }));
}
let HEADER_RULES = await loadHeaderRules();
function applyHeaders(pathname, headers) {
  for (const r of HEADER_RULES) if (r.re.test(pathname)) for (const [k, v] of r.headers) headers.set(k, v);
}

/* ---------- Статика ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
};
async function fileIfExists(p) {
  try { const st = await fs.stat(p); return st.isFile() ? { p, st } : null; } catch (e) { return null; }
}
async function resolveStatic(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return null; }
  if (rel.includes('\0')) return null;
  const abs = path.join(PUBLIC, rel);
  if (!abs.startsWith(PUBLIC)) return null;
  if (path.basename(abs).startsWith('_')) return null; // _headers и т.п. не отдаём
  if (rel.endsWith('/')) return fileIfExists(path.join(abs, 'index.html'));
  return (await fileIfExists(abs)) || (await fileIfExists(abs + '.html')) ||
    ((await fileIfExists(path.join(abs, 'index.html'))) ? { redirect: pathname + '/' } : null);
}
async function serveStatic(req, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
  // Как на Pages: /page.html → /page, /dir/index.html → /dir/
  if (url.pathname.endsWith('/index.html')) return Response.redirect(new URL(url.pathname.slice(0, -10) + url.search, url).toString(), 308);
  if (url.pathname.endsWith('.html')) return Response.redirect(new URL(url.pathname.slice(0, -5) + url.search, url).toString(), 308);
  let found = await resolveStatic(url.pathname);
  let status = 200;
  if (found && found.redirect) return Response.redirect(new URL(found.redirect + url.search, url).toString(), 308);
  if (!found) { found = await fileIfExists(path.join(PUBLIC, '404.html')); status = 404; }
  if (!found) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const headers = new Headers();
  headers.set('content-type', TYPES[path.extname(found.p).toLowerCase()] || 'application/octet-stream');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  const lm = found.st.mtime.toUTCString();
  headers.set('last-modified', lm);
  applyHeaders(url.pathname, headers);
  if (status === 200 && req.headers.get('if-modified-since') === lm) return new Response(null, { status: 304, headers });
  const body = req.method === 'HEAD' ? null : await fs.readFile(found.p);
  return new Response(body, { status, headers });
}

/* ---------- Функции (API) ---------- */
const fnCache = new Map();
async function loadModule(file) {
  if (!fnCache.has(file)) fnCache.set(file, import(pathToFileURL(file).href).catch(() => null));
  return fnCache.get(file);
}
async function route(request) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/);
  if (m) {
    const mod = await loadModule(path.join(ROOT, 'functions', 'api', m[1] + '.js'));
    if (mod && typeof mod.onRequest === 'function') {
      const res = await mod.onRequest({ request, env: ENV });
      const h = new Headers(res.headers);
      applyHeaders(url.pathname, h);
      return new Response(res.body, { status: res.status, headers: h });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  return serveStatic(request, url);
}
const middleware = await loadModule(path.join(ROOT, 'functions', '_middleware.js'));
async function handle(request) {
  if (middleware && typeof middleware.onRequest === 'function') {
    return middleware.onRequest({ request, env: ENV, next: () => route(request) });
  }
  return route(request);
}

/* ---------- HTTP-сервер (за Caddy, который даёт HTTPS) ---------- */
const MAX_BODY = 1024 * 1024;
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = new URL(req.url, proto + '://' + host);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    // Адрес посетителя: Caddy кладёт его последним в X-Forwarded-For
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    headers.set('cf-connecting-ip', xff.length ? xff[xff.length - 1] : (req.socket.remoteAddress || 'unknown'));
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413).end(); return; } chunks.push(c); }
      body = Buffer.concat(chunks);
    }
    const response = await handle(new Request(url, { method: req.method, headers, body }));
    const out = {};
    response.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(response.status, out);
    if (response.body && req.method !== 'HEAD') res.end(Buffer.from(await response.arrayBuffer()));
    else res.end();
  } catch (e) {
    console.error('request failed:', e && e.message);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal Server Error');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log('systemprompt-pro listening on 127.0.0.1:' + PORT));
