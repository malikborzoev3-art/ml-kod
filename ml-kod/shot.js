// «Картинка из кода»: красивый PNG с окном редактора на градиентном фоне (как в ray.so / Pika).
// Использует глобальные из app.js: tabs, ai, cur, render, esc, say, saveBlob, closeMenu, closeSaved, closeLangMenu, PYACT.
// Картинка рисуется прямо на canvas (без внешних библиотек), поэтому работает и офлайн. Подсветку берём из render() редактора.
(function(){
  const FONT = '"SF Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono",monospace';
  const UI = 'system-ui,-apple-system,"Segoe UI",sans-serif';
  const MAXL = 300;                       // больше строк в картинку не берём
  const PAL = {
    dark:  { bg: '#12151c', fg: '#d6deeb', mute: '#7d8799', ln: '#47505f', bd: 'rgba(255,255,255,.09)', k: '#c4a7e7', s: '#9ece6a', n: '#ff9e64', c: '#667386', f: '#7aa2f7', t: '#f7768e', a: '#e0af68' },
    light: { bg: '#fbfbfd', fg: '#24292f', mute: '#6b7280', ln: '#b6bcc8', bd: 'rgba(0,0,0,.10)',       k: '#8250df', s: '#0a7d33', n: '#b35900', c: '#8a8f98', f: '#0550ae', t: '#cf222e', a: '#9a6700' }
  };
  const GR = [
    ['Небо', ['#a6d4ff', '#4f8fd8']], ['Закат', ['#ff9a8b', '#ff6a88', '#c44fb0']], ['Мята', ['#9be7c4', '#2bb3a3']],
    ['Сирень', ['#d9c2f0', '#8f7bd9']], ['Океан', ['#2193b0', '#6dd5ed']], ['Ночь', ['#2b2e33', '#0f1114']],
    ['Персик', ['#ffd1a1', '#f08a8a']], ['Лайм', ['#d4fc79', '#59c173']], ['Космос', ['#0f0c29', '#302b63', '#24243e']],
    ['Роза', ['#f6d5e0', '#e0a3c4']], ['Графит', ['#4a4e58', '#1a1c21']], ['Аврора', ['#43cea2', '#185a9d']]
  ];
  const SOLID = ['#ffffff', '#f4f1ea', '#0e0e0e', '#1f2937', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  const MENUS = {
    pad:   { o: [[0, 'Без отступа'], [16, 'Малый (16)'], [32, 'Средний (32)'], [64, 'Большой (64)'], [96, 'Очень большой (96)'], [128, 'Огромный (128)']] },
    frame: { o: [['mac', 'Как в macOS'], ['plain', 'Только заголовок'], ['none', 'Без заголовка']] },
    win:   { o: [['dark', 'Тёмное окно'], ['light', 'Светлое окно']] },
    fs:    { o: [[12, '12 px'], [14, '14 px'], [16, '16 px'], [18, '18 px'], [20, '20 px'], [24, '24 px']] }
  };
  const S = { bgT: 'grad', gi: 0, solid: '#1f2937', pad: 64, frame: 'mac', win: 'dark', ln: true, shadow: true, fs: 14, scale: 2, title: '' };
  try { const o = JSON.parse(localStorage.getItem('ml-shot') || '{}'); delete o.title; if (o.bgT === 'img') o.bgT = 'grad'; Object.assign(S, o); } catch (_) {}
  const save = () => { try { const o = Object.assign({}, S); delete o.title; localStorage.setItem('ml-shot', JSON.stringify(o)); } catch (_) {} };
  const mc = document.createElement('canvas').getContext('2d');
  let G = null, IMG = null, IMGURL = '', IMGNAME = '', ov = null, prevFocus = null, raf = 0;

  // ---------- код → строки из цветных кусочков ----------
  function snap(){
    const t = tabs[ai] || { code: '', lang: 'py', name: 'main' }, ta = document.getElementById('code');
    return { src: ta && typeof ta.value === 'string' ? ta.value : t.code, lang: t.lang, name: t.name || 'main' };
  }
  function toLines(src, lang){
    src = src.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/\s+$/, '');
    let html, sv = cur;
    try { cur = lang; html = render(src, 0, 0); } catch (_) { html = esc(src); } finally { cur = sv; }
    const box = document.createElement('div'); box.innerHTML = html;
    const out = [[]];
    box.childNodes.forEach(n => {
      const cls = n.nodeType === 1 ? n.className : '';
      n.textContent.split('\n').forEach((p, i) => { if (i) out.push([]); if (p) out[out.length - 1].push([p, cls]); });
    });
    return out;
  }

  // ---------- размеры ----------
  function layout(){
    const d = snap(); let L = toLines(d.src, d.lang), cut = 0;
    if (L.length > MAXL) { cut = L.length - MAXL; L = L.slice(0, MAXL); L.push([['… ещё строк: ' + cut, 'c']]); }
    const numbered = cut ? L.length - 1 : L.length;
    mc.font = S.fs + 'px ' + FONT;
    const cw = mc.measureText('M').width, lh = Math.round(S.fs * 1.65);
    const widths = L.map(l => l.reduce((a, t) => a + mc.measureText(t[0]).width, 0));
    const gut = S.ln ? String(numbered).length * cw + 26 : 0;
    const px = 22, py = S.frame === 'none' ? 22 : 14, head = S.frame === 'none' ? 0 : 46;
    const ww = Math.max(px * 2 + gut + Math.max.apply(null, widths.concat([cw])), 360);
    const wh = head + py * 2 + L.length * lh + 6;
    return { L, numbered, cw, lh, gut, px, py, head, ww, wh, W: ww + S.pad * 2, H: wh + S.pad * 2, name: d.name };
  }

  // ---------- рисование ----------
  function rr(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function backdrop(g, W, H){
    if (S.bgT === 'none') return;
    if (S.bgT === 'solid') { g.fillStyle = S.solid; g.fillRect(0, 0, W, H); return; }
    if (S.bgT === 'img' && IMG) {
      const k = Math.max(W / IMG.width, H / IMG.height), w = IMG.width * k, h = IMG.height * k;
      g.drawImage(IMG, (W - w) / 2, (H - h) / 2, w, h); return;
    }
    const cols = GR[S.gi][1], a = 135 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), hl = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const gr = g.createLinearGradient(W / 2 - dx * hl, H / 2 - dy * hl, W / 2 + dx * hl, H / 2 + dy * hl);
    cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), c));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  function paint(cv, k){
    const P = PAL[S.win], g = cv.getContext('2d'), { W, H, ww, wh } = G;
    cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, W, H);
    backdrop(g, W, H);
    const x = S.pad, y = S.pad;
    g.save();
    if (S.shadow && S.pad > 0) { g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 50 * k; g.shadowOffsetY = 22 * k; }
    rr(g, x, y, ww, wh, 12); g.fillStyle = P.bg; g.fill(); g.restore();
    rr(g, x + .5, y + .5, ww - 1, wh - 1, 12); g.strokeStyle = P.bd; g.lineWidth = 1; g.stroke();
    g.save(); rr(g, x, y, ww, wh, 12); g.clip();
    if (G.head) {
      if (S.frame === 'mac') ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { g.beginPath(); g.arc(x + 22 + i * 20, y + 23, 6.5, 0, 7); g.fillStyle = c; g.fill(); });
      let t = S.title || G.name; g.font = '500 13px ' + UI;
      const max = ww - (S.frame === 'mac' ? 170 : 60);
      if (g.measureText(t).width > max) { while (t.length > 2 && g.measureText(t + '…').width > max) t = t.slice(0, -1); t += '…'; }
      g.fillStyle = P.mute; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(t, x + ww / 2, y + 28); g.textAlign = 'left';
    }
    g.font = S.fs + 'px ' + FONT; g.textBaseline = 'alphabetic';
    const top = y + G.head + G.py, x0 = x + G.px + G.gut, off = G.lh / 2 + S.fs * .35;
    G.L.forEach((l, i) => {
      const by = top + i * G.lh + off;
      if (S.ln && i < G.numbered) { g.fillStyle = P.ln; g.textAlign = 'right'; g.fillText(String(i + 1), x + G.px + G.gut - 26, by); g.textAlign = 'left'; }
      let cx = x0;
      for (const [txt, cls] of l) { g.fillStyle = P[cls] || P.fg; g.fillText(txt, cx, by); cx += g.measureText(txt).width; }
    });
    g.restore();
  }
  function fitScale(k){
    let s = k; while (s > .5 && (G.W * s * G.H * s > 16e6 || G.W * s > 16000 || G.H * s > 16000)) s -= .5;
    return Math.max(.5, s);
  }
  const blob = () => new Promise((ok, no) => { const c = document.createElement('canvas'); paint(c, fitScale(S.scale)); c.toBlob(b => b ? ok(b) : no(new Error('blob')), 'image/png'); });
  const goal = n => { try { window.mlGoal && window.mlGoal(n); } catch (_) {} };

  // ---------- окно ----------
  const IC = {
    pad: '<rect x="3" y="3" width="18" height="18" rx="3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    frame: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/>',
    win: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    ln: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 14H4l2 2.5a1.5 1.5 0 0 1-2 1.5"/>',
    shadow: '<rect x="4" y="4" width="13" height="13" rx="3"/><path d="M8 20.5h11a1.5 1.5 0 0 0 1.5-1.5V8"/>',
    fs: '<path d="M4 19 9 6l5 13M5.8 15h6.4M16 19l2.5-6.5L21 19M16.9 17h3.2"/>'
  };
  const svg = k => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>';
  const label = (k, v) => { const o = MENUS[k].o.find(x => x[0] === v); return o ? o[1].replace(/ \(.*\)/, '') : String(v); };

  function build(){
    ov = document.createElement('div'); ov.id = 'shot'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Картинка из кода');
    ov.innerHTML =
      '<div class="sh-stage"><div class="sh-scroll"><canvas id="shcv" role="img" aria-label="Предпросмотр картинки"></canvas></div>' +
        '<div class="sh-pop" id="shpop" hidden role="menu"></div>' +
        '<div class="sh-bar" id="shbar" role="toolbar" aria-label="Параметры картинки"></div></div>' +
      '<aside class="sh-pan"><div class="sh-hd"><b>Картинка из кода</b><button id="shx" class="ib" aria-label="Закрыть" title="Закрыть (Esc)">✕</button></div>' +
        '<div class="sh-lab">Фон</div><div class="sh-tabs" id="shtabs"></div><div class="sh-sw" id="shsw"></div>' +
        '<label class="sh-lab" for="shti">Заголовок окна</label><input type="text" id="shti" maxlength="60" placeholder="Имя файла" autocomplete="off" spellcheck="false">' +
        '<div class="sh-lab">Размер файла</div><div class="sh-seg" id="shsc"></div><div class="sh-info" id="shinfo"></div>' +
        '<div class="sh-act"><button id="shcp">Копировать</button><button class="play" id="shdl">Скачать PNG</button></div>' +
      '</aside>';
    document.body.appendChild(ov);
    ov.querySelector('#shx').onclick = close;
    ov.querySelector('#shdl').onclick = download;
    ov.querySelector('#shcp').onclick = copy;
    const ti = ov.querySelector('#shti'); ti.oninput = () => { S.title = ti.value; redo(); };
    ov.querySelector('#shsc').onclick = e => { const b = e.target.closest('[data-sc]'); if (b) { S.scale = +b.dataset.sc; save(); panel(); } };
    ov.querySelector('#shtabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { S.bgT = b.dataset.t; save(); panel(); redo(); } };
    ov.querySelector('#shsw').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.g != null) { S.gi = +b.dataset.g; S.bgT = 'grad'; }
      else if (b.dataset.c) { S.solid = b.dataset.c; S.bgT = 'solid'; }
      else if (b.id === 'shpick') { ov.querySelector('#shfile').click(); return; }
      save(); panel(); redo();
    };
    ov.querySelector('#shsw').addEventListener('input', e => { if (e.target.id === 'shcol') { S.solid = e.target.value; S.bgT = 'solid'; save(); redo(); } });
    ov.querySelector('#shsw').addEventListener('change', e => {
      if (e.target.id !== 'shfile' || !e.target.files[0]) return;
      const f = e.target.files[0], u = URL.createObjectURL(f), im = new Image();
      im.onload = () => { if (IMGURL) URL.revokeObjectURL(IMGURL); IMG = im; IMGURL = u; IMGNAME = f.name; S.bgT = 'img'; panel(); redo(); };
      im.onerror = () => { URL.revokeObjectURL(u); say('Не удалось открыть картинку'); };
      im.src = u;
    });
    const bar = ov.querySelector('#shbar');
    bar.onclick = e => {
      const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k;
      if (k === 'ln' || k === 'shadow') { S[k] = !S[k]; save(); toolbar(); redo(); return; }
      pop(k, b);
    };
    ov.addEventListener('click', e => { const p = ov.querySelector('#shpop'); if (!p.hidden && !p.contains(e.target) && !e.target.closest('#shbar')) p.hidden = true; });
    ov.querySelector('#shpop').onclick = e => {
      const it = e.target.closest('.mi'); if (!it) return;
      const k = it.dataset.k, o = MENUS[k].o[+it.dataset.i]; S[k] = o[0]; save(); ov.querySelector('#shpop').hidden = true; toolbar(); redo();
    };
  }
  function toolbar(){
    const names = { pad: 'Отступ', frame: 'Рамка', win: 'Окно', fs: 'Шрифт' };
    ov.querySelector('#shbar').innerHTML =
      ['pad', 'frame', 'win', 'fs'].map(k => '<button data-k="' + k + '" aria-haspopup="menu">' + svg(k) + '<span>' + names[k] + '</span><small>' + esc(label(k, S[k])) + '</small></button>').join('') +
      [['ln', 'Номера'], ['shadow', 'Тень']].map(([k, n]) => '<button data-k="' + k + '" class="' + (S[k] ? 'on' : '') + '" aria-pressed="' + S[k] + '">' + svg(k) + '<span>' + n + '</span></button>').join('');
  }
  function pop(k, btn){
    const p = ov.querySelector('#shpop'), st = ov.querySelector('.sh-stage').getBoundingClientRect(), r = btn.getBoundingClientRect();
    if (!p.hidden && p.dataset.k === k) { p.hidden = true; return; }
    p.dataset.k = k;
    p.innerHTML = MENUS[k].o.map((o, i) => '<div class="mi" role="menuitem" tabindex="0" data-k="' + k + '" data-i="' + i + '">' + esc(o[1]) + (o[0] === S[k] ? '<span class="ck">✓</span>' : '') + '</div>').join('');
    p.hidden = false;
    const w = p.offsetWidth; p.style.left = Math.max(8, Math.min(r.left - st.left + r.width / 2 - w / 2, st.width - w - 8)) + 'px'; p.style.bottom = (st.bottom - r.top + 10) + 'px';
    p.querySelectorAll('.mi').forEach(m => m.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); m.click(); } });
  }
  function panel(){
    const T = [['none', 'Нет', 'background:conic-gradient(#555 25%,#2a2a2a 0 50%,#555 0 75%,#2a2a2a 0) 0 0/10px 10px'], ['solid', 'Цвет', 'background:' + S.solid], ['grad', 'Градиент', 'background:linear-gradient(135deg,' + GR[S.gi][1].join(',') + ')'], ['img', 'Картинка', 'background:' + (IMG ? 'center/cover url(' + IMG.src + ')' : 'linear-gradient(135deg,#555,#222)')]];
    ov.querySelector('#shtabs').innerHTML = T.map(([k, n, st]) => '<button data-t="' + k + '" class="' + (S.bgT === k ? 'on' : '') + '" aria-pressed="' + (S.bgT === k) + '"><i style="' + st + '"></i>' + n + '</button>').join('');
    const sw = ov.querySelector('#shsw');
    if (S.bgT === 'grad') sw.innerHTML = GR.map((g, i) => '<button data-g="' + i + '" class="' + (i === S.gi ? 'on' : '') + '" title="' + g[0] + '" aria-label="' + g[0] + '" style="background:linear-gradient(135deg,' + g[1].join(',') + ')"></button>').join('');
    else if (S.bgT === 'solid') sw.innerHTML = SOLID.map(c => '<button data-c="' + c + '" class="' + (c === S.solid ? 'on' : '') + '" aria-label="' + c + '" style="background:' + c + '"></button>').join('') + '<label class="sh-col" title="Свой цвет"><input type="color" id="shcol" value="' + (/^#[0-9a-f]{6}$/i.test(S.solid) ? S.solid : '#1f2937') + '"><span>＋</span></label>';
    else if (S.bgT === 'img') sw.innerHTML = '<button id="shpick" class="wide">' + (IMG ? 'Другая картинка… (' + esc(IMGNAME.slice(0, 22)) + ')' : 'Выбрать картинку…') + '</button><input type="file" id="shfile" accept="image/*" hidden>';
    else sw.innerHTML = '<div class="sh-note">Фон прозрачный: в PNG останется только окно с кодом.</div>';
    ov.querySelector('#shsc').innerHTML = [1, 2, 3, 4].map(n => '<button data-sc="' + n + '" class="' + (S.scale === n ? 'on' : '') + '" aria-pressed="' + (S.scale === n) + '">' + n + '×</button>').join('');
  }
  function redo(){
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!ov) return;
      G = layout();
      const cv = ov.querySelector('#shcv'), pv = Math.min(2, window.devicePixelRatio || 1.5);
      paint(cv, pv); cv.style.width = G.W + 'px'; cv.style.aspectRatio = G.W + ' / ' + G.H;
      const s = fitScale(S.scale);
      ov.querySelector('#shinfo').textContent = Math.round(G.W * s) + ' × ' + Math.round(G.H * s) + ' px' + (s < S.scale ? ' (уменьшено под лимит браузера)' : '');
    });
  }
  async function download(){
    try {
      const b = await blob(), n = (G.name.replace(/\.[^.]+$/, '') || 'code').split('/').pop() + '.png';
      if (typeof saveBlob === 'function') saveBlob(b, n);
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = n; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
      say('Картинка сохранена'); goal('shot_png');
    } catch (_) { say('Не удалось создать картинку: попробуйте размер поменьше'); }
  }
  async function copy(){
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw 0;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]); say('Картинка скопирована'); goal('shot_copy');
    } catch (_) { say('Браузер не дал скопировать картинку: нажмите «Скачать PNG»'); }
  }
  function onKey(e){
    if (e.key !== 'Escape') return;
    e.stopPropagation(); const p = ov.querySelector('#shpop');
    if (!p.hidden) p.hidden = true; else close();
  }
  function open(){
    if (ov) return;
    try { closeMenu(); closeSaved(); closeLangMenu(); } catch (_) {}
    const d = snap(); if (!d.src.trim()) { say('Сначала напишите код'); return; }
    prevFocus = document.activeElement; S.title = '';
    build(); toolbar(); panel(); redo();
    ov.querySelector('#shti').value = ''; ov.querySelector('#shti').placeholder = d.name;
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => { const b = ov && ov.querySelector('#shdl'); if (b) b.focus(); }, 50);
  }
  function close(){
    if (!ov) return; cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey, true);
    ov.remove(); ov = null; G = null; if (IMGURL) { URL.revokeObjectURL(IMGURL); IMGURL = ''; IMG = null; } try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (_) {}
  }
  window.mlShot = open;
  if (typeof PYACT !== 'undefined') PYACT.shot = open;
  const btn = document.getElementById('imgBtn'); if (btn) btn.addEventListener('click', open);
})();
