/* Калькулятор продавца: всё считается в браузере, ничего не отправляется. */
(function () {
  'use strict';
  var f = document.getElementById('calc'); if (!f) return;
  var $ = function (id) { return document.getElementById(id); };
  var HINTS = { wb: 'смотрите в кабинете WB: «Тарифы» → комиссия по вашей категории', ozon: 'смотрите в кабинете Ozon: раздел с тарифами и комиссиями по категориям', ym: 'смотрите в кабинете Маркета: «Тарифы» → комиссия за размещение по категории', other: 'комиссия площадки за продажу в вашей категории' };
  var num = function (n) { var v = parseFloat(String(f.elements[n].value).replace(',', '.').replace(/\s/g, '')); return isFinite(v) ? v : 0; };
  var rub = function (v) { return (v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('ru-RU') + ' ₽'; };
  var pct = function (v) { return (Math.round(v * 10) / 10).toLocaleString('ru-RU') + ' %'; };
  var used = false;
  function calc() {
    var P = num('price'), C = num('cost'), com = num('com') / 100, L = num('log'), B = num('back'), S = num('store'), ads = num('ads') / 100, tax = num('tax') / 100, want = num('want') / 100;
    var buy = Math.min(Math.max(num('buy'), 1), 100) / 100;
    var ret = (1 - buy) / buy * (L + B);           // потери на невыкупах, на одну проданную штуку
    var fixed = C + L + S + ret;                    // расходы в рублях
    var share = com + ads + tax;                    // расходы в % от цены
    var profit = P - fixed - P * share;
    $('rProfit').textContent = rub(profit);
    $('rProfit').classList.toggle('neg', profit < 0);
    $('rMargin').textContent = P > 0 ? pct(profit / P * 100) : '—';
    $('rRoi').textContent = C > 0 ? pct(profit / C * 100) : '—';
    $('rZero').textContent = share < 1 ? rub(fixed / (1 - share)) : 'не получится';
    $('rWant').textContent = share + want < 1 ? rub(fixed / (1 - share - want)) : 'не получится';
    var parts = [['Себестоимость', C], ['Комиссия площадки', P * com], ['Логистика', L], ['Невыкупы (логистика туда и обратно)', ret], ['Хранение и приёмка', S], ['Реклама', P * ads], ['Налог', P * tax]];
    var box = $('rParts'); box.textContent = '';
    parts.forEach(function (p) { var r = document.createElement('p'); var a = document.createElement('span'); a.textContent = p[0]; var b = document.createElement('b'); b.textContent = rub(p[1]); r.appendChild(a); r.appendChild(b); box.appendChild(r); });
    var w = $('rWarn');
    if (profit < 0) { w.hidden = false; w.textContent = 'Каждая продажа в минус. Поднимите цену хотя бы до ' + $('rZero').textContent + ' или снизьте расходы.'; }
    else if (P > 0 && profit / P < 0.1) { w.hidden = false; w.textContent = 'Маржа меньше 10 % — любой рост логистики или скидка съедят прибыль.'; }
    else w.hidden = true;
  }
  f.addEventListener('input', function () { calc(); if (!used) { used = true; try { if (typeof window.spGoal === 'function') window.spGoal('calc_use'); } catch (e) { /* без аналитики */ } } });
  f.addEventListener('submit', function (e) { e.preventDefault(); });
  f.querySelectorAll('.mp-b').forEach(function (b) {
    b.addEventListener('click', function () {
      f.querySelectorAll('.mp-b').forEach(function (x) { x.classList.toggle('on', x === b); });
      $('hintCom').textContent = HINTS[b.dataset.mp] || HINTS.other;
    });
  });
  calc();
})();
