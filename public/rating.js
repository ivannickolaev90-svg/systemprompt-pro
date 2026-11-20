/* Калькулятор рейтинга: всё считается в браузере, ничего не отправляется. */
(function () {
  'use strict';
  var f = document.getElementById('rcalc'); if (!f) return;
  var $ = function (id) { return document.getElementById(id); };
  var num = function (n) { var v = parseFloat(String(f.elements[n].value).replace(',', '.').replace(/\s/g, '')); return isFinite(v) ? v : 0; };
  var r2 = function (v) { return (Math.round(v * 100) / 100).toLocaleString('ru-RU'); };
  var cnt = function (v) { return Math.max(0, v).toLocaleString('ru-RU'); };
  var used = false;
  function calc() {
    var R = Math.min(5, Math.max(1, num('cur'))), N = Math.max(0, Math.round(num('n'))), T = num('want');
    var sum = R * N, w = $('rWarn'); w.hidden = true;
    if (T <= R) { $('rNeed').textContent = '0 — уже есть'; }
    else if (T >= 5) { $('rNeed').textContent = 'недостижимо'; w.textContent = 'Ровно 5,0 бывает, только если все оценки пятёрки. Поставьте цель, например, 4,8 или 4,9.'; w.hidden = false; }
    else { $('rNeed').textContent = cnt(Math.ceil((T * N - sum) / (5 - T) - 1e-9)) + ' шт.'; }
    var one = N ? (sum + 1) / (N + 1) : 1;
    $('rOne').textContent = r2(one) + ' (−' + r2(R - one) + ')';
    $('rBack').textContent = R >= 5 ? '—' : cnt(Math.ceil((R - 1) / (5 - R) - 1e-9)) + ' шт.';
    $('rFive').textContent = r2(N ? (sum + 50) / (N + 10) : 5);
  }
  f.addEventListener('input', function () { calc(); if (!used) { used = true; try { if (typeof window.spGoal === 'function') window.spGoal('calc_use'); } catch (e) { /* без аналитики */ } } });
  calc();
})();
