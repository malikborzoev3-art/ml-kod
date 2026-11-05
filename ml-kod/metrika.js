// Яндекс.Метрика. Вставьте номер счётчика в ID (число из кабинета metrika.yandex.ru). Пока ID = 0, ничего не загружается.
// Номер счётчика публичный (виден в любом сайте с Метрикой), прятать его бессмысленно; скрипт вынесен из index.html в этот файл.
(function(){
  var ID = 0;
  if (!ID || location.protocol === 'file:' || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;   // уважаем «Не отслеживать»
  window.mlGoal = function(n){ try { window.ym && window.ym(ID, 'reachGoal', n); } catch (_) {} };   // цели: mlGoal('shot_png')
  function go(){
    (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();
    k=e.createElement(t);a=e.getElementsByTagName(t)[0];k.async=1;k.src=r;a.parentNode.insertBefore(k,a)})
    (window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');
    // webvisor и карта кликов выключены: на сайте работают ученики, а записи экрана захватили бы их код и имена.
    // defer + ручной hit: в Метрику уходит адрес БЕЗ #g=... (в ссылке «Поделиться» зашит чужой код).
    window.ym(ID, 'init', { defer: true, clickmap: false, trackLinks: false, accurateTrackBounce: true, webvisor: false, trackHash: false });
    window.ym(ID, 'hit', location.origin + location.pathname, { referrer: document.referrer });
  }
  if (document.readyState === 'complete') setTimeout(go, 1500); else addEventListener('load', function(){ setTimeout(go, 1500); });
})();
