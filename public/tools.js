/* Блок «Выберите задачу → получите готовый результат».
   Текст от ИИ выводится только через textContent/createElement — без innerHTML. */
(function () {
  'use strict';
  const root = document.getElementById('tasks');
  if (!root) return;

  const $ = (sel) => root.querySelector(sel);
  const grid = $('#tGrid'), panel = $('#tPanel'), form = $('#tForm'), title = $('#tTitle'), hint = $('#tHint');
  const go = $('#tGo'), out = $('#tOut'), actions = $('#tActions'), openBox = $('#tOpen'), quota = $('#tQuota');

  const LICENSE_KEY = 'systemprompt_license';
  const license = () => { try { return localStorage.getItem(LICENSE_KEY) || ''; } catch (e) { return ''; } };
  const goal = (n) => { try { if (typeof window.spGoal === 'function') window.spGoal(n); } catch (e) { /* без аналитики */ } };

  /* «Приведи друга»: свой секрет rid и код пригласившего (из ссылки ?r=) */
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { /* без хранилища */ } return ''; };
  let rid = ls('sp_rid');
  if (!/^[a-f0-9]{32}$/.test(rid)) { rid = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); ls('sp_rid', rid); }
  try { const r = new URLSearchParams(location.search).get('r'); if (r && /^[a-f0-9]{10}$/.test(r) && !ls('sp_ref')) ls('sp_ref', r); } catch (e) { /* нет параметра */ }
  let refInfo = null;

  let tasks = [], current = null, lastFields = null, lastResult = '', lastPrompt = '', busy = false, state = { left: null, perDay: null, pro: false };

  /* ---------- Утилиты ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('tToast');
    if (!t) { t = el('div', 't-toast'); t.id = 'tToast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
  }
  async function copy(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* запасной способ */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove(); return ok;
  }
  async function api(path, body) {
    const headers = { 'content-type': 'application/json' };
    const lic = license(); if (lic) headers.authorization = 'Bearer ' + lic;
    const res = await fetch(path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
    let data = {}; try { data = await res.json(); } catch (e) { data = {}; }
    return { status: res.status, data };
  }
  function openPro() {
    const b = document.getElementById('tProTrigger');
    if (b) b.click();
  }

  /* ---------- Простая разметка результата (жирный, списки, заголовки, таблицы, код) ---------- */
  function inline(node, text) {
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
    parts.forEach((p) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) node.appendChild(el('b', '', p.slice(2, -2)));
      else if (p) node.appendChild(document.createTextNode(p));
    });
    return node;
  }
  function render(text) {
    out.textContent = '';
    const lines = text.replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) { i++; continue; }
      if (t.startsWith('```')) {
        const buf = []; i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
        i++; out.appendChild(el('pre', '', buf.join('\n'))); continue;
      }
      let m;
      if ((m = /^#{1,6}\s+(.*)$/.exec(t))) { out.appendChild(inline(el('h4'), m[1])); i++; continue; }
      if (t.startsWith('|')) {
        const wrap = el('div', 'tbl'), table = el('table');
        let first = true;
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const row = lines[i++].trim();
          if (/^\|?\s*:?-{2,}/.test(row.replace(/^\|/, ''))) continue;
          const tr = el('tr');
          row.replace(/^\|/, '').replace(/\|$/, '').split('|').forEach((c) => tr.appendChild(inline(el(first ? 'th' : 'td'), c.trim())));
          table.appendChild(tr); first = false;
        }
        wrap.appendChild(table); out.appendChild(wrap); continue;
      }
      if (/^[-*•]\s+/.test(t)) {
        const ul = el('ul');
        while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) ul.appendChild(inline(el('li'), lines[i++].trim().replace(/^[-*•]\s+/, '')));
        out.appendChild(ul); continue;
      }
      if (/^\d+[.)]\s+/.test(t)) {
        const ol = el('ol');
        while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) ol.appendChild(inline(el('li'), lines[i++].trim().replace(/^\d+[.)]\s+/, '')));
        out.appendChild(ol); continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\||[-*•]\s|\d+[.)]\s)/.test(lines[i].trim())) para.push(lines[i++].trim());
      const p = el('p');
      para.forEach((line, k) => { if (k) p.appendChild(document.createElement('br')); inline(p, line); });
      out.appendChild(p);
    }
  }
  // Текст для копирования — без разметки Markdown
  const plain = (text) => text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^```\w*\s*$/gm, '').trim();

  /* ---------- Счётчик ---------- */
  function showQuota() {
    quota.textContent = '';
    if (state.left === null) return;
    quota.appendChild(document.createTextNode(state.pro ? 'PRO · осталось сегодня: ' : 'Бесплатно сегодня: '));
    quota.appendChild(el('b', '', state.left + ' из ' + state.perDay));
    if (!state.pro) {
      const b = el('button', '', 'Больше с PRO');
      b.type = 'button'; b.addEventListener('click', openPro);
      quota.appendChild(b);
    }
  }

  /* ---------- Профиль магазина (хранится только в браузере) ---------- */
  const profText = $('#tProfile');
  if (profText) {
    profText.value = ls('sp_profile');
    const profState = $('#tProfileState');
    const mark = () => { if (profState) profState.textContent = profText.value.trim() ? '✓ заполнен' : ''; };
    mark();
    profText.addEventListener('input', () => { ls('sp_profile', profText.value.slice(0, 800)); mark(); });
    profText.addEventListener('change', () => goal('profile_saved'));
  }

  /* ---------- Приведи друга ---------- */
  const refBox = $('#tRef');
  function showRef() {
    if (!refBox || !refInfo || state.pro) return;
    refBox.textContent = '';
    refBox.appendChild(document.createTextNode('🎁 Приведи друга — +' + refInfo.per + ' текста за каждого'));
    if (refInfo.bonus > 0) refBox.appendChild(el('b', '', ' · бонус: ' + refInfo.bonus));
    const b = el('button', '', 'Скопировать ссылку');
    b.type = 'button';
    b.addEventListener('click', async () => {
      const link = location.origin + '/?r=' + refInfo.code;
      const ok = await copy(link);
      toast(ok ? 'Ссылка скопирована ✓ Отправьте её другу' : link);
      goal('ref_copy');
    });
    refBox.appendChild(b);
    refBox.classList.remove('t-hidden');
  }
  async function loadRef() {
    if (state.pro) return;
    try { const r = await api('/api/ref', { rid }); if (r.status === 200 && r.data.code) { refInfo = r.data; showRef(); } } catch (e) { /* без бонусов */ }
  }

  /* ---------- Сетка задач ---------- */
  const CATS = [['sell', '🛒 Продавцам'], ['biz', '💼 Бизнесу'], ['me', '🙋 Для себя']];
  let cat = 'sell', tabs = null;
  function card(t) {
    const b = el('button', 't-card');
    b.type = 'button'; b.dataset.task = t.id; b.setAttribute('aria-pressed', String(!!current && current.id === t.id));
    b.appendChild(el('span', 'e', t.emoji));
    b.appendChild(el('span', 'n', t.title));
    if (t.pro) b.querySelector('.n').appendChild(el('span', 't-pro', 'PRO'));
    b.appendChild(el('span', 'd', t.desc));
    b.addEventListener('click', () => select(t.id, true));
    return b;
  }
  function setCat(c, user) {
    cat = c;
    if (tabs) tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.cat === c)));
    grid.textContent = '';
    tasks.filter((t) => !t.hidden && (t.cats || []).includes(c)).forEach((t) => grid.appendChild(card(t)));
    if (user) { ls('sp_cat', c); goal('tab_' + c); }
  }
  function buildGrid() {
    tabs = el('div', 't-tabs'); tabs.setAttribute('role', 'tablist');
    CATS.forEach(([id, name]) => {
      const b = el('button', '', name); b.type = 'button'; b.dataset.cat = id; b.setAttribute('role', 'tab');
      b.addEventListener('click', () => setCat(id, true));
      tabs.appendChild(b);
    });
    grid.insertAdjacentElement('beforebegin', tabs);
    const saved = ls('sp_cat');
    setCat(CATS.some((c) => c[0] === saved) ? saved : 'sell');
  }

  function select(id, scroll) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    current = t; lastResult = ''; lastPrompt = ''; lastFields = null;
    if (!t.hidden && !(t.cats || []).includes(cat) && t.cats && t.cats.length) setCat(t.cats[0]);
    root.querySelectorAll('.t-card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.task === id)));
    title.textContent = t.emoji + ' ' + t.title;
    hint.textContent = t.desc;
    form.textContent = '';
    if (t.example) {
      const ex = el('button', 't-example', '✨ Заполнить примером');
      ex.type = 'button';
      ex.addEventListener('click', () => {
        Object.keys(t.example).forEach((k) => { const i = form.querySelector('[name="' + k + '"]'); if (i) { i.value = t.example[k]; i.closest('.t-field').classList.remove('bad'); } });
        goal('task_example');
      });
      form.appendChild(ex);
    }
    t.fields.forEach((f) => {
      const lab = el('label', 't-field'); lab.dataset.name = f.name;
      const cap = el('span', '', f.label);
      if (f.required) { cap.appendChild(document.createTextNode(' ')); cap.appendChild(el('i', '', '*')); }
      lab.appendChild(cap);
      let input;
      if (f.type === 'select') {
        input = el('select');
        f.options.forEach((o) => { const op = el('option', '', o); op.value = o; input.appendChild(op); });
      } else if (f.type === 'textarea') {
        input = el('textarea'); input.rows = f.max > 3000 ? 10 : 4; input.maxLength = f.max; input.placeholder = f.placeholder || '';
      } else {
        input = el('input'); input.type = 'text'; input.maxLength = f.max; input.placeholder = f.placeholder || '';
      }
      input.name = f.name;
      input.addEventListener('input', () => lab.classList.remove('bad'));
      lab.appendChild(input);
      lab.appendChild(el('div', 'err', 'Заполните это поле'));
      form.appendChild(lab);
    });
    out.textContent = '';
    out.appendChild(el('p', 'ph', 'Заполните поля и нажмите «Сделать». Готовый текст появится здесь — его можно скопировать или открыть в любой нейросети.'));
    actions.classList.add('t-hidden'); openBox.classList.add('t-hidden');
    panel.classList.remove('t-hidden');
    try { history.replaceState(null, '', '#task=' + id); } catch (e) { /* без смены адреса */ }
    if (scroll) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    goal('task_open');
  }

  function readFields() {
    const data = {}; let ok = true; let firstBad = null;
    current.fields.forEach((f) => {
      const lab = form.querySelector('[data-name="' + f.name + '"]');
      const v = lab.querySelector('input,textarea,select').value.trim();
      data[f.name] = v;
      if (f.required && !v) { ok = false; lab.classList.add('bad'); if (!firstBad) firstBad = lab; }
    });
    if (firstBad) firstBad.querySelector('input,textarea,select').focus();
    return ok ? data : null;
  }

  function setBusy(on, label) {
    busy = on; go.disabled = on;
    go.textContent = on ? 'ИИ пишет… обычно 3–10 секунд' : 'Сделать ⚡';
    actions.querySelectorAll('button').forEach((b) => { b.disabled = on; });
    if (on) { out.textContent = ''; out.appendChild(el('div', 't-loading', label || 'ИИ пишет текст…')); }
  }

  async function run(tweak) {
    if (busy || !current) return;
    let fields = lastFields;
    if (!tweak) { fields = readFields(); if (!fields) return; }
    setBusy(true, tweak ? 'Переписываю…' : 'ИИ пишет текст…');
    const body = { task: current.id, fields, rid };
    const prof = ls('sp_profile').trim().slice(0, 800); if (prof) body.profile = prof;
    const inv = ls('sp_ref'); if (inv && (!refInfo || inv !== refInfo.code)) body.ref = inv;
    if (tweak) { body.tweak = tweak; body.previous = lastResult; }
    let res;
    try { res = await api('/api/task', body); } catch (e) { res = { status: 0, data: {} }; }
    setBusy(false);
    const d = res.data || {};
    if (typeof d.bonus === 'number' && refInfo) { refInfo.bonus = d.bonus; showRef(); }
    if (typeof d.left === 'number') { state.left = d.left; state.perDay = d.perDay; state.pro = !!d.pro; showQuota(); }
    if (d.prompt) { lastPrompt = d.prompt; lastFields = fields; }

    if (res.status === 200 && d.result) {
      lastResult = d.result;
      render(d.result);
      actions.classList.remove('t-hidden'); openBox.classList.remove('t-hidden');
      goal(tweak ? 'task_tweak' : 'task_done');
      return;
    }
    out.textContent = '';
    if (res.status === 402 && d.error === 'pro_only') {
      out.appendChild(el('div', 't-note', 'Бесплатно — до 3 отзывов за раз. До 15 за раз и 100 текстов в сутки — в PRO, попробуйте 7 дней за 99 ₽. Или уберите лишние отзывы, или отправьте этот запрос в ChatGPT, Claude или другую нейросеть кнопками ниже.'));
      openBox.classList.remove('t-hidden');
      window.spPreferTrial = true;
      goal('batch_pro');
      openPro();
    } else if (res.status === 402) {
      out.appendChild(el('div', 't-note', 'Бесплатные задачи на сегодня закончились. Откройте PRO, пригласите друга (+3 текста за каждого — ссылка над задачами) или отправьте этот запрос в ChatGPT, Claude или другую нейросеть кнопками ниже, он уже собран.'));
      if (lastResult) render(lastResult);
      openBox.classList.remove('t-hidden');
      window.spPreferTrial = true;
      openPro();
    } else if (res.status === 503) {
      out.appendChild(el('div', 't-note', 'Наш ИИ сейчас перегружен. Запрос уже собран — отправьте его в любую нейросеть кнопками ниже, результат будет тем же.'));
      openBox.classList.remove('t-hidden');
    } else if (res.status === 429) {
      out.appendChild(el('div', 't-note', 'Слишком много запросов подряд. Подождите минуту и попробуйте снова.'));
    } else if (res.status === 400 && d.field) {
      const lab = form.querySelector('[data-name="' + d.field + '"]');
      if (lab) { lab.classList.add('bad'); lab.querySelector('.err').textContent = d.error === 'too_long' ? 'Слишком длинный текст' : 'Проверьте это поле'; }
      out.appendChild(el('p', 'ph', 'Проверьте отмеченное поле.'));
    } else {
      out.appendChild(el('div', 't-note', 'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.'));
    }
  }

  /* ---------- Кнопки «Открыть в…» ---------- */
  const TARGETS = {
    chatgpt: { name: 'ChatGPT', url: (q) => 'https://chatgpt.com/?q=' + q, home: 'https://chatgpt.com/' },
    claude: { name: 'Claude', url: (q) => 'https://claude.ai/new?q=' + q, home: 'https://claude.ai/new' },
    perplexity: { name: 'Perplexity', url: (q) => 'https://www.perplexity.ai/search?q=' + q, home: 'https://www.perplexity.ai/' },
    deepseek: { name: 'DeepSeek', home: 'https://chat.deepseek.com/' },
    gigachat: { name: 'GigaChat', home: 'https://giga.chat/' },
    alice: { name: 'Алиса', home: 'https://alice.yandex.ru/' }
  };
  async function openIn(key) {
    const t = TARGETS[key];
    if (!t || !lastPrompt) return;
    const copied = await copy(lastPrompt);
    const enc = encodeURIComponent(lastPrompt);
    const direct = t.url && enc.length <= 12000;
    window.open(direct ? t.url(enc) : t.home, '_blank', 'noopener');
    goal('open_in_' + key);
    if (direct) toast('Открываю ' + t.name + ' с готовым запросом');
    else toast(copied ? 'Запрос скопирован — вставьте его в ' + t.name + ' (Ctrl+V) и отправьте' : 'Откройте ' + t.name + ' и вставьте запрос');
  }

  /* ---------- Обработчики ---------- */
  go.addEventListener('click', () => run(null));
  form.addEventListener('submit', (e) => { e.preventDefault(); run(null); });
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(null); } });
  actions.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'copy') { const ok = await copy(plain(lastResult)); toast(ok ? 'Скопировано ✓' : 'Выделите текст и скопируйте вручную'); goal('task_copy'); }
    else if (a) run(a);
  });
  openBox.addEventListener('click', (e) => { const b = e.target.closest('button[data-open]'); if (b) openIn(b.dataset.open); });

  /* ---------- Поле «Напишите, что нужно» ---------- */
  const qBox = $('#tQuick'), qText = $('#tQuickText');
  function quick() {
    const v = (qText.value || '').trim();
    if (!v) { qText.focus(); return; }
    if (!tasks.some((t) => t.id === 'svoya-zadacha')) return;
    select('svoya-zadacha', true);
    const inp = form.querySelector('[name="request"]');
    if (inp) inp.value = v.slice(0, 2000);
    goal('quick_ask');
    run(null);
  }
  if (qBox) {
    qBox.addEventListener('submit', (e) => { e.preventDefault(); quick(); });
    qText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); quick(); } });
  }

  /* ---------- Старт ---------- */
  async function init() {
    let res;
    try { res = await api('/api/tasks'); } catch (e) { res = { status: 0, data: {} }; }
    if (res.status !== 200 || !Array.isArray(res.data.tasks)) {
      grid.textContent = '';
      grid.appendChild(el('p', 't-sub', 'Не удалось загрузить задачи. Обновите страницу.'));
      return;
    }
    tasks = res.data.tasks;
    state = { left: res.data.left, perDay: res.data.perDay, pro: !!res.data.pro };
    buildGrid(); showQuota(); loadRef();
    // Счётчик «уже написано N текстов» — показываем, когда цифра уже солидная
    const total = res.data.textsTotal;
    const sub = document.querySelector('#tasks .t-sub');
    if (typeof total === 'number' && total >= 100 && sub && !document.getElementById('tTotal')) {
      const n10 = total % 10, n100 = total % 100;
      const word = (n10 === 1 && n100 !== 11) ? 'текст' : (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) ? 'текста' : 'текстов';
      const c = el('p', 't-total', '⚡ Нейросеть уже написала ' + total.toLocaleString('ru-RU') + ' ' + word);
      c.id = 'tTotal';
      sub.insertAdjacentElement('afterend', c);
    }
    const m = /^#task=([a-z0-9-]+)$/.exec(location.hash || '');
    if (m) select(m[1], true);
  }
  init();
})();
