// Офлайн-режим + блокирующий input() для Pyodide. Кладите рядом с index.html (нужен http/https, не file://).
const C = 'ml-editor-v26', MAX_CDN = 200; // v26: homework.js (домашние задания и тесты), PyPI в кеше (Black для «Формата» больше не качается при каждом запуске). v25: shot.js (картинка из кода), metrika.js. v24: классы и ученики на Supabase (school-config.js), клавиатура и доступность, предупреждение для кода из ссылки. v23: diag.js (диагностика), автоустановка пакетов, JS-модули, Pyodide по умолчанию. v22: высота графика Plotly. v21: запасные CDN для plotly.js. v20: seaborn, plotly, автопереключение JS→Python. v19: school.js (классы и ученики). v18: офлайн-переходы со ?query, запасное имя acorn_min.js. v17: лёгкая установка (без ~7 МБ библиотек), локальный acorn. v16: понятные ошибки JS в консоли, красивый console.log. v15: стартовые сообщения. v14: приглушённая шапка. v13: tools.js, cm-bundle.js, PNG-иконки. v12: network-first для своих файлов, лимит кеша CDN
// При установке кладём в кеш только лёгкое ядро. Тяжёлые библиотеки (Skulpt, Brython, ~7 МБ) кешируются при первом использовании
// или кнопкой «Работать без интернета» в меню: так установка быстрая и не тратит трафик зря.
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'extras.js', 'tools.js', 'cm-bundle.js', 'cm.js', 'school.js', 'homework.js', 'school-config.js', 'diag.js', 'shot.js', 'metrika.js', 'acorn.min.js', 'acorn_min.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
const waits = new Map(), box = new Map();
self.addEventListener('install', e => e.waitUntil(
  caches.open(C).then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())
));
// не даём кешу CDN расти бесконечно: удаляем самые старые записи не из оболочки
async function trim(c){
  const keys = await c.keys(), cdn = keys.filter(r => new URL(r.url).origin !== location.origin);
  for (const r of cdn.slice(0, Math.max(0, cdn.length - MAX_CDN))) await c.delete(r);
}
self.addEventListener('message', e => {
  const d = e.data; if (!d) return;
  if (d.t === 'precache' && Array.isArray(d.urls)) {
    const src = e.source, urls = d.urls.slice(0, 40);
    e.waitUntil((async () => {
      const c = await caches.open(C); let done = 0, fail = 0;
      for (const u of urls) {
        try {
          const h = await c.match(u);
          if (!h || h.type === 'opaque') { const r = await fetch(u, { mode: 'cors', cache: 'reload' }); if (!r.ok) throw 0; await c.put(u, r); }
        } catch (_) { fail++; }
        done++;
        try { src && src.postMessage({ t: 'pre', done, total: urls.length, fail }); } catch (_) {}
      }
    })());
    return;
  }
  if (d.t !== 'in') return;
  const w = waits.get(d.k);
  if (w) { waits.delete(d.k); w(new Response(String(d.text))); } else box.set(d.k, String(d.text));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url), same = u.origin === location.origin;
  if (same && u.pathname.endsWith('/__ml_ping')) { e.respondWith(new Response('pong')); return; }
  if (same && u.pathname.endsWith('/__ml_wait')) {
    const k = u.searchParams.get('k');
    e.respondWith(new Promise(res => {
      if (box.has(k)) { res(new Response(box.get(k))); box.delete(k); return; }
      let t = 0;
      const fin = r => { clearTimeout(t); if (waits.get(k) === fin) waits.delete(k); res(r); };
      t = setTimeout(() => fin(new Response('', { status: 204 })), 20000);
      waits.set(k, fin);
    }));
    return;
  }
  if (r.method !== 'GET' || r.headers.has('range')) return;
  const cdn = /(^|\.)(jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|pypi\.org|pythonhosted\.org)$/.test(u.hostname);
  if (!same && !cdn) return;
  if (!same && u.hostname === 'pypi.org') {
    // описание пакетов на PyPI: сначала сеть (чтобы видеть свежие версии), без сети или при медленной сети (8 с) берём копию из кеша.
    // сами файлы пакетов (files.pythonhosted.org) неизменяемы и идут ниже в кеш «сначала кеш»
    e.respondWith(caches.open(C).then(async c => {
      try {
        const x = await Promise.race([fetch(r), new Promise((_, no) => setTimeout(no, 8000))]);
        if (x.ok) c.put(r, x.clone()).then(() => trim(c));
        return x;
      } catch (_) { return (await c.match(r)) || Response.error(); }
    }));
    return;
  }
  if (same) {
    const big = /\/(skulpt|brython)[\w.-]*\.js$/.test(u.pathname);
    e.respondWith(caches.open(C).then(async c => {
      // для переходов по ссылке со ?query без сети отдаём оболочку: ищем без учёта параметров
      const hit = (await c.match(r)) || (r.mode === 'navigate' ? ((await c.match(r, { ignoreSearch: true })) || (await c.match('index.html'))) : undefined);
      if (big) {
        // тяжёлые библиотеки почти не меняются: из кеша мгновенно, свежая версия подтягивается фоном
        const net = fetch(r).then(x => { if (x.ok) c.put(r, x.clone()); return x; });
        if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
        return net.catch(() => Response.error());
      }
      // свои файлы (html, js, css): сначала сеть, чтобы после обновления сайта все файлы были одной версии; без сети или при медленной сети (4 с) берём кеш
      try {
        const x = await Promise.race([fetch(r), new Promise((_, no) => setTimeout(no, hit ? 4000 : 30000))]);
        if (x.ok) c.put(r, x.clone());
        return x;
      } catch (_) { return hit || Response.error(); }
    }));
  } else {
    e.respondWith(caches.open(C).then(async c => {
      const h = await c.match(r); if (h) return h;
      const x = await fetch(r);
      if (x.ok || x.type === 'opaque') { c.put(r, x.clone()).then(() => trim(c)); }
      return x;
    }));
  }
});
