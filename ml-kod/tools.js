// Инструменты: журнал ошибок и самопроверка, горячие клавиши, история версий с откатом, индикатор «Сохранено»,
// переход к строке по клику в сообщении об ошибке, переключатель переноса строк, подсветка «стекла» под курсором.
// Использует глобальные tabs, ai, switchTab, say, PYACT из app.js; CodeMirror берёт из window.cmView (его создаёт cm.js).
(function(){
  const $ = id => document.getElementById(id);
  const ta = $('code');
  const h = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const lsPut = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
  const toast = t => { try { say(t); } catch (_) {} };

  // ---------- окно ----------
  let openM = null;
  function closeModal(){ if (openM) { openM.remove(); openM = null; } }
  function modal(title, html, wide){
    closeModal();
    const o = document.createElement('div'); o.className = 'mlm';
    o.innerHTML = '<div class="mlb' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + h(title) + '"><div class="mlh"><h3>' + h(title) + '</h3><button class="mlx" data-close aria-label="Закрыть">×</button></div><div class="mlc">' + html + '</div></div>';
    o.addEventListener('mousedown', e => { if (e.target === o) closeModal(); });
    o.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    document.body.appendChild(o); openM = o;
    return o;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openM) { e.preventDefault(); e.stopPropagation(); closeModal(); } }, true);

  // ---------- пункты меню ----------
  window.toolsMenu = function(){
    const wrap = window.mlWrapState ? window.mlWrapState() : false;
    return '<div class="mi" data-a="hist">История версий…</div>' +
      '<div class="mi" data-a="wrap">Перенос длинных строк <span class="mut">' + (window.mlWrap ? (wrap ? 'вкл' : 'выкл') : 'недоступно') + '</span></div>' +
      '<div class="mi" data-a="keys">Горячие клавиши <span class="mut">F1</span></div>' +
      '<div class="mi" data-a="diag">Журнал ошибок и самопроверка</div>';
  };
  function addAct(k, f){ try { PYACT[k] = f; } catch (_) {} }

  // ---------- переносы строк ----------
  addAct('wrap', () => {
    if (!window.mlWrap) { toast('Перенос строк работает в CodeMirror (он не загрузился)'); return; }
    toast('Перенос строк: ' + (window.mlWrap() ? 'включён' : 'выключен'));
  });

  // ---------- горячие клавиши ----------
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const K = s => s.replace(/Ctrl/g, mac ? '⌘' : 'Ctrl').replace(/Alt/g, mac ? '⌥' : 'Alt');
  const KEYS = [
    ['Запуск и файлы', [['Ctrl+Enter', 'Запустить код'], ['Ctrl+S', 'Скачать текущий файл'], ['F1', 'Это окно'], ['Esc', 'Закрыть окно; выйти из редактора, затем Tab']]],
    ['Правка', [['Ctrl+Z', 'Отменить'], ['Ctrl+Shift+Z', 'Повторить (также Ctrl+Y)'], ['Ctrl+/', 'Закомментировать / раскомментировать строки'], ['Tab / Shift+Tab', 'Сдвинуть строки вправо / влево'], ['Alt+↑ / Alt+↓', 'Переместить строку'], ['Shift+Alt+↑ / ↓', 'Скопировать строку'], ['Ctrl+Shift+K', 'Удалить строку'], ['Ctrl+A', 'Выделить всё']]],
    ['Поиск и выделение', [['Ctrl+F', 'Поиск и замена'], ['Ctrl+G', 'Следующее совпадение'], ['Ctrl+D', 'Выделить следующее такое же слово'], ['Alt + мышь', 'Прямоугольное выделение']]],
    ['Код', [['Ctrl+Space', 'Показать подсказки'], ['Ctrl+Shift+[ / ]', 'Свернуть / развернуть блок'], ['Ctrl+Shift+\\', 'К парной скобке'], ['! затем Tab', 'Шаблон страницы в HTML']]]
  ];
  function openKeys(){
    modal('Горячие клавиши', KEYS.map(([t, rows]) => '<div class="kh">' + h(t) + '</div>' + rows.map(([k, d]) => '<div class="kr"><span>' + h(d) + '</span><span>' + K(k).split(' / ').map(x => '<kbd>' + h(x) + '</kbd>').join(' ') + '</span></div>').join('')).join(''));
  }
  addAct('keys', openKeys);
  document.addEventListener('keydown', e => { if (e.key === 'F1') { e.preventDefault(); openM ? closeModal() : openKeys(); } }, true);

  // ---------- журнал ошибок и самопроверка ----------
  const SHELL = ['index.html', 'style.css', 'app.js', 'extras.js', 'tools.js', 'cm-bundle.js', 'cm.js', 'school.js', 'homework.js', 'school-config.js', 'diag.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'sw.js'];
  async function report(){
    const L = [], bad = [], T = (k, v) => L.push(k + ': ' + v), g = n => { try { return (0, eval)('typeof ' + n + " !== 'undefined' ? " + n + ' : undefined'); } catch (_) { return undefined; } };
    T('Дата', new Date().toISOString());
    T('Адрес', location.href.split('#')[0]);
    T('Браузер', navigator.userAgent);
    T('Экран', innerWidth + '×' + innerHeight + ', ×' + devicePixelRatio + ', режим: ' + document.documentElement.dataset.dev + ', тема: ' + (document.documentElement.dataset.theme || 'dark'));
    T('Сеть', navigator.onLine ? 'онлайн' : 'офлайн');
    if (location.protocol === 'file:') { bad.push('страница открыта с диска (file://): input() и офлайн не работают'); }
    const cm = window.__mlCm || 'нет данных';
    T('CodeMirror', cm + '; источник: ' + (window.CMB ? 'cm-bundle.js (локально)' : 'esm.sh (чужой CDN)'));
    if (cm !== 'работает') bad.push('CodeMirror: ' + cm);
    T('Pyflakes', window.__mlFlakes || 'ещё не запускался (нужен готовый Pyodide и вкладка Python)');
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        T('Service Worker', regs.length ? regs.map(r => (r.active ? 'active' : r.installing ? 'installing' : r.waiting ? 'waiting' : '?') + ' ' + r.scope).join('; ') : 'не зарегистрирован');
        T('SW управляет страницей', navigator.serviceWorker.controller ? 'да' : 'нет (обновите страницу один раз)');
        if (/^https?:/.test(location.protocol)) {
          if (!regs.length) bad.push('Service Worker не зарегистрирован');
          try { const r = await fetch('__ml_ping', { cache: 'no-store' }); const ok = (await r.text()) === 'pong'; T('SW ping (нужен для input())', ok ? 'ок' : 'нет ответа'); if (!ok) bad.push('Service Worker не отвечает: input() в Pyodide не будет блокирующим'); } catch (_) { T('SW ping', 'ошибка'); bad.push('SW ping не прошёл'); }
        }
      } catch (e) { T('Service Worker', 'ошибка: ' + e.message); }
    } else T('Service Worker', 'не поддерживается');
    const ry = g('pyoReady'), fy = g('pyoFail');
    T('Pyodide', ry ? 'готов' : fy ? 'не загрузился' : 'ещё не загружен или грузится');
    if (fy) bad.push('Pyodide не загрузился');
    T('Движок Python', g('eng') || '?'); T('Skulpt', typeof Sk !== 'undefined' ? 'загружен' : 'нет'); T('Brython', typeof __BRYTHON__ !== 'undefined' ? 'загружен' : 'нет (грузится по требованию)');
    const miss = [];
    if (/^https?:/.test(location.protocol)) await Promise.all(SHELL.map(async f => { try { const r = await fetch(f, { method: 'HEAD', cache: 'no-store' }); if (!r.ok) miss.push(f + ' (' + r.status + ')'); } catch (_) { miss.push(f + ' (нет связи)'); } }));
    T('Файлы сайта', miss.length ? 'не найдены: ' + miss.join(', ') : 'все на месте');
    const need = miss.filter(x => x.indexOf('cm-bundle.js') !== 0);
    if (need.length) bad.push('нет файлов: ' + need.join(', '));
    try { T('Кеши', (await caches.keys()).join(', ') || 'пусто'); } catch (_) {}
    try { const ks = Object.keys(localStorage).filter(k => k.indexOf('ml-') === 0); T('Память браузера', ks.map(k => k + ' ' + Math.round((localStorage.getItem(k) || '').length / 1024) + 'КБ').join(', ') || 'пусто'); } catch (_) {}
    const log = window.__mlLog || [];
    if (log.some(x => x.k !== 'console.error' && !/cm-bundle\.js/.test(x.m))) bad.push('в журнале есть ошибки (' + log.length + ')');
    L.push('', 'Ошибки (' + log.length + '):');
    if (!log.length) L.push('нет');
    log.slice(-25).forEach(x => L.push(new Date(x.t).toLocaleTimeString('ru-RU') + ' [' + x.k + '] ' + x.m + (x.x ? '\n    ' + x.x.replace(/\n/g, '\n    ') : '')));
    return { text: L.join('\n'), bad };
  }
  async function openDiag(){
    const o = modal('Журнал ошибок и самопроверка', '<div class="dsum">Проверяю…</div><pre class="dpre"></pre><div class="mlf"><button data-copy class="go">Скопировать всё</button><button data-clr>Очистить журнал</button></div>', true);
    const r = await report();
    if (!openM || openM !== o) return;
    o.querySelector('.dsum').innerHTML = r.bad.length ? '<b class="no">⚠ Найдено проблем: ' + r.bad.length + '</b><ul>' + r.bad.map(x => '<li>' + h(x) + '</li>').join('') + '</ul>' : '<b class="yes">✓ Всё в порядке</b>';
    o.querySelector('.dpre').textContent = r.text;
    o.addEventListener('click', async e => {
      if (e.target.closest('[data-copy]')) {
        try { await navigator.clipboard.writeText(r.text); } catch (_) { const t = document.createElement('textarea'); t.value = r.text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (_) {} t.remove(); }
        toast('Отчёт скопирован: пришли его в чат');
      }
      if (e.target.closest('[data-clr]')) { (window.__mlLog || []).length = 0; openDiag(); }
    });
  }
  addAct('diag', openDiag);

  // ---------- история версий ----------
  const HK = 'ml-hist', MAX_FILE = 25, MAX_ALL = 80, MAX_CHARS = 1200000;
  let hist = lsGet(HK, []); if (!Array.isArray(hist)) hist = [];
  const curCode = () => { try { return ta.value; } catch (_) { return tabs[ai].code; } };
  function snapHist(kind){
    try {
      const t = tabs[ai], c = curCode(); if (!t || !c.trim()) return;
      const last = hist.find(x => x.n === t.name);
      if (last && last.c === c) { if (kind !== 'auto') last.k = kind === 'run' ? 'run' : last.k; return; }
      hist.unshift({ id: Date.now() + Math.random(), n: t.name, l: t.lang, c, t: Date.now(), k: kind });
      const per = {}; hist = hist.filter(x => (per[x.n] = (per[x.n] || 0) + 1) <= MAX_FILE).slice(0, MAX_ALL);
      let tot = 0; hist = hist.filter((x, i) => i < 3 || (tot += x.c.length) < MAX_CHARS);
      if (!lsPut(HK, hist)) { hist = hist.slice(0, Math.ceil(hist.length / 2)); lsPut(HK, hist); }
    } catch (_) {}
  }
  // автоверсия: через 20 с после последней правки, не чаще раза в минуту
  let hT = 0, hLast = 0;
  ta.addEventListener('input', () => { clearTimeout(hT); hT = setTimeout(() => { if (Date.now() - hLast > 60000) { hLast = Date.now(); snapHist('auto'); } }, 20000); });
  // версия при каждом запуске: цепляемся к snap() из app.js, который вызывается по кнопке «Запуск»
  try { const s0 = window.snap; if (typeof s0 === 'function') window.snap = function(){ snapHist('run'); return s0.apply(this, arguments); }; } catch (_) {}
  addEventListener('pagehide', () => { if (hT) snapHist('auto'); });
  const KN = { auto: 'автосохранение', run: 'запуск', before: 'до отката', manual: 'вручную' };
  const ago = t => { const s = (Date.now() - t) / 1000; if (s < 60) return 'только что'; if (s < 3600) return Math.floor(s / 60) + ' мин назад'; if (s < 86400) return Math.floor(s / 3600) + ' ч назад'; return new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  function dstat(a, b){   // сколько строк добавлено/убрано относительно текущего кода
    const m = new Map(); a.split('\n').forEach(l => m.set(l, (m.get(l) || 0) + 1));
    let same = 0; b.split('\n').forEach(l => { const n = m.get(l); if (n) { m.set(l, n - 1); same++; } });
    return [b.split('\n').length - same, a.split('\n').length - same];
  }
  function openHist(){
    const name = tabs[ai].name;
    const draw = () => {
      const cur = curCode(), list = hist.filter(x => x.n === name);
      return '<p class="msub">Файл <b>' + h(name) + '</b>. Версии сохраняются при запуске и во время работы. Откат сам сохраняет текущий код, так что его можно отменить.</p>' +
        (list.length ? list.map(v => { const [p, m] = dstat(cur, v.c); return '<div class="hv" data-id="' + v.id + '"><div class="hr"><b>' + ago(v.t) + '</b><span class="mut">' + (KN[v.k] || v.k) + '</span><span class="df">' + (p || m ? '<i class="pl">+' + p + '</i> <i class="mi2">−' + m + '</i>' : 'без отличий') + '</span></div><pre class="hp">' + h(v.c.split('\n').slice(0, 8).join('\n')) + '</pre><div class="mlf"><button data-rs="' + v.id + '" class="go">Вернуть эту версию</button><button data-cp="' + v.id + '">В новую вкладку</button></div></div>'; }).join('')
          : '<div class="spe">Пока нет версий этого файла. Запустите код или поработайте минуту.</div>') +
        '<div class="mlf"><button data-now>Сохранить версию сейчас</button></div>';
    };
    const o = modal('История версий', draw(), true), body = o.querySelector('.mlc');
    o.addEventListener('click', e => {
      const rs = e.target.closest('[data-rs]'), cp = e.target.closest('[data-cp]'), nw = e.target.closest('[data-now]');
      if (nw) { snapHist('manual'); body.innerHTML = draw(); toast('Версия сохранена'); return; }
      const el = rs || cp, v = el && hist.find(x => String(x.id) === (rs ? el.dataset.rs : el.dataset.cp));
      if (!v) return;
      if (rs) { snapHist('before'); tabs[ai].code = v.c; switchTab(ai); closeModal(); toast('Версия восстановлена'); }
      if (cp) { const nm = (typeof uniq === 'function') ? uniq(v.n) : v.n; tabs.push({ name: nm, lang: v.l, code: v.c }); switchTab(tabs.length - 1); closeModal(); }
    });
  }
  addAct('hist', openHist);

  // ---------- индикатор «Сохранено» ----------
  const ind = document.createElement('span'); ind.id = 'svi'; ind.className = 'ok'; ind.textContent = 'Сохранено';
  const acts = $('acts'); if (acts) acts.insertBefore(ind, acts.firstChild);
  const setInd = (s, t) => { ind.className = s; ind.textContent = t; };
  ta.addEventListener('input', () => setInd('busy', 'Сохранение…'));
  try {
    const sn = window.saveNow;
    if (typeof sn === 'function') window.saveNow = function(){
      const r = sn.apply(this, arguments);
      try { const same = localStorage.getItem('ml-tabs') === JSON.stringify({ tabs, ai }); setInd(same ? 'ok' : 'bad', same ? 'Сохранено' : 'Не сохранено'); } catch (_) { setInd('bad', 'Не сохранено'); }
      return r;
    };
  } catch (_) {}

  // ---------- клик по номеру строки в ошибке ----------
  const con = $('con');
  const RE = /(File\s+["']([^"']+)["'],\s*)?\b(line|строка|строке)\s+(\d+)\b|\bon line (\d+)\b/gi;
  const base = n => String(n).split('/').pop();
  const tabIdx = n => n ? tabs.findIndex(t => t.name === n || base(t.name) === base(n)) : -1;
  function linkify(el){
    if (el.dataset.lk || el.nodeType !== 1 || !el.classList.contains('e')) return;
    const txt = el.textContent; if (!/line|строк/i.test(txt)) return;
    el.dataset.lk = '1';
    let last = 0, hit = false; const frag = document.createDocumentFragment(); RE.lastIndex = 0; let m;
    while ((m = RE.exec(txt))) {
      const file = m[2] || ((/([\w.\/-]+\.(?:py|js|html|css))["']?,\s*$/.exec(txt.slice(Math.max(0, m.index - 80), m.index)) || [])[1] || '');
      const n = +(m[4] || m[5]);
      const own = !file || /^<(exec|stdin|string|module)>$/.test(file) || tabIdx(file) >= 0;
      if (!own || !n) continue;             // строки из внутренностей Pyodide не трогаем
      hit = true; frag.append(txt.slice(last, m.index));
      const a = document.createElement('a'); a.className = 'ml-ln'; a.dataset.ln = n; if (file && tabIdx(file) >= 0) a.dataset.file = file;
      a.title = 'Перейти к строке ' + n; a.textContent = m[0]; frag.append(a); last = m.index + m[0].length;
    }
    if (hit) { frag.append(txt.slice(last)); el.replaceChildren(frag); }
  }
  if (con) {
    new MutationObserver(ms => ms.forEach(r => r.addedNodes.forEach(n => { if (n.nodeType === 1) linkify(n); }))).observe(con, { childList: true });
    con.addEventListener('click', e => {
      const a = e.target.closest('a.ml-ln'); if (!a) return;
      e.preventDefault(); jump(+a.dataset.ln, a.dataset.file);
    });
  }
  function jump(n, file){
    const i = tabIdx(file); if (i >= 0 && i !== ai) switchTab(i);
    if (document.documentElement.dataset.dev === 'phone') { const b = document.querySelector('#seg [data-v=code]'); if (b) b.click(); }
    const v = window.cmView;
    setTimeout(() => {
      if (v) {
        const d = v.state.doc, ln = d.line(Math.min(Math.max(n, 1), d.lines));
        v.dispatch({ selection: { anchor: ln.from, head: ln.to }, effects: v.constructor.scrollIntoView ? v.constructor.scrollIntoView(ln.from, { y: 'center' }) : [], scrollIntoView: true });
        v.focus();
      } else {
        const L = ta.value.split('\n'); let p = 0; for (let k = 0; k < n - 1 && k < L.length; k++) p += L[k].length + 1;
        ta.focus(); ta.setSelectionRange(p, p + (L[n - 1] || '').length);
      }
    }, 30);
  }

  // ---------- «стекло» в шапке: блик следует за курсором ----------
  document.addEventListener('pointermove', e => {
    const b = e.target.closest && e.target.closest('button'); if (!b) return;
    const r = b.getBoundingClientRect(); b.style.setProperty('--mx', (e.clientX - r.left) + 'px'); b.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
})();
