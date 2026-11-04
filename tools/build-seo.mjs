// Сборка SEO-страниц: public/prompts/<slug>.html, каталог public/prompts/index.html и sitemap.xml.
// Запуск: node tools/build-seo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PAGES } from './seo-pages.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pub = path.join(root, 'public');
const SITE = 'https://systemprompt-pro.pages.dev';
const TODAY = new Date().toISOString().slice(0, 10);
const SELLER = 'Николаев Иван Антонович · самозанятый · ИНН 783807650108';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const bySlug = Object.fromEntries(PAGES.map((p) => [p.slug, p]));

const head = ({ title, description, url, jsonld }) => `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:site_name" content="SystemPrompt PRO">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/og-image.png">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/legal.css">
  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
  <header class="top">
    <div class="wrap">
      <a class="logo" href="/">⚡ SystemPrompt <span>PRO</span></a>
      <nav class="topnav"><a href="/prompts/">Готовые промпты</a><a class="btn-sm" href="/#builder">Конструктор</a></nav>
    </div>
  </header>
`;

const foot = `
  <footer class="foot">
    <div class="wrap">
      <span>© 2026 SystemPrompt PRO · ${SELLER}</span>
      <nav><a href="/">Конструктор</a><a href="/prompts/">Готовые промпты</a><a href="/offer">Оферта</a><a href="/contacts">Реквизиты</a></nav>
    </div>
  </footer>
  <script src="/metrika.js"></script>
  <script src="/prompts.js" defer></script>
</body>
</html>
`;

// SEO-страница → подходящая задача «готовый текст за 10 секунд»
const TASK_FOR = {
  'internet-magazin': ['otvet-na-otzyv', 'Ответить на отзыв покупателя'],
  'telegram-bot-podderzhki': ['otvet-klientu', 'Написать ответ клиенту'],
  'marketolog-kopirajter': ['post-telegram', 'Написать продающий пост'],
  'smm-kontent-plan': ['kontent-plan', 'Составить контент-план на неделю'],
  'kartochki-tovarov-marketplace': ['kartochka-tovara', 'Написать описание товара'],
  'menedzher-po-prodazham': ['kommercheskoe-predlozhenie', 'Написать коммерческое предложение'],
  'hr-rekruter': ['soprovoditelnoe-pismo', 'Написать сопроводительное письмо'],
  'chto-takoe-sistemnyj-prompt': ['uluchshit-prompt', 'Улучшить свой промпт'],
  'programmist-code-review': ['uluchshit-prompt', 'Улучшить свой промпт'],
  'seo-statya': ['kartochka-tovara', 'Написать SEO-описание товара'],
  'restoran-kafe': ['post-telegram', 'Написать пост для заведения'],
  'yurist-pomoshchnik': ['delovoe-pismo', 'Написать деловое письмо или претензию']
};
const taskCta = (slug) => {
  const t = TASK_FOR[slug];
  if (!t) return '';
  return `
      <div class="cta">
        <div>
          <p class="cta-t">Нужен готовый текст прямо сейчас?</p>
          <p class="cta-s">Ответьте на пару вопросов — ИИ сделает за 10 секунд. Бесплатно, без регистрации, можно открыть в ChatGPT или Claude.</p>
        </div>
        <a class="btn" href="/#task=${t[0]}">${t[1]} ⚡</a>
      </div>`;
};

const cta = `
      <div class="cta">
        <div>
          <p class="cta-t">Соберите промпт для своего бота или GPT</p>
          <p class="cta-s">Выберите роль и тон, опишите задачу — конструктор соберёт структурированный промпт за 10 секунд. Бесплатно, без регистрации.</p>
        </div>
        <a class="btn" href="/#builder">Открыть конструктор ⚡</a>
      </div>`;

function pageHtml(p) {
  const url = `${SITE}/prompts/${p.slug}`;
  const jsonld = [
    {
      '@context': 'https://schema.org', '@type': 'Article', headline: p.h1, description: p.description,
      inLanguage: 'ru', dateModified: TODAY, mainEntityOfPage: url,
      author: { '@type': 'Person', name: 'Николаев Иван Антонович' },
      publisher: { '@type': 'Organization', name: 'SystemPrompt PRO', url: SITE + '/' }
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: p.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Готовые промпты', item: SITE + '/prompts/' },
        { '@type': 'ListItem', position: 3, name: p.h1, item: url }
      ]
    }
  ];
  const promptTitle = p.guide ? 'Пример' : 'Готовый промпт';
  const intro = (p.intro || []).map((t) => `      <p>${esc(t)}</p>`).join('\n');
  return head({ title: p.title, description: p.description, url, jsonld }) + `
  <main>
    <div class="wrap">
      <p class="crumbs"><a href="/">Главная</a> / <a href="/prompts/">Готовые промпты</a></p>
      <h1>${esc(p.h1)}</h1>
      <p class="lead">${esc(p.lead)}</p>
${intro ? intro + '\n' : ''}${taskCta(p.slug)}
      <h2>Кому подойдёт</h2>
      <ul>
${p.audience.map((a) => `        <li>${esc(a)}</li>`).join('\n')}
      </ul>

      <h2>${promptTitle}</h2>
      <p class="note">Скопируйте текст и замените значения в [квадратных скобках] на свои.</p>
      <div class="code">
        <button type="button" class="copy" data-copy="#prompt">Скопировать</button>
        <pre id="prompt">${esc(p.prompt)}</pre>
      </div>
${cta}

      <h2>Как использовать</h2>
      <ol>
        <li><strong>ChatGPT:</strong> создайте Custom GPT и вставьте текст в поле «Instructions» или добавьте его в «Настройки → Персонализация».</li>
        <li><strong>Claude:</strong> создайте проект и вставьте текст в инструкции проекта.</li>
        <li><strong>Telegram-бот или сайт через API:</strong> передавайте текст в сообщении с ролью <code>system</code>.</li>
        <li><strong>DeepSeek, GigaChat, YandexGPT:</strong> вставьте текст первым сообщением или в системные инструкции.</li>
      </ol>

      <h2>Советы, как улучшить</h2>
      <ul>
${p.tips.map((t) => `        <li>${esc(t)}</li>`).join('\n')}
      </ul>

      <h2>Частые вопросы</h2>
${p.faq.map((f) => `      <details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}

      <h2>Другие готовые промпты</h2>
      <div class="grid">
${p.related.filter((s) => bySlug[s]).map((s) => `        <a class="tile" href="/prompts/${s}"><b>${esc(bySlug[s].h1)}</b><span>${esc(bySlug[s].lead)}</span></a>`).join('\n')}
      </div>
    </div>
  </main>
` + foot;
}

function catalogHtml() {
  const url = `${SITE}/prompts/`;
  const title = 'Готовые системные промпты для ChatGPT, Claude и ботов — каталог';
  const description = 'Бесплатные готовые системные промпты на русском: для Telegram-бота поддержки, интернет-магазина, маркетолога, SMM, SEO, программиста, юриста и других задач.';
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, url, inLanguage: 'ru',
    hasPart: PAGES.map((p) => ({ '@type': 'Article', headline: p.h1, url: `${SITE}/prompts/${p.slug}` }))
  };
  const tiles = (list) => list.map((p) => `        <a class="tile" href="/prompts/${p.slug}"><b>${esc(p.h1)}</b><span>${esc(p.lead)}</span></a>`).join('\n');
  return head({ title, description, url, jsonld }) + `
  <main>
    <div class="wrap">
      <p class="crumbs"><a href="/">Главная</a> / Готовые промпты</p>
      <h1>Готовые системные промпты</h1>
      <p class="lead">Бесплатные структурированные промпты на русском для ChatGPT, Claude, DeepSeek и Telegram-ботов. Скопируйте готовый или соберите свой в конструкторе.</p>
      <h2>Промпты по профессиям и задачам</h2>
      <div class="grid">
${tiles(PAGES.filter((p) => !p.guide))}
      </div>
      <h2>Инструкции</h2>
      <div class="grid">
${tiles(PAGES.filter((p) => p.guide))}
      </div>
${cta}
    </div>
  </main>
` + foot;
}

fs.mkdirSync(path.join(pub, 'prompts'), { recursive: true });
for (const p of PAGES) fs.writeFileSync(path.join(pub, 'prompts', p.slug + '.html'), pageHtml(p));
fs.writeFileSync(path.join(pub, 'prompts', 'index.html'), catalogHtml());

// sitemap.xml целиком
const urls = [
  { loc: SITE + '/', freq: 'daily', pri: '1.0' },
  { loc: SITE + '/prompts/', freq: 'weekly', pri: '0.8' },
  ...PAGES.map((p) => ({ loc: `${SITE}/prompts/${p.slug}`, freq: 'monthly', pri: '0.7' })),
  { loc: SITE + '/offer', freq: 'monthly', pri: '0.3' },
  { loc: SITE + '/contacts', freq: 'monthly', pri: '0.3' }
];
fs.writeFileSync(path.join(pub, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `   <url>
      <loc>${u.loc}</loc>
      <lastmod>${TODAY}</lastmod>
      <changefreq>${u.freq}</changefreq>
      <priority>${u.pri}</priority>
   </url>`).join('\n')}
</urlset>
`);
console.log('built', PAGES.length, 'pages + catalog + sitemap');
