/* Яндекс Метрика.
   🔧 Чтобы включить: впиши номер счётчика в METRIKA_ID (только цифры) и залей сайт.
   Пока номер пустой, ничего не загружается и никакие данные не собираются. */
(function () {
  'use strict';
  var METRIKA_ID = '';

  window.spGoal = function () {};
  if (!/^\d{5,12}$/.test(METRIKA_ID)) return;
  var id = Number(METRIKA_ID);

  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(s);

  window.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
  window.spGoal = function (name) { window.ym(id, 'reachGoal', name); };
})();
