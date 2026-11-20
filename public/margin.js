/* Калькулятор маржинальности: всё считается в браузере, ничего не отправляется. */
(function () {
  'use strict';
  var f = document.getElementById('mcalc'); if (!f) return;
  var $ = function (id) { return document.getElementById(id); };
  var num = function (n) { var v = parseFloat(String(f.elements[n].value).replace(',', '.').replace(/\s/g, '')); return isFinite(v) ? v : 0; };
  var rub = function (v) { return (v < 0 ? '−' : '') + (Math.round(Math.abs(v) * 100) / 100).toLocaleString('ru-RU') + ' ₽'; };
  var pct = function (v) { return (Math.round(v * 10) / 10).toLocaleString('ru-RU') + ' %'; };
  var used = false;
  function calc() {
    var C = num('cost'), P = num('price'), wm = num('wm'), wk = num('wk'), pr = P - C;
    var b = $('rProfit'); b.textContent = rub(pr); b.classList.toggle('neg', pr < 0);
    $('rMargin').textContent = P > 0 ? pct(pr / P * 100) : '—';
    $('rMarkup').textContent = C > 0 ? pct(pr / C * 100) : '—';
    $('rWm').textContent = wm < 100 && C > 0 ? rub(C / (1 - wm / 100)) : '—';
    $('rWk').textContent = C > 0 ? rub(C * (1 + wk / 100)) : '—';
  }
  f.addEventListener('input', function () { calc(); if (!used) { used = true; try { if (typeof window.spGoal === 'function') window.spGoal('calc_use'); } catch (e) { /* без аналитики */ } } });
  calc();
})();
