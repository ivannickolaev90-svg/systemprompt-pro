/* SystemPrompt PRO — клиентская часть.
   Важно: здесь нет ни шаблонов промптов, ни проверки оплаты. Промпт собирается на сервере (/api/generate),
   лимиты считает сервер, а PRO-доступ подтверждается подписанной лицензией после уведомления ЮMoney. */
(function () {
  'use strict';

  /* ================= НАСТРОЙКИ ================= */
  // 🔧 Вставь ссылку на свой Telegram-канал
  const TELEGRAM_URL = 'https://t.me/your_channel';
  const KEY_LICENSE = 'systemprompt_license';
  // Цели Яндекс Метрики (работают, только если в /metrika.js указан номер счётчика)
  const goal = (name) => { try { if (typeof window.spGoal === 'function') window.spGoal(name); } catch (e) { /* без аналитики */ } };
  const KEY_ORDER = 'systemprompt_order';

  /* ================= ХРАНИЛИЩЕ ================= */
  const mem = {};
  function storeGet(k) { try { const v = localStorage.getItem(k); return v !== null ? v : (mem[k] || null); } catch (e) { return mem[k] || null; } }
  function storeSet(k, v) { mem[k] = String(v); try { localStorage.setItem(k, String(v)); } catch (e) { /* только в памяти */ } }
  function storeDel(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  // Старые ключи клиентской «оплаты» больше ничего не значат — убираем
  ['systemprompt_pro_status', 'systemprompt_free_tokens', 'spp_pro_unlocked'].forEach(storeDel);

  /* ================= СОСТОЯНИЕ ================= */
  const state = { pro: false, tokensLeft: null, freePerDay: 3, statusLoaded: false, aiOnline: false, aiLeft: null, aiDaily: null };
  const ORDER_RE = /^[a-f0-9]{32}$/;
  const OUTPUT_PLACEHOLDER = (document.getElementById('output') || {}).placeholder || '';

  /* ================= API ================= */
  async function api(path, opts) {
    opts = opts || {};
    const headers = { 'Accept': 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const lic = storeGet(KEY_LICENSE);
    if (lic) headers['Authorization'] = 'Bearer ' + lic;
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store'
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* пустой ответ */ }
    return { status: res.status, data };
  }

  /* ================= ЭЛЕМЕНТЫ ================= */
  const $ = (id) => document.getElementById(id);
  const els = {
    form: $('builderForm'), role: $('role'), tone: $('tone'), lang: $('lang'),
    taskContext: $('taskContext'), taskCounter: $('taskCounter'),
    fmtCode: $('fmtCode'), fmtNoFluff: $('fmtNoFluff'),
    protection: $('protection'), mdTables: $('mdTables'),
    output: null, outputStatus: $('outputStatus'), stats: $('stats'),
    staleHint: $('staleHint'), staleRegen: $('staleRegen'),
    generateBtn: $('generateBtn'), generateLabel: $('generateLabel'),
    copyBtn: $('copyBtn'), resetBtn: $('resetBtn'), headerProBtn: $('headerProBtn'),
    modal: $('proModal'), modalReason: $('modalReason'),
    payForm: $('payForm'), payBtn: $('payBtn'), payCardBtn: $('payCardBtn'), formSum: $('formSum'),
    formLabel: $('formLabel'), successUrl: $('formSuccessUrl'),
    restoreBox: $('restoreBox'), restoreForm: $('restoreForm'), restoreCode: $('restoreCode'),
    restoreBtn: $('restoreBtn'), restoreMsg: $('restoreMsg'), aiHint: $('aiHint'),
    toast: $('toast'), toastText: $('toastText'), toastIcon: $('toastIcon')
  };

  /* ================= ОКНО ВЫВОДА (документ) ================= */
  // Промпт отрисовывается как документ. Текст ИИ вставляется ТОЛЬКО через textContent — без innerHTML.
  const out = {
    area: $('output'), frame: $('outputFrame'), view: $('outputView'),
    empty: $('outputEmpty'), emptyText: $('outputEmptyText'), dots: document.querySelector('#outputEmpty .out-dots')
  };
  const EMPTY_TEXT = out.emptyText.textContent;
  let revealTimer = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  // Инлайн-разметка: `код` и **жирный**
  function appendInline(parent, text) {
    const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const t = m[0];
      if (t[0] === '`') parent.appendChild(el('code', 'font-mono text-[13px] px-1.5 py-0.5 rounded-md bg-zinc-800 text-indigo-200 border border-zinc-700/60', t.slice(1, -1)));
      else parent.appendChild(el('strong', 'font-semibold text-white', t.slice(2, -2)));
      last = m.index + t.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    return parent;
  }
  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  }

  function renderMarkdown(text) {
    const blocks = [];
    const lines = text.replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) { i++; continue; }

      if (t.startsWith('```')) {                       // блок кода
        const buf = []; i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
        i++;
        const pre = el('pre', 'my-4 p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 overflow-x-auto');
        pre.appendChild(el('code', 'font-mono text-[13px] leading-6 text-zinc-200', buf.join('\n')));
        blocks.push(pre); continue;
      }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(t))) {         // заголовки
        const lvl = m[1].length;
        let node;
        if (lvl === 1) {
          node = el('h2', 'text-xl sm:text-2xl font-bold tracking-tight text-white pb-3 mb-4 border-b border-zinc-800');
        } else if (lvl === 2) {
          node = el('h3', 'flex items-center gap-2.5 text-base sm:text-[17px] font-bold tracking-tight text-white mt-7 mb-2.5');
          node.appendChild(el('span', 'w-1 h-4 rounded-full bg-indigo-500 shrink-0'));
        } else {
          node = el('h4', 'text-[15px] font-semibold text-zinc-100 mt-5 mb-1.5');
        }
        appendInline(node, m[2].replace(/^#+\s*/, ''));
        blocks.push(node); i++; continue;
      }
      if (t.startsWith('|')) {                          // таблица
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
        const data = rows.filter((r) => !/^\|?\s*:?-{2,}/.test(r.trim().replace(/^\|/, '')));
        const wrap = el('div', 'my-4 overflow-x-auto rounded-xl border border-zinc-800');
        const table = el('table', 'w-full text-sm text-left');
        data.forEach((r, ri) => {
          const tr = el('tr', ri === 0 ? 'bg-zinc-800/60' : 'border-t border-zinc-800');
          splitRow(r).forEach((c) => tr.appendChild(appendInline(el(ri === 0 ? 'th' : 'td', ri === 0 ? 'px-3 py-2 font-semibold text-white' : 'px-3 py-2 text-zinc-300'), c)));
          table.appendChild(tr);
        });
        wrap.appendChild(table); blocks.push(wrap); continue;
      }
      if (/^[-*•]\s+/.test(t)) {                        // маркированный список
        const ul = el('ul', 'my-3 space-y-2');
        while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
          const li = el('li', 'flex gap-3');
          li.appendChild(el('span', 'mt-[11px] w-1.5 h-1.5 rounded-full bg-indigo-400/80 shrink-0'));
          li.appendChild(appendInline(el('span', 'min-w-0'), lines[i].trim().replace(/^[-*•]\s+/, '')));
          ul.appendChild(li); i++;
        }
        blocks.push(ul); continue;
      }
      if (/^\d+[.)]\s+/.test(t)) {                      // нумерованный список
        const ol = el('ol', 'my-3 space-y-2');
        let n = 1;
        while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
          const li = el('li', 'flex gap-3');
          li.appendChild(el('span', 'mt-0.5 w-6 h-6 rounded-md bg-zinc-800 text-zinc-300 text-xs font-semibold flex items-center justify-center shrink-0', String(n++)));
          li.appendChild(appendInline(el('span', 'min-w-0'), lines[i].trim().replace(/^\d+[.)]\s+/, '')));
          ol.appendChild(li); i++;
        }
        blocks.push(ol); continue;
      }
      const para = [];                                   // абзац
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||[-*•]\s|\d+[.)]\s)/.test(lines[i].trim())) para.push(lines[i++].trim());
      blocks.push(appendInline(el('p', 'my-3'), para.join(' ')));
    }
    return blocks;
  }

  function renderOutput(text, animate) {
    clearTimeout(revealTimer);
    out.view.textContent = '';
    const has = !!(text && text.trim());
    out.view.classList.toggle('hidden', !has);
    out.empty.classList.toggle('hidden', has);
    out.empty.classList.toggle('flex', !has);
    if (!has) return;
    const blocks = renderMarkdown(text);
    blocks.forEach((b) => { b.classList.add('out-block'); out.view.appendChild(b); });
    if (!animate || reducedMotion) { blocks.forEach((b) => b.classList.add('shown')); return; }
    // плавное появление блоков по очереди
    const step = Math.max(28, Math.min(70, 1100 / blocks.length));
    let k = 0;
    (function next() {
      if (k >= blocks.length) return;
      blocks[k++].classList.add('shown');
      revealTimer = setTimeout(next, step);
    })();
  }

  // Совместимый «фасад» вместо textarea: логика генерации продолжает работать с els.output
  els.output = {
    get value() { return out.area.value; },
    set value(v) { out.area.value = v; renderOutput(v, false); },
    get placeholder() { return out.emptyText.textContent; },
    set placeholder(v) {
      const txt = String(v || '').replace(/^\/\/\s?/gm, '');
      out.emptyText.textContent = txt || EMPTY_TEXT;
      out.area.placeholder = v;
    },
    classList: {
      add(c) { out.frame.classList.add(c); if (c === 'is-typing') { out.dots.classList.remove('hidden'); out.dots.classList.add('flex'); } },
      remove(c) { out.frame.classList.remove(c); if (c === 'is-typing') { out.dots.classList.add('hidden'); out.dots.classList.remove('flex'); } },
      contains(c) { return out.frame.classList.contains(c); }
    },
    get scrollTop() { return out.view.scrollTop; },
    set scrollTop(v) { out.view.scrollTop = v; },
    focus() { out.area.classList.remove('sr-only'); out.area.className = 'mt-3 w-full h-40 rounded-xl bg-zinc-950 border border-zinc-700 p-3 font-mono text-xs text-zinc-200'; out.area.focus(); },
    select() { out.area.select(); }
  };

  /* ================= НАСТРОЙКИ ПРОМПТА ================= */
  function getSettings() {
    return {
      role: els.role.value,
      tone: els.tone.value,
      lang: els.lang.value,
      task: els.taskContext.value,
      code: els.fmtCode.checked,
      noFluff: els.fmtNoFluff.checked,
      mdTables: els.mdTables.checked,
      protection: els.protection.checked
    };
  }
  const settingsKey = () => JSON.stringify(getSettings());

  /* ================= ВЫВОД ================= */
  let generatedText = '';
  let generatedKey = '';
  let generatedMode = 'template';
  let typingFrame = null;
  let busy = false;

  const STATUS = {
    ready: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    typing: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
    done: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    ai: 'bg-indigo-500/15 text-indigo-200 border-indigo-400/30',
    stale: 'bg-amber-500/10 text-amber-300 border-amber-500/30'
  };
  function setStatus(label, cls) {
    els.outputStatus.textContent = label;
    els.outputStatus.className = 'inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ' + cls;
  }
  function setStats(text) {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    els.stats.textContent = text.length + ' chars · ' + words + ' words';
  }
  const doneLabel = () => (generatedMode === 'ai' ? 'ai ✨' : state.pro ? 'live' : 'generated');

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stopTyping() {
    if (typingFrame) { clearTimeout(typingFrame); typingFrame = null; }
    els.output.classList.remove('is-typing');
  }

  // Плавное появление готового промпта (fade-in по блокам)
  function typeOut(text, done) {
    stopTyping();
    out.area.value = text;
    els.output.classList.add('is-live');
    renderOutput(text, true);
    out.view.scrollTop = 0;
    setStatus('…', STATUS.typing);
    const blocks = out.view.children.length || 1;
    const total = reducedMotion ? 0 : Math.min(1300, Math.max(28, Math.min(70, 1100 / blocks)) * blocks + 200);
    typingFrame = setTimeout(() => {
      typingFrame = null;
      setStatus(doneLabel(), generatedMode === 'ai' ? STATUS.ai : STATUS.done);
      if (done) done();
    }, total);
  }

  function showStale(show) {
    els.staleHint.classList.toggle('hidden', !show);
    els.staleHint.classList.toggle('flex', show);
    if (show) setStatus('changed', STATUS.stale);
    else if (generatedText) setStatus(doneLabel(), STATUS.done);
  }

  function setBusy(on) {
    busy = on;
    els.generateBtn.disabled = on;
  }

  /* ================= UI СТАТУСА ================= */
  function updateStatusUI() {
    const pro = state.pro;
    const left = state.tokensLeft;
    const max = state.freePerDay;
    document.body.classList.toggle('pro-unlocked', pro);

    let badgeCls, dotCls;
    if (pro) {
      badgeCls = 'border-emerald-500/40 bg-gradient-to-r from-indigo-600/20 to-emerald-500/20 text-emerald-300 shadow-[0_0_20px_-6px_rgba(52,211,153,.6)]';
      dotCls = 'bg-emerald-400';
    } else if (left === null) {
      badgeCls = 'border-zinc-700 bg-zinc-900 text-zinc-400'; dotCls = 'bg-zinc-500';
    } else if (left >= max) {
      badgeCls = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'; dotCls = 'bg-emerald-400';
    } else if (left === max - 1) {
      badgeCls = 'border-amber-500/40 bg-amber-500/10 text-amber-300'; dotCls = 'bg-amber-400';
    } else {
      badgeCls = 'border-red-500/40 bg-red-500/10 text-red-300'; dotCls = 'bg-red-400';
    }
    const countText = left === null ? '…' : left + '/' + max;

    document.querySelectorAll('[data-token-badge]').forEach((b) => {
      b.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold font-mono whitespace-nowrap transition-colors duration-300 ' + badgeCls;
      b.title = pro ? 'PRO-доступ активен' : 'Осталось бесплатных генераций сегодня: ' + countText;
    });
    document.querySelectorAll('[data-token-dot]').forEach((d) => { d.className = 'w-2 h-2 rounded-full animate-pulse-glow ' + dotCls; });
    document.querySelectorAll('[data-token-text]').forEach((t) => {
      t.textContent = '';
      if (pro) { t.textContent = 'PRO Активен ⚡'; return; }
      const long = document.createElement('span');
      long.className = 'hidden sm:inline font-sans';
      long.textContent = 'Осталось бесплатных генераций: ';
      t.appendChild(long);
      t.appendChild(document.createTextNode(countText));
    });
    document.querySelectorAll('[data-token-inline]').forEach((t) => {
      t.textContent = countText;
      t.className = 'font-mono font-semibold ' + (left === null ? 'text-zinc-400' : left >= max ? 'text-emerald-400' : left === max - 1 ? 'text-amber-400' : 'text-red-400');
    });

    els.generateLabel.textContent = (!pro && left === 0) ? 'Открыть PRO — от 99 ₽ 🔓' : 'Сгенерировать промпт ⚡';
    els.headerProBtn.textContent = pro ? 'PRO ⚡' : 'PRO ✨';
    updateAiHint();
  }

  function updateAiHint() {
    if (!els.aiHint) return;
    let text = '';
    if (state.statusLoaded) {
      if (!state.aiOnline) text = 'ИИ-адаптация временно недоступна — промпты собираются по шаблонам';
      else if (state.aiLeft === 0) text = state.pro ? 'ИИ-генерации на сегодня исчерпаны (' + state.aiDaily + '/сутки) — дальше шаблоны' : 'Пробная ИИ-генерация на сегодня использована. В PRO — 30 в сутки ✨';
      else if (!els.taskContext.value.trim()) text = '✨ Опишите нишу в поле 03 — ИИ адаптирует промпт под неё';
      else text = '✨ ИИ адаптирует промпт под вашу нишу' + (state.aiLeft !== null ? ' · осталось ' + state.aiLeft + '/' + state.aiDaily + ' сегодня' : '');
    }
    els.aiHint.textContent = text;
    els.aiHint.classList.toggle('hidden', !text);
  }

  async function refreshStatus() {
    try {
      const { status, data } = await api('/api/status');
      if (status !== 200) throw new Error('status ' + status);
      if (data.licenseInvalid) storeDel(KEY_LICENSE);
      // «Старт» — только готовые тексты; PRO-возможности конструктора — с тарифа PRO
      state.pro = data.pro === true && data.builderPro !== false;
      state.paid = data.pro === true;
      state.expiresAt = data.expiresAt || null;
      state.tokensLeft = state.pro ? null : (typeof data.tokensLeft === 'number' ? data.tokensLeft : null);
      if (typeof data.freePerDay === 'number') state.freePerDay = data.freePerDay;
      state.aiOnline = data.aiOnline === true;
      state.aiLeft = typeof data.aiLeft === 'number' ? data.aiLeft : null;
      state.aiDaily = typeof data.aiDaily === 'number' ? data.aiDaily : null;
      state.statusLoaded = true;
    } catch (e) {
      state.statusLoaded = false;
    }
    updateStatusUI();
  }

  /* ================= ГЕНЕРАЦИЯ ================= */
  async function generate() {
    if (busy || typingFrame) return;
    if (!state.pro && state.tokensLeft === 0) { openModal('Бесплатные генерации на сегодня закончились'); return; }

    const key = settingsKey();
    const aiLikely = state.aiOnline && state.aiLeft !== 0 && els.taskContext.value.trim().length > 0;
    setBusy(true);
    setStatus(aiLikely ? 'ai thinking…' : '…', STATUS.typing);
    if (aiLikely) {
      els.output.classList.add('is-typing');
      els.output.value = '';
      els.output.placeholder = '// ✨ ИИ изучает вашу нишу и пишет персональный промпт…\n// Обычно это занимает 5–15 секунд.';
    }
    try {
      const { status, data } = await api('/api/generate', { method: 'POST', body: { settings: getSettings(), ai: true } });
      els.output.placeholder = OUTPUT_PLACEHOLDER;
      if (status === 200 && typeof data.prompt === 'string') {
        if (data.pro === false && typeof data.tokensLeft === 'number') state.tokensLeft = data.tokensLeft;
        if (data.pro === true) state.pro = true;
        if (typeof data.aiLeft === 'number') state.aiLeft = data.aiLeft;
        if (typeof data.aiDaily === 'number') state.aiDaily = data.aiDaily;
        if (['budget', 'daily_cap', 'breaker', 'disabled', 'not_configured', 'error'].indexOf(data.reason) !== -1) state.aiOnline = false;
        updateStatusUI();
        generatedText = data.prompt;
        generatedKey = key;
        generatedMode = data.mode === 'ai' ? 'ai' : 'template';
        goal(generatedMode === 'ai' ? 'generate_ai' : 'generate');
        const modeNote = aiModeNote(data);
        showStale(false);
        setStats(generatedText);
        typeOut(generatedText, () => {
          setBusy(false);
          if (!state.pro) {
            if (state.tokensLeft === 0) showToast('Это была последняя бесплатная генерация на сегодня. Откройте PRO для безлимита ⚡', 3800, 'warn');
            else showToast((generatedMode === 'ai' ? '✨ ИИ-промпт под вашу нишу готов! ' : 'Промпт готов! ') + 'Осталось бесплатных генераций: ' + state.tokensLeft + '/' + state.freePerDay, 3000);
          } else if (modeNote) {
            showToast(modeNote, 3600, generatedMode === 'ai' ? '' : 'warn');
          }
        });
        return;
      }
      setBusy(false);
      handleApiError(status, data);
    } catch (e) {
      setBusy(false);
      els.output.placeholder = OUTPUT_PLACEHOLDER;
      els.output.classList.remove('is-typing');
      if (generatedText) els.output.value = generatedText;
      setStatus(generatedText ? doneLabel() : 'ready', generatedText ? STATUS.done : STATUS.ready);
      showToast('Нет связи с сервером. Проверьте интернет и попробуйте снова', 3000, 'warn');
    }
  }

  function aiModeNote(data) {
    if (data.mode === 'ai') return '✨ Промпт адаптирован ИИ под вашу нишу' + (typeof data.aiLeft === 'number' ? ' · осталось ' + data.aiLeft + '/' + data.aiDaily + ' сегодня' : '');
    const notes = {
      no_task: 'Опишите нишу в поле 03, чтобы ИИ адаптировал промпт под неё',
      user_limit: 'ИИ-генерации на сегодня исчерпаны — промпт собран по шаблону',
      budget: 'ИИ-режим временно на паузе — промпт собран по шаблону',
      daily_cap: 'ИИ-режим временно на паузе — промпт собран по шаблону',
      breaker: 'ИИ-режим временно на паузе — промпт собран по шаблону',
      disabled: 'ИИ-режим отключён — промпт собран по шаблону',
      not_configured: 'ИИ-режим недоступен — промпт собран по шаблону',
      error: 'ИИ не ответил — промпт собран по шаблону',
      bad_output: 'ИИ не справился — промпт собран по шаблону'
    };
    return notes[data.reason] || '';
  }

  function handleApiError(status, data) {
    els.output.classList.remove('is-typing');
    if (generatedText) els.output.value = generatedText;
    setStatus(generatedText ? doneLabel() : 'ready', generatedText ? STATUS.done : STATUS.ready);
    if (status === 402 && data.error === 'quota') {
      state.tokensLeft = 0; updateStatusUI();
      openModal('Бесплатные генерации на сегодня закончились');
    } else if (status === 402 && data.error === 'pro_required') {
      // Лицензия могла стать недействительной — обновим статус
      refreshStatus();
      openModal(data.reason === 'role' ? 'Эта роль доступна в PRO' : 'Защита от взлома доступна в PRO');
    } else if (status === 429) {
      showToast('Слишком много запросов. Подождите немного', 2800, 'warn');
    } else {
      showToast('Ошибка сервера. Попробуйте ещё раз через минуту', 3000, 'warn');
    }
  }

  // PRO: живой предпросмотр (с задержкой, чтобы не слать запрос на каждую букву)
  let liveTimer = null;
  let liveSeq = 0;
  async function liveUpdate() {
    const seq = ++liveSeq;
    const key = settingsKey();
    try {
      const { status, data } = await api('/api/generate', { method: 'POST', body: { settings: getSettings(), ai: false } });
      if (seq !== liveSeq) return; // пришёл устаревший ответ
      if (status === 200 && typeof data.prompt === 'string') {
        stopTyping();
        generatedText = data.prompt;
        generatedKey = key;
        generatedMode = 'template';
        els.output.value = generatedText;
        setStats(generatedText);
        showStale(false);
      } else {
        handleApiError(status, data);
      }
    } catch (e) { /* без сети — оставим предыдущий промпт */ }
  }

  function onSettingsChange() {
    els.taskCounter.textContent = els.taskContext.value.length + '/1000';
    updateAiHint();
    if (!generatedText) return;
    const changed = settingsKey() !== generatedKey;
    if (state.pro) {
      if (!changed) return;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(liveUpdate, 450);
    } else {
      showStale(changed);
    }
  }

  els.form.addEventListener('submit', (e) => e.preventDefault());
  els.form.addEventListener('input', onSettingsChange);
  els.form.addEventListener('change', onSettingsChange);
  els.generateBtn.addEventListener('click', generate);
  els.staleRegen.addEventListener('click', generate);

  els.protection.addEventListener('change', () => {
    if (els.protection.checked && !state.pro) {
      els.protection.checked = false;
      onSettingsChange();
      openModal('Защита от взлома доступна в PRO');
    }
  });

  els.resetBtn.addEventListener('click', () => {
    els.tone.selectedIndex = 0;
    els.lang.selectedIndex = 0;
    els.taskContext.value = '';
    els.fmtCode.checked = false;
    els.fmtNoFluff.checked = false;
    els.mdTables.checked = true;
    els.protection.checked = false;
    onSettingsChange();
    showToast('Настройки сброшены', 1800);
  });

  /* ================= КОПИРОВАНИЕ ================= */
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* запасной способ */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  const copyLabelEl = els.copyBtn.querySelector('[data-copy-label]') || els.copyBtn;
  const copyLabelText = copyLabelEl.textContent.trim();
  let copyTimer;
  // Поделиться ссылкой на сайт (системное меню на телефоне или копирование ссылки)
  const shareBtn = $('shareBtn');
  if (shareBtn) shareBtn.addEventListener('click', async () => {
    const url = 'https://systemprompt-pro.com/';
    const text = 'Конструктор системных промптов для ChatGPT, Claude и Telegram-ботов — собирает готовый промпт за 10 секунд, бесплатно';
    goal('share');
    try {
      if (navigator.share) { await navigator.share({ title: 'SystemPrompt PRO', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const ok = await copyText(url);
    showToast(ok ? 'Ссылка на сайт скопирована — отправьте её другу 🙌' : url, 3000);
  });

  els.copyBtn.addEventListener('click', async () => {
    if (!generatedText) {
      if (!state.pro && state.tokensLeft === 0) { openModal('Бесплатные генерации на сегодня закончились'); return; }
      els.generateBtn.classList.remove('shake'); void els.generateBtn.offsetWidth; els.generateBtn.classList.add('shake');
      showToast('Сначала нажмите «Сгенерировать промпт ⚡»', 2200, 'warn');
      return;
    }
    if (typingFrame) { stopTyping(); els.output.value = generatedText; setStatus(doneLabel(), STATUS.done); }
    const ok = await copyText(generatedText);
    if (ok) {
      copyLabelEl.textContent = 'Скопировано! ✅';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copyLabelEl.textContent = copyLabelText; }, 1800);
      showToast('Скопировано!', 1800);
    } else {
      els.output.focus(); els.output.select();
      showToast('Выделено — нажмите Ctrl+C', 2400, 'warn');
    }
  });

  /* ================= ТОСТ ================= */
  let toastTimer;
  function showToast(msg, duration, kind) {
    const warn = kind === 'warn';
    els.toastText.textContent = msg;
    els.toastIcon.textContent = warn ? '!' : '✓';
    els.toastIcon.className = 'w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-zinc-950 font-bold text-sm ' + (warn ? 'bg-amber-400' : 'bg-emerald-500');
    els.toast.firstElementChild.className = 'flex items-center gap-3 px-5 py-3.5 rounded-xl bg-zinc-900 border shadow-2xl ' + (warn ? 'border-amber-500/50 shadow-amber-500/20' : 'border-emerald-500/50 shadow-emerald-500/20');
    els.toast.classList.remove('translate-y-24', 'opacity-0');
    els.toast.classList.add('translate-y-0', 'opacity-100');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.add('translate-y-24', 'opacity-0');
      els.toast.classList.remove('translate-y-0', 'opacity-100');
    }, duration || 2200);
  }

  /* ================= МОДАЛКА ОПЛАТЫ ================= */
  let lastFocused = null;
  function openModal(reason, opts) {
    opts = opts || {};
    goal('open_pro');
    if (state.pro && !opts.force && reason === 'improve') {
      if (!els.taskContext.value.trim()) {
        els.taskContext.focus();
        showToast('Опишите нишу в поле 03 — и ИИ адаптирует промпт под неё ✨', 3200, 'warn');
      } else {
        generate();
      }
      return;
    }
    if (state.pro && !opts.force) {
      const order = storeGet(KEY_ORDER);
      showToast(reason === 'improve'
        ? 'У вас PRO ⚡ ИИ-оптимизатор появится в ближайшем обновлении'
        : 'PRO активен ⚡' + (order ? ' Код доступа: ' + order : ''), 4200);
      return;
    }
    lastFocused = document.activeElement;
    const text = reason && reason !== 'improve' ? reason : '';
    els.modalReason.textContent = text ? '⚠ ' + text : '';
    els.modalReason.classList.toggle('hidden', !text);
    resetPayButton();
    if (opts.restore) {
      els.restoreBox.open = true;
      if (opts.code) els.restoreCode.value = opts.code;
    }
    els.modal.classList.remove('hidden');
    els.modal.classList.add('flex');
    const card = els.modal.querySelector('.modal-enter');
    card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
    document.body.style.overflow = 'hidden';
    (opts.restore ? els.restoreBtn : els.payBtn).focus();
  }
  function closeModal() {
    els.modal.classList.add('hidden');
    els.modal.classList.remove('flex');
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }
  function resetPayButton() {
    els.payBtn.disabled = false;
    els.payCardBtn.disabled = false;
    els.payBtn.textContent = 'По СБП ⚡';
    els.payCardBtn.textContent = 'Картой 💳';
  }

  document.querySelectorAll('[data-open-pro]').forEach((b) => {
    b.addEventListener('click', () => openModal(b.dataset.reason || ''));
  });
  els.modal.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) closeModal();
  });

  // Оплата: сначала сервер создаёт заказ с уникальной меткой, затем уходим на ЮMoney
  els.payForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (els.payBtn.disabled) return;
    const method = (e.submitter && e.submitter.dataset.method) || 'sbp';
    const checked = document.querySelector('#planList input[name="plan"]:checked');
    const plan = checked ? checked.value : 'pro';
    goal('pay_click');
    els.payBtn.disabled = true;
    els.payCardBtn.disabled = true;
    (method === 'card' ? els.payCardBtn : els.payBtn).textContent = 'Создаём заказ…';
    try {
      const { status, data } = await api('/api/order', { method: 'POST', body: { plan, method, renew: storeGet(KEY_LICENSE) || '' } });
      if (status === 409) { resetPayButton(); showToast('Пробный тариф уже был использован — выберите другой', 3500, 'warn'); return; }
      if (status !== 200 || !ORDER_RE.test(data.orderId || '')) throw new Error('order ' + status);
      storeSet(KEY_ORDER, data.orderId);
      // ЮKassa: СБП, SberPay, T-Pay, карта — переходим на страницу оплаты
      if (typeof data.payUrl === 'string' && /^https:\/\/yoomoney\.ru\//.test(data.payUrl)) {
        window.location.href = data.payUrl;
        return;
      }
      els.formLabel.value = data.label;
      if (typeof data.sum === 'number') els.formSum.value = String(data.sum);
      els.successUrl.value = window.location.origin + window.location.pathname + '?pay=success&order=' + data.orderId;
      els.payForm.submit(); // программная отправка не вызывает submit-обработчик повторно
    } catch (err) {
      resetPayButton();
      showToast(status429(err) ? 'Слишком много попыток. Подождите немного' : 'Не удалось создать заказ. Попробуйте ещё раз', 3200, 'warn');
    }
  });
  const status429 = (err) => String(err && err.message).indexOf('429') !== -1;
  window.addEventListener('pageshow', resetPayButton);

  /* ================= ПОДТВЕРЖДЕНИЕ ОПЛАТЫ ================= */
  function setRestoreMsg(text, kind) {
    els.restoreMsg.textContent = text;
    els.restoreMsg.className = 'text-xs leading-relaxed ' + (kind === 'ok' ? 'text-emerald-400' : kind === 'warn' ? 'text-amber-300' : 'text-zinc-400');
    els.restoreMsg.classList.toggle('hidden', !text);
  }

  // Одна проверка: 'paid' | 'pending' | 'underpaid' | 'not_found' | 'error' | ...
  async function claimOnce(orderId) {
    try {
      const { status, data } = await api('/api/claim', { method: 'POST', body: { orderId } });
      if (status === 200 && data.license) {
        storeSet(KEY_LICENSE, data.license);
        storeSet(KEY_ORDER, orderId);
        return 'paid';
      }
      if (status === 202) return 'pending';
      if (status === 402) return 'underpaid';
      if (status === 404) return 'not_found';
      if (status === 403) return data.error || 'forbidden';
      if (status === 429) return 'rate_limited';
      return 'error';
    } catch (e) { return 'error'; }
  }

  async function onPaid(orderId) {
    goal('paid');
    await refreshStatus();
    closeModal();
    showToast('Оплата подтверждена! Доступ активирован' + (state.expiresAt ? ' до ' + new Date(state.expiresAt).toLocaleDateString('ru-RU') : '') + ' ⚡ Код доступа: ' + orderId, 6000);
    if (generatedText) liveUpdate();
  }

  // После возврата с ЮMoney ждём подписанное уведомление (обычно приходит за несколько секунд)
  async function verifyAfterReturn(orderId) {
    showToast('Проверяем оплату…', 60000);
    for (let i = 0; i < 20; i++) {
      const r = await claimOnce(orderId);
      if (r === 'paid') { await onPaid(orderId); return; }
      if (r !== 'pending' && r !== 'error') break;
      await new Promise((res) => setTimeout(res, 3000));
    }
    showToast('Платёж ещё не подтверждён', 3000, 'warn');
    openModal('Ждём подтверждение от ЮMoney', { restore: true, code: orderId, force: true });
    setRestoreMsg('Если вы оплатили, нажмите «Проверить оплату» через минуту. Сохраните код заказа: ' + orderId, 'warn');
  }

  els.restoreForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = els.restoreCode.value.trim().toLowerCase();
    if (!ORDER_RE.test(code)) { setRestoreMsg('Код заказа — 32 символа (цифры и буквы a–f).', 'warn'); return; }
    els.restoreBtn.disabled = true;
    setRestoreMsg('Проверяем…');
    const r = await claimOnce(code);
    els.restoreBtn.disabled = false;
    const messages = {
      pending: 'Оплата по этому заказу ещё не поступила. Если вы только что оплатили — подождите минуту и проверьте снова.',
      underpaid: 'Сумма платежа меньше цены тарифа. Позвоните нам: +7 981 717-18-14.',
      not_found: 'Заказ не найден. Проверьте код.',
      device_limit: 'Превышен лимит устройств для этого заказа. Напишите нам в Telegram.',
      revoked: 'Доступ по этому заказу отозван.',
      rate_limited: 'Слишком много попыток. Подождите немного.',
      error: 'Нет связи с сервером. Попробуйте ещё раз.'
    };
    if (r === 'paid') { setRestoreMsg('Доступ восстановлен ⚡', 'ok'); await onPaid(code); return; }
    setRestoreMsg(messages[r] || messages.error, 'warn');
  });

  /* ================= TELEGRAM ================= */
  // Пока канал не указан, ссылки на Telegram скрыты, чтобы не вести посетителей в никуда
  const telegramReady = /^https:\/\/t\.me\/[A-Za-z0-9_]{4,}$/.test(TELEGRAM_URL) && TELEGRAM_URL.indexOf('your_channel') === -1;
  document.querySelectorAll('[data-telegram]').forEach((a) => {
    if (!telegramReady) { a.classList.add('hidden'); return; }
    a.href = TELEGRAM_URL; a.target = '_blank'; a.rel = 'noopener noreferrer';
  });

  /* ================= СТАРТ ================= */
  async function init() {
    $('year').textContent = new Date().getFullYear();
    els.taskCounter.textContent = '0/1000';
    updateStatusUI();

    const params = new URLSearchParams(window.location.search);
    let returnedOrder = null;
    if (params.get('pay') === 'success') {
      const fromUrl = (params.get('order') || '').toLowerCase();
      returnedOrder = ORDER_RE.test(fromUrl) ? fromUrl : storeGet(KEY_ORDER);
      params.delete('pay'); params.delete('order');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    }

    await refreshStatus();
    if (!state.statusLoaded) showToast('Не удалось связаться с сервером. Обновите страницу', 4000, 'warn');

    if (returnedOrder && ORDER_RE.test(returnedOrder) && !state.pro) verifyAfterReturn(returnedOrder);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
