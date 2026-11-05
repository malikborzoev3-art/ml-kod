// Дополнения: ссылка для шеринга (#g=..., формат #s=/#z= занят app.js) и Ctrl+S. Использует глобальные tabs, ai, switchTab, say из app.js.
(function(){
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
  const un64 = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
  // cap защищает от «бомбы»: маленькая ссылка, которая распаковывается в гигабайты
  const CAP = 2e6, MAX_LINK = 80000;
  async function pipe(data, T, cap){
    const st = new T('gzip'), w = st.writable.getWriter();
    w.write(data).catch(() => {}); w.close().catch(() => {});
    const r = st.readable.getReader(), parts = []; let n = 0;
    for (;;) {
      const { done, value } = await r.read(); if (done) break;
      n += value.length; if (cap && n > cap) { r.cancel().catch(() => {}); throw new Error('too big'); }
      parts.push(value);
    }
    const o = new Uint8Array(n); let p = 0; for (const x of parts) { o.set(x, p); p += x.length; } return o;
  }
  async function pack(){
    tabs[ai].code = document.getElementById('code').value;
    const json = JSON.stringify(tabs.map(t => ({ n: t.name, l: t.lang, c: t.code })));
    return b64(await pipe(new TextEncoder().encode(json), CompressionStream));
  }
  async function unpack(s){
    const json = new TextDecoder().decode(await pipe(un64(s), DecompressionStream, CAP));
    return JSON.parse(json).filter(t => t && typeof t.c === 'string').slice(0, 20).map(t => ({ name: String(t.n || 'main'), lang: ['py','js','html','css'].includes(t.l) ? t.l : 'py', code: t.c }));
  }
  document.getElementById('shareBtn').addEventListener('click', async () => {
    if (!window.CompressionStream) { say('Браузер не поддерживает сжатие для ссылок'); return; }
    try {
      const url = location.origin + location.pathname + '#g=' + await pack();
      if (url.length > 60000) { say('Код слишком большой для ссылки: используйте экспорт'); return; }
      try { await navigator.clipboard.writeText(url); say('Ссылка скопирована'); } catch (_) { prompt('Скопируйте ссылку:', url); }
    } catch (_) { say('Не удалось создать ссылку'); }
  });
  async function fromHash(){
    const m = /^#g=([\w-]+)$/.exec(location.hash); if (!m || !window.DecompressionStream) return;
    if (m[1].length > MAX_LINK) { history.replaceState(null, '', location.pathname); say('Ссылка слишком длинная: отклонена'); return; }
    try {
      const t = await unpack(m[1]); if (!t.length) return;
      if (!confirm('Открыть код по ссылке? Текущие вкладки будут заменены (они останутся в «Сохранённых кодах», если вы запускали код).')) return;
      tabs = t; tabs.forEach(v => { v.ext = 1; }); switchTab(0); history.replaceState(null, '', location.pathname); say('Код открыт по ссылке. Перед запуском спросим подтверждение');
    } catch (e) { history.replaceState(null, '', location.pathname); say(e && e.message === 'too big' ? 'Ссылка распаковывается в слишком большой объём: отклонена' : 'Ссылка повреждена'); }
  }
  addEventListener('hashchange', fromHash); fromHash();
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault(); tabs[ai].code = document.getElementById('code').value;
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([tabs[ai].code], { type: 'text/plain' }));
      a.download = tabs[ai].name.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); say('Файл скачан');
    }
  }, true);
})();

// Открытие двойным кликом (file://): Service Worker недоступен, значит, нет input() и офлайна
if (location.protocol === 'file:') setTimeout(() => say('Страница открыта с диска: input() и офлайн-режим не работают. Откройте сайт по ссылке https://'), 1500);

// Стартовые сообщения: «стеклянные» плашки по очереди выезжают снизу слева, в конце — «Все системы работают»
(function(){
  let box = null;
  window.bootSay = function(text, kind){
    try {
      if (!box) { box = document.createElement('div'); box.id = 'boot'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
      const d = document.createElement('div'); d.className = 'bt' + (kind === 'all' ? ' all' : '');
      d.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="8.5"/><path d="M6 10.4l2.6 2.6L14 7.6"/></svg><span></span>';
      d.lastChild.textContent = text; d.style.animationDelay = Math.min(box.children.length, 4) * .1 + 's';
      box.appendChild(d); while (box.children.length > 4) box.firstChild.remove();
      setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 500); }, kind === 'all' ? 4600 : 3400);
    } catch (_) {}
  };
  const wait = (p, ms) => Promise.race([Promise.resolve(p).then(() => true, () => false), new Promise(r => setTimeout(() => r(false), ms))]);
  (async () => {
    if (document.readyState !== 'complete') await new Promise(r => addEventListener('load', r, { once: true }));
    await new Promise(r => setTimeout(r, 700));
    const jobs = [];
    try { if (typeof ML !== 'undefined' && ML.skReady) jobs.push(wait(ML.skReady, 6000).then(ok => ok && window.bootSay('Python (Skulpt) готов'))); } catch (_) {}
    try { if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) jobs.push(wait(navigator.serviceWorker.ready, 4000).then(ok => ok && window.bootSay('Офлайн-режим включён'))); } catch (_) {}
    await Promise.all(jobs);
    await new Promise(r => setTimeout(r, 600));
    const bad = (window.__mlLog || []).some(x => x.k !== 'console.error' && !/cm-bundle\.js/.test(x.m));
    if (window.__mlCm === 'работает' && !bad) window.bootSay('Все системы работают', 'all');
  })();
})();

