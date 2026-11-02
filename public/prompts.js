// Кнопка «Скопировать» на страницах готовых промптов
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const el = document.querySelector(btn.getAttribute('data-copy'));
    if (!el) return;
    const text = el.textContent;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
    } catch (e) { /* запасной способ ниже */ }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = ok ? 'Скопировано ✓' : 'Выделите и скопируйте вручную';
    setTimeout(() => { btn.textContent = old; }, 2000);
  });
});
