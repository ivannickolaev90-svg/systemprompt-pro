/* SystemPrompt PRO — клиентская часть.
   Важно: здесь нет ни шаблонов промптов, ни проверки оплаты. Промпт собирается на сервере (/api/generate),
   лимиты считает сервер, а PRO-доступ подтверждается подписанной лицензией после уведомления ЮMoney. */
(function () {
  'use strict';

  /* ================= НАСТРОЙКИ ================= */
  // 🔧 Вставь ссылку на свой Telegram-канал
  const TELEGRAM_URL = 'https://t.me/your_channel';
  const KEY_LICENSE = 'systemprompt_license';
  const KEY_ORDER = 'systemprompt_order';

  /* ================= ХРАНИЛИЩЕ ================= */
  const mem = {};
  function storeGet(k) { try { const v = localStorage.getItem(k); return v !== null ? v : (mem[k] || null); } catch (e) { return mem[k] || null; } }
  function storeSet(k, v) { mem[k] = String(v); try { localStorage.setItem(k, String(v)); } catch (e) { /* только в памяти */ } }
  function storeDel(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  // Старые ключи клиентской «оплаты» больше ничего не значат — убираем
  ['systemprompt_pro_status', 'systemprompt_free_tokens', 'spp_pro_unlocked'].forEach(storeDel);

  /* ================= СОСТОЯНИЕ ================= */
  const state = { pro: false, tokensLeft: null, freePerDay: 3, statusLoaded: false };
  const ORDER_RE = /^[a-f0-9]{32}$/;

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
    form: $('builderForm'), role: $('role'), tone: $('tone'),
    taskContext: $('taskContext'), taskCounter: $('taskCounter'),
    fmtCode: $('fmtCode'), fmtNoFluff: $('fmtNoFluff'),
    protection: $('protection'), mdTables: $('mdTables'),
    output: $('output'), outputStatus: $('outputStatus'), stats: $('stats'),
    staleHint: $('staleHint'), staleRegen: $('staleRegen'),
    generateBtn: $('generateBtn'), generateLabel: $('generateLabel'),
    copyBtn: $('copyBtn'), resetBtn: $('resetBtn'), headerProBtn: $('headerProBtn'),
    proRolesGroup: $('proRolesGroup'),
    modal: $('proModal'), modalReason: $('modalReason'),
    payForm: $('payForm'), payBtn: $('payBtn'), payLabel: $('payLabel'), paySpinner: $('paySpinner'),
    formLabel: $('formLabel'), successUrl: $('formSuccessUrl'),
    restoreBox: $('restoreBox'), restoreForm: $('restoreForm'), restoreCode: $('restoreCode'),
    restoreBtn: $('restoreBtn'), restoreMsg: $('restoreMsg'),
    toast: $('toast'), toastText: $('toastText'), toastIcon: $('toastIcon')
  };

  /* ================= НАСТРОЙКИ ПРОМПТА ================= */
  function getSettings() {
    return {
      role: els.role.value,
      tone: els.tone.value,
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
  let typingFrame = null;
  let busy = false;

  const STATUS = {
    ready: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    typing: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    done: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
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
  const doneLabel = () => (state.pro ? 'live' : 'generated');

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stopTyping() {
    if (typingFrame) { cancelAnimationFrame(typingFrame); typingFrame = null; }
    els.output.classList.remove('is-typing');
  }

  function typeOut(text, done) {
    stopTyping();
    const finish = () => {
      els.output.value = text;
      els.output.scrollTop = 0;
      stopTyping();
      els.output.classList.add('is-live');
      setStatus(doneLabel(), STATUS.done);
      if (done) done();
    };
    if (reducedMotion) { finish(); return; }
    const duration = Math.min(1800, 500 + text.length * 0.9);
    const start = performance.now();
    els.output.classList.add('is-typing');
    els.output.classList.remove('is-live');
    setStatus('typing…', STATUS.typing);
    function step(now) {
      const p = Math.min(1, (now - start) / duration);
      const n = Math.floor(text.length * (1 - Math.pow(1 - p, 2)));
      els.output.value = text.slice(0, n) + (p < 1 ? '▌' : '');
      els.output.scrollTop = els.output.scrollHeight;
      if (p < 1) typingFrame = requestAnimationFrame(step);
      else { typingFrame = null; finish(); }
    }
    typingFrame = requestAnimationFrame(step);
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

    els.generateLabel.textContent = (!pro && left === 0) ? 'Открыть PRO — 190 ₽ навсегда 🔓' : 'Сгенерировать промпт ⚡';
    els.proRolesGroup.label = pro ? 'PRO-роли ⚡' : 'PRO-роли 🔒';
    els.proRolesGroup.querySelectorAll('option').forEach((o) => { o.textContent = (pro ? '' : '🔒 ') + o.dataset.label; });
    els.headerProBtn.textContent = pro ? 'PRO ⚡' : 'PRO ✨';
  }

  async function refreshStatus() {
    try {
      const { status, data } = await api('/api/status');
      if (status !== 200) throw new Error('status ' + status);
      if (data.licenseInvalid) storeDel(KEY_LICENSE);
      state.pro = data.pro === true;
      state.tokensLeft = state.pro ? null : (typeof data.tokensLeft === 'number' ? data.tokensLeft : null);
      if (typeof data.freePerDay === 'number') state.freePerDay = data.freePerDay;
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
    setBusy(true);
    setStatus('…', STATUS.typing);
    try {
      const { status, data } = await api('/api/generate', { method: 'POST', body: { settings: getSettings() } });
      if (status === 200 && typeof data.prompt === 'string') {
        if (data.pro === false && typeof data.tokensLeft === 'number') state.tokensLeft = data.tokensLeft;
        if (data.pro === true) state.pro = true;
        updateStatusUI();
        generatedText = data.prompt;
        generatedKey = key;
        showStale(false);
        setStats(generatedText);
        typeOut(generatedText, () => {
          setBusy(false);
          if (!state.pro) {
            if (state.tokensLeft === 0) showToast('Это была последняя бесплатная генерация на сегодня. Откройте PRO для безлимита ⚡', 3800, 'warn');
            else showToast('Промпт готов! Осталось бесплатных генераций: ' + state.tokensLeft + '/' + state.freePerDay, 2600);
          }
        });
        return;
      }
      setBusy(false);
      handleApiError(status, data);
    } catch (e) {
      setBusy(false);
      setStatus(generatedText ? doneLabel() : 'ready', generatedText ? STATUS.done : STATUS.ready);
      showToast('Нет связи с сервером. Проверьте интернет и попробуйте снова', 3000, 'warn');
    }
  }

  function handleApiError(status, data) {
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
      const { status, data } = await api('/api/generate', { method: 'POST', body: { settings: getSettings() } });
      if (seq !== liveSeq) return; // пришёл устаревший ответ
      if (status === 200 && typeof data.prompt === 'string') {
        stopTyping();
        generatedText = data.prompt;
        generatedKey = key;
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

  // PRO-роли: без доступа мягко предлагаем PRO (сервер всё равно проверит)
  let lastRoleIndex = els.role.selectedIndex;
  els.role.addEventListener('change', () => {
    const opt = els.role.options[els.role.selectedIndex];
    if (opt && opt.hasAttribute('data-pro') && !state.pro) {
      els.role.selectedIndex = lastRoleIndex;
      onSettingsChange();
      showToast('Эта роль доступна в PRO 🔒', 2200, 'warn');
      const name = (opt.dataset.label || '').split(' (')[0];
      setTimeout(() => openModal('Роль «' + name + '» доступна в PRO'), 350);
      return;
    }
    lastRoleIndex = els.role.selectedIndex;
  });

  els.protection.addEventListener('change', () => {
    if (els.protection.checked && !state.pro) {
      els.protection.checked = false;
      onSettingsChange();
      openModal('Защита от взлома доступна в PRO');
    }
  });

  els.resetBtn.addEventListener('click', () => {
    els.role.selectedIndex = 0; lastRoleIndex = 0;
    els.tone.selectedIndex = 0;
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

  const copyLabelText = els.copyBtn.textContent.trim();
  let copyTimer;
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
      els.copyBtn.textContent = 'Скопировано! ✅';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { els.copyBtn.textContent = copyLabelText; }, 1800);
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
    els.payLabel.classList.remove('hidden');
    els.paySpinner.classList.add('hidden');
    els.paySpinner.classList.remove('inline-flex');
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
    els.payBtn.disabled = true;
    els.payLabel.classList.add('hidden');
    els.paySpinner.classList.remove('hidden');
    els.paySpinner.classList.add('inline-flex');
    try {
      const { status, data } = await api('/api/order', { method: 'POST', body: {} });
      if (status !== 200 || !ORDER_RE.test(data.orderId || '')) throw new Error('order ' + status);
      storeSet(KEY_ORDER, data.orderId);
      els.formLabel.value = data.label;
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
    await refreshStatus();
    closeModal();
    showToast('Оплата подтверждена! PRO активирован навсегда ⚡ Код доступа: ' + orderId, 6000);
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
      underpaid: 'Сумма платежа меньше 190 ₽. Напишите нам в Telegram.',
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
  document.querySelectorAll('[data-telegram]').forEach((a) => {
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
