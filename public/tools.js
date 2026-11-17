/* Блок «Выберите задачу → получите готовый результат».
   Текст от ИИ выводится только через textContent/createElement — без innerHTML. */
(function () {
  'use strict';
  const root = document.getElementById('tasks');
  if (!root) return;

  const $ = (sel) => root.querySelector(sel);
  const grid = $('#tGrid'), panel = $('#tPanel'), form = $('#tForm'), title = $('#tTitle'), hint = $('#tHint');
  const go = $('#tGo'), out = $('#tOut'), actions = $('#tActions'), openBox = $('#tOpen'), mpBox = $('#tMp'), quota = $('#tQuota');

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
  const CATS = [['sell', '🛒 Продавцам'], ['biz', '💼 Бизнесу'], ['me', '📝 Другие тексты']];
  let cat = 'sell', tabs = null;
  function card(t) {
    const b = el('button', 't-card');
    b.type = 'button'; b.dataset.task = t.id; b.setAttribute('aria-pressed', String(!!current && current.id === t.id));
    b.appendChild(el('span', 'e', t.emoji));
    b.appendChild(el('span', 'n', t.title));
    if (t.pro) b.querySelector('.n').appendChild(el('span', 't-pro', 'до 3 бесплатно'));
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
      if (f.name === 'shop' && ls('sp_profile').trim()) input.placeholder = 'Можно не заполнять — магазин уже в профиле';
      input.addEventListener('input', () => lab.classList.remove('bad'));
      lab.appendChild(input);
      lab.appendChild(el('div', 'err', 'Заполните это поле'));
      form.appendChild(lab);
    });
    if (t.id === 'otvet-na-otzyv') {
      const PRESETS = [['📦 Брак', 'Пришло с браком — на рукаве затяжка, а надеть хотела сразу. Очень расстроилась.', '1 ★'], ['📏 Не подошёл размер', 'Маломерит. Заказала свой обычный размер — мало, пришлось вернуть.', '3 ★'], ['🚚 Долгая доставка', 'Товар хороший, но доставка шла почти две недели.', '4 ★'], ['🔄 Прислали не то', 'Заказывала синий цвет, а пришёл чёрный. Разочарована.', '2 ★'], ['💚 Всё отлично', 'Всё супер, качество отличное, пришло быстро. Спасибо!', '5 ★']];
      const row = el('div', 't-presets'); row.appendChild(el('span', '', 'Нет отзыва под рукой? Частый случай:'));
      PRESETS.forEach((p) => { const b = el('button', 't-preset', p[0]); b.type = 'button'; b.addEventListener('click', () => { const r = form.querySelector('[name="review"]'), g = form.querySelector('[name="rating"]'); if (r) { r.value = p[1]; r.closest('.t-field').classList.remove('bad'); } if (g) g.value = p[2]; goal('preset'); }); row.appendChild(b); });
      const rl = form.querySelector('[data-name="review"]'); if (rl) rl.insertAdjacentElement('beforebegin', row);
    }
    if (t.id === 'otvety-pachkoj') { const rl = form.querySelector('[data-name="reviews"]'); if (rl) rl.insertAdjacentElement('afterend', fileBox()); }
    form.querySelectorAll('textarea').forEach(addMic);
    panel.classList.remove('t-wide');
    out.textContent = '';
    out.appendChild(el('p', 'ph', 'Заполните поля и нажмите «Сделать». Готовый текст появится здесь — его можно скопировать или открыть в любой нейросети.'));
    actions.classList.add('t-hidden'); openBox.classList.add('t-hidden'); mpShow(false);
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
    stopVoice(); panel.classList.remove('t-wide');
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
      saveHistory(current, d.result);
      actions.classList.remove('t-hidden'); openBox.classList.remove('t-hidden'); mpShow(true);
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

  /* ---------- История и шаблоны (только в браузере) ---------- */
  const HIST_KEY = 'sp_hist', TPL_KEY = 'sp_tpl', HIST_MAX = 30, TPL_MAX = 50;
  const readList = (k) => { try { const v = JSON.parse(ls(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const writeList = (k, list) => { try { localStorage.setItem(k, JSON.stringify(list)); return true; } catch (e) { return false; } };
  function saveHistory(task, text) {
    if (!task || !text) return;
    const list = readList(HIST_KEY);
    list.unshift({ t: task.emoji + ' ' + task.title, x: plain(text).slice(0, 8000), at: Date.now() });
    writeList(HIST_KEY, list.slice(0, HIST_MAX));
    if (drawer && drawer.classList.contains('on')) fillDrawer();
  }
  function saveTemplate() {
    if (!lastResult || !current) return;
    const list = readList(TPL_KEY);
    const x = plain(lastResult).slice(0, 8000);
    if (list.some((i) => i.x === x)) { toast('Этот текст уже в шаблонах'); return; }
    list.unshift({ t: current.emoji + ' ' + current.title, x, at: Date.now() });
    if (!writeList(TPL_KEY, list.slice(0, TPL_MAX))) { toast('Не удалось сохранить: браузер не даёт хранить данные'); return; }
    toast('Сохранено в шаблоны ⭐ — они в «📚 Мои тексты»');
    goal('tpl_save');
  }
  const fmtDate = (ms) => { try { return new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

  let drawer = null, drawerTab = 'hist';
  function fillDrawer() {
    const body = drawer.querySelector('.t-dr-body');
    drawer.querySelectorAll('.t-dr-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === drawerTab)));
    body.textContent = '';
    const key = drawerTab === 'hist' ? HIST_KEY : TPL_KEY;
    const list = readList(key);
    if (!list.length) {
      body.appendChild(el('p', 't-dr-empty', drawerTab === 'hist'
        ? 'Здесь появятся последние ' + HIST_MAX + ' текстов, которые написала нейросеть. Хранятся только в этом браузере.'
        : 'Понравился текст? Нажмите под ним «⭐ В шаблоны» — и он будет здесь, чтобы скопировать одной кнопкой.'));
      return;
    }
    list.forEach((it, idx) => {
      const c = el('div', 't-dr-item');
      const top = el('div', 't-dr-top');
      top.appendChild(el('b', '', it.t || 'Текст'));
      top.appendChild(el('span', '', fmtDate(it.at)));
      c.appendChild(top);
      const txt = el('div', 't-dr-text', it.x);
      c.appendChild(txt);
      const row = el('div', 't-dr-row');
      const b1 = el('button', 't-btn primary', '📋 Скопировать'); b1.type = 'button';
      b1.addEventListener('click', async () => { const ok = await copy(it.x); toast(ok ? 'Скопировано ✓' : 'Выделите текст и скопируйте вручную'); goal(drawerTab === 'hist' ? 'hist_copy' : 'tpl_copy'); });
      const b2 = el('button', 't-btn', 'Развернуть'); b2.type = 'button';
      b2.addEventListener('click', () => { const on = txt.classList.toggle('full'); b2.textContent = on ? 'Свернуть' : 'Развернуть'; });
      row.appendChild(b1); row.appendChild(b2);
      if (drawerTab === 'hist') {
        const b3 = el('button', 't-btn', '⭐ В шаблоны'); b3.type = 'button';
        b3.addEventListener('click', () => {
          const tl = readList(TPL_KEY);
          if (!tl.some((i) => i.x === it.x)) { tl.unshift({ t: it.t, x: it.x, at: Date.now() }); writeList(TPL_KEY, tl.slice(0, TPL_MAX)); goal('tpl_save'); }
          toast('Сохранено в шаблоны ⭐');
        });
        row.appendChild(b3);
      }
      const del = el('button', 't-btn t-dr-del', '🗑'); del.type = 'button'; del.setAttribute('aria-label', 'Удалить');
      del.addEventListener('click', () => { const l = readList(key); l.splice(idx, 1); writeList(key, l); fillDrawer(); });
      row.appendChild(del);
      c.appendChild(row);
      body.appendChild(c);
    });
    if (drawerTab === 'hist') {
      const clr = el('button', 't-dr-clear', 'Очистить историю'); clr.type = 'button';
      clr.addEventListener('click', () => { if (confirm('Удалить всю историю текстов из этого браузера?')) { writeList(HIST_KEY, []); fillDrawer(); } });
      body.appendChild(clr);
    }
  }
  function buildDrawer() {
    drawer = el('div', 't-drawer'); drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'Мои тексты');
    const shade = el('div', 't-dr-shade');
    const box = el('div', 't-dr-box');
    const head = el('div', 't-dr-head');
    head.appendChild(el('b', '', '📚 Мои тексты'));
    const x = el('button', 't-dr-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Закрыть');
    head.appendChild(x);
    const tb = el('div', 't-dr-tabs');
    [['hist', '🕘 История'], ['tpl', '⭐ Шаблоны']].forEach(([id, n]) => {
      const b = el('button', '', n); b.type = 'button'; b.dataset.tab = id;
      b.addEventListener('click', () => { drawerTab = id; fillDrawer(); });
      tb.appendChild(b);
    });
    box.appendChild(head); box.appendChild(tb); box.appendChild(el('div', 't-dr-body'));
    box.appendChild(el('p', 't-dr-note', 'Хранится только в этом браузере — на другом устройстве не видно.'));
    drawer.appendChild(shade); drawer.appendChild(box);
    const close = () => drawer.classList.remove('on');
    shade.addEventListener('click', close); x.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.appendChild(drawer);
  }
  function openDrawer(tab) {
    if (!drawer) buildDrawer();
    if (tab) drawerTab = tab;
    fillDrawer(); drawer.classList.add('on');
    goal('mytexts_open');
  }
  (function addMyTextsButton() {
    const head = root.querySelector('.t-head');
    if (!head || !quota) return;
    const side = el('div', 't-head-side');
    const b = el('button', 't-mytexts', '📚 Мои тексты'); b.type = 'button';
    b.addEventListener('click', () => openDrawer());
    quota.insertAdjacentElement('beforebegin', side);
    side.appendChild(b); side.appendChild(quota);
  })();

  /* ---------- Голосовой ввод (Chrome, Яндекс Браузер, Edge, Safari) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null, recogTarget = null, recogBtn = null;
  function stopVoice() { if (recog) { try { recog.stop(); } catch (e) { /* уже остановлено */ } } }
  function addMic(ta) {
    if (!SR || !ta || ta.dataset.mic) return;
    ta.dataset.mic = '1';
    const wrap = el('div', 't-micwrap');
    ta.parentNode.insertBefore(wrap, ta); wrap.appendChild(ta);
    const b = el('button', 't-mic', '🎤'); b.type = 'button'; b.title = 'Надиктовать голосом'; b.setAttribute('aria-label', 'Надиктовать голосом');
    wrap.appendChild(b);
    b.addEventListener('click', () => {
      if (recog && recogTarget === ta) { stopVoice(); return; }
      stopVoice();
      const r = new SR(); r.lang = 'ru-RU'; r.continuous = true; r.interimResults = true;
      const base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
      let finalText = '';
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const s = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += s; else interim += s;
        }
        ta.value = (base + finalText + interim).slice(0, ta.maxLength > 0 ? ta.maxLength : 6000);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      };
      r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Разрешите доступ к микрофону в браузере (значок слева от адреса сайта)'); else if (e.error === 'no-speech') toast('Не слышно речи — попробуйте ещё раз'); };
      r.onend = () => { b.classList.remove('on'); if (recog === r) { recog = null; recogTarget = null; recogBtn = null; } };
      try { r.start(); } catch (e) { toast('Голосовой ввод сейчас недоступен'); return; }
      recog = r; recogTarget = ta; recogBtn = b; b.classList.add('on');
      toast('Говорите… Нажмите 🎤 ещё раз, чтобы закончить');
      goal('voice');
    });
  }

  /* ---------- Отзывы из файла (Excel / CSV из кабинета WB, Ozon) ---------- */
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('zip');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el2 = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      files[name] = { method, csize, off };
      p += 46 + nl + el2 + cl;
    }
    const read = async (name) => {
      const f = files[name]; if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return dec.decode(data);
      if (f.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('deflate');
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(ds).text();
    };
    return { names: Object.keys(files), read };
  }
  const colIdx = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  async function parseXlsx(buf) {
    const z = await unzip(buf);
    const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const textOf = (node) => Array.from(node.getElementsByTagName('t')).map((t) => t.textContent).join('');
    const sstRaw = await z.read('xl/sharedStrings.xml');
    const sst = sstRaw ? Array.from(xml(sstRaw).getElementsByTagName('si')).map(textOf) : [];
    const sheetName = z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))[0];
    if (!sheetName) throw new Error('sheet');
    const doc = xml(await z.read(sheetName));
    return Array.from(doc.getElementsByTagName('row')).map((row) => {
      const out = [];
      Array.from(row.getElementsByTagName('c')).forEach((c, i) => {
        const t = c.getAttribute('t'); let idx = colIdx(c.getAttribute('r')); if (idx < 0) idx = i;
        let v = '';
        if (t === 's') { const vv = c.getElementsByTagName('v')[0]; v = vv ? (sst[parseInt(vv.textContent, 10)] || '') : ''; }
        else if (t === 'inlineStr') v = textOf(c);
        else { const vv = c.getElementsByTagName('v')[0]; v = vv ? vv.textContent : ''; }
        out[idx] = v;
      });
      return Array.from(out, (x) => (x == null ? '' : String(x)));
    });
  }
  function parseCsv(text) {
    const first = text.split('\n', 1)[0];
    const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch (e) { return new TextDecoder('windows-1251').decode(buf); }
  }
  // Из таблицы — список отзывов { rating, product, text }
  function rowsToReviews(rows) {
    rows = rows.filter((r) => r.some((c) => String(c).trim()));
    if (!rows.length) return [];
    const head = rows[0].map((h) => String(h).toLowerCase());
    const find = (re) => head.findIndex((h) => re.test(h));
    let iText = find(/текст отзыв|^отзыв$|комментар|текст|review|^text/);
    const iPlus = find(/достоинств|плюс/), iMinus = find(/недостат|минус/);
    const iRate = find(/оценк|рейтинг|звезд|rating/);
    const iProd = find(/наименован|название|товар|product/);
    let start = 1;
    if (iText < 0 && iPlus < 0 && iMinus < 0) {
      // Заголовков нет — берём колонку с самым длинным текстом
      const w = Math.max(...rows.map((r) => r.length));
      let best = 0, bestLen = -1;
      for (let c = 0; c < w; c++) { const len = rows.reduce((s, r) => s + String(r[c] || '').length, 0); if (len > bestLen) { bestLen = len; best = c; } }
      iText = best; start = /[a-zа-я]/i.test(head[best] || '') && String(rows[0][best]).length < 40 ? 1 : 0;
    }
    const list = [];
    rows.slice(start).forEach((r) => {
      const parts = [];
      if (iText >= 0 && String(r[iText] || '').trim()) parts.push(String(r[iText]).trim());
      if (iPlus >= 0 && String(r[iPlus] || '').trim()) parts.push('Достоинства: ' + String(r[iPlus]).trim());
      if (iMinus >= 0 && String(r[iMinus] || '').trim()) parts.push('Недостатки: ' + String(r[iMinus]).trim());
      const rate = iRate >= 0 ? String(r[iRate] || '').trim() : '';
      if (!parts.length && !rate) return;
      list.push({ rating: rate, product: iProd >= 0 ? String(r[iProd] || '').trim() : '', text: parts.join('. ').replace(/\s+/g, ' ').slice(0, 700) || 'Без текста, только оценка' });
    });
    return list;
  }
  async function readReviewFile(file) {
    const buf = await file.arrayBuffer();
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.xlsx')) return rowsToReviews(await parseXlsx(buf));
    if (name.endsWith('.xls')) throw new Error('xls');
    const text = decodeText(buf);
    if (name.endsWith('.txt')) return splitReviews(text).map((t) => ({ rating: '', product: '', text: t.replace(/\s+/g, ' ').slice(0, 700) }));
    return rowsToReviews(parseCsv(text));
  }
  function splitReviews(text) {
    const t = String(text || '').trim();
    let parts = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) parts = t.split(/\n/).map((x) => x.trim()).filter(Boolean);
    return parts;
  }
  const reviewLine = (r) => (r.rating ? r.rating.replace(/\D/g, '').slice(0, 1) + '★ ' : '') + (r.product ? '[' + r.product.slice(0, 80) + '] ' : '') + r.text;
  function parseAnswers(text, n) {
    const res = new Array(n).fill('');
    const re = /(?:^|\n)[ \t*#]*Отзыв\s*(\d+)\s*[:.)]?[*]*[ \t]*(?:\n|$)/g;
    const marks = []; let m;
    while ((m = re.exec(text))) marks.push({ n: parseInt(m[1], 10), s: m.index, e: re.lastIndex });
    marks.forEach((mk, i) => {
      const body = text.slice(mk.e, i + 1 < marks.length ? marks[i + 1].s : text.length).trim();
      if (mk.n >= 1 && mk.n <= n) res[mk.n - 1] = plain(body);
    });
    if (!marks.length && n === 1) res[0] = plain(text);
    return res;
  }
  const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  function downloadCsv(items) {
    const lines = [['Оценка', 'Товар', 'Отзыв', 'Ответ'].map(csvCell).join(';')];
    items.forEach((r) => lines.push([r.rating, r.product, r.text, r.answer || ''].map(csvCell).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'otvety-na-otzyvy.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    goal('file_download');
  }
  function fileResults(items, done, note) {
    out.textContent = '';
    if (note) out.appendChild(el('div', 't-note', note));
    const ready = items.filter((r) => r.answer);
    if (ready.length) {
      const bar = el('div', 't-actions t-file-bar');
      const d = el('button', 't-btn primary', '⬇️ Скачать ответы (' + ready.length + ') — Excel/CSV'); d.type = 'button';
      d.addEventListener('click', () => downloadCsv(items));
      const c = el('button', 't-btn', '📋 Скопировать все'); c.type = 'button';
      c.addEventListener('click', async () => { const ok = await copy(ready.map((r, i) => (i + 1) + '. ' + r.text + '\nОтвет: ' + r.answer).join('\n\n')); toast(ok ? 'Скопировано ✓' : 'Не удалось скопировать'); goal('task_copy'); });
      bar.appendChild(d); bar.appendChild(c); out.appendChild(bar);
    }
    const wrap = el('div', 'tbl'), table = el('table'), tr0 = el('tr');
    ['', 'Отзыв', 'Ответ'].forEach((h) => tr0.appendChild(el('th', '', h)));
    table.appendChild(tr0);
    items.slice(0, done || items.length).forEach((r, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', 't-file-n', String(i + 1)));
      tr.appendChild(el('td', '', reviewLine(r)));
      tr.appendChild(el('td', '', r.answer || '—'));
      table.appendChild(tr);
    });
    wrap.appendChild(table); out.appendChild(wrap);
  }
  async function processFile(items) {
    if (busy) return;
    const shop = (form.querySelector('[name="shop"]') || {}).value || '';
    const tone = (form.querySelector('[name="tone"]') || {}).value || '';
    let size = state.pro ? 15 : 3, i = 0, note = '', limited = false;
    if (!state.pro) { limited = items.length > 3; items = items.slice(0, 3); }
    busy = true; go.disabled = true;
    panel.classList.add('t-wide');
    const rbox = out.closest('.t-box'); if (rbox) setTimeout(() => rbox.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    while (i < items.length) {
      const chunk = items.slice(i, i + size);
      go.textContent = 'ИИ пишет… готово ' + i + ' из ' + items.length;
      out.textContent = ''; out.appendChild(el('div', 't-loading', 'Пишу ответы: ' + i + ' из ' + items.length + '… не закрывайте страницу'));
      const body = { task: 'otvety-pachkoj', fields: { reviews: chunk.map(reviewLine).join('\n\n'), shop: shop.slice(0, 200), tone }, rid };
      const prof = ls('sp_profile').trim().slice(0, 800); if (prof) body.profile = prof;
      let res; try { res = await api('/api/task', body); } catch (e) { res = { status: 0, data: {} }; }
      const d = res.data || {};
      if (typeof d.left === 'number') { state.left = d.left; state.perDay = d.perDay; state.pro = !!d.pro; showQuota(); }
      if (res.status === 402 && d.error === 'pro_only' && size > 3) { size = 3; continue; }
      if (res.status !== 200 || !d.result) {
        note = res.status === 402 ? 'Лимит текстов на сегодня закончился — готово ' + i + ' из ' + items.length + '. Остальные можно сделать завтра или с тарифом побольше.'
          : res.status === 429 ? 'Слишком много запросов подряд — готово ' + i + ' из ' + items.length + '. Подождите пару минут и загрузите файл снова.'
          : 'Связь прервалась — готово ' + i + ' из ' + items.length + '. Скачайте готовое и попробуйте остальное позже.';
        if (res.status === 402) { window.spPreferTrial = true; openPro(); }
        break;
      }
      parseAnswers(d.result, chunk.length).forEach((a, k) => { chunk[k].answer = a; });
      i += chunk.length;
    }
    busy = false; go.disabled = false; go.textContent = 'Сделать ⚡';
    if (!note && limited) note = 'Бесплатно — первые 3 отзыва из файла. Весь файл (по 15 отзывов за раз, до 100 запросов в сутки) — в PRO, попробуйте 7 дней за 99 ₽.';
    if (limited) { window.spPreferTrial = true; goal('batch_pro'); }
    fileResults(items, i, note);
    if (i) { goal('file_done'); mpShow(true, true); }
    if (limited) openPro();
  }
  function fileBox() {
    const box = el('div', 't-file');
    const inp = el('input'); inp.type = 'file'; inp.accept = '.xlsx,.csv,.txt'; inp.className = 't-hidden';
    const b = el('button', 't-filebtn', '📎 Загрузить файл с отзывами'); b.type = 'button';
    const s = el('span', 't-file-hint', 'Excel или CSV из кабинета WB / Ozon — ответы придут файлом');
    b.addEventListener('click', () => inp.click());
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; inp.value = '';
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('Файл больше 5 МБ — оставьте в нём только новые отзывы'); return; }
      goal('file_upload');
      let items;
      try { items = await readReviewFile(f); } catch (e) {
        toast(e && e.message === 'xls' ? 'Старый формат .xls — откройте файл в Excel и сохраните как .xlsx или CSV' : 'Не получилось прочитать файл. Сохраните его как .xlsx или CSV и попробуйте снова');
        return;
      }
      if (!items.length) { toast('В файле не нашлось отзывов'); return; }
      if (items.length > 300) { items = items.slice(0, 300); toast('Беру первые 300 отзывов из файла'); }
      s.textContent = 'Файл: ' + f.name + ' · отзывов: ' + items.length;
      processFile(items);
    });
    box.appendChild(b); box.appendChild(s); box.appendChild(inp);
    return box;
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

  /* ---------- Кнопки «Скопировать и открыть кабинет маркетплейса» ---------- */
  const MP_TASKS = { 'otvet-na-otzyv': 'r', 'otvety-pachkoj': 'r', 'vopros-pokupatelya': 'q' };
  const MP = {
    wb: { name: 'Wildberries', url: 'https://seller.wildberries.ru/', where: '«Вопросы и отзывы»' },
    ozon: { name: 'Ozon', r: 'https://seller.ozon.ru/app/reviews', url: 'https://seller.ozon.ru/', where: '«Отзывы» / «Вопросы и ответы»' },
    ym: { name: 'Яндекс Маркет', url: 'https://partner.market.yandex.ru/', where: '«Отзывы» / «Вопросы о товарах»' },
    avito: { name: 'Авито', url: 'https://www.avito.ru/profile', where: '«Отзывы»' }
  };
  let mpFile = false;
  function mpShow(on, file) {
    if (!mpBox) return;
    mpFile = !!file;
    mpBox.classList.toggle('t-hidden', !(on && current && MP_TASKS[current.id]));
  }
  async function mpOpen(key) {
    const m = MP[key]; if (!m) return;
    const kind = current && MP_TASKS[current.id];
    const copied = !mpFile && lastResult ? await copy(plain(lastResult)) : false;
    window.open((kind === 'r' && m.r) || m.url, '_blank', 'noopener');
    goal('mp_open_' + key);
    toast((copied ? 'Ответ скопирован. ' : '') + 'В кабинете ' + m.name + ' откройте ' + m.where + ' и вставьте ответ (Ctrl+V)');
  }
  if (mpBox) mpBox.addEventListener('click', (e) => { const b = e.target.closest('button[data-mp]'); if (b) mpOpen(b.dataset.mp); });

  /* ---------- Обработчики ---------- */
  go.addEventListener('click', () => run(null));
  form.addEventListener('submit', (e) => { e.preventDefault(); run(null); });
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(null); } });
  actions.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'copy') { const ok = await copy(plain(lastResult)); toast(ok ? 'Скопировано ✓' : 'Выделите текст и скопируйте вручную'); goal('task_copy'); }
    else if (a === 'tpl') saveTemplate();
    else if (a) run(a);
  });
  openBox.addEventListener('click', (e) => { const b = e.target.closest('button[data-open]'); if (b) openIn(b.dataset.open); });

  /* ---------- Поле «Напишите, что нужно» ---------- */
  const qBox = $('#tQuick'), qText = $('#tQuickText');
  // Короткая просьба «что сделать» → сразу открываем подходящую задачу (длинный текст — это уже материал, его пишет ИИ)
  const ROUTES = [
    [/(пачк|много|сразу|несколько|все|массов|excel|эксел|файл|таблиц).*отзыв|отзыв.*(пачк|много|сразу|несколько|массов|excel|эксел|файл|таблиц)/, 'otvety-pachkoj'],
    [/(разбор|разобрать|анализ|проанализ|жалу|что (не )?нравит).*отзыв|отзыв.*(разбор|разобрать|анализ|проанализ)/, 'razbor-otzyvov'],
    [/штраф|поддержк|оспор|претензи.*(склад|wb|вб|озон|ozon|маркетплейс)|потерял|потеря|компенсац/, 'obrashchenie-v-podderzhku'],
    [/вопрос.*покупател|покупател.*(спрашива|вопрос)|ответ.*на вопрос/, 'vopros-pokupatelya'],
    [/(провер|аудит|оцени|улучш).*карточк/, 'proverka-kartochki'],
    [/карточк|описани.*товар|название товар|seo.*товар/, 'kartochka-tovara'],
    [/авито|объявлени/, 'obyavlenie-avito'],
    [/отзыв/, 'otvet-na-otzyv'],
    [/деловое письмо|письмо партн|письмо поставщ/, 'delovoe-pismo'],
    [/контент.?план/, 'kontent-plan'],
    [/пост|телеграм|вк\b|вконтакт/, 'post-telegram'],
    [/коммерческ|\bкп\b/, 'kommercheskoe-predlozhenie'],
    [/сопроводит|резюме|вакансi?/, 'soprovoditelnoe-pismo'],
    [/клиент.*(ответ|недовол|жалоб)|ответ.*клиент/, 'otvet-klientu']
  ];
  function route(v) {
    if (v.length > 90 || /[«"„]/.test(v)) return null;
    const x = v.toLowerCase().replace(/ё/g, 'е');
    for (const [re, id] of ROUTES) if (re.test(x) && tasks.some((t) => t.id === id)) return id;
    return null;
  }
  function quick() {
    const v = (qText.value || '').trim();
    if (!v) { qText.focus(); return; }
    const r = route(v);
    if (r) { select(r, true); goal('quick_ask'); const f1 = form.querySelector('textarea, input'); if (f1) f1.focus(); return; }
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
    addMic(qText);
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
    window.addEventListener('hashchange', () => { const h = /^#task=([a-z0-9-]+)$/.exec(location.hash || ''); if (h && tasks.some((t) => t.id === h[1])) select(h[1], true); });
  }
  init();
})();

// Конструктор скрыт с главной; открывается только по прямой ссылке /#builder
(function () { function show() { if (location.hash === '#builder') { const b = document.getElementById('builder'); if (b) { b.hidden = false; b.scrollIntoView(); } } } show(); window.addEventListener('hashchange', show); })();
