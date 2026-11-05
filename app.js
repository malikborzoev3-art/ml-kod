const $ = id => document.getElementById(id);
// запись в localStorage с предупреждением, если память браузера кончилась (раньше ошибка глоталась молча)
let lsWarned = 0;
function lsSet(k, v){
  try { localStorage.setItem(k, v); return true; }
  catch(e) { if (Date.now() - lsWarned > 30000) { lsWarned = Date.now(); say('Не удалось сохранить: память браузера заполнена. Скачайте код или очистите «Сохранённые коды»'); } return false; }
}
const SID = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ind = () => cur === 'py' ? 4 : 2;
const code = $('code'), hl = $('hl'), st = $('st'), lang = $('lang'), out = $('out');
const samples = {
  py: "# Python работает прямо в браузере\ndef hello(name):\n    return 'Привет, ' + name + '!'\n\nprint(hello('мир'))\nfor i in range(1, 4):\n    print('Шаг', i)\n",
  js: "// Пиши код и жми Запуск (Ctrl+Enter)\nconst hello = name => `Привет, ${name}!`;\nconsole.log(hello('мир'));\n\nfor (let i = 1; i <= 3; i++) {\n  console.log('Шаг', i);\n}\n",
  html: "<h1>Привет, мир</h1>\n<button onclick=\"alert('Работает!')\">Нажми</button>\n\n<style>\n  body { font-family: sans-serif; padding: 24px; }\n</style>\n<script>\n  console.log('HTML запущен');\n<\/script>\n"
};
const store = { js: '', py: '', html: '' };
let cur = 'py', tabs = [{ name: 'main.py', lang: 'py', code: '' }], ai = 0;

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function parseJs(src, offset){
  let e = null;
  try { acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); return null; } catch(x){ e = x; }
  // import/export и await на верхнем уровне допустимы в ES-модулях: если как модуль код разбирается, ошибки нет
  try { acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }); return null; }
  catch(x){ if (/sourceType: ?'module'|import' and 'export/.test(e.message)) e = x; }
  if (typeof e.pos === 'number') return { pos: e.pos + offset, msg: e.message.replace(/\s*\(\d+:\d+\)$/, '') };
  return { pos: -1, msg: e.message };
}
// код корректен только как ES-модуль (import/export или await на верхнем уровне): запускаем его как <script type="module">
function isModuleJs(src){
  if (typeof acorn === 'undefined') return false;
  try { acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); return false; } catch(_) {}
  try { acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }); return true; } catch(_) { return false; }
}
// «голые» импорты (import _ from 'lodash') браузер не понимает: ведём их на esm.sh через import map
function importMapTag(codes){
  const map = {}; let m;
  for (const code of codes) {
    const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]+)\1/g;
    while ((m = re.exec(code))) if (!/^(?:\.{0,2}\/|[a-z][a-z0-9+.-]*:|#)/i.test(m[2])) map[m[2]] = 'https://esm.sh/' + m[2];
  }
  return Object.keys(map).length ? '<script type="importmap">' + JSON.stringify({ imports: map }).replace(/</g, '\\u003c') + '<\/script>' : '';
}

let pyBusy = false;
let pyoSync = false, pyoW = null, pyoReady = false, pyoLoading = null, pyoFail = false, pyoSkip = false, pyoId = 0, pyoH = {}, pyoRunning = false, runSeed = 1, paT = 0;
const pyoChk = new Map();
let eng = 'auto', stdinText = '';
try { eng = localStorage.getItem('ml-eng') || 'auto'; stdinText = localStorage.getItem('ml-stdin') || ''; } catch(e) {}
function posOf(src, line, col){ const L = src.split('\n'); let pos = 0; line = Math.max(1, Math.min(line, L.length)); for (let i = 0; i < line - 1; i++) pos += L[i].length + 1; return pos + Math.max(0, Math.min(col, L[line - 1].length)); }
// Второй разборщик: Brython в скрытом iframe проверяет синтаксис, если Skulpt ругнулся (null = код верный, false = Brython недоступен)
const bryChecked = new Map(); let bcFrame = null, bcT = 0, bcId = 0; const bcWait = {};
function bryCheck(src){
  clearTimeout(bcT);
  bcT = setTimeout(() => {
    if (!bcFrame) {
      bcFrame = document.createElement('iframe'); bcFrame.hidden = true; bcFrame.setAttribute('sandbox', 'allow-scripts');
      const srcs = JSON.stringify([new URL('./', location.href).href, BRY]);
      bcFrame.srcdoc = '<script>var S=' + srcs + ',N=["brython.min.js","brython_min.js"],L=[];S.forEach(function(b){N.forEach(function(n){L.push(b+n)})});' +
        '(function nx(i){if(i>=L.length)return parent.postMessage({bc:"fail"},"*");var e=document.createElement("script");e.onload=function(){if(window.__BRYTHON__)parent.postMessage({bc:"ready"},"*");else{e.remove();nx(i+1)}};e.onerror=function(){e.remove();nx(i+1)};e.src=L[i];document.head.appendChild(e)})(0);' +
        'addEventListener("message",function(ev){var d=ev.data;if(!d||d.id==null)return;var r=null;try{__BRYTHON__.python_to_js(d.src,"__main__")}catch(x){var m=x.msg||(x.args&&x.args[0])||x.message||String(x);if(typeof m!=="string")m=String(m);r={line:x.lineno||(x.args&&x.args[1]&&x.args[1][1])||0,msg:m}}parent.postMessage({bc:"res",id:d.id,r:r},"*")});<\/script>';
      bcFrame.ready = false; document.body.appendChild(bcFrame);
    }
    const ask = () => { const id = ++bcId; bcWait[id] = src; bcFrame.contentWindow.postMessage({ id, src }, '*'); };
    if (bcFrame.ready) ask(); else bcFrame.pend = ask;
  }, 400);
}
addEventListener('message', ev => {
  const d = ev.data; if (!d || !d.bc || !bcFrame || ev.source !== bcFrame.contentWindow) return;
  if (d.bc === 'ready') { bcFrame.ready = true; if (bcFrame.pend) bcFrame.pend(); }
  else if (d.bc === 'fail') { bcFrame.ready = false; if (code.value) { bryChecked.set(code.value, false); update(true); } }
  else if (d.bc === 'res') {
    const src = bcWait[d.id]; delete bcWait[d.id]; if (src == null) return;
    let r = null;
    if (d.r) {
      const line = +d.r.line || 0, lines = src.split('\n'); let pos = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      const text = lines[Math.max(line - 1, 0)] || '';
      r = { pos: line ? pos + (text.length - text.trimStart().length) : -1, msg: d.r.msg };
    }
    bryChecked.set(src, r);
    if (bryChecked.size > 50) bryChecked.delete(bryChecked.keys().next().value);
    if (code.value === src) update(true);
  }
});
function pyInit(o){
  Sk.configure({ output: o || (() => {}), __future__: Sk.python3, execLimit: 5000,
    read: x => { if (!Sk.builtinFiles || !Sk.builtinFiles.files[x]) throw 'File not found: ' + x; return Sk.builtinFiles.files[x]; },
    inputfun: p => { try { return prompt(p) || ''; } catch(e) { return ''; } } });
}
function checkPy(src){
  if (pyoReady) {
    const r = pyoChk.get(src);
    if (r === undefined) { pyoAsk(src); return null; }
    return r.e || null;
  }
  if (typeof Sk === 'undefined' || !Sk.parse || pyBusy) return null;
  try { pyInit(); Sk.parse('<stdin>.py', src); return null; }
  catch(e){
    // Skulpt знает не весь Python 3: окончательный вердикт даёт настоящий разборщик Pyodide (ast.parse). Пока он грузится, ошибку не показываем
    if (!pyoFail && !pyoSkip && eng !== 'classic' && window.Worker) { startPyo(); return null; }
    if (modernPy(src)) return null;
    const tb = e.traceback && e.traceback[0], line = tb ? tb.lineno : 0;
    if (!line) return { pos: -1, msg: String(e) };
    const lines = src.split('\n'); let pos = 0;
    for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    const text = lines[line - 1] || '', lead = text.length - text.trimStart().length;
    const col = tb.colno > 0 && tb.colno <= text.length ? tb.colno : lead;
    const msg = (e.args && e.args.v && e.args.v[0] && e.args.v[0].v) || 'Синтаксическая ошибка';
    return { pos: pos + col, msg };
  }
}
function check(src){
  if (cur === 'css') return checkCss(src);
  if (cur === 'py') return checkPy(src);
  if (typeof acorn === 'undefined') return null;
  if (cur === 'js') return parseJs(src, 0);
  const re = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].indexOf('>') + 1;
    const err = parseJs(m[1], start);
    if (err) return err;
  }
  return null;
}

// ===== ПРОВЕРКА И ПОДСВЕТКА =====
let lastLines = -1, chkT = 0;
function update(force){
  const src = code.value;
  // у больших файлов подсветка мгновенная, а проверка синтаксиса откладывается, чтобы ввод не тормозил
  const big = src.length > 15000 && force !== true;
  if (big) { clearTimeout(chkT); chkT = setTimeout(() => update(true), 250); }
  const err = big ? null : check(src);
  let html;
  if (err && err.pos >= 0) {
    let s = Math.min(err.pos, Math.max(src.length - 1, 0));
    if (src[s] === '\n' && s > 0) s--;
    const t = /^(\w+|\S)/.exec(src.slice(s));
    const e = s + (t ? t[0].length : 1);
    html = render(src, s, e);
    const line = src.slice(0, s).split('\n').length;
    st.textContent = '⚠ Строка ' + line + ': ' + ruErr(err.msg);
    st.className = 'bad';
  } else {
    html = render(src, -1, -1);
    if (!big) { st.textContent = err ? '⚠ ' + ruErr(err.msg) : '✓ Ошибок нет'; st.className = err ? 'bad' : ''; if (!err) pyStatusExtra(src); }
  }
  // при включённом CodeMirror (класс cm6) старые слои подсветки, нумерации и подсказок скрыты: не тратим на них время на каждый символ
  if (document.documentElement.classList.contains('cm6')) return;
  hl.innerHTML = html + '\n';
  const nl = src.split('\n').length;
  if (nl !== lastLines) { lastLines = nl; ln.textContent = Array.from({ length: nl }, (_, i) => i + 1).join('\n'); }
  updateHint();
  updateSug();
  sync();
}
function sync(){ hl.scrollTop = ln.scrollTop = code.scrollTop; hl.scrollLeft = code.scrollLeft; }

let saveT = 0;
function saveNow(){ clearTimeout(saveT); saveT = 0; lsSet('ml-tabs', JSON.stringify({ tabs, ai })); }
function save(){ clearTimeout(saveT); saveT = setTimeout(saveNow, 300); }
addEventListener('pagehide', () => { if (saveT) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveT) saveNow(); });

const ln = $('ln'), tabsEl = $('tabs'), hint = $('hint');
let FS = 13, cw = 8, LH = 20.8;
function setFS(n){
  FS = n; document.documentElement.style.setProperty('--fs', n + 'px');
  const c = document.createElement('canvas').getContext('2d'); c.font = n + 'px ui-monospace,Menlo,Consolas,monospace';
  cw = c.measureText('M').width; LH = n * 1.6;
}
setFS(13);
function updateHint(){
  const v = code.value, p = code.selectionStart, ls = v.lastIndexOf('\n', p - 1) + 1, le = v.indexOf('\n', p);
  const line = v.slice(ls, le < 0 ? v.length : le);
  if (cur !== 'html' || code.selectionEnd !== p || line.trim() !== '!') { hint.style.display = 'none'; return; }
  const row = v.slice(0, ls).split('\n').length - 1;
  hint.style.display = 'block';
  hint.style.top = (16 + (row + 1) * LH - code.scrollTop) + 'px';
  hint.style.left = (code.offsetLeft + 16 + line.length * cw - code.scrollLeft) + 'px';
}
code.addEventListener('keyup', updateHint);
code.addEventListener('click', updateHint);
code.addEventListener('scroll', updateHint);

const sug = $('sug');
const svb = $('sv'), svp = $('svp');
let saved = [];
try { saved = JSON.parse(localStorage.getItem('ml-saved') || '[]') || []; } catch(e) {}
const fmt = t => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const prevLine = c => (c.split('\n').find(l => l.trim()) || '').trim().slice(0, 42);
const uniq = n => {
  if (!tabs.some(x => x.name === n)) return n;
  const m = /^(.*?)(\.[^./]+)?$/.exec(n); let i = 2, r;
  do r = m[1] + i++ + (m[2] || ''); while (tabs.some(x => x.name === r));
  return r;
};
const EXT2L = { py: 'py', js: 'js', html: 'html', htm: 'html', css: 'css' };
const DEFN = { py: 'main.py', js: 'script.js', html: 'index.html', css: 'style.css' };
const langOf = n => EXT2L[((/\.([a-z0-9]+)$/i.exec(n) || [])[1] || '').toLowerCase()] || null;
const cleanName = n => String(n).replace(/\\/g, '/').split('/').map(x => x.replace(/[^\wа-яёА-ЯЁ .-]/g, '').trim()).filter(x => x && x !== '.' && x !== '..').join('/').slice(0, 40);
const folderHtml = n => { const i = n.lastIndexOf('/'); return i < 0 ? esc(n) : '<i>' + esc(n.slice(0, i + 1)) + '</i>' + esc(n.slice(i + 1)); };
function persistSaved(){ lsSet('ml-saved', JSON.stringify(saved)); }
function snap(){
  const c = code.value; if (!c.trim()) return;
  const last = saved[0];
  if (last && last.code === c && last.lang === cur) last.t = Date.now();
  else saved.unshift({ id: Date.now(), lang: cur, name: tabs[ai].name, code: c, t: Date.now() });
  saved = saved.slice(0, 30); persistSaved();
  if (!svp.hidden) drawSaved();
}
function drawSaved(){
  svp.innerHTML = '<div class="sph"><b>Сохранённые коды</b>' + (saved.length ? '<a data-clear="1">Очистить</a>' : '') + '</div>' +
    (saved.length ? saved.map(s => '<div class="spi" data-id="' + s.id + '"><span class="spl">' + esc(LN[s.lang] || s.lang) + '</span><span class="spp">' + esc(prevLine(s.code)) + '</span><span class="spt">' + fmt(s.t) + '</span><b data-del="' + s.id + '">×</b></div>').join('') : '<div class="spe">Пока пусто. Код появится здесь после нажатия «Запуск».</div>');
  a11y(svp, '.spi, .spi b, .sph a');
  svp.querySelectorAll('.spi b').forEach(b => b.setAttribute('aria-label', 'Удалить'));
}
function closeSaved(){ svp.hidden = true; svb.classList.remove('open'); }
function openSaved(s){
  const t = tabs[ai];
  if (!t.code.trim()) { t.lang = s.lang; t.code = s.code; t.name = uniq(s.name); switchTab(ai); }
  else { tabs.push({ name: uniq(s.name), lang: s.lang, code: s.code }); switchTab(tabs.length - 1); }
  closeSaved(); code.focus();
}
svb.addEventListener('click', e => {
  e.stopPropagation();
  if (!svp.hidden) return closeSaved();
  drawSaved(); svp.hidden = false; svb.classList.add('open');
  const r = svb.getBoundingClientRect(), w = Math.min(380, innerWidth - 24);
  svp.style.width = w + 'px'; svp.style.top = (r.bottom + 8) + 'px'; svp.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
  if (e.detail === 0) { const f = svp.querySelector('[tabindex="0"]'); if (f) f.focus(); }
});
kbNav(svp, closeSaved, svb);
svp.addEventListener('click', e => {
  e.stopPropagation();
  const d = e.target.closest('[data-del]'), c = e.target.closest('[data-clear]'), it = e.target.closest('[data-id]');
  if (d) saved = saved.filter(s => String(s.id) !== d.dataset.del);
  else if (c) saved = [];
  else if (it) { const s = saved.find(x => String(x.id) === it.dataset.id); if (s) openSaved(s); return; }
  else return;
  persistSaved(); drawSaved();
});
document.addEventListener('click', closeSaved);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSaved(); });

const con = $('con'), mnb = $('mn'), mnp = $('mnp'), fi = $('fi'), toast = $('toast');
const FSZ = [12, 13, 14, 16, 20, 26, 34];
const EX = {
  py: [['Привет, мир', 'print("Привет, мир!")'],
    ['Сумма двух чисел', 'a = int(input("a = "))\nb = int(input("b = "))\nprint("Сумма:", a + b)'],
    ['Цикл for', 'for i in range(1, 6):\n    print(i, "в квадрате:", i * i)'],
    ['Условие', 'x = int(input("Число: "))\nif x % 2 == 0:\n    print("чётное")\nelse:\n    print("нечётное")'],
    ['Список', 'nums = [3, 1, 4, 1, 5, 9]\nprint("Сумма:", sum(nums))\nprint("Максимум:", max(nums))\nnums.sort()\nprint(nums)'],
    ['Функция', 'def square(x):\n    return x * x\n\nfor n in range(1, 6):\n    print(n, square(n))'],
    ['Цикл while', 'n = 5\nf = 1\nwhile n > 1:\n    f = f * n\n    n = n - 1\nprint("5! =", f)'],
    ['Страница из Python', '# Python управляет страницей (запуск через Brython)\nfrom browser import document, html, bind\n\ndocument["app"] <= html.H2("Привет из Python!")\nbtn = html.BUTTON("Нажми")\ncounter = html.P("Нажатий: 0")\ndocument["app"] <= btn\ndocument["app"] <= counter\nn = 0\n\n@bind(btn, "click")\ndef click(ev):\n    global n\n    n += 1\n    counter.text = f"Нажатий: {n}"\n\nprint("Страница собрана из Python")']],
  js: [['Привет, мир', 'console.log("Привет, мир!");'],
    ['Цикл for', 'for (let i = 1; i <= 5; i++) {\n  console.log(i, "в квадрате:", i * i);\n}'],
    ['Функция', 'function square(x) {\n  return x * x;\n}\n\nconsole.log(square(7));'],
    ['Массив', 'const nums = [3, 1, 4, 1, 5, 9];\nconst sum = nums.reduce((a, b) => a + b, 0);\nconsole.log("Сумма:", sum);\nconsole.log("Квадраты:", nums.map(n => n * n));'],
    ['Диалог', 'const name = prompt("Как тебя зовут?");\nalert("Привет, " + name + "!");']],
  html: [['Страница', '<h1>Моя страница</h1>\n<p>Привет! Это мой первый сайт.</p>\n<a href="https://example.com">Ссылка</a>'],
    ['Список', '<h2>Мои предметы</h2>\n<ul>\n  <li>Информатика</li>\n  <li>Математика</li>\n  <li>Физика</li>\n</ul>'],
    ['Таблица', '<table border="1">\n  <tr><th>Имя</th><th>Оценка</th></tr>\n  <tr><td>Аня</td><td>5</td></tr>\n  <tr><td>Борис</td><td>4</td></tr>\n</table>']],
  css: [['Кнопка', 'button {\n  background: #4a6cf7;\n  color: white;\n  padding: 10px 20px;\n  border: 0;\n  border-radius: 8px;\n}'],
    ['Заголовок', 'h1 {\n  color: tomato;\n  text-align: center;\n}']]
};
// ===== ФАЙЛЫ, ССЫЛКА «ПОДЕЛИТЬСЯ», СКАЧИВАНИЕ =====
function say(t){ toast.textContent = t; toast.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove('on'), Math.max(2200, t.length * 55)); }
function newWith(c, name, l, ext){
  const t = tabs[ai];
  if (!t.code.trim()) { t.lang = l; t.code = c; t.name = uniq(name); if (ext) t.ext = 1; switchTab(ai); }
  else { tabs.push({ name: uniq(name), lang: l, code: c, ext: ext ? 1 : undefined }); switchTab(tabs.length - 1); }
  code.focus();
}
// Код, открытый по ссылке (#g=, #s=, #z=), помечается ext и не запускается, пока человек не подтвердит, что доверяет автору
function trustGate(){
  if (!tabs.some(t => t.ext)) return true;
  if (!confirm('Этот код открыт по ссылке. Запускайте его только если доверяете автору: программа может обращаться к данным этого сайта в браузере.\n\nЗапустить?')) return false;
  tabs.forEach(t => { delete t.ext; }); save(); return true;
}
const b64u = u => { let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = t => { t = t.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; const b = atob(t), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
// сжатие/распаковка deflate; cap защищает от «бомбы» во вредоносной ссылке
async function pipeZ(u, S, cap){
  const st = new S('deflate-raw'), w = st.writable.getWriter();
  w.write(u).catch(() => {}); w.close().catch(() => {});
  const r = st.readable.getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; n += value.length; if (cap && n > cap) { r.cancel(); throw new Error('too big'); } parts.push(value); }
  const o = new Uint8Array(n); let p = 0; for (const x of parts) { o.set(x, p); p += x.length; } return o;
}
async function shareLink(){
  const raw = new TextEncoder().encode(JSON.stringify({ l: cur, n: tabs[ai].name, c: code.value }));
  let tag = 's', bytes = raw;
  if (typeof CompressionStream !== 'undefined') { try { bytes = await pipeZ(raw, CompressionStream); tag = 'z'; } catch(e) {} }
  const url = location.href.split('#')[0] + '#' + tag + '=' + b64u(bytes);
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => say('Ссылка скопирована'), () => prompt('Скопируй ссылку', url));
  else prompt('Скопируй ссылку', url);
}
function download(){
  const ext = { py: 'py', js: 'js', html: 'html', css: 'css' }[cur];
  let n = (cleanName(tabs[ai].name) || 'code').split('/').pop(); if (langOf(n) !== cur) n += '.' + ext;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([code.value], { type: 'text/plain;charset=utf-8' })); a.download = n;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
fi.addEventListener('change', async () => {
  const fs = Array.from(fi.files).slice(0, 30); fi.value = '';
  for (const f of fs) { const l = langOf(f.name) || cur; newWith(await f.text(), cleanName(f.name) || f.name, l); }
});
function offlineUrls(){
  const base = new URL('./', location.href).href;
  return [
    ML.CDN + 'skulpt.min.js', ML.CDN + 'skulpt-stdlib.js',
    BRY + 'brython.min.js', BRY + 'brython_min.js', BRY + 'brython_stdlib.js',
    PYO + 'pyodide.js', PYO + 'pyodide.asm.js', PYO + 'pyodide.asm.wasm', PYO + 'python_stdlib.zip', PYO + 'pyodide-lock.json',
    base, base + 'index.html', base + 'style.css', base + 'app.js', base + 'acorn.min.js',
    base + 'skulpt_min.js', base + 'skulpt-stdlib.js', base + 'brython_min.js', base + 'brython_stdlib.js'
  ];
}
function prepOffline(){
  const c = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!/^https?:/.test(location.protocol)) { say('Для работы без интернета откройте сайт по http(s), не как файл'); return; }
  if (!c) { say('Сервис-воркер ещё не активен: обновите страницу и повторите'); return; }
  if (navigator.onLine === false) { say('Сейчас нет сети, подготовка невозможна'); return; }
  say('Скачиваю файлы для работы без интернета (около 15 МБ)…');
  c.postMessage({ t: 'precache', urls: offlineUrls() });
}
function wipeAll(){
  if (!confirm('Удалить все вкладки, сохранённые коды и настройки на этом компьютере?')) return;
  clearTimeout(saveT); saveT = 0;
  try { Object.keys(localStorage).filter(k => k.indexOf('ml-') === 0).forEach(k => localStorage.removeItem(k)); } catch(e) {}
  try { if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))); } catch(e) {}
  location.reload();
}
async function loadShared(){
  const m = /^#([sz])=([\w+\/=-]+)$/.exec(location.hash); if (!m) return;
  try {
    let u = unb64u(m[2]);
    if (m[1] === 'z') u = await pipeZ(u, DecompressionStream, 5e6);
    const d = JSON.parse(new TextDecoder().decode(u));
    if (d && typeof d.c === 'string') newWith(d.c, d.n || 'Из ссылки', LN[d.l] ? d.l : 'py', true);
  } catch(e) {}
  history.replaceState(null, '', location.href.split('#')[0]);
}
function applyFS(n){ setFS(n); try { localStorage.setItem('ml-fs', n); } catch(e) {} update(); }
function closeMenu(){ mnp.hidden = true; mnb.classList.remove('open'); }
function drawMenu(){
  mnp.innerHTML = '<div class="mi" data-a="share">Поделиться ссылкой</div><div class="mi" data-a="dl">Скачать файл</div><div class="mi" data-a="shot">Картинка из кода…</div><div class="mi" data-a="open">Открыть файлы…</div><div class="mi" data-a="new">Новый файл…</div><div class="mi" data-a="ren">Переименовать файл…</div><div class="mi" data-a="demo">Пример: проект из 3 файлов</div>' +
    '<div class="mi mf">Размер шрифта <span class="fs"><b data-a="fm">A−</b><b data-a="fp">A+</b></span></div>' +
    '<div class="mi mf">Устройство <span class="fs">' + [['desktop', 'ПК'], ['tablet', 'Планшет'], ['phone', 'Телефон']].map(([v, t]) => '<b data-dv="' + v + '"' + (document.documentElement.dataset.dev === v ? ' style="background:var(--line)"' : '') + '>' + t + '</b>').join('') + '</span></div>' +
    '<div class="sph">Примеры · ' + esc(LN[cur]) + '</div>' + (EX[cur] || []).map((e, i) => '<div class="mi" data-ex="' + i + '">' + esc(e[0]) + '</div>').join('') +
    (cur === 'py' ? '<div class="sph">Python</div><div class="mi" data-a="tests">Автотесты…</div><div class="mi" data-a="dbg">Отладка по шагам</div><div class="mi" data-a="stdin">Входные данные (stdin)…</div><div class="mi" data-a="eng">Движок: ' + (eng === 'classic' ? 'классический (Skulpt/Brython)' : 'Pyodide + запасные') + '</div><div class="mi" data-a="proxy">Прокси для сети…</div>' : '') + '<div class="sph">Инструменты</div>' + (typeof toolsMenu === 'function' ? toolsMenu() : '') + '<div class="sph"></div><div class="mi" data-a="diag">Диагностика редактора…</div><div class="mi" data-a="offline">Подготовить к работе без интернета</div><div class="mi" data-a="wipe">Очистить всё на этом компьютере</div>';
  mnp.setAttribute('role', 'menu'); a11y(mnp, '.mi:not(.mf), .fs b');
}
// делает div-элементы доступными с клавиатуры: фокус, роль, Enter/Пробел и стрелки
function a11y(root, sel){
  root.querySelectorAll(sel).forEach(el => { el.tabIndex = 0; el.setAttribute('role', el.tagName === 'B' || el.tagName === 'A' ? 'button' : (root === mnp ? 'menuitem' : 'button')); });
}
function kbNav(root, close, opener){
  root.addEventListener('keydown', e => {
    const items = Array.from(root.querySelectorAll('[tabindex="0"]')), i = items.indexOf(document.activeElement);
    if (e.key === 'Enter' || e.key === ' ') { if (i >= 0) { e.preventDefault(); items[i].click(); } }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
    else if (e.key === 'Home' && items.length) { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End' && items.length) { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Escape') { close(); opener.focus(); }
    else if (e.key === 'Tab') { close(); }
  });
}
mnb.addEventListener('click', e => {
  e.stopPropagation(); closeSaved();
  if (!mnp.hidden) return closeMenu();
  drawMenu(); mnp.hidden = false; mnb.classList.add('open');
  const r = mnb.getBoundingClientRect(), w = 280;
  mnp.style.width = w + 'px'; mnp.style.top = (r.bottom + 6) + 'px'; mnp.style.left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12)) + 'px';
  if (e.detail === 0) { const f = mnp.querySelector('[tabindex="0"]'); if (f) f.focus(); }   // открыто с клавиатуры
});
kbNav(mnp, closeMenu, mnb);
mnb.setAttribute('aria-haspopup', 'menu');
mnp.addEventListener('click', e => {
  e.stopPropagation();
  const a = e.target.closest('[data-a]'), x = e.target.closest('[data-ex]'), dv = e.target.closest('[data-dv]');
  if (dv) { applyDevice(dv.dataset.dv, true); drawMenu(); return; }
  if (x) { const ex = EX[cur][+x.dataset.ex]; closeMenu(); newWith(ex[1], ex[0], cur); return; }
  if (!a) return;
  const k = a.dataset.a;
  if (k === 'fm' || k === 'fp') { const i = Math.max(0, FSZ.indexOf(FS)); applyFS(FSZ[Math.max(0, Math.min(FSZ.length - 1, i + (k === 'fp' ? 1 : -1)))]); return; }
  closeMenu();
  if (typeof PYACT !== 'undefined' && PYACT[k]) { PYACT[k](); return; }
  if (k === 'share') shareLink(); else if (k === 'dl') download(); else if (k === 'open') fi.click(); else if (k === 'new') newFile(); else if (k === 'ren') renameTab(ai); else if (k === 'demo') demoProject(); else if (k === 'wipe') wipeAll(); else if (k === 'offline') prepOffline();
});
document.addEventListener('click', e => { if (!mnb.contains(e.target) && !mnp.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

const DEVFS = { desktop: 13, tablet: 16, phone: 14 };
const kb = $('kb'), seg = $('seg'), devp = $('devp'), vp = $('vp');
const KEYS = ['Tab', '←', '→', '(', ')', ':', '=', '"', "'", '[', ']', '{', '}', ';', '+', '-', '*', '/', '%', '<', '>', '!', '#', '_', ',', '.'];
kb.innerHTML = KEYS.map((k, i) => '<button data-i="' + i + '">' + esc(k) + '</button>').join('');
const guessDev = () => !matchMedia('(pointer:coarse)').matches ? 'desktop' : (Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet');
function typeKey(k){
  code.focus();
  if (k === '←' || k === '→') { const p = Math.max(0, Math.min(code.value.length, code.selectionStart + (k === '←' ? -1 : 1))); code.setSelectionRange(p, p); hideSug(); return; }
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  if (code.dispatchEvent(ev)) document.execCommand('insertText', false, k);
}
kb.addEventListener('pointerdown', e => { const b = e.target.closest('[data-i]'); if (!b) return; e.preventDefault(); typeKey(KEYS[+b.dataset.i]); });
function placeKb(){ const v = window.visualViewport; if (v) kb.style.bottom = Math.max(0, document.documentElement.clientHeight - v.height - v.offsetTop) + 'px'; }
if (window.visualViewport) { visualViewport.addEventListener('resize', placeKb); visualViewport.addEventListener('scroll', placeKb); }
function showKb(on){
  on = on && ['phone', 'tablet'].includes(document.documentElement.dataset.dev);
  kb.hidden = !on; document.documentElement.classList.toggle('kbon', on); if (on) placeKb();
}
code.addEventListener('focus', () => showKb(true));
code.addEventListener('blur', () => showKb(false));
function setView(v){ document.documentElement.dataset.view = v; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
seg.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) setView(b.dataset.v); });
function applyDevice(d, persist){
  document.documentElement.dataset.dev = d;
  if (persist) { try { localStorage.setItem('ml-dev', d); } catch(e) {} }
  vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover' + (d === 'desktop' ? '' : ', maximum-scale=1');
  let sf = null; try { sf = localStorage.getItem('ml-fs'); } catch(e) {}
  if (!sf) setFS(DEVFS[d]);
  setView('code'); showKb(document.activeElement === code); update();
}
function initDevice(){
  let d = null; try { d = localStorage.getItem('ml-dev'); } catch(e) {}
  if (DEVFS[d]) { applyDevice(d, false); return; }
  const g = guessDev(); applyDevice(g, false);
  devp.querySelector('[data-d="' + g + '"]').classList.add('rec');
  devp.hidden = false;
}
devp.addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) { applyDevice(b.dataset.d, true); devp.hidden = true; } });
let sugList = [], sugI = 0;
const SN = {
  html: [
    ['link', 'Подключить CSS', '<link rel="stylesheet" href="style.css">'],
    ['script', 'Подключить JS', '<script src="script.js"><\/script>'],
    ['style', 'Блок стилей', '<style>\n\t$0\n</style>'],
    ['meta', 'Адаптив для телефона', '<meta name="viewport" content="width=device-width, initial-scale=1.0">'],
    ['div', 'Блок', '<div>$0</div>'],
    ['h1', 'Заголовок', '<h1>$0</h1>'],
    ['img', 'Картинка', '<img src="$0" alt="">'],
    ['button', 'Кнопка', '<button>$0</button>'],
    ['input', 'Поле ввода', '<input type="text" placeholder="$0">'],
    ['form', 'Форма', '<form>\n\t$0\n</form>'],
    ['ul', 'Список', '<ul>\n\t<li>$0</li>\n</ul>'],
    ['class', 'Атрибут class', 'class="$0"'],
    ['id', 'Атрибут id', 'id="$0"'],
    ['anchor', 'Ссылка', '<a href="$0"></a>'],
    ['para', 'Абзац', '<p>$0</p>'],
    ['h2', 'Подзаголовок', '<h2>$0</h2>'],
    ['span', 'span', '<span>$0</span>'],
    ['nav', 'Меню', '<nav>\n\t$0\n</nav>'],
    ['header', 'Шапка', '<header>\n\t$0\n</header>'],
    ['footer', 'Подвал', '<footer>\n\t$0\n</footer>'],
    ['section', 'Секция', '<section>\n\t$0\n</section>'],
    ['table', 'Таблица', '<table>\n\t<tr>\n\t\t<td>$0</td>\n\t</tr>\n</table>'],
    ['label', 'Подпись', '<label>$0</label>'],
    ['textarea', 'Многострочное поле', '<textarea>$0</textarea>'],
    ['ol', 'Нумерованный список', '<ol>\n\t<li>$0</li>\n</ol>']
  ],
  css: [
    ['flex', 'Flexbox по центру', 'display: flex;\njustify-content: center;\nalign-items: center;'],
    ['grid', 'Сетка', 'display: grid;\ngrid-template-columns: repeat(3, 1fr);\ngap: 16px;'],
    ['center', 'Центрировать', 'margin: 0 auto;\ntext-align: center;'],
    ['border', 'Рамка', 'border: 1px solid #ccc;\nborder-radius: 8px;'],
    ['shadow', 'Тень', 'box-shadow: 0 4px 12px rgba(0,0,0,.2);'],
    ['transition', 'Плавность', 'transition: all .2s ease;'],
    ['font', 'Шрифт', 'font-family: system-ui, sans-serif;\nfont-size: 16px;'],
    ['media', 'Адаптив', '@media (max-width: 700px) {\n\t$0\n}'],
    ['body', 'Стили страницы', 'body {\n\t$0\n}'],
    ['class', 'Селектор класса', '.$0 {\n\t\n}'],
    ['id', 'Селектор id', '#$0 {\n\t\n}'],
    ['hover', 'При наведении', ':hover {\n\t$0\n}'],
    ['before', 'Псевдоэлемент before', '::before {\n\tcontent: "";\n\t$0\n}'],
    ['bg', 'Фон', 'background: #111;'],
    ['gradient', 'Градиент', 'background: linear-gradient(135deg, #667eea, #764ba2);'],
    ['position', 'Позиционирование', 'position: absolute;\ntop: 0;\nleft: 0;'],
    ['transform', 'Поворот и масштаб', 'transform: rotate(10deg) scale(1.1);'],
    ['keyframes', 'Анимация', '@keyframes $0 {\n\tfrom { opacity: 0; }\n\tto { opacity: 1; }\n}'],
    ['root', 'Переменные', ':root {\n\t--$0: #fff;\n}']
  ],
  js: [
    ['log', 'console.log', 'console.log($0);'],
    ['fn', 'Функция', 'function $0() {\n\t\n}'],
    ['arrow', 'Стрелочная функция', 'const $0 = () => {\n\t\n};'],
    ['for', 'Цикл for', 'for (let i = 0; i < $0; i++) {\n\t\n}'],
    ['if', 'Условие', 'if ($0) {\n\t\n}'],
    ['qs', 'Найти элемент', "document.querySelector('$0')"],
    ['listener', 'Событие клика', "$0.addEventListener('click', () => {\n\t\n});"],
    ['timeout', 'Таймер', 'setTimeout(() => {\n\t$0\n}, 1000);'],
    ['class', 'Класс', 'class $0 {\n\tconstructor() {\n\t\t\n\t}\n}'],
    ['foreach', 'forEach', '$0.forEach(item => {\n\t\n});'],
    ['map', 'map', '$0.map(item => item)'],
    ['filter', 'filter', '$0.filter(item => item)'],
    ['async', 'Async-функция', 'async function $0() {\n\t\n}'],
    ['fetch', 'Запрос fetch', "fetch('$0')\n\t.then(res => res.json())\n\t.then(data => console.log(data));"],
    ['try', 'try / catch', 'try {\n\t$0\n} catch (err) {\n\tconsole.error(err);\n}'],
    ['while', 'Цикл while', 'while ($0) {\n\t\n}'],
    ['switch', 'switch', 'switch ($0) {\n\tcase 1:\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}'],
    ['interval', 'setInterval', 'setInterval(() => {\n\t$0\n}, 1000);'],
    ['create', 'createElement', "document.createElement('$0')"]
  ],
  py: [
    ['print', 'Вывод', 'print("$0")'],
    ['input', 'Ввод', 'input("$0")'],
    ['def', 'Функция', 'def $0():\n\t'],
    ['for', 'Цикл for', 'for i in range($0):\n\t'],
    ['while', 'Цикл while', 'while $0:\n\t'],
    ['if', 'Условие', 'if $0:\n\t'],
    ['try', 'try / except', 'try:\n\t$0\nexcept Exception as e:\n\tprint(e)'],
    ['class', 'Класс', 'class $0:\n\tdef __init__(self):\n\t\t'],
    ['main', 'Точка входа', 'if __name__ == "__main__":\n\t$0'],
    ['import', 'Импорт', 'import $0'],
    ['elif', 'Иначе если', 'elif $0:\n\t'],
    ['else', 'Иначе', 'else:\n\t$0'],
    ['return', 'return', 'return $0'],
    ['lambda', 'lambda', 'lambda $0: '],
    ['comp', 'Список-генератор', '[x for x in $0]'],
    ['enumerate', 'enumerate', 'for i, x in enumerate($0):\n\t'],
    ['len', 'Длина', 'len($0)'],
    ['range', 'range', 'range($0)'],
    ['dict', 'Словарь', '{"$0": }'],
    ['random', 'Случайное число', 'import random\nrandom.randint(1, $0)']
  ]
};
const SN2 = {
  html: [
    ['class', 'Атрибут class', 'class="$0"'],
    ['id', 'Атрибут id', 'id="$0"'],
    ['anchor', 'Ссылка <a>', '<a href="$0"></a>'],
    ['span', 'Строчный блок', '<span>$0</span>'],
    ['section', 'Секция', '<section>\n\t$0\n</section>'],
    ['header', 'Шапка', '<header>\n\t$0\n</header>'],
    ['footer', 'Подвал', '<footer>\n\t$0\n</footer>'],
    ['nav', 'Меню', '<nav>\n\t$0\n</nav>'],
    ['main', 'Основной блок', '<main>\n\t$0\n</main>'],
    ['para', 'Абзац', '<p>$0</p>'],
    ['h2', 'Заголовок 2', '<h2>$0</h2>'],
    ['h3', 'Заголовок 3', '<h3>$0</h3>'],
    ['ol', 'Нумерованный список', '<ol>\n\t<li>$0</li>\n</ol>'],
    ['li', 'Пункт списка', '<li>$0</li>'],
    ['table', 'Таблица', '<table>\n\t<tr>\n\t\t<th>$0</th>\n\t</tr>\n\t<tr>\n\t\t<td></td>\n\t</tr>\n</table>'],
    ['textarea', 'Многострочное поле', '<textarea>$0</textarea>'],
    ['select', 'Выпадающий список', '<select>\n\t<option>$0</option>\n</select>'],
    ['label', 'Подпись', '<label>$0</label>'],
    ['video', 'Видео', '<video src="$0" controls></video>'],
    ['comment', 'Комментарий', '<!' + '-- $0 -->'],
    ['br', 'Перенос строки', '<br>'],
    ['hr', 'Линия', '<hr>']
  ],
  css: [
    ['class', 'Класс', '.$0 {\n\t\n}'],
    ['margin', 'отступ снаружи', 'margin: $0;'],
    ['margin-top', 'отступ сверху', 'margin-top: $0;'],
    ['margin-bottom', 'отступ снизу', 'margin-bottom: $0;'],
    ['margin-left', 'отступ слева', 'margin-left: $0;'],
    ['margin-right', 'отступ справа', 'margin-right: $0;'],
    ['padding', 'отступ внутри', 'padding: $0;'],
    ['padding-top', 'внутри сверху', 'padding-top: $0;'],
    ['padding-bottom', 'внутри снизу', 'padding-bottom: $0;'],
    ['padding-left', 'внутри слева', 'padding-left: $0;'],
    ['padding-right', 'внутри справа', 'padding-right: $0;'],
    ['color', 'цвет текста', 'color: $0;'],
    ['background', 'фон', 'background: $0;'],
    ['background-color', 'цвет фона', 'background-color: $0;'],
    ['background-image', 'картинка фона', 'background-image: url($0);'],
    ['background-size', 'cover / contain', 'background-size: $0;'],
    ['font-size', 'размер шрифта', 'font-size: $0;'],
    ['font-weight', '400 / 700', 'font-weight: $0;'],
    ['font-family', 'шрифт', 'font-family: $0;'],
    ['line-height', 'высота строки', 'line-height: $0;'],
    ['letter-spacing', 'между буквами', 'letter-spacing: $0;'],
    ['text-align', 'left / center / right', 'text-align: $0;'],
    ['text-decoration', 'none / underline', 'text-decoration: $0;'],
    ['text-transform', 'uppercase / lowercase', 'text-transform: $0;'],
    ['width', 'ширина', 'width: $0;'],
    ['height', 'высота', 'height: $0;'],
    ['max-width', 'макс. ширина', 'max-width: $0;'],
    ['min-height', 'мин. высота', 'min-height: $0;'],
    ['display', 'block / flex / grid / none', 'display: $0;'],
    ['position', 'relative / absolute / fixed', 'position: $0;'],
    ['top', 'от верха', 'top: $0;'],
    ['bottom', 'от низа', 'bottom: $0;'],
    ['left', 'от левого края', 'left: $0;'],
    ['right', 'от правого края', 'right: $0;'],
    ['z-index', 'слой', 'z-index: $0;'],
    ['overflow', 'hidden / auto / scroll', 'overflow: $0;'],
    ['opacity', 'прозрачность 0–1', 'opacity: $0;'],
    ['cursor', 'pointer / default', 'cursor: $0;'],
    ['border-radius', 'скругление', 'border-radius: $0;'],
    ['border-bottom', 'линия снизу', 'border-bottom: $0;'],
    ['box-shadow', 'тень блока', 'box-shadow: $0;'],
    ['box-sizing', 'border-box', 'box-sizing: border-box;'],
    ['transform', 'поворот, масштаб', 'transform: $0;'],
    ['animation', 'анимация', 'animation: $0;'],
    ['flex-direction', 'row / column', 'flex-direction: $0;'],
    ['flex-wrap', 'wrap', 'flex-wrap: wrap;'],
    ['justify-content', 'center / space-between', 'justify-content: $0;'],
    ['align-items', 'center / flex-start', 'align-items: $0;'],
    ['gap', 'промежуток', 'gap: $0;'],
    ['grid-template-columns', 'колонки сетки', 'grid-template-columns: $0;'],
    ['object-fit', 'cover / contain', 'object-fit: $0;'],
    ['white-space', 'nowrap / pre', 'white-space: $0;'],
    ['list-style', 'none', 'list-style: none;'],
    ['outline', 'контур', 'outline: $0;'],
    ['visibility', 'hidden / visible', 'visibility: $0;'],
    ['content', 'для ::before', 'content: "$0";']
  ],
  js: [
    ['class', 'Класс', 'class $0 {\n\tconstructor() {\n\t\t\n\t}\n}'],
    ['const', 'Константа', 'const $0 = ;'],
    ['let', 'Переменная', 'let $0 = ;'],
    ['while', 'Цикл while', 'while ($0) {\n\t\n}'],
    ['foreach', 'Перебор массива', '$0.forEach(item => {\n\t\n});'],
    ['map', 'Преобразовать массив', '$0.map(item => item)'],
    ['filter', 'Отфильтровать массив', '$0.filter(item => item)'],
    ['switch', 'switch', 'switch ($0) {\n\tcase 1:\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}'],
    ['try', 'try / catch', 'try {\n\t$0\n} catch (e) {\n\tconsole.error(e);\n}'],
    ['fetch', 'Запрос данных', "fetch('$0')\n\t.then(r => r.json())\n\t.then(data => console.log(data));"],
    ['getid', 'Найти по id', "document.getElementById('$0')"],
    ['create', 'Создать элемент', "document.createElement('$0')"],
    ['interval', 'Повтор по таймеру', 'setInterval(() => {\n\t$0\n}, 1000);'],
    ['alert', 'Окошко', "alert('$0');"],
    ['return', 'return', 'return $0;']
  ],
  py: [
    ['browser', 'Страница из Python', 'from browser import document, html, bind, window, alert\n'],
    ['bind', 'Обработчик клика', '@bind(document["$0"], "click")\ndef on_click(ev):\n\t'],
    ['document', 'Элемент по id', 'document["$0"]'],
    ['timer', 'Таймер', 'from browser import timer\n\ntimer.set_interval($0, 1000)'],
    ['elif', 'Иначе если', 'elif $0:\n\t'],
    ['else', 'Иначе', 'else:\n\t$0'],
    ['return', 'return', 'return $0'],
    ['lambda', 'Короткая функция', 'lambda $0: '],
    ['with', 'Открыть файл', 'with open("$0") as f:\n\t'],
    ['comp', 'Список из цикла', '[x for x in $0]'],
    ['len', 'Длина', 'len($0)'],
    ['range', 'Диапазон', 'range($0)'],
    ['enumerate', 'Перебор с номерами', 'for i, x in enumerate($0):\n\t'],
    ['dict', 'Словарь', '{"$0": }'],
    ['from', 'Импорт из модуля', 'from $0 import ']
  ]
};

const PYX = [
'print|вывод|print($0)','printsep|print с sep/end|print($0, sep=", ", end="\\n")','input|ввод строки|input("$0")','inputint|ввод числа|int(input("$0"))','inputlist|числа через пробел|list(map(int, input().split()))',
'int|в целое|int($0)','float|в дробное|float($0)','str|в строку|str($0)','bool|в логическое|bool($0)','list|список|list($0)','tuple|кортеж|tuple($0)','set|множество|set($0)','dict|словарь|dict($0)','frozenset|неизменяемое множество|frozenset($0)',
'len|длина|len($0)','range|диапазон|range($0)','sum|сумма|sum($0)','min|минимум|min($0)','max|максимум|max($0)','abs|модуль|abs($0)','round|округлить|round($0, 2)','pow|степень|pow($0, 2)','divmod|частное и остаток|divmod($0, )',
'sorted|отсортировать|sorted($0)','sortedkey|сортировка по ключу|sorted($0, key=lambda x: x, reverse=False)','reversed|в обратном порядке|reversed($0)','enumerate|с номерами|enumerate($0)','zip|склеить списки|zip($0)','map|применить функцию|map($0, )','filter|отфильтровать|filter($0, )',
'any|хоть один True|any($0)','all|все True|all($0)','isinstance|проверка типа|isinstance($0, )','type|тип значения|type($0)','id|адрес объекта|id($0)','hash|хеш|hash($0)','repr|строка-представление|repr($0)','chr|символ по коду|chr($0)','ord|код символа|ord($0)','bin|двоичная запись|bin($0)','hex|шестнадцатеричная|hex($0)','oct|восьмеричная|oct($0)',
'format|форматирование|format($0, ".2f")','fstring|f-строка|f"{$0}"','fdebug|f-строка с именем|f"{$0=}"','fwidth|f-строка с шириной|f"{$0:>10.2f}"','open|открыть файл|open("$0", "r", encoding="utf-8")','iter|итератор|iter($0)','next|следующий элемент|next($0, None)','callable|можно вызвать?|callable($0)','getattr|атрибут по имени|getattr($0, "name", None)','setattr|задать атрибут|setattr($0, "name", value)','hasattr|есть атрибут?|hasattr($0, "name")','vars|атрибуты объекта|vars($0)','dir|список имён|dir($0)','help|справка|help($0)','globals|глобальные имена|globals()','locals|локальные имена|locals()','exit|завершить|exit()','slice|срез|slice($0)','bytes|байты|bytes($0)','bytearray|массив байтов|bytearray($0)','complex|комплексное|complex($0)','eval|вычислить выражение|eval($0)','exec|выполнить код|exec($0)',
'for|цикл for|for $0 in :\n\t','forrange|цикл по числам|for i in range($0):\n\t','forenum|цикл с номерами|for i, x in enumerate($0):\n\t','forzip|цикл по двум спискам|for a, b in zip($0, ):\n\t','foritems|цикл по словарю|for k, v in $0.items():\n\t','while|цикл while|while $0:\n\t','whiletrue|бесконечный цикл|while True:\n\t$0\n\tif :\n\t\tbreak','break|выйти из цикла|break','continue|следующая итерация|continue','pass|ничего не делать|pass',
'if|условие|if $0:\n\t','ifelse|if / else|if $0:\n\t\nelse:\n\t','ifelif|if / elif / else|if $0:\n\t\nelif :\n\t\nelse:\n\t','ternary|условное выражение|$0 if  else ','match|match / case|match $0:\n\tcase 1:\n\t\tpass\n\tcase _:\n\t\tpass','walrus|моржовый оператор|if (n := len($0)) > 0:\n\t','isnone|проверка на None|is None','isnotnone|не None|is not None',
'def|функция|def $0():\n\t','defargs|функция с параметрами|def $0(a, b=0, *args, **kwargs):\n\t','deftyped|функция с типами|def $0(x: int) -> int:\n\t','return|вернуть|return $0','yield|генератор|yield $0','yieldfrom|делегировать генератору|yield from $0','lambda|лямбда|lambda $0: ','global|глобальная переменная|global $0','nonlocal|внешняя переменная|nonlocal $0','decorator|декоратор|def $0(func):\n\tdef wrapper(*args, **kwargs):\n\t\treturn func(*args, **kwargs)\n\treturn wrapper','async|асинхронная функция|async def $0():\n\t','await|ждать|await $0','asyncrun|запустить asyncio|import asyncio\n\nasync def main():\n\t$0\n\nasyncio.run(main())',
'class|класс|class $0:\n\tdef __init__(self):\n\t\t','classinh|наследование|class $0(Base):\n\tdef __init__(self):\n\t\tsuper().__init__()\n\t\t','dataclass|датакласс|from dataclasses import dataclass\n\n@dataclass\nclass $0:\n\tx: int = 0','init|конструктор|def __init__(self$0):\n\t','str__|текст объекта|def __str__(self):\n\treturn $0','repr__|repr объекта|def __repr__(self):\n\treturn $0','len__|длина объекта|def __len__(self):\n\treturn $0','eq__|сравнение ==|def __eq__(self, other):\n\treturn $0','lt__|сравнение <|def __lt__(self, other):\n\treturn $0','add__|сложение +|def __add__(self, other):\n\treturn $0','getitem__|obj[i]|def __getitem__(self, i):\n\treturn $0','iter__|итерация|def __iter__(self):\n\treturn $0','next__|следующий|def __next__(self):\n\t$0','call__|вызов obj()|def __call__(self, *args):\n\t$0','enter__|with: вход|def __enter__(self):\n\treturn self','exit__|with: выход|def __exit__(self, exc_type, exc, tb):\n\treturn False','property|свойство|@property\ndef $0(self):\n\treturn self._$0','staticmethod|статический метод|@staticmethod\ndef $0():\n\t','classmethod|метод класса|@classmethod\ndef $0(cls):\n\t','abstract|абстрактный класс|from abc import ABC, abstractmethod\n\nclass $0(ABC):\n\t@abstractmethod\n\tdef run(self):\n\t\t','enum|перечисление|from enum import Enum\n\nclass $0(Enum):\n\tA = 1\n\tB = 2','namedtuple|именованный кортеж|from collections import namedtuple\n$0 = namedtuple("$0", ["x", "y"])','self|self|self.$0',
'try|try / except|try:\n\t$0\nexcept Exception as e:\n\tprint(e)','tryfull|try / except / else / finally|try:\n\t$0\nexcept ValueError as e:\n\tprint(e)\nelse:\n\tpass\nfinally:\n\tpass','exceptvalue|except ValueError|except ValueError:\n\t$0','exceptzero|except ZeroDivisionError|except ZeroDivisionError:\n\t$0','exceptkey|except KeyError|except KeyError:\n\t$0','exceptindex|except IndexError|except IndexError:\n\t$0','exceptmulti|несколько исключений|except (ValueError, TypeError) as e:\n\t$0','raise|вызвать исключение|raise ValueError("$0")','assert|проверка|assert $0, "сообщение"','customerr|своё исключение|class $0(Exception):\n\tpass','with|контекст|with $0 as f:\n\t','withopen|прочитать файл|with open("$0", encoding="utf-8") as f:\n\tdata = f.read()','withwrite|записать файл|with open("$0", "w", encoding="utf-8") as f:\n\tf.write("")','contextmanager|свой контекст|from contextlib import contextmanager\n\n@contextmanager\ndef $0():\n\tyield','del|удалить|del $0',
'comp|список-генератор|[x for x in $0]','compif|генератор с условием|[x for x in $0 if x]','compnest|вложенный генератор|[(i, j) for i in range($0) for j in range()]','setcomp|множество-генератор|{x for x in $0}','dictcomp|словарь-генератор|{k: v for k, v in $0}','genexp|выражение-генератор|($0 for x in )','unpack|распаковка|a, b = $0','star|звёздочка в распаковке|first, *rest = $0','swap|обмен значений|a, b = b, a','mergedict|слияние словарей|{**$0, **other}','slicerev|развернуть срезом|$0[::-1]',
'import|импорт|import $0','from|импорт из модуля|from $0 import ','main|точка входа|if __name__ == "__main__":\n\t$0','random|случайное число|import random\nrandom.randint(1, $0)','randchoice|случайный элемент|random.choice($0)','randshuffle|перемешать|random.shuffle($0)','randsample|выборка без повторов|random.sample($0, k=1)','randfloat|случайное дробное|random.random()',
'math|математика|import math','sqrt|корень|math.sqrt($0)','floor|вниз|math.floor($0)','ceil|вверх|math.ceil($0)','pi|число пи|math.pi','sin|синус|math.sin($0)','cos|косинус|math.cos($0)','log|логарифм|math.log($0)','gcd|НОД|math.gcd($0, )','factorial|факториал|math.factorial($0)','hypot|гипотенуза|math.hypot($0, )','isclose|почти равны|math.isclose($0, )',
'time|время|import time\ntime.time()','sleep|пауза|time.sleep($0)','perf|замер времени|import time\nstart = time.perf_counter()\n$0\nprint(time.perf_counter() - start)','datetime|дата и время|from datetime import datetime, timedelta, date\nnow = datetime.now()','strftime|дата в строку|datetime.now().strftime("%d.%m.%Y %H:%M")','strptime|строка в дату|datetime.strptime("$0", "%d.%m.%Y")','timedelta|интервал|timedelta(days=$0)',
'json|JSON|import json','jsondumps|в JSON-строку|json.dumps($0, ensure_ascii=False, indent=2)','jsonloads|из JSON-строки|json.loads($0)','re|регулярки|import re','research|найти по шаблону|re.search(r"$0", text)','refindall|все совпадения|re.findall(r"$0", text)','resub|заменить по шаблону|re.sub(r"$0", "", text)','resplit|разбить по шаблону|re.split(r"$0", text)','recompile|скомпилировать шаблон|re.compile(r"$0")',
'collections|коллекции|from collections import Counter, defaultdict, deque, OrderedDict','counter|подсчёт элементов|Counter($0).most_common(3)','defaultdict|словарь со значением по умолчанию|defaultdict(list)','deque|двусторонняя очередь|deque($0)','itertools|итераторы|import itertools','permutations|перестановки|itertools.permutations($0)','combinations|сочетания|itertools.combinations($0, 2)','product|декартово произведение|itertools.product($0, repeat=2)','chain|склеить итерируемые|itertools.chain($0)','accumulate|накопленная сумма|itertools.accumulate($0)','groupby|группировка|itertools.groupby($0, key=lambda x: x)','functools|функции высшего порядка|from functools import reduce, lru_cache, partial','reduce|свёртка|reduce(lambda a, b: a + b, $0)','lrucache|кеш результатов|@lru_cache(maxsize=None)\ndef $0(n):\n\t','partial|частичное применение|partial($0, )','heapq|куча|import heapq','heappush|в кучу|heapq.heappush($0, x)','heappop|из кучи|heapq.heappop($0)','bisect|бинарный поиск|import bisect\nbisect.bisect_left($0, x)',
'sys|система|import sys','argv|аргументы|sys.argv','stdin|читать строки|sys.stdin.readline()','stdout|писать в stdout|sys.stdout.write($0)','recursion|лимит рекурсии|sys.setrecursionlimit($0)','os|ОС|import os','exists|файл существует|os.path.exists($0)','listdir|файлы в папке|os.listdir($0)','typing|типы|from typing import List, Dict, Optional, Tuple, Union, Callable, Any','optional|необязательный тип|Optional[$0]','string|модуль string|import string\nstring.ascii_lowercase','copy|копирование|import copy\ncopy.deepcopy($0)','decimal|точные дроби|from decimal import Decimal\nDecimal("$0")','fractions|обыкновенные дроби|from fractions import Fraction\nFraction($0, 1)','statistics|статистика|import statistics\nstatistics.mean($0)','textwrap|перенос текста|import textwrap\ntextwrap.fill($0, 40)','uuid|уникальный id|import uuid\nstr(uuid.uuid4())','hashlib|хеш-сумма|import hashlib\nhashlib.sha256($0.encode()).hexdigest()','base64|кодирование base64|import base64\nbase64.b64encode($0.encode()).decode()','csv|CSV|import csv','pprint|красивый вывод|from pprint import pprint\npprint($0)','threading|потоки|import threading','logging|логи|import logging\nlogging.basicConfig(level=logging.INFO)\nlogging.info("$0")','unittest|тесты|import unittest\n\nclass Test$0(unittest.TestCase):\n\tdef test_one(self):\n\t\tself.assertEqual(1, 1)',
'fizzbuzz|FizzBuzz|for i in range(1, 101):\n\tif i % 15 == 0:\n\t\tprint("FizzBuzz")\n\telif i % 3 == 0:\n\t\tprint("Fizz")\n\telif i % 5 == 0:\n\t\tprint("Buzz")\n\telse:\n\t\tprint(i)','fib|числа Фибоначчи|def fib(n):\n\ta, b = 0, 1\n\tfor _ in range(n):\n\t\ta, b = b, a + b\n\treturn a','isprime|простое число|def is_prime(n):\n\tif n < 2:\n\t\treturn False\n\tfor i in range(2, int(n ** 0.5) + 1):\n\t\tif n % i == 0:\n\t\t\treturn False\n\treturn True','binsearch|бинарный поиск|def bin_search(a, x):\n\tlo, hi = 0, len(a) - 1\n\twhile lo <= hi:\n\t\tmid = (lo + hi) // 2\n\t\tif a[mid] == x:\n\t\t\treturn mid\n\t\tif a[mid] < x:\n\t\t\tlo = mid + 1\n\t\telse:\n\t\t\thi = mid - 1\n\treturn -1','guess|игра угадай число|import random\n\nsecret = random.randint(1, 100)\nwhile True:\n\tg = int(input("Число: "))\n\tif g == secret:\n\t\tprint("Верно!")\n\t\tbreak\n\tprint("Больше" if secret > g else "Меньше")'
].map(l => { const a = l.indexOf('|'), b = l.indexOf('|', a + 1); return [l.slice(0, a), l.slice(a + 1, b), l.slice(b + 1)]; });
const PYM = ['append|добавить в конец','extend|добавить список','insert|вставить по индексу','remove|удалить значение','pop|достать элемент','clear|очистить','index|найти индекс','count|посчитать','sort|сортировать на месте','reverse|развернуть','copy|копия','join|склеить строки','split|разбить строку','rsplit|разбить справа','splitlines|разбить по строкам','strip|убрать пробелы по краям','lstrip|убрать слева','rstrip|убрать справа','replace|заменить','find|найти позицию','rfind|найти справа','startswith|начинается с','endswith|заканчивается на','upper|в верхний регистр','lower|в нижний регистр','capitalize|первая заглавная','title|каждое слово с заглавной','swapcase|поменять регистр','center|по центру','ljust|выровнять влево','rjust|выровнять вправо','zfill|дополнить нулями','isdigit|только цифры?','isalpha|только буквы?','isalnum|буквы и цифры?','isspace|пробелы?','isupper|верхний регистр?','islower|нижний регистр?','format|подставить значения','encode|в байты','decode|из байтов','partition|разделить на 3 части','removeprefix|убрать начало','removesuffix|убрать конец','keys|ключи','values|значения','items|пары ключ-значение','get|значение или по умолчанию','setdefault|значение, создав при отсутствии','update|обновить','popitem|достать последнюю пару','fromkeys|словарь из ключей','add|добавить в множество','discard|убрать без ошибки','union|объединение','intersection|пересечение','difference|разность','symmetric_difference|симметричная разность','issubset|подмножество?','issuperset|надмножество?','isdisjoint|нет общих?','read|прочитать файл','readline|одна строка','readlines|все строки','write|записать','writelines|записать строки','close|закрыть','flush|сбросить буфер','seek|перейти в позицию','appendleft|добавить слева','popleft|достать слева','most_common|самые частые','bit_length|число бит','to_bytes|в байты','isoformat|дата в ISO','timestamp|метка времени','group|группа совпадения','groups|все группы','span|границы совпадения','sub|заменить по шаблону','findall|все совпадения','finditer|итератор совпадений','match|совпадение с начала','search|поиск'].map(l => { const [a, b] = l.split('|'); return [a, b, a + '($0)']; });
SN.py = SN.py.filter(x => !PYX.some(y => y[0] === x[0])).concat(PYX);
for (const k in SN2) SN2[k].forEach(s => { if (!SN[k].some(x => x[0] === s[0])) SN[k].push(s); });
function hideSug(){ sugList = []; sug.style.display = 'none'; }
function drawSug(){
  sug.innerHTML = sugList.map((s, i) => '<div class="si' + (i === sugI ? ' on' : '') + '" data-i="' + i + '"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>').join('') + '<div class="sh">Tab — вставить</div>';
}
function updateSug(){
  const v = code.value, p = code.selectionStart, ls = v.lastIndexOf('\n', p - 1) + 1;
  const m = (cur === 'css' ? /[\w-]+$/ : /\w+$/).exec(v.slice(ls, p)), w = m ? m[0].toLowerCase() : '';
  const om = cur === 'py' ? /([A-Za-z_]\w*)\.\w*$/.exec(v.slice(ls, p)) : null, dotM = !!om;
  if (w.length < (dotM ? 1 : 2) || code.selectionEnd !== p || (cur === 'css' && v.slice(ls, p - w.length).includes(':'))) return hideSug();
  let pool = dotM ? (om[1] === 'self' ? selfAttrs(v) : (MODM[om[1]] || PYM)) : (SN[cur] || []);
  if (!dotM && (cur === 'py' || cur === 'js')) { const seen = new Set(pool.map(x => x[0].toLowerCase())); (v.match(/[A-Za-z_]\w{2,}/g) || []).forEach(x => { const k = x.toLowerCase(); if (!seen.has(k) && k !== w) { seen.add(k); pool = pool.concat([[x, 'из кода', x]]); } }); }
  const pre = pool.filter(s => s[0].toLowerCase().startsWith(w)).sort((a, b) => (a[1] === 'из кода') - (b[1] === 'из кода') || a[0].length - b[0].length);
  sugList = pre.concat(w.length > 2 ? pool.filter(s => !s[0].toLowerCase().startsWith(w) && (s[0].toLowerCase().includes(w) || s[1].toLowerCase().includes(w))) : []).slice(0, 10);
  if (!sugList.length) return hideSug();
  sugI = 0; drawSug();
  const row = v.slice(0, ls).split('\n').length - 1;
  sug.style.top = (16 + (row + 1) * LH - code.scrollTop) + 'px';
  sug.style.left = (code.offsetLeft + 16 + (p - ls - w.length) * cw - code.scrollLeft) + 'px';
  sug.style.display = 'block';
}
function accept(s){
  const v = code.value, p = code.selectionStart, ls = v.lastIndexOf('\n', p - 1) + 1, before = v.slice(ls, p);
  let st = p - (cur === 'css' ? /[\w-]+$/ : /\w+$/).exec(before)[0].length;
  if (cur === 'html' && v[st - 1] === '<') st--;
  const sp = /^[ \t]*/.exec(before)[0], unit = ' '.repeat(ind());
  let t = s[2].replace(/\t/g, unit).split('\n').join('\n' + sp);
  const k = t.indexOf('$0'); t = t.replace('$0', '');
  code.setSelectionRange(st, p);
  document.execCommand('insertText', false, t);
  const q = st + (k < 0 ? t.length : k); code.setSelectionRange(q, q);
  hideSug();
}
sug.addEventListener('pointerdown', e => { e.preventDefault(); const i = e.target.closest('.si'); if (i) accept(sugList[+i.dataset.i]); });
code.addEventListener('blur', hideSug);
code.addEventListener('click', hideSug);
code.addEventListener('scroll', hideSug);
function renderTabs(){
  tabsEl.innerHTML = tabs.map((t, i) => '<div class="tab' + (i === ai ? ' on' : '') + '" role="tab" tabindex="' + (i === ai ? 0 : -1) + '" aria-selected="' + (i === ai) + '" data-i="' + i + '"><span>' + folderHtml(t.name) + '</span>' + (tabs.length > 1 ? '<b data-x="' + i + '" role="button" tabindex="-1" aria-label="Закрыть ' + esc(t.name) + '">×</b>' : '') + '</div>').join('') + '<div class="tab add" role="button" tabindex="0" aria-label="Новый файл" data-add="1">+</div>';
}
function switchTab(i){
  ai = i; cur = tabs[i].lang; lang.value = cur; code.value = tabs[i].code; out.srcdoc = '';
  save(); renderTabs(); update();
  try { syncLangBtn(); } catch(e) {}
}
function newTab(){ tabs.push({ name: tabName(cur), lang: cur, code: '' }); switchTab(tabs.length - 1); code.focus(); }
function closeTab(i){
  if (tabs.length < 2) return;
  if (tabs[i].code && !confirm('Закрыть «' + tabs[i].name + '»?')) return;
  tabs.splice(i, 1); if (i < ai) ai--; switchTab(Math.min(ai, tabs.length - 1));
}
function renameTab(i){
  const t = tabs[i], v = prompt('Название файла. Можно с папкой, например css/style.css', t.name); if (v === null) return;
  const n = cleanName(v); if (!n) return;
  if (tabs.some((x, j) => j !== i && x.name === n)) { say('Файл «' + n + '» уже есть'); return; }
  t.name = n; const l = langOf(n);
  if (l && l !== t.lang) { t.lang = l; switchTab(i); } else { save(); renderTabs(); }
}
function newFile(){
  const v = prompt('Имя нового файла, например index.html или js/app.js', DEFN[cur] || 'file.txt'); if (v === null) return;
  const n = cleanName(v); if (!n) return;
  if (tabs.some(x => x.name === n)) { say('Файл «' + n + '» уже есть'); return; }
  tabs.push({ name: n, lang: langOf(n) || cur, code: '' }); switchTab(tabs.length - 1); code.focus();
}
function demoProject(){
  const names = ['index.html', 'css/style.css', 'js/app.js'];
  if (tabs.some(t => names.includes(t.name))) { say('Файлы примера уже есть'); return; }
  tabs.push({ name: 'index.html', lang: 'html', code: '<!doctype html>\n<html lang="ru">\n<head>\n  <meta charset="utf-8">\n  <title>Проект</title>\n  <link rel="stylesheet" href="css/style.css">\n</head>\n<body>\n  <h1 id="title">Проект из трёх файлов</h1>\n  <button id="btn">Нажми</button>\n  <script src="js/app.js"><\/script>\n</body>\n</html>\n' });
  tabs.push({ name: 'css/style.css', lang: 'css', code: 'body {\n  font-family: sans-serif;\n  padding: 24px;\n}\nbutton {\n  padding: 8px 16px;\n}\n' });
  tabs.push({ name: 'js/app.js', lang: 'js', code: "let n = 0;\ndocument.getElementById('btn').onclick = () => {\n  n++;\n  document.getElementById('title').textContent = 'Нажатий: ' + n;\n  console.log('Нажатий:', n);\n};\n" });
  switchTab(tabs.length - 3); say('Добавлен пример: 3 файла, связанные по имени');
}
let lpT = null, lpFired = false;
tabsEl.addEventListener('pointerdown', e => {
  const t = e.target.closest('[data-i]'); if (e.pointerType !== 'touch' || !t || e.target.closest('[data-x]')) return;
  lpFired = false; clearTimeout(lpT); lpT = setTimeout(() => { lpFired = true; renameTab(+t.dataset.i); }, 650);
});
['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach(ev => tabsEl.addEventListener(ev, () => clearTimeout(lpT)));
// клавиатура: ←/→ переходят между вкладками, Enter/Пробел открывают, Delete закрывает, F2 переименовывает
tabsEl.addEventListener('keydown', e => {
  const x = e.target.closest('[data-x]'), a = e.target.closest('[data-add]'), t = e.target.closest('[data-i]');
  const back = () => { const on = tabsEl.querySelector('.tab.on'); if (on) on.focus(); };
  if (e.key === 'Enter' || e.key === ' ') {
    if (!x && !a && !t) return;
    e.preventDefault(); (x || a || t).click(); setTimeout(back, 0);
  } else if (t && !x && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault(); const i = Math.max(0, Math.min(tabs.length - 1, +t.dataset.i + (e.key === 'ArrowRight' ? 1 : -1)));
    switchTab(i); setTimeout(back, 0);
  } else if (t && !x && e.key === 'Delete') { e.preventDefault(); closeTab(+t.dataset.i); setTimeout(back, 0); }
  else if (t && !x && e.key === 'F2') { e.preventDefault(); renameTab(+t.dataset.i); }
});
tabsEl.addEventListener('click', e => {
  if (lpFired) { lpFired = false; return; }
  const x = e.target.closest('[data-x]'), a = e.target.closest('[data-add]'), t = e.target.closest('[data-i]');
  if (x) closeTab(+x.dataset.x); else if (a) newTab();
  else if (t) {
    const i = +t.dataset.i;
    if (e.detail === 2) renameTab(i);
    else if (i !== ai) switchTab(i);
  }
});

const KW = {
  js: new Set('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await null undefined true false'.split(' ')),
  py: new Set('and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False async await'.split(' '))
};
const RE = {
  js: /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?)|(\b0x[\da-f]+\b|\b\d[\d_]*\.?\d*(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)|([\s\S])/gi,
  py: /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b\d[\d_]*\.?\d*(?:e[+-]?\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/gi
};
function lex(src, kind, off, out){
  const re = new RegExp(RE[kind].source, 'gi'); let m;
  while ((m = re.exec(src))) {
    let c = '';
    if (m[1] !== undefined) c = 'c';
    else if (m[2] !== undefined) c = 's';
    else if (m[3] !== undefined) c = 'n';
    else if (m[4] !== undefined) c = KW[kind].has(m[4]) ? 'k' : (src[re.lastIndex] === '(' ? 'f' : '');
    out.push([off + m.index, off + m.index + m[0].length, c]);
  }
}
function lexHtml(src, out){
  const re = /(<!\-\-[\s\S]*?(?:\-\->|$))|(<script\b[^>]*>)([\s\S]*?)(<\/script>|$)|(<\/?[A-Za-z][\w:-]*|\/?>)|("[^"]*"|'[^']*')|(\s[\w:-]+(?==))|([\s\S])/gi; let m;
  while ((m = re.exec(src))) {
    const a = m.index, len = m[0].length;
    if (m[1] !== undefined) out.push([a, a + len, 'c']);
    else if (m[2] !== undefined) {
      const b = a + m[2].length;
      out.push([a, b, 't']);
      lex(m[3], 'js', b, out);
      if (m[4]) out.push([b + m[3].length, a + len, 't']);
    }
    else if (m[5] !== undefined) out.push([a, a + len, 't']);
    else if (m[6] !== undefined) out.push([a, a + len, 's']);
    else if (m[7] !== undefined) out.push([a, a + len, 'a']);
    else out.push([a, a + 1, '']);
  }
}
function checkCss(src){
  const re = /\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|[{}]/g, st = []; let m;
  while ((m = re.exec(src))) {
    if (m[0] === '{') st.push(m.index);
    else if (m[0] === '}') { if (!st.length) return { pos: m.index, msg: 'Лишняя }' }; st.pop(); }
  }
  return st.length ? { pos: st[st.length - 1], msg: 'Не закрыта {' } : null;
}
function lexCss(src, out){
  const re = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(#[\da-f]{3,8}\b|\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?)|(@[\w-]+)|([\w-]+)|([{}])|([\s\S])/gi; let m, d = 0;
  while ((m = re.exec(src))) {
    const a = m.index, b = a + m[0].length; let c = '';
    if (m[1] !== undefined) c = 'c';
    else if (m[2] !== undefined) c = 's';
    else if (m[6] !== undefined) d += m[6] === '{' ? 1 : -1;
    else if (m[4] !== undefined) c = 'k';
    else if (m[3] !== undefined) c = d > 0 ? 'n' : '';
    else if (m[5] !== undefined) c = d > 0 ? (/^\s*:/.test(src.slice(b)) ? 'a' : '') : 't';
    out.push([a, b, c]);
  }
}
// ===== ПЕРЕВОД ОШИБОК И ЗАЩИТА ОТ ЗАЦИКЛИВАНИЯ =====
// (флаги regexp тут не переносятся в iframe: пиши шаблоны без /i)
const RU = [
  [/No module named '?js\b/, 'Модуля js здесь нет. Для окон и страницы используйте Brython: from browser import window, alert, document. Для вывода хватит print() и input()'],
  [/(?:(?:js|javascript)\W.*has no attribute '?|AttributeError: )(window|alert|confirm|prompt|document)\b/, 'js.$1 в Python-режиме не работает: код идёт без страницы. Используйте print()/input() или from browser import window, alert, document'],
  [/([^\s']+) is not defined/, 'Имя «$1» не определено: проверь написание или объяви его раньше'],
  [/name '([^']+)' is not defined/, 'Имя «$1» не определено: проверь написание или объяви его раньше'],
  [/Identifier '([^']+)' has already been declared/, 'Имя «$1» уже объявлено выше'],
  [/Assignment to constant variable/, 'Нельзя менять значение константы (const)'],
  [/Cannot read propert(?:y|ies) of (?:undefined|null)|(?:null|undefined) is not an object|can't access property .*?, \S+ is (?:null|undefined)/i, 'Обращение к значению, которого нет (undefined или null)'],
  [/Can't find variable: (\S+)/, 'Имя «$1» не определено: проверь написание или объяви его раньше'],
  [/(\S+) is not a function/, '«$1» не является функцией'],
  [/Unterminated string/, 'Не закрыта строка: не хватает кавычки'],
  [/Unexpected end of input|Unexpected EOF|Unexpected end of script|Unterminated template/, 'Код оборван: не хватает закрывающей скобки или кавычки'],
  [/Unexpected token|Unexpected character|Unexpected identifier|Unexpected keyword|Unexpected number|Unexpected string/, 'Лишний или неожиданный символ: проверь скобки, запятые и кавычки'],
  [/Maximum call stack size exceeded|too much recursion|maximum recursion depth exceeded/, 'Слишком глубокая рекурсия: функция бесконечно вызывает сама себя, добавь условие выхода'],
  [/division or modulo by zero|division by zero/i, 'Деление на ноль'],
  [/list index out of range/, 'Индекс за пределами списка'],
  [/invalid literal for int/, 'Это нельзя превратить в целое число'],
  [/expected an indented block/, 'После двоеточия нужен отступ'],
  [/unindent does not match|unexpected indent/, 'Неправильные отступы'],
  [/bad input/, 'Синтаксическая ошибка: проверь скобки, кавычки и двоеточия'],
  [/NameError: (?:global )?name '([^']+)'/, 'Имя «$1» не определено'],
  [/ZeroDivisionError/, 'Деление на ноль'],
  [/IndexError: .*out of range/, 'Индекс за пределами списка или строки'],
  [/KeyError: ('?[^\n]*)/, 'В словаре нет ключа $1'],
  [/No module named '?([^'\s]+)/, 'Модуль «$1» недоступен в браузерной версии Python'],
  [/can only concatenate str|must be str, not int|unsupported operand type/, 'Нельзя смешивать разные типы: преврати значения через str() или int()'],
  [/object is not subscriptable/, 'К этому значению нельзя обращаться по [индексу]'],
  [/object is not callable/, 'Это значение нельзя вызвать как функцию: проверь скобки и имя'],
  [/has no attribute '([^']+)'/, 'У объекта нет атрибута или метода «$1»: проверь написание'],
  [/object is not iterable/, 'По этому значению нельзя делать for: оно не список, строка или range'],
  [/could not convert string to float|invalid literal for float/, 'Это нельзя превратить в число с точкой'],
  [/EOFError/, 'Программа ждала ввод, но данных нет'],
  [/unhashable type/, 'Список или словарь нельзя использовать как ключ словаря или элемент set'],
  [/was never closed/, 'Не закрыта скобка: не хватает закрывающей'],
  [/unmatched '(.)'/, 'Лишняя закрывающая скобка $1'],
  [/expected ':'/, 'Не хватает двоеточия в конце строки'],
  [/unterminated (?:triple-quoted )?string/, 'Не закрыта строка: не хватает кавычки'],
  [/Missing parentheses in call to 'print'/, 'В Python 3 print нужно писать со скобками: print(...)'],
  [/cannot assign to (\S+)/, 'Нельзя присваивать значение: $1'],
  [/invalid syntax/, 'Синтаксическая ошибка: проверь скобки, кавычки и двоеточия'],
  [/run time limit/, 'Программа выполняется слишком долго: возможно, бесконечный цикл'],
  [/^(?:Promise: )?Script error\.?$/, 'Синтаксическая ошибка в скрипте: смотри красное подчёркивание в редакторе']
];
const ruErr = s => { s = String(s); for (const [re, t] of RU) { const m = re.exec(s); if (m) return t.replace('$1', m[1]); } return s; };
// Защита страницы-результата (вставляется внутрь iframe через toString):
// 1) цикл дольше лимита: спрашиваем «Продолжить?» вместо жёсткой остановки (каждый следующий вопрос — через вдвое больший срок);
// 2) счётчик отложенных setTimeout / setInterval / requestAnimationFrame: понятная ошибка, когда их слишком много.
function gpreFn(){
  var W = window, lim = 4000, t0 = Date.now(), n = 0, dead = false, LIM = 1000, raw = {};
  // Safari в песочнице подменяет текст ошибки на «Script error.»: запоминаем настоящий текст, обработчики ошибок его подставят
  // и сразу печатаем его в консоль страницы: так текст виден, даже если событие error придёт обезличенным
  function fail(msg){ W.__lastErr = msg; try { console.error(msg); } catch (e) {} throw new Error(msg); }
  // время, пока открыто alert/confirm/prompt, в лимит не входит
  ['alert', 'confirm', 'prompt'].forEach(function(k){
    var o = W[k]; raw[k] = o;
    W[k] = function(){ var t = Date.now(); try { return o.apply(W, arguments); } finally { t0 += Date.now() - t; } };
  });
  W.__g = function(){
    if (dead) fail('Программа остановлена: слишком долгое выполнение (возможно, бесконечный цикл)');
    if ((++n & 63) !== 0 || Date.now() - t0 <= lim) return;
    var s = Math.round((Date.now() - t0) / 1000), ok = false;
    try { ok = raw.confirm.call(W, 'Программа выполняется уже ' + s + ' с. Возможно, это бесконечный цикл.\n\nПродолжить?'); } catch (e) {}
    if (!ok) { dead = true; fail('Программа остановлена: слишком долгое выполнение (возможно, бесконечный цикл)'); }
    t0 = Date.now(); lim *= 2;
  };
  var P = { setTimeout: new Set(), setInterval: new Set(), requestAnimationFrame: new Set() };
  function over(k){
    var tip = k === 'setInterval'
      ? 'Каждый вызов создаёт новый повторяющийся таймер, а старые не останавливаются. Сохраняйте id и вызывайте clearInterval(id).'
      : 'Скорее всего, таймер создаётся в цикле или функция планирует сама себя несколько раз за один вызов.';
    fail('Слишком много отложенных вызовов ' + k + ' (' + P[k].size + '). ' + tip);
  }
  function wrap(k){
    var o = W[k]; if (typeof o !== 'function') return;
    W[k] = function(f){
      var S = P[k]; if (S.size >= LIM) over(k);
      var a = Array.prototype.slice.call(arguments), id;
      if (k !== 'setInterval') {
        if (typeof f === 'function') a[0] = function(){ S.delete(id); return f.apply(this, arguments); };
        else if (k === 'setTimeout') a[0] = function(){ S.delete(id); return (0, eval)(String(f)); };
      }
      id = o.apply(W, a); S.add(id); return id;
    };
  }
  wrap('setTimeout'); wrap('setInterval'); wrap('requestAnimationFrame');
  function unwrap(k, sets){
    var o = W[k]; if (typeof o !== 'function') return;
    W[k] = function(id){ sets.forEach(function(x){ P[x].delete(id); }); return o.apply(W, arguments); };
  }
  unwrap('clearTimeout', ['setTimeout', 'setInterval']); unwrap('clearInterval', ['setTimeout', 'setInterval']); unwrap('cancelAnimationFrame', ['requestAnimationFrame']);
}
const GPRE = ';(' + gpreFn.toString() + ')();';
// Красивый вывод значений в console.log (запускается внутри iframe с результатом): [1, 2, 3], { a: 1 }, ошибки со стеком
function inspFn(v){
  var seen = [];
  function go(v, d){
    try {
      var t = typeof v;
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (t === 'string') return d ? JSON.stringify(v) : v;
      if (t === 'function') return 'ƒ ' + (v.name || '');
      if (t === 'bigint') return String(v) + 'n';
      if (t !== 'object') return String(v);
      if (v instanceof Error) return String(v.stack || v);
      if (v.nodeType === 1) return '<' + v.tagName.toLowerCase() + '>';
      if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
      if (v instanceof RegExp) return String(v);
      if (seen.indexOf(v) >= 0) return '[Circular]';
      if (d > 3) return Array.isArray(v) ? '[…]' : '{…}';
      seen.push(v);
      var r;
      if (Array.isArray(v)) r = v.length ? '[' + v.map(function(x){ return go(x, d + 1); }).join(', ') + ']' : '[]';
      else if (v instanceof Map) r = 'Map(' + v.size + ') {' + Array.from(v).map(function(e){ return go(e[0], d + 1) + ' => ' + go(e[1], d + 1); }).join(', ') + '}';
      else if (v instanceof Set) r = 'Set(' + v.size + ') {' + Array.from(v).map(function(x){ return go(x, d + 1); }).join(', ') + '}';
      else { var k = Object.keys(v); r = k.length ? '{ ' + k.map(function(n){ return n + ': ' + go(v[n], d + 1); }).join(', ') + ' }' : '{}'; }
      seen.pop();
      return r;
    } catch (e) { return '[object]'; }
  }
  return go(v, 0);
}
function guard(src){
  if (typeof acorn === 'undefined') return src;
  let ast; try { ast = acorn.parse(src, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }); } catch(e) { try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }); } catch(e2) { return src; } }
  const ins = [];
  (function walk(n){
    if (!n || typeof n.type !== 'string') return;
    if (/^(While|DoWhile|For|ForIn|ForOf)Statement$/.test(n.type)) {
      if (n.body.type === 'BlockStatement') ins.push([n.body.start + 1, '__g();']);
      else { ins.push([n.body.start, '{__g();']); ins.push([n.body.end, '}']); }
    }
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
  })(ast);
  ins.sort((a, b) => (b[0] - a[0]) || (a[1] === '}' ? -1 : 1));
  let o = src; for (const [p, t] of ins) o = o.slice(0, p) + t + o.slice(p);
  return o;
}
// ===== PYTHON + ВЕБ (Brython) и ЕДИНАЯ КОНСОЛЬ =====
const BRY = new URL('./', location.href).href; // Brython лежит рядом с index.html
// Python-код «веб-режима»: импортирует модуль browser
const pyWeb = s => /^[ \t]*(?:from[ \t]+browser(?:\.[\w.]+)?[ \t]+import|import[ \t]+browser\b)/m.test(s);
// Нужна ли стандартная библиотека (random, math, ...) — иначе не грузим лишние мегабайты
const pyNeedsLib = s => {
  const re = /^[ \t]*(?:from[ \t]+([\w.]+)[ \t]+import|import[ \t]+([\w., \t]+))/gm; let m;
  while ((m = re.exec(s))) {
    const names = (m[1] || m[2]).split(',').map(x => x.trim().split(/\s+/)[0]);
    if (names.some(n => n && !/^(browser(\.html)?|javascript)$/.test(n))) return true;
  }
  return false;
};
const pyTabs = () => tabs.filter(t => t.lang === 'py' && pyWeb(t.code)).map(t => t.code);
const PYPAGE = '<!doctype html><meta charset="utf-8"><body style="font:16px/1.5 system-ui,sans-serif;padding:16px"><div id="app"></div></body>';

// Эта функция целиком вставляется внутрь iframe с результатом (через toString)
function consoleBoot(o){
  var q = [], panel = null, list = null, last = '', lastT = 0, bufs = {};
  function tr(s){ for (var i = 0; i < o.ru.length; i++){ var m = new RegExp(o.ru[i][0]).exec(s); if (m) return o.ru[i][1].replace('$1', m[1]); } return s; }
  function fmt(a){ return Array.prototype.map.call(a, function(x){ var ins = window.__insp; if (typeof x === 'object' && x !== null){ try { var c = ins ? ins(x) : ''; if (c && c.length <= 72 && c.indexOf('\n') < 0) return c; return JSON.stringify(x, null, 2); } catch(e){} } return ins ? ins(x) : String(x); }).join(' '); }
  function mk(tag, css, txt){ var e = document.createElement(tag); e.setAttribute('style', css); if (txt) e.textContent = txt; return e; }
  function mount(){
    if (panel) return;
    panel = mk('div', 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:45%;display:none;flex-direction:column;background:' + o.bg + ';color:' + o.fg + ';border-top:1px solid ' + o.line + ';font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;text-align:left;box-sizing:border-box');
    var head = mk('div', 'display:flex;gap:12px;align-items:center;padding:3px 10px;border-bottom:1px solid ' + o.line + ';flex:none');
    head.appendChild(mk('b', 'margin-right:auto;font-weight:600', 'Консоль'));
    var clr = mk('span', 'cursor:pointer;opacity:.7', 'очистить'); clr.onclick = function(){ list.textContent = ''; };
    var cls = mk('span', 'cursor:pointer;opacity:.7;padding:0 4px', '✕'); cls.onclick = function(){ panel.style.display = 'none'; };
    head.appendChild(clr); head.appendChild(cls);
    list = mk('div', 'overflow:auto;padding:4px 0');
    panel.appendChild(head); panel.appendChild(list);
  }
  function draw(){
    if (!document.body){ if (!draw.w){ draw.w = 1; document.addEventListener('DOMContentLoaded', function(){ draw.w = 0; draw(); }); } return; }
    mount(); if (!panel.isConnected) document.body.appendChild(panel);
    while (q.length){ var m = q.shift(); list.appendChild(mk('div', 'white-space:pre-wrap;word-break:break-word;padding:1px 10px;' + (m[0] === 'e' ? 'color:' + o.err : ''), m[1] || '\u00a0')); }
    panel.style.display = 'flex'; list.scrollTop = list.scrollHeight;
  }
  function where(n){ for (var i = 0; i < o.offs.length; i++){ var f = o.offs[i], k = n - f[1]; if (k >= 1 && k <= f[2]) return f[0] + ', строка ' + k; } return ''; }
  function add(c, t, w){
    if (c === 'e'){
      var k = t, now = Date.now(); if (k === last && now - lastT < 150) return; last = k; lastT = now;
      var r = tr(t); if (r !== t) t = r + '  (' + t + ')';
      if (w) t = w + ': ' + t;
    }
    q.push([c, t]); draw();
  }
  ['log', 'info', 'warn', 'debug', 'dir', 'table'].forEach(function(k){ var f = console[k]; console[k] = function(){ add('', fmt(arguments)); try { f.apply(console, arguments); } catch(e){} }; });
  var fe = console.error; console.error = function(){ add('e', fmt(arguments)); try { fe.apply(console, arguments); } catch(e){} };
  if (o.pre) for (var pi = 0; pi < o.pre.length; pi++) add('e', o.pre[pi]);
  window.addEventListener('error', function(e){ var le = window.__lastErr; window.__lastErr = ''; var em = e.message; if (le && em && (em === 'Script error.' || em.indexOf(le) >= 0)) return; if (window.__bryLoading && em === 'Script error.') return; if (o.pre && o.pre.length && em === 'Script error.') return; if (em) add('e', em, e.lineno ? where(e.lineno) : ''); });
  window.addEventListener('unhandledrejection', function(e){ var r = e.reason; add('e', 'Promise: ' + ((r && r.message) || r)); });
  // Brython не загрузился: даём выбор, что делать
  window.__fail = function(){
    add('e', 'Не удалось загрузить Brython: нет интернета и нет файлов рядом с index.html');
    var box = mk('div', 'padding:4px 10px;display:flex;gap:8px;flex-wrap:wrap');
    var help = mk('div', 'display:none;white-space:pre-wrap;overflow-wrap:anywhere;padding:2px 10px 6px;opacity:.9', 'Чтобы работало без интернета: скачай эти файлы и положи рядом с index.html (на Netlify, в ту же папку, потом задеплой заново):\n\n' + o.cdn + 'brython.min.js\n' + o.cdn + 'brython_stdlib.js  (нужен только для import random, math и т.п.)\n\nПосле этого интернет не понадобится.');
    function btn(t, f){ var b = mk('button', 'font:inherit;cursor:pointer;padding:3px 10px;border-radius:6px;border:1px solid ' + o.line + ';background:transparent;color:' + o.fg, t); b.onclick = f; box.appendChild(b); }
    btn('↻ Повторить', function(){ parent.postMessage('ml-rerun', '*'); });
    btn('Как работать без интернета', function(){ help.style.display = help.style.display === 'none' ? 'block' : 'none'; });
    list.appendChild(box); list.appendChild(help); list.scrollTop = list.scrollHeight;
  };
  // сюда пишет Python (sys.stdout / sys.stderr): c = пустая строка (print) или 'e' (ошибки)
  window.mlw = function(c, s){
    for (var k0 in bufs){ if (k0 !== c && bufs[k0]){ add(k0, bufs[k0]); bufs[k0] = ''; } }
    bufs[c] = (bufs[c] || '') + s; var i;
    while ((i = bufs[c].indexOf('\n')) >= 0){ add(c, bufs[c].slice(0, i)); bufs[c] = bufs[c].slice(i + 1); }
    clearTimeout(window.__wt);
    window.__wt = setTimeout(function(){ for (var k in bufs){ if (bufs[k]){ add(k, bufs[k]); bufs[k] = ''; } } }, 40);
  };
}
addEventListener('message', e => { if (e.data === 'ml-rerun' && e.source === out.contentWindow) run(); });
const cboot = pre => '<script>window.__insp=(' + inspFn.toString() + ');<\/script><script>(' + consoleBoot.toString() + ')(' + JSON.stringify({ bg: cv('--outbg'), fg: cv('--text'), line: cv('--line'), err: cv('--err'), cdn: BRY, pre: pre || [], offs: '@@OFFS@@', ru: RU.map(([r, t]) => [r.source, t]) }).replace(/<\//g, '<\\/') + ')<\/script>';
const PYPRE = 'import sys\nfrom browser import window\nclass _W:\n    def __init__(self, c):\n        self.c = c\n    def write(self, s):\n        window.mlw(self.c, str(s))\n    def flush(self):\n        pass\nsys.stdout = _W("")\nsys.stderr = _W("e")\n';
const ASYNC_SHIM = "import sys\n_o = sys.stdout\nclass _N:\n    def write(self, s): pass\n    def flush(self): pass\nsys.stdout = _N()\nimport asyncio\nsys.stdout = _o\nfrom browser import aio\nasyncio.run = aio.run\nasyncio.sleep = aio.sleep\nasync def _gather(*aws):\n    if not aws:\n        return []\n    res = [None] * len(aws)\n    st = {\"n\": len(aws)}\n    fut = aio.Future()\n    async def _r(i, c):\n        res[i] = await c\n        st[\"n\"] -= 1\n        if st[\"n\"] == 0:\n            fut.set_result(res)\n    for i, c in enumerate(aws):\n        aio.run(_r(i, c))\n    return await fut\nasyncio.gather = _gather\n";  // Brython не умеет asyncio.run/sleep/gather: подставляем browser.aio
// Загрузчик внутри iframe: пробует файлы рядом с index.html, потом CDN
function bryLoad(o){
  window.__bryLoading = true;
  function fail(){ window.__bryLoading = false; if (window.__fail) window.__fail(); }
  function load(name, ok, check){
    var L = []; o.srcs.forEach(function(b){ [].concat(name).forEach(function(n){ L.push(b + n); }); });
    (function next(i){
      if (i >= L.length) return fail();
      var s = document.createElement('script');
      s.onload = function(){ if (check()) ok(); else { s.remove(); next(i + 1); } };
      s.onerror = function(){ s.remove(); next(i + 1); };
      s.src = L[i]; document.head.appendChild(s);
    })(0);
  }
  load(['brython.min.js', 'brython_min.js'], function(){
    var go = function(){
      // iframe с адресом about:srcdoc: штатный strip_host Brython не понимает такой URL и падает с «not a url»
      var B = window.__BRYTHON__;
      if (B) B.strip_host = function(u){ var mo = /(.*?):\/\/([^\/]*)?[\/#]?(.*)/.exec(u); return mo ? mo[3] : String(u).replace(/^about:/, ''); };
      brython({ indexedDB: false });
      window.__bryLoading = false;
    };
    if (o.lib) load('brython_stdlib.js', go, function(){ return !!(window.__BRYTHON__ && window.__BRYTHON__.VFS); }); else go();
  }, function(){ return !!window.brython; });
}
function brySuite(pys){
  const all = pys.join('\n'), safe = t => t.replace(/<\/script/gi, '<\\/script');
  const cfg = JSON.stringify({ srcs: [new URL('./', location.href).href, BRY], lib: true }).replace(/<\//g, '<\\/');
  return '<script type="text/python">' + PYPRE + (/\basyncio\b/.test(all) ? ASYNC_SHIM : '') + '<\/script><script type="text/python">' + safe(all) + '<\/script>' +
    '<script>(' + bryLoad.toString() + ')(' + cfg + ')<\/script>';
}
function injectHead(h, x){
  const m = /<head(?:\s[^>]*)?>/i.exec(h) || /<html(?:\s[^>]*)?>/i.exec(h) || /<!doctype[^>]*>/i.exec(h);
  return m ? h.slice(0, m.index + m[0].length) + x + h.slice(m.index + m[0].length) : x + h;
}
function project(h, pys){
  const h0 = h;
  const nl = x => (x.match(/\n/g) || []).length, blocks = [];
  const norm = x => x.replace(/^(\.?\/)+/, '').split(/[?#]/)[0];
  const byName = (x, l) => tabs.find(t => t.lang === l && t.name === norm(x));
  const jsBlock = t => { const k = blocks.length; blocks.push(t); return (isModuleJs(t.code) ? '<script type="module">' : '<script>') + '/*@@ML' + k + '@@*/\n' + guard(t.code).replace(/<\/script/gi, '<\\/script') + '<\/script>'; };
  let used = 0;
  // файлы, на которые страница ссылается по имени: <link href="css/style.css"> и <script src="js/app.js">
  h = h.replace(/<link\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi, (m, q, x) => { const t = byName(x, 'css'); if (!t) return m; used++; return '<style>' + t.code + '</style>'; });
  h = h.replace(/<script\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1[^>]*>\s*<\/script>/gi, (m, q, x) => { const t = byName(x, 'js'); if (!t) return m; used++; return jsBlock(t); });
  if (!used) { // ссылок нет — подключаем все CSS и JS вкладки сами, как раньше
    const css = tabs.filter(t => t.lang === 'css').map(t => t.code).join('\n');
    if (css) h = /<\/head>/i.test(h) ? h.replace(/<\/head>/i, () => '<style>' + css + '</style></head>') : '<style>' + css + '</style>' + h;
    const js = tabs.filter(t => t.lang === 'js').map(jsBlock).join('');
    if (js) h = /<\/body>/i.test(h) ? h.replace(/<\/body>/i, () => js + '</body>') : h + js;
  }
  h = injectHead(h, cboot(synPre(h0, blocks)) + '<script>' + GPRE + '<\/script>' + importMapTag(blocks.filter(t => isModuleJs(t.code)).map(t => t.code)));
  if (pys && pys.length) { const s = brySuite(pys); h = /<\/body>/i.test(h) ? h.replace(/<\/body>/i, () => s + '</body>') : h + s; }
  const offs = blocks.map((t, k) => [t.name, nl(h.slice(0, h.indexOf('/*@@ML' + k + '@@*/'))) + 1, t.code.split('\n').length]);
  h = h.replace('"@@OFFS@@"', () => JSON.stringify(offs));
  return h;
}
const SAMPLE = '<h1>Заголовок</h1><p>Абзац текста <a href="#">со ссылкой</a>.</p><button>Кнопка</button><ul><li>Раз</li><li>Два</li></ul>';
function render(src, es, ee){
  const toks = [], mg = [];
  if (cur === 'html') lexHtml(src, toks); else if (cur === 'css') lexCss(src, toks); else lex(src, cur, 0, toks);
  for (const t of toks) { const l = mg[mg.length - 1]; if (l && l[2] === t[2] && l[1] === t[0]) l[1] = t[1]; else mg.push(t.slice()); }
  let h = '';
  for (const [a, b, c] of mg) {
    const cuts = [a, b];
    if (es > a && es < b) cuts.push(es);
    if (ee > a && ee < b) cuts.push(ee);
    cuts.sort((x, y) => x - y);
    for (let i = 0; i < cuts.length - 1; i++) {
      const p = cuts[i], q = cuts[i + 1];
      let t = esc(src.slice(p, q));
      if (ee > es && p >= es && q <= ee) t = '<u>' + t + '</u>';
      h += c ? '<span class="' + c + '">' + t + '</span>' : t;
    }
  }
  return h;
}

function runnerJs(src){
  const pe = typeof acorn === 'undefined' ? null : parseJs(src, 0);
  const pl = pe ? (pe.pos >= 0 ? 'Строка ' + src.slice(0, pe.pos).split('\n').length + ': ' : '') + ruErr(pe.msg) : '';
  const ruj = JSON.stringify(RU.map(([r, t]) => [r.source, t]));
  return '<!doctype html><meta charset=utf-8><style>body{margin:0;padding:16px;background:' + cv('--outbg') + ';color:' + cv('--text') + ';font:' + FS + 'px/1.6 ui-monospace,Menlo,Consolas,monospace}div{white-space:pre-wrap}.e{color:' + cv('--err') + '}</style><body><script>' +
  'window.__insp=(' + inspFn.toString() + ');' +
  "const __mlf=(c,a)=>{const d=document.createElement('div');if(c)d.className=c;d.textContent=a.map(x=>{if(typeof x==='object'&&x!==null){try{const c=__insp(x);if(c.length<=72&&c.indexOf('\\n')<0)return c;return JSON.stringify(x,null,2)}catch(e){}}return __insp(x)}).join(' ');document.body.appendChild(d)};" +
  "console.log=console.info=console.warn=console.debug=console.dir=console.table=(...a)=>__mlf('',a);console.error=(...a)=>__mlf('e',a);" +
  'const __mlRU=' + ruj + ";const __mlru=s=>{for(const [r,t] of __mlRU){const m=new RegExp(r).exec(s);if(m)return t.replace('$1',m[1])}return s};" +
  "const __mler=m=>{const le=window.__lastErr;window.__lastErr='';m=String(m);if(le&&(m==='Script error.'||m.indexOf(le)>=0))return;const r=__mlru(m);__mlf('e',[r===m?m:r+'  ('+m+')'])};onerror=__mler;onunhandledrejection=e=>__mler('Promise: '+(e.reason&&e.reason.message||e.reason));" +
  GPRE + (pe ? '__mlf("e",[' + JSON.stringify(pl).replace(/<\//g, '<\\/') + ']);<\/script>' : '<\/script>' + (isModuleJs(src)
    ? importMapTag([src]) + '<script type="module" onerror="typeof __mlf===\'function\'&&__mlf(\'e\',[\'Не удалось загрузить модуль: проверьте адрес в import и интернет\'])">' + guard(src).replace(/<\/script/gi, '<\\/script') + '<\/script>'
    : '<script>' + guard(src).replace(/<\/script/gi, '<\\/script') + '<\/script>'));
}
// синтаксические ошибки скриптов страницы: показываем их в консоли с номером строки (браузер сам пишет только «Script error.»)
function synPre(h, blocks){
  const r = [];
  if (typeof acorn === 'undefined') return r;
  const add = (name, s, e) => { const ln = e.pos >= 0 ? s.slice(0, e.pos).split('\n').length : 0; r.push(name + (ln ? ', строка ' + ln : '') + ': ' + ruErr(e.msg)); };
  blocks.forEach(t => { const e = parseJs(t.code, 0); if (e) add(t.name, t.code, e); });
  const re = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(h))) { if (/type\s*=\s*["']?text\/python/i.test(m[0])) continue; const e = parseJs(m[1], 0); if (e) add('Скрипт в HTML', m[1], e); }
  return r;
}

function pageOut(text, err){
  const q = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  out.srcdoc = '<!doctype html><meta charset=utf-8><body style="margin:0;padding:16px;background:' + cv('--outbg') + ';color:' + cv('--text') + ';font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">' + q(text) + (err ? '<span style="color:' + cv('--err') + '">' + q(err) + '</span>' : '');
}
// Синтаксис, который Skulpt не разбирает: match/case, :=, async/await, except*
function modernPy(src){
  const t = src.replace(/("""|''')[\s\S]*?\1|(["'])(?:\\.|(?!\2).)*\2|#.*$/gm, '');
  return (/^[ \t]*match\s+[^\n]+:\s*$/m.test(t) && /^[ \t]*case\s+\S[^\n]*:/m.test(t))
      || /:=/.test(t) || /^[ \t]*async\s+(def|for|with)\b/m.test(t) || /\bawait\s+\w/.test(t) || /^[ \t]*except\s*\*/m.test(t)
      || /^[ \t]*type\s+\w+(\[[^\]]*\])?\s*=/m.test(t) || /^[ \t]*(?:def|class)\s+\w+\s*\[/m.test(t)
      || /\bdef\s+\w+\s*\([^)]*,\s*\/\s*[,)]|\bdef\s+\w+\s*\(\s*\/\s*[,)]/.test(t) || /^[ \t]*with\s*\(\s*\n?[^\n]*\bas\b/m.test(t)
      || /\bnonlocal\b/.test(t) || /\bf["'][^"'\n]*\{[^}\n]*=\s*[!:}]/.test(src)
      || /\.(removeprefix|removesuffix|bit_count|is_integer)\(|\bmath\.(lcm|isqrt|comb|perm|prod|dist)\b|\bzip\([^)]*strict\s*=/.test(t);
}
function runViaBrython(src, quiet){
  con.hidden = true; out.style.display = ''; out.style.background = cv('--outbg');
  const css = 'html,body{margin:0;height:100%;background:' + cv('--outbg') + '}body>div[style*="2147483647"]{top:0!important;max-height:none!important;border-top:0!important}';
  out.srcdoc = project('<!doctype html><meta charset="utf-8"><style>' + css + '</style><body></body>', [src]);
  if (!quiet) say('Skulpt не поддерживает эту конструкцию, запущено через Brython');
}
async function runPy(src){
  if (src.trim().startsWith('<') || cur === 'html') {
    pageOut(src, false);
    con.hidden = true;
    out.style.display = 'block';
    return;
  }
  con.innerHTML = ''; con.hidden = false; out.style.display = 'none'; pyBusy = true; let usedInput = false;
  const add = (t, c) => { const e = document.createElement('span'); if (c) e.className = c; e.textContent = t; con.appendChild(e); con.scrollTop = con.scrollHeight; };
  Sk.configure({ output: t => add(t), __future__: Sk.python3, execLimit: 20000, inputfunTakesPrompt: true,
    read: x => { if (!Sk.builtinFiles || !Sk.builtinFiles.files[x]) throw 'File not found: ' + x; return Sk.builtinFiles.files[x]; },
    inputfun: p => new Promise(res => {
      usedInput = true; if (p) add(p);
      const i = document.createElement('input'); con.appendChild(i); i.focus(); const t0 = Date.now();
      const submit = () => { const v = i.value; ML.pending = null; i.replaceWith(document.createTextNode(v + '\n')); Sk.execStart += Date.now() - t0; res(v); };
      ML.pending = { el: i, submit };
      i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    }) });
  Sk.execStart = Date.now();
  try { await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, src, true)); }
  catch(e) {
    if (window.__stopped) { window.__stopped = false; add('\n■ Остановлено\n', 'e'); pyBusy = false; return; }
    const m = String(e), ln = /on line (\d+)/.exec(m);
    // Skulpt не умеет часть Python (nonlocal и др.): тихо перезапускаем через Brython
    // Любая ошибка Skulpt, кроме таймаута и exit(), перепроверяется в Brython (он ближе к CPython). Если пользователь уже вводил данные, повторяем только при явных ограничениях Skulpt
    const lim = /run time limit|TimeLimit/i.test(m) || /SystemExit/.test(m);
    const limitation = /not (yet )?implemented|NotImplemented|No module named|ImportError|ParseError|SyntaxError|bad input|has no attribute|not supported|unsupported|is not iterable|is not callable|not a valid|cannot be interpreted|unhashable/i.test(m) || modernPy(src);
    if (!lim && (limitation || !usedInput)) { pyBusy = false; runViaBrython(src, !limitation); return; }
    add((con.textContent && !con.textContent.endsWith('\n') ? '\n' : '') + (ln ? 'Строка ' + ln[1] + ': ' : '') + ruErr(m) + '\n(' + m + ')\n', 'e');
  }
  pyBusy = false;
}
// ===== PYODIDE: полный CPython 3.12 в Web Worker =====
const PYO = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const PYBOOT = String.raw`
import sys, os, ast, builtins, json, io, types, warnings
ROOT = '/home/pyodide'
os.environ['MPLBACKEND'] = 'AGG'
warnings.filterwarnings('ignore', message='FigureCanvasAgg')
warnings.filterwarnings('ignore', message='Matplotlib is currently using')
if ROOT not in sys.path: sys.path.insert(0, ROOT)
# в браузере нет потоков и процессов: threading/multiprocessing/ThreadPoolExecutor выполняются по очереди
def _shims():
    import sys, os, types, threading, queue
    import concurrent.futures as cf
    def tstart(self):
        if self._started.is_set(): raise RuntimeError('threads can only be started once')
        self._started.set()
        try: self.run()
        except SystemExit: pass
        except BaseException:
            import traceback
            sys.stderr.write('Exception in thread %s:\n' % self.name); traceback.print_exc()
        finally: self._is_stopped = True
    threading.Thread.start = tstart
    class SyncExecutor(cf.Executor):
        def __init__(self, max_workers=None, *a, **k): self._down = False
        def submit(self, fn, /, *args, **kw):
            f = cf.Future()
            try: f.set_result(fn(*args, **kw))
            except BaseException as e: f.set_exception(e)
            return f
        def shutdown(self, wait=True, *, cancel_futures=False): self._down = True
    cf.ThreadPoolExecutor = SyncExecutor; cf.ProcessPoolExecutor = SyncExecutor
    class AsyncRes:
        def __init__(self): self._v = None; self._e = None
        def get(self, timeout=None):
            if self._e is not None: raise self._e
            return self._v
        def wait(self, timeout=None): pass
        def ready(self): return True
        def successful(self): return self._e is None
    class Pool:
        def __init__(self, processes=None, initializer=None, initargs=(), *a, **k):
            if initializer: initializer(*initargs)
        def map(self, f, it, chunksize=None): return [f(x) for x in it]
        def starmap(self, f, it, chunksize=None): return [f(*x) for x in it]
        def imap(self, f, it, chunksize=1): return iter([f(x) for x in it])
        imap_unordered = imap
        def apply(self, f, args=(), kwds={}): return f(*args, **kwds)
        def apply_async(self, f, args=(), kwds={}, callback=None, error_callback=None):
            r = AsyncRes()
            try:
                r._v = f(*args, **kwds)
                if callback: callback(r._v)
            except BaseException as e:
                r._e = e
                if error_callback: error_callback(e)
            return r
        def map_async(self, f, it, chunksize=None, callback=None, error_callback=None):
            return self.apply_async(lambda: [f(x) for x in it], (), {}, callback, error_callback)
        def close(self): pass
        def terminate(self): pass
        def join(self): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
    class Process:
        def __init__(self, group=None, target=None, name=None, args=(), kwargs=None, *, daemon=None):
            self._t = target; self._a = args; self._k = kwargs or {}; self.name = name or 'Process-1'; self.daemon = daemon
            self.exitcode = None; self.pid = None
        def run(self):
            if self._t: self._t(*self._a, **self._k)
        def start(self):
            try: self.run(); self.exitcode = 0
            except SystemExit as e: self.exitcode = e.code or 0
            except BaseException:
                import traceback
                sys.stderr.write('Process %s:\n' % self.name); traceback.print_exc(); self.exitcode = 1
        def join(self, timeout=None): pass
        def is_alive(self): return False
        def terminate(self): pass
        kill = terminate
    class Value:
        def __init__(self, typecode=None, value=0, lock=True): self.value = value
        def get_lock(self): return threading.Lock()
    class Manager:
        list = staticmethod(list); dict = staticmethod(dict); Queue = staticmethod(queue.Queue)
        Lock = staticmethod(threading.Lock)
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def shutdown(self): pass
    Manager.Value = Value
    mp = types.ModuleType('multiprocessing'); mpp = types.ModuleType('multiprocessing.pool')
    mpp.Pool = mpp.ThreadPool = Pool; mp.pool = mpp
    mp.Pool = Pool; mp.Process = Process; mp.Queue = queue.Queue; mp.Lock = threading.Lock; mp.RLock = threading.RLock
    mp.Event = threading.Event; mp.Value = Value; mp.Manager = Manager
    mp.cpu_count = lambda: os.cpu_count() or 1; mp.freeze_support = lambda: None; mp.set_start_method = lambda *a, **k: None
    mp.current_process = lambda: types.SimpleNamespace(name='MainProcess', pid=1)
    sys.modules['multiprocessing'] = mp; sys.modules['multiprocessing.pool'] = mpp
_shims()
try: _shims()
except Exception: pass
# мини-оболочка: subprocess и os.system понимают echo, pwd, ls, cat и python (внутри страницы, без настоящих процессов)
def _shell():
    import sys, os, io, shlex, subprocess, contextlib
    def run_cmd(argv):
        out, err = io.StringIO(), io.StringIO(); code = 0
        name = os.path.basename(argv[0]) if argv else ''
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                if not argv: pass
                elif name == 'echo':
                    a = argv[1:]; nl = True
                    if a[:1] == ['-n']: nl = False; a = a[1:]
                    print(' '.join(a), end='\n' if nl else '')
                elif name == 'pwd': print(os.getcwd())
                elif name == 'ls':
                    for n in sorted(os.listdir(argv[1] if len(argv) > 1 else '.')): print(n)
                elif name == 'cat':
                    for f in argv[1:]: sys.stdout.write(open(f).read())
                elif name.startswith('python') or argv[0] == sys.executable:
                    a = argv[1:]; old = sys.argv
                    try:
                        if a[:1] == ['-c']:
                            sys.argv = ['-c'] + a[2:]; exec(compile(a[1], '<string>', 'exec'), {'__name__': '__main__'})
                        elif a:
                            sys.argv = a; exec(compile(open(a[0]).read(), a[0], 'exec'), {'__name__': '__main__', '__file__': a[0]})
                    finally: sys.argv = old
                else:
                    err.write('sh: %s: command not found\n' % argv[0]); code = 127
        except SystemExit as e:
            code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        except BaseException:
            import traceback; traceback.print_exc(file=err); code = 1
        return code, out.getvalue(), err.getvalue()
    def split(a): return shlex.split(a) if isinstance(a, str) else [str(x) for x in a]
    def run(args, *, stdin=None, input=None, stdout=None, stderr=None, capture_output=False, shell=False,
            text=None, universal_newlines=None, encoding=None, errors=None, check=False, timeout=None, cwd=None, env=None, **kw):
        code, o, e = run_cmd(split(args))
        if stderr == subprocess.STDOUT: o += e; e = ''
        co = capture_output or stdout == subprocess.PIPE; ce = capture_output or stderr == subprocess.PIPE
        if not co: sys.stdout.write(o)
        if not ce and e: sys.stderr.write(e)
        tx = bool(text or universal_newlines or encoding)
        ov = (o if tx else o.encode()) if co else None; ev = (e if tx else e.encode()) if ce else None
        if check and code: raise subprocess.CalledProcessError(code, args, ov, ev)
        return subprocess.CompletedProcess(args, code, ov, ev)
    class Popen:
        def __init__(self, args, stdin=None, stdout=None, stderr=None, text=None, universal_newlines=None, encoding=None, **kw):
            self.args = args; self._r = run(args, stdout=subprocess.PIPE, stderr=stderr if stderr == subprocess.STDOUT else subprocess.PIPE, text=True)
            self.returncode = self._r.returncode; self.pid = 1
            self._tx = bool(text or universal_newlines or encoding)
            self.stdout = io.StringIO(self._r.stdout) if stdout == subprocess.PIPE else None
            self.stderr = io.StringIO(self._r.stderr) if stderr == subprocess.PIPE else None
            if stdout != subprocess.PIPE: sys.stdout.write(self._r.stdout)
        def communicate(self, input=None, timeout=None):
            o = self.stdout.read() if self.stdout else None; e = self.stderr.read() if self.stderr else None
            if not self._tx: o = o.encode() if o is not None else None; e = e.encode() if e is not None else None
            return o, e
        def wait(self, timeout=None): return self.returncode
        def poll(self): return self.returncode
        def kill(self): pass
        terminate = kill
        def __enter__(self): return self
        def __exit__(self, *a): return False
    def check_output(*a, **k):
        k['stdout'] = subprocess.PIPE; k['check'] = True; return run(*a, **k).stdout
    def call(*a, **k): return run(*a, **k).returncode
    def check_call(*a, **k): k['check'] = True; return run(*a, **k).returncode
    def getstatusoutput(c):
        code, o, e = run_cmd(split(c)); return code, (o + e).rstrip('\n')
    def getoutput(c): return getstatusoutput(c)[1]
    subprocess.run = run; subprocess.Popen = Popen; subprocess.check_output = check_output; subprocess.call = call
    subprocess.check_call = check_call; subprocess.getstatusoutput = getstatusoutput; subprocess.getoutput = getoutput
    def system(cmd):
        code, o, e = run_cmd(split(cmd)); sys.stdout.write(o)
        if e: sys.stderr.write(e)
        return code << 8
    def popen(cmd, mode='r', buffering=-1):
        code, o, e = run_cmd(split(cmd))
        if e: sys.stderr.write(e)
        return io.StringIO(o)
    os.system = system; os.popen = popen
try: _shell()
except Exception: pass
def _lint(src):
    try: tree = ast.parse(src)
    except SyntaxError as e: return json.dumps({'e': [e.lineno or 1, e.offset or 1, e.msg or 'SyntaxError']})
    except Exception as e: return json.dumps({'e': [1, 1, str(e)]})
    defined = set(dir(builtins)) | {'__file__', '__name__', '__doc__', '__spec__', '__builtins__', '__class__'}
    used = set(); imps = []; star = False
    for n in ast.walk(tree):
        if isinstance(n, ast.Name):
            if isinstance(n.ctx, ast.Load): used.add(n.id)
            else: defined.add(n.id)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): defined.add(n.name)
        elif isinstance(n, ast.arg): defined.add(n.arg)
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            for a in n.names:
                if a.name == '*': star = True; continue
                nm = a.asname or a.name.split('.')[0]; defined.add(nm)
                if not (isinstance(n, ast.ImportFrom) and n.module == '__future__'): imps.append((n.lineno, nm))
        elif isinstance(n, ast.ExceptHandler) and n.name: defined.add(n.name)
        elif isinstance(n, (ast.Global, ast.Nonlocal)): defined.update(n.names)
        elif isinstance(n, (ast.MatchAs, ast.MatchStar)) and n.name: defined.add(n.name)
        elif isinstance(n, ast.MatchMapping) and n.rest: defined.add(n.rest)
    w = None
    if not star:
        bad = [(n.lineno, n.id) for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in defined]
        if bad: l, nm = min(bad); w = [l, 'имя «%s» не определено' % nm]
    if not w:
        for l, nm in sorted(imps):
            if nm not in used and ("'%s'" % nm) not in src and ('"%s"' % nm) not in src:
                w = [l, 'импорт «%s» не используется' % nm]; break
    return json.dumps({'w': w})
def _figs():
    if 'matplotlib.pyplot' not in sys.modules: return '[]'
    import base64, matplotlib.pyplot as plt
    r = []
    for n in plt.get_fignums():
        if not plt.figure(n).axes: continue
        b = io.BytesIO(); plt.figure(n).savefig(b, format='png', dpi=100, bbox_inches='tight'); r.append(base64.b64encode(b.getvalue()).decode())
    plt.close('all'); return json.dumps(r)
def _dbg(src, limit=2500):
    steps = []; buf = io.StringIO(); old = sys.stdout; sys.stdout = buf; g = {'__name__': '__main__'}
    def tr(fr, ev, arg):
        if fr.f_code.co_filename != '<exec>': return None
        if ev == 'line':
            if len(steps) >= limit: raise RuntimeError('достигнут лимит шагов отладчика (%d)' % limit)
            loc = {}
            for k, v in fr.f_locals.items():
                if k.startswith('__') or isinstance(v, (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, type)): continue
                try: loc[k] = repr(v)[:60]
                except Exception: loc[k] = '?'
            steps.append([fr.f_lineno, fr.f_code.co_name, loc, len(buf.getvalue())])
        return tr
    err = None
    try:
        co = compile(src, '<exec>', 'exec'); sys.settrace(tr); exec(co, g)
    except BaseException as e: err = '%s: %s' % (type(e).__name__, e)
    finally: sys.settrace(None); sys.stdout = old
    return json.dumps({'steps': steps, 'out': buf.getvalue(), 'err': err})
`;
function startPyo(){
  if (pyoW || pyoFail) return pyoLoading;
  try { pyoW = new Worker(URL.createObjectURL(new Blob([$('pyo-worker').textContent], { type: 'text/javascript' }))); }
  catch(e) { pyoFail = true; return Promise.reject(e); }
  const w = pyoW; pyoReady = false;
  pyoLoading = new Promise((ok, no) => {
    w.onmessage = ev => {
      const d = ev.data;
      if (d.ready) { pyoReady = true; pyoUsed = true; pyoSync = !!d.sync; ok(); say('Pyodide загружен: полный Python 3.12'); if (code.value) update(true); setTimeout(() => { try { warmFmt(); } catch (_) {} }, 6000); return; }
      if (d.fatal) { pyoFail = true; pyoW = null; no(d.fatal); return; }
      const h = pyoH[d.id]; if (h) h(d);
    };
    w.onerror = () => { if (!pyoReady) { pyoFail = true; pyoW = null; no('worker'); } };
  });
  pyoLoading.catch(() => {});
  w.postMessage({ init: PYO, boot: PYBOOT, base: pyoBase() });
  return pyoLoading;
}
const getProxy = () => { try { return localStorage.getItem('ml-proxy') || ''; } catch(e) { return ''; } };
const pyoBase = () => /^https?:/.test(location.protocol) ? new URL('./', location.href).href : '';
function probeSync(){ if (pyoReady && !pyoSync && pyoBase() && navigator.serviceWorker && navigator.serviceWorker.controller) pyoCall({ t: 'probe', base: pyoBase() }).then(d => { pyoSync = !!d.sync; }); }
let pyoUsed = false;
function stopPyo(lazy){ if (pyoW) { pyoW.terminate(); pyoW = null; } pyoReady = false; pyoLoading = null; pyoH = {}; pyoRunning = false; if (!lazy) startPyo(); }
function pyoCall(msg, on){
  return new Promise(res => {
    const id = ++pyoId; pyoH[id] = d => { if (on) on(d); if (d.done) { delete pyoH[id]; res(d); } };
    pyoW.postMessage(Object.assign({ id }, msg));
  });
}
function pyoAsk(src){
  clearTimeout(paT);
  paT = setTimeout(() => {
    if (!pyoReady) return;
    pyoCall({ t: 'check', src }).then(d => {
      const r = { e: null, w: null };
      try { const j = JSON.parse(d.r); if (j.e) r.e = { pos: posOf(src, j.e[0], j.e[1] - 1), msg: j.e[2] }; else if (j.w) r.w = j.w; } catch(_) {}
      pyoChk.set(src, r); if (pyoChk.size > 60) pyoChk.delete(pyoChk.keys().next().value);
      if (code.value === src) update(true);
    });
  }, 300);
}
const needsPyo = src => /^[ \t]*(?:import|from)[ \t]+(?:numpy|pandas|matplotlib|seaborn|plotly|scipy|sympy|PIL|sklearn|networkx|statsmodels|yaml|bs4|lxml|regex|cryptography|mpmath)\b/m.test(src);
// Простая программа: без сторонних модулей и новых конструкций. Её Skulpt выполняет мгновенно, пока Pyodide (около 10 МБ) ещё грузится
const skSimple = src => !modernPy(src) && !/^[ \t]*(?:import|from)[ \t]+(?!(?:math|random|time|string|re|json|itertools|collections|functools|operator|copy|datetime|heapq|bisect|statistics|decimal|fractions|sys)\b)/m.test(src);
// Pyodide (настоящий CPython 3.12) — движок по умолчанию; Skulpt остаётся для turtle, для input() без сервис-воркера и для быстрого старта
const pyoWanted = src => {
  if (pyoSkip || pyoFail || eng === 'classic' || !window.Worker) return false;
  if (/^[ \t]*(?:import|from)[ \t]+turtle\b/m.test(src)) return false;
  const needs = needsPyo(src) || stdinText.trim() !== '' || !skSimple(src);
  if (/\binput\s*\(/.test(src) && !pyoSync && !needs) return false;
  return pyoReady || pyoUsed || needs;
};
const pyFiles = () => tabs.map((t, i) => ({ p: String(t.name || '').replace(/^[\/.]+/, '').replace(/\.\.+/g, ''), c: i === ai ? code.value : t.code })).filter(f => /\.py$/.test(f.p));
const conAdd = (t, c, l) => { const e = document.createElement('span'); if (c) e.className = c; if (l) e.dataset.l = l; e.textContent = t; con.appendChild(e); con.scrollTop = con.scrollHeight; return e; };
function gotoLine(n){
  const a = posOf(code.value, n, 0), L = code.value.split('\n')[n - 1] || '';
  if (document.documentElement.dataset.dev === 'phone') setView('code');
  code.focus(); code.setSelectionRange(a, a + L.length); code.scrollTop = Math.max(0, (n - 4) * LH);
}
con.addEventListener('click', e => { const l = e.target.closest('.jl'); if (l) gotoLine(+l.dataset.l); });
function showPyErr(msg){
  if (/NEED_INPUT/.test(msg)) return;
  const lines = msg.trim().split('\n'), last = lines[lines.length - 1];
  if (/^SystemExit/.test(last)) return;
  let ln = 0, m; const re = /File "<exec>", line (\d+)/g; while ((m = re.exec(msg))) ln = +m[1];
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+File "(\/lib\/|\/usr\/|pyodide)/.test(lines[i])) { while (/^ {4,}\S/.test(lines[i + 1] || '') && !/^\s+File /.test(lines[i + 1])) i++; continue; }
    keep.push(lines[i]);
  }
  if (con.textContent && !con.textContent.endsWith('\n')) conAdd('\n');
  if (ln) conAdd('Строка ' + ln + ': ' + ruErr(last) + '\n', 'e jl', ln); else conAdd(ruErr(last) + '\n', 'e');
  conAdd(keep.join('\n') + '\n', 'e');
}
let plP = null;
// plotly.js 2.35.2 (под python-пакет plotly 5.24.1): пробуем несколько CDN по очереди; первые два кеширует сервис-воркер для офлайна
const PLURLS = ['https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/plotly.js/2.35.2/plotly.min.js', 'https://cdn.plot.ly/plotly-2.35.2.min.js'];
const loadPlotly = () => plP || (plP = new Promise((ok, no) => {
  if (window.Plotly) return ok();
  let i = 0;
  const next = () => {
    if (window.Plotly) return ok();
    if (i >= PLURLS.length) { plP = null; return no(new Error('plotly.js не загрузился ни с одного CDN')); }
    const s = document.createElement('script'); s.src = PLURLS[i++];
    s.onload = () => (window.Plotly ? ok() : (s.remove(), next())); s.onerror = () => { s.remove(); next(); };
    document.head.appendChild(s);
  };
  next();
}));
function showPlotly(j){
  const d = document.createElement('div'); d.style.cssText = 'background:#fff;border-radius:6px;margin:8px 0;padding:4px;overflow:hidden';
  con.appendChild(d);
  const fail = e => { d.style.cssText = ''; d.className = 'e'; d.textContent = 'Не удалось показать график Plotly: ' + ((e && e.message) || e) + '\n'; };
  loadPlotly().then(() => {
    try { const f = JSON.parse(j), lay = Object.assign({ autosize: true }, f.layout || {}), h = +lay.height || 450; lay.height = h; delete lay.width; d.style.height = (h + 8) + 'px'; d.style.whiteSpace = 'normal'; return Plotly.newPlot(d, f.data || [], lay, { responsive: true, displaylogo: false }); }
    catch (e) { fail(e); }
  }, fail).catch(fail);
}
async function runPyodide(src, ans, skipN){
  ans = ans || []; skipN = skipN || 0;
  if (!ans.length) { con.innerHTML = ''; runSeed = (Date.now() % 90000) + 1; }
  con.hidden = false; out.style.display = 'none';
  if (document.documentElement.dataset.dev === 'phone') setView('out');
  if (pyoRunning) stopPyo();
  if (!pyoReady) {
    if (pyoFail || !startPyo()) return false;
    const w = conAdd('⏳ Загружаю Python 3.12 (один раз, около 10 МБ)…\n');
    try { await pyoLoading; } catch(e) { w.remove(); return false; }
    w.remove();
  }
  const inter = stdinText.trim() === '';
  let printed = 0;
  const emit = (s, e) => { if (skipN > 0) { const k = Math.min(skipN, s.length); skipN -= k; printed += k; s = s.slice(k); } if (s) { printed += s.length; conAdd(s, e ? 'e' : ''); } };
  const promptIn = onSubmit => {
    const i = document.createElement('input'); con.appendChild(i); i.focus();
    const submit = () => { const v = i.value; ML.pending = null; i.replaceWith(document.createTextNode(v + '\n')); onSubmit(v); };
    ML.pending = { el: i, submit };
    i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  };
  const askInput = () => {
    if (!ML.inWarn && /\b(requests|urllib|urlopen|open\s*\(|datetime|time\.time|random\.org)/.test(src)) { ML.inWarn = 1; say('Ввод без сервис-воркера: программа перезапускается при каждом input(), сетевые запросы и запись файлов повторятся. Откройте сайт по http(s) и обновите страницу'); }
    stopPyo();
    promptIn(v => runPyodide(src, ans.concat([v]), printed));
  };
  const askSync = key => promptIn(v => {
    const c = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (c) c.postMessage({ t: 'in', k: key, text: v }); else conAdd('Сервис-воркер недоступен: обновите страницу\n', 'e');
  });
  pyoRunning = true; let stEl = null;
  const res = await pyoCall({ t: 'run', src, files: pyFiles(), stdin: inter ? ans.join('\n') : stdinText.replace(/\r/g, ''), inter, sid: SID, sync: pyoSync ? pyoBase() : '', seed: runSeed, proxy: getProxy(), origin: location.origin }, d => {
    if (d.st != null) { if (stEl) { stEl.remove(); stEl = null; } if (d.st) stEl = conAdd(d.st); }
    if (d.o != null) emit(d.o, d.e);
    if (d.need) { if (d.key) askSync(d.key); else askInput(); }
  });
  pyoRunning = false;
  (res.im || []).forEach(b => { const im = document.createElement('img'); im.src = 'data:image/png;base64,' + b; im.style.cssText = 'max-width:100%;background:#fff;display:block;margin:8px 0;border-radius:6px'; con.appendChild(im); });
  (res.pf || []).forEach(showPlotly);
  if (stEl) stEl.remove();
  if (res.err) showPyErr(res.err);
  con.scrollTop = con.scrollHeight;
  return true;
}
function stopAll(){
  if (pyoRunning) { const pi = ML.pending; if (pi && pi.el.isConnected) pi.el.remove(); ML.pending = null; stopPyo(true); conAdd('\n■ Остановлено\n', 'e'); return; }
  if (typeof Sk !== 'undefined' && pyBusy) { window.__stopped = true; Sk.execLimit = 1; const pi = ML.pending; if (pi && pi.el.isConnected) pi.submit(); return; }
  out.srcdoc = ''; say('Остановлено');
}
$('stopBtn').addEventListener('click', stopAll);

// ===== ФОРМАТТЕР PYTHON, ПОДСКАЗКИ, СТАТУС =====
function fmtPy(s){
  let inS = false;
  const L = s.replace(/\r/g, '').split('\n').map(l => {
    const t = (l.match(/"""|\x27\x27\x27/g) || []).length;
    const r = inS ? l : l.replace(/^[ \t]+/, m => m.replace(/\t/g, '    ')).replace(/\s+$/, '');
    if (t % 2) inS = !inS;
    return r;
  });
  return L.join('\n').replace(/\n{4,}/g, '\n\n\n').replace(/\s*$/, '\n');
}
const M = s => s.split(' ').map(n => [n, 'модуль', n]);
const MODM = {
  math: M('sqrt floor ceil pi e sin cos tan asin acos atan atan2 log log2 log10 exp pow fabs factorial gcd lcm hypot radians degrees isclose isnan isinf inf nan comb perm prod trunc fsum'),
  random: M('randint random choice choices sample shuffle uniform seed randrange gauss'),
  os: M('path getcwd listdir mkdir remove rename environ getenv sep system'),
  sys: M('argv exit stdin stdout stderr path version platform maxsize setrecursionlimit getsizeof'),
  time: M('time sleep perf_counter monotonic strftime localtime gmtime ctime process_time'),
  json: M('dumps loads dump load'),
  re: M('search match fullmatch findall finditer sub subn split compile escape IGNORECASE MULTILINE DOTALL'),
  itertools: M('permutations combinations product chain accumulate groupby cycle repeat count islice zip_longest starmap takewhile dropwhile'),
  collections: M('Counter defaultdict deque OrderedDict namedtuple ChainMap'),
  string: M('ascii_letters ascii_lowercase ascii_uppercase digits punctuation whitespace'),
  functools: M('reduce lru_cache partial wraps cache cmp_to_key'),
  datetime: M('datetime date time timedelta timezone'),
  heapq: M('heappush heappop heapify nlargest nsmallest heappushpop'),
  statistics: M('mean median mode stdev variance pstdev'),
  np: M('array arange linspace zeros ones eye random sum mean std dot sqrt sin cos reshape shape max min argmax argmin sort unique where concatenate'),
  numpy: M('array arange linspace zeros ones eye random sum mean std dot sqrt sin cos reshape shape max min argmax argmin sort unique where concatenate'),
  plt: M('plot show figure bar hist scatter title xlabel ylabel legend grid subplots savefig pie'),
  pd: M('DataFrame Series read_csv concat merge to_datetime date_range'),
  sns: M('heatmap jointplot scatterplot lineplot barplot histplot boxplot violinplot pairplot countplot kdeplot regplot set_theme'),
  go: M('Figure Scatter Bar Pie Histogram Heatmap Layout'),
  px: M('line scatter bar histogram pie box imshow')
};
function selfAttrs(v){
  const seen = new Set(), r = []; let m;
  const a = /\bself\.([A-Za-z_]\w*)/g; while ((m = a.exec(v))) if (!seen.has(m[1])) { seen.add(m[1]); r.push([m[1], 'атрибут класса', m[1]]); }
  const d = /\bdef\s+([A-Za-z_]\w*)\s*\(\s*self\b/g; while ((m = d.exec(v))) if (!seen.has(m[1])) { seen.add(m[1]); r.push([m[1], 'метод класса', m[1] + '($0)']); }
  return r;
}
const SIGS = {
  print: 'print(*объекты, sep=" ", end="\\n")', input: 'input(подсказка="")', len: 'len(объект)', range: 'range([start,] stop [, step])',
  int: 'int(x, base=10)', float: 'float(x)', str: 'str(объект)', list: 'list(iterable)', dict: 'dict(**пары)', set: 'set(iterable)', sum: 'sum(iterable, start=0)',
  min: 'min(a, b, ...) или min(iterable, key=None)', max: 'max(a, b, ...) или max(iterable, key=None)', abs: 'abs(x)', round: 'round(число, ndigits=None)',
  sorted: 'sorted(iterable, key=None, reverse=False)', enumerate: 'enumerate(iterable, start=0)', zip: 'zip(*iterables)', map: 'map(функция, iterable)',
  filter: 'filter(функция, iterable)', open: 'open(файл, режим="r", encoding=None)', isinstance: 'isinstance(объект, тип)', pow: 'pow(основание, степень, mod=None)',
  randint: 'random.randint(a, b)  — включая b', choice: 'random.choice(последовательность)', sample: 'random.sample(последовательность, k)', shuffle: 'random.shuffle(список)',
  uniform: 'random.uniform(a, b)', sqrt: 'math.sqrt(x)', floor: 'math.floor(x)', ceil: 'math.ceil(x)', sleep: 'time.sleep(секунды)',
  dumps: 'json.dumps(obj, ensure_ascii=True, indent=None)', loads: 'json.loads(строка)', split: 'str.split(sep=None, maxsplit=-1)', join: 'str.join(iterable)',
  replace: 'str.replace(старое, новое, count=-1)', strip: 'str.strip(символы=None)', append: 'list.append(элемент)', insert: 'list.insert(индекс, элемент)',
  pop: 'pop(индекс=-1)  (для dict: pop(ключ, по_умолчанию))', sort: 'list.sort(key=None, reverse=False)', format: 'str.format(*args, **kwargs)', find: 'str.find(подстрока, start, end)',
  startswith: 'str.startswith(префикс)', endswith: 'str.endswith(суффикс)', get: 'dict.get(ключ, по_умолчанию=None)', items: 'dict.items()', index: 'index(значение)'
};
function pyStatusExtra(src){
  if (cur !== 'py') return;
  const r = pyoChk.get(src);
  const before = src.slice(Math.max(0, code.selectionStart - 200), code.selectionStart), m = /([A-Za-z_]\w*)\s*\([^()]*$/.exec(before);
  if (m && SIGS[m[1]]) { st.textContent = 'ƒ ' + SIGS[m[1]]; return; }
  if (/\bjs\.(?:window|alert|confirm|prompt|document)\b|^[ \t]*from[ \t]+js[ \t]+import[^\n]*\b(?:window|alert|confirm|prompt|document)\b/m.test(src)) { st.textContent = 'ℹ js.window и js.alert в Python не работают: для вывода print(), для окон и страницы from browser import window, alert, document'; return; }
  if (r && r.w) st.textContent = 'ℹ Строка ' + r.w[0] + ': ' + r.w[1];
}

// ===== ОКНА: stdin, автотесты, отладчик =====
function closeOv(){ const o = $('ovl'); if (o) o.remove(); }
function overlay(title, node){
  closeOv();
  const o = document.createElement('div'); o.id = 'ovl';
  o.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:12px';
  const b = document.createElement('div');
  b.style.cssText = 'background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:14px;width:min(680px,100%);max-height:90vh;overflow:auto;display:flex;flex-direction:column;gap:10px';
  const h = document.createElement('div'); h.innerHTML = '<b>' + esc(title) + '</b><span id="ovx" style="float:right;cursor:pointer;padding:0 6px">✕</span>';
  b.append(h, node); o.append(b);
  o.addEventListener('pointerdown', e => { if (e.target === o || e.target.id === 'ovx') closeOv(); });
  document.body.appendChild(o);
}
const mkBtn = (t, f) => { const b = document.createElement('button'); b.textContent = t; b.onclick = f; return b; };
const mkTa = (v, h) => { const t = document.createElement('textarea'); t.value = v; t.spellcheck = false; t.style.cssText = 'width:100%;height:' + h + 'px;background:var(--outbg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;resize:vertical'; return t; };
function openStdin(){
  const w = document.createElement('div'), t = mkTa(stdinText, 140);
  const info = document.createElement('div'); info.style.cssText = 'font-size:12px;color:var(--mute)';
  info.textContent = 'Каждая строка — один ответ на input(). Если поле пустое, программа спрашивает ввод по ходу работы.';
  const ok = mkBtn('Сохранить', () => { stdinText = t.value; try { localStorage.setItem('ml-stdin', stdinText); } catch(e) {} closeOv(); say(stdinText.trim() ? 'Ввод задан: запуск без вопросов' : 'Ввод очищен'); });
  w.style.cssText = 'display:flex;flex-direction:column;gap:10px'; w.append(info, t, ok); overlay('Входные данные (stdin)', w);
}
const normOut = x => String(x).replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
async function ensurePyo(box){
  if (pyoReady) return true;
  if (pyoFail || !startPyo()) { box.textContent = 'Pyodide не загрузился (нет интернета?)'; return false; }
  box.textContent = '⏳ Загружаю Python…'; try { await pyoLoading; } catch(e) { box.textContent = 'Pyodide не загрузился'; return false; } return true;
}
function openTests(){
  let all = {}; try { all = JSON.parse(localStorage.getItem('ml-tests') || '{}'); } catch(e) {}
  const key = tabs[ai] ? tabs[ai].name : 'main';
  const w = document.createElement('div'); w.style.cssText = 'display:flex;flex-direction:column;gap:10px';
  const info = document.createElement('div'); info.style.cssText = 'font-size:12px;color:var(--mute);white-space:pre-wrap';
  info.textContent = 'Формат: вход, затем строка ---, затем ожидаемый вывод. Тесты разделяются строкой ###.';
  const t = mkTa(all[key] || '2\n3\n---\nСумма: 5\n###\n10\n-4\n---\nСумма: 6', 190), res = document.createElement('div');
  res.style.cssText = 'font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap';
  const go = mkBtn('▶ Проверить', async () => {
    all[key] = t.value; try { localStorage.setItem('ml-tests', JSON.stringify(all)); } catch(e) {}
    res.textContent = ''; if (!(await ensurePyo(res))) return;
    const src = code.value, files = pyFiles(), cases = t.value.split(/^###[ \t]*$/m).map(c => c.split(/^---[ \t]*$/m)).filter(c => c.length >= 2 || c[0].trim());
    let okN = 0; res.textContent = '';
    for (let i = 0; i < cases.length; i++) {
      const inp = (cases[i][0] || '').replace(/^\n+|\n+$/g, ''), exp = cases[i].slice(1).join('---').replace(/^\n/, '');
      const r = await Promise.race([pyoCall({ t: 'test', src, files, stdin: inp, inter: false, seed: 1 }), new Promise(ok => setTimeout(() => ok(null), 10000))]);
      const line = document.createElement('div');
      if (!r) { stopPyo(); line.textContent = '✗ Тест ' + (i + 1) + ': превышено время (10 с)'; line.style.color = 'var(--err)'; res.appendChild(line); try { await pyoLoading; } catch(e) {} continue; }
      const got = normOut(r.buf), want = normOut(exp);
      if (!r.err && got === want) { okN++; line.textContent = '✓ Тест ' + (i + 1); line.style.color = 'var(--hs)'; }
      else { line.style.color = 'var(--err)'; line.textContent = '✗ Тест ' + (i + 1) + (r.err ? '\nОшибка: ' + ruErr(r.err.trim().split('\n').pop()) : '') + '\nОжидалось: ' + JSON.stringify(want) + '\nПолучено:  ' + JSON.stringify(got); }
      res.appendChild(line);
    }
    const sum = document.createElement('div'); sum.style.fontWeight = '600'; sum.textContent = 'Пройдено: ' + okN + ' из ' + cases.length; res.appendChild(sum);
  });
  w.append(info, t, go, res); overlay('Автотесты: ' + key, w);
}
async function runDebug(){
  if (!trustGate()) return;
  const src = code.value; con.innerHTML = ''; con.hidden = false; out.style.display = 'none';
  if (document.documentElement.dataset.dev === 'phone') setView('out');
  if (!pyoReady) {
    if (pyoFail || !startPyo()) { conAdd('Отладчику нужен Pyodide (загрузка не удалась)\n', 'e'); return; }
    const w = conAdd('⏳ Загружаю Python…\n'); try { await pyoLoading; } catch(e) { w.textContent = 'Pyodide не загрузился\n'; return; } w.remove();
  }
  const d = await pyoCall({ t: 'debug', src, files: pyFiles(), stdin: stdinText.replace(/\r/g, ''), inter: false, seed: 1 });
  let r; try { r = JSON.parse(d.r); } catch(e) { conAdd((d.err || 'Ошибка отладчика') + '\n', 'e'); return; }
  showDebug(r, src);
}
function showDebug(r, src){
  const L = src.split('\n'), S = r.steps; con.innerHTML = '';
  if (!S.length) { conAdd((r.err || 'Нет шагов') + '\n', 'e'); return; }
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px';
  const sl = document.createElement('input'); sl.type = 'range'; sl.min = 0; sl.max = S.length - 1; sl.value = 0; sl.style.cssText = 'flex:1;width:auto;border:0';
  const go = d => { sl.value = Math.max(0, Math.min(S.length - 1, +sl.value + d)); draw(); };
  bar.append(mkBtn('◀', () => go(-1)), sl, mkBtn('▶', () => go(1)));
  const info = document.createElement('div'), vars = document.createElement('div'), o = document.createElement('pre');
  info.style.cssText = 'margin:6px 0;font-weight:600'; vars.style.cssText = 'margin:6px 0;color:var(--hn)'; o.style.cssText = 'margin:8px 0 0;padding:8px;border:1px solid var(--line);border-radius:6px;white-space:pre-wrap;min-height:2em';
  con.append(bar, info, vars, o);
  function draw(){
    const i = +sl.value, s = S[i];
    info.textContent = 'Шаг ' + (i + 1) + ' из ' + S.length + ' · строка ' + s[0] + (s[1] !== '<module>' ? ' · в функции ' + s[1] : '') + '\n▶ ' + (L[s[0] - 1] || '').trim();
    const e = Object.entries(s[2]); vars.textContent = e.length ? e.map(([k, v]) => k + ' = ' + v).join('\n') : '(переменных пока нет)';
    const last = i === S.length - 1; o.textContent = r.out.slice(0, last ? undefined : s[3]) + (last && r.err ? '\n' + r.err : '');
    const a = posOf(src, s[0], 0); try { code.setSelectionRange(a, a + (L[s[0] - 1] || '').length); code.scrollTop = Math.max(0, (s[0] - 4) * LH); } catch(_) {}
  }
  sl.addEventListener('input', draw); draw();
}
const PYACT = {
  tests: openTests, dbg: runDebug, stdin: openStdin,
  proxy: () => {
    const v = prompt('Адрес вашего прокси для запросов из Python (оканчивается на ?url=). ВНИМАНИЕ: прокси видит все адреса и данные, которые код отправляет в сеть, указывайте только свой или доверенный. Пусто — выключить.', getProxy());
    if (v === null) return;
    const s = v.trim();
    if (s && !/^https:\/\/.+/.test(s)) { say('Адрес должен начинаться с https://'); return; }
    try { localStorage.setItem('ml-proxy', s); } catch(e) {}
    say(s ? 'Прокси для сети включён' : 'Прокси для сети выключен');
  },
  eng: () => { eng = eng === 'classic' ? 'auto' : 'classic'; try { localStorage.setItem('ml-eng', eng); } catch(e) {} say(eng === 'classic' ? 'Движок: Skulpt/Brython' : 'Движок: Pyodide (полный Python 3.12)'); if (eng !== 'classic') startPyo(); }
};
addEventListener('load', () => {
  setTimeout(() => { if (eng !== 'classic' && !(navigator.connection && navigator.connection.saveData) && navigator.onLine !== false && window.Worker && tabs.some(t => t.lang === 'py')) startPyo(); }, 1500);
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) { navigator.serviceWorker.register('sw.js').catch(() => {}); navigator.serviceWorker.addEventListener('message', ev => { const d = ev.data; if (d && d.t === 'pre') say(d.done < d.total ? 'Оффлайн: ' + d.done + ' из ' + d.total + '…' : (d.fail ? 'Готово, но ' + d.fail + ' файл(ов) не скачалось: повторите позже' : 'Готово: редактор работает без интернета')); }); navigator.serviceWorker.addEventListener('controllerchange', () => setTimeout(probeSync, 500)); setTimeout(probeSync, 3000); }
});

// ===== ЗАПУСК =====
function run(){
  if (!trustGate()) return;
  // Если программа ждёт ввод и в поле уже что-то набрано, «Запуск» отправляет это значение (как Enter), а не перезапускает код
  const pi = ML.pending;
  if (pi && pi.el.isConnected && pi.el.value !== '') { pi.submit(); return; }
  ML.pending = null;
  snap();
  const src = code.value;
  // в JS-вкладке лежит Python («import numpy as np», «from x import y»): в JS такого синтаксиса нет, переключаем язык вкладки
  if (cur === 'js' && /^[ \t]*(?:from[ \t]+[\w.]+[ \t]+import[ \t]+[\w*(]|import[ \t]+[\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*[ \t]*(?:#.*)?$)/m.test(src)) {
    const t = tabs[ai]; t.code = src; t.lang = 'py'; if (/\.js$/i.test(t.name)) t.name = uniq(t.name.replace(/\.js$/i, '.py'));
    switchTab(ai); say('Это код Python: язык вкладки переключён'); return run();
  }
  if (cur === 'py' && !pyWeb(src) && pyoWanted(src)) { runPyodide(src).then(r => { if (r === false) { pyoSkip = true; try { run(); } finally { pyoSkip = false; } } }); return; }
  con.hidden = true; out.style.display = '';
  if (document.documentElement.dataset.dev === 'phone') setView('out');
  out.style.background = cur === 'html' || cur === 'css' ? '#fff' : '';
  if (cur === 'py' && pyWeb(src)) {
    // Python управляет страницей: берём вкладку HTML (если есть) и запускаем через Brython
    const h = tabs.find(t => t.lang === 'html');
    const usesPage = /\bdocument\b|\bhtml\b|\bsvg\b|\bwidgets\b/.test(src);
    if (!h && !usesPage) { runViaBrython(src, true); return; }
    out.style.background = '#fff';
    out.srcdoc = project(h ? h.code : PYPAGE, [src]);
    return;
  }
  // Skulpt не умеет sys.settrace/setprofile (и сам об этом не сообщает, а кидает AttributeError, который код часто ловит), сразу идём через Brython
  if (cur === 'py' && /\bsys\s*\.\s*(settrace|setprofile)\b|\bfrom\s+sys\s+import[^\n]*\b(settrace|setprofile)\b/.test(src)) { runViaBrython(src, true); return; }
  if (cur === 'py' && modernPy(src)) { runViaBrython(src, true); return; }
  if (cur === 'py') { if (typeof Sk === 'undefined') pageOut('', 'Python не загрузился'); else runPy(src); return; }
  if (cur === 'js') {
    // Есть вкладка HTML: собираем весь проект (JS подтянется из вкладки), иначе запускаем чистый JS
    const h = tabs.find(t => t.lang === 'html');
    out.srcdoc = h ? project(h.code, pyTabs()) : runnerJs(src);
  }
  else if (cur === 'css') { const h = tabs.find(t => t.lang === 'html'); out.srcdoc = project(h ? h.code : SAMPLE, pyTabs()); }
  else out.srcdoc = project(src, pyTabs());
}


// ===== АВТОЗАКРЫТИЕ СКОБОК И КАВЫЧЕК (чистая функция) =====
function autoEdit(v, s, e, k, lang){
  const OPEN = { '(': ')', '[': ']', '{': '}' }, CLOSE = ')]}';
  const Q = lang === 'js' ? '"\'`' : '"\'';
  const isQ = Q.includes(k);
  const prev = v[s - 1] || '', next = v[e] || '';
  if (s !== e) {                                   // выделено — оборачиваем
    if (OPEN[k]) return { from: s, to: e, text: k + v.slice(s, e) + OPEN[k], sel: [s + 1, e + 1] };
    if (isQ)     return { from: s, to: e, text: k + v.slice(s, e) + k,       sel: [s + 1, e + 1] };
    return null;
  }
  if (CLOSE.includes(k) && next === k) return { from: s, to: s, text: '', sel: [s + 1, s + 1] };   // перепрыгнуть закрывающую
  if (isQ) {
    if (next === k) return { from: s, to: s, text: '', sel: [s + 1, s + 1] };                       // перепрыгнуть кавычку
    const ls = v.lastIndexOf('\n', s - 1) + 1, before = v.slice(ls, s);
    if (lang === 'py' && v.slice(s - 2, s) === k + k && v[s - 3] !== k && !/[\w]/.test(next))      // третья кавычка → """|"""
      return { from: s, to: s, text: k + k + k + k, sel: [s + 1, s + 1] };
    if (prev === k) return null;                                                                    // одиночная кавычка после закрытой
    const prefix = lang === 'py' && /(^|[^\w])[rRbBfFuU]{1,2}$/.test(before);                       // f"..", r'..'
    if (/\w/.test(prev) && !prefix) return null;                                                    // апостроф в слове: don't
    if (next && !/[\s)\]}.,;:>]/.test(next)) return null;
    return { from: s, to: s, text: k + k, sel: [s + 1, s + 1] };
  }
  if (OPEN[k]) {
    if (next && !/[\s)\]}.,;:>"'`]/.test(next)) return null;
    return { from: s, to: s, text: k + OPEN[k], sel: [s + 1, s + 1] };
  }
  return null;
}
// Tab перед закрывающей скобкой/кавычкой — перепрыгнуть через неё
function tabJump(v, s, e){
  if (s !== e) return false;
  const n = v[s] || '', ls = v.lastIndexOf('\n', s - 1) + 1, before = v.slice(ls, s);
  if (!n || !/\S/.test(v[s - 1] || '')) return false;
  if (')]}'.includes(n)) return true;
  if ('"\'`'.includes(n)) return (before.split(n).length - 1) % 2 === 1;
  return false;
}
function placeSel(a, b){
  code.setSelectionRange(a, b);
  const val = code.value;
  setTimeout(() => { if (code.value === val && (code.selectionStart !== a || code.selectionEnd !== b)) code.setSelectionRange(a, b); }, 0);
}

code.addEventListener('input', () => { tabs[ai].code = code.value; save(); update(); });
code.addEventListener('scroll', sync);
code.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); return; }
  if (sugList.length) {
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); accept(sugList[sugI]); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugI = (sugI + (e.key === 'ArrowDown' ? 1 : sugList.length - 1)) % sugList.length; drawSug(); return; }
    if (e.key === 'Escape') { hideSug(); return; }
  }
  if (e.key === 'Escape') { ML.tabFree = true; return; }
  if (e.key === 'Tab') { if (ML.tabFree) { ML.tabFree = false; return; } }
  else if (!/^(Shift|Control|Alt|Meta)$/.test(e.key)) ML.tabFree = false;
  const s0 = code.selectionStart, e0 = code.selectionEnd, v0 = code.value, ins = t => document.execCommand('insertText', false, t);
  const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const line = v0.slice(v0.lastIndexOf('\n', s0 - 1) + 1, s0), sp = /^[ \t]*/.exec(line)[0];
    const prev = v0[s0 - 1], next = v0[e0], unit = ' '.repeat(ind());
    const open = '([{'.includes(prev || ' ') || (cur === 'py' && /:\s*$/.test(line));
    if (open && next && pairs[prev] === next) { ins('\n' + sp + unit + '\n' + sp); const p = s0 + 1 + sp.length + unit.length; code.setSelectionRange(p, p); }
    else ins('\n' + sp + (open ? unit : ''));
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && e.key.length === 1) {
    const ed = autoEdit(v0, s0, e0, e.key, cur);
    if (ed) {
      e.preventDefault();
      if (ed.text !== '' || ed.from !== ed.to) { code.setSelectionRange(ed.from, ed.to); ins(ed.text); }
      placeSel(ed.sel[0], ed.sel[1]);
      return;
    }
  }
  if (e.key === 'Backspace' && s0 === e0 && s0 > 0 && pairs[v0[s0 - 1]] === v0[s0]) { e.preventDefault(); code.setSelectionRange(s0 - 1, s0 + 1); document.execCommand('delete'); return; }
  if (e.key === 'Tab' && !e.shiftKey && cur === 'html' && s0 === e0) {
    const ls = v0.lastIndexOf('\n', s0 - 1) + 1, line = v0.slice(ls, s0);
    if (line.trim() === '!') {
      e.preventDefault();
      const sp = /^[ \t]*/.exec(line)[0], bang = ls + sp.length, nl = '\n' + sp;
      const tpl = ['<!DOCTYPE html>', '<html lang="ru">', '<head>', '  <meta charset="UTF-8">', '  <meta name="viewport" content="width=device-width, initial-scale=1.0">', '  <title>Document</title>', '</head>', '<body>', '  ', '</body>', '</html>'];
      code.setSelectionRange(bang, s0);
      ins(tpl.join(nl));
      const p = bang + tpl.slice(0, 9).join(nl).length;
      code.setSelectionRange(p, p);
      return;
    }
  }
  if (e.key === 'Tab' && !e.shiftKey && tabJump(v0, s0, e0)) { e.preventDefault(); placeSel(s0 + 1, s0 + 1); return; }
  if (e.key !== 'Tab') return;
    const v = code.value, a = code.selectionStart, b = code.selectionEnd;
  if (a === b && !e.shiftKey) { document.execCommand('insertText', false, ' '.repeat(ind())); return; }
  const ls = v.lastIndexOf('\n', a - 1) + 1;
  const block = v.slice(ls, b).split('\n');
  const res = block.map(l => e.shiftKey ? l.replace(new RegExp('^ {1,' + ind() + '}'), '') : ' '.repeat(ind()) + l).join('\n');
  code.setSelectionRange(ls, b);
  document.execCommand('insertText', false, res);
  code.setSelectionRange(ls, ls + res.length);
});

const LN = { py: 'Python', js: 'JavaScript', html: 'HTML', css: 'CSS' };
function tabName(l){ return uniq(DEFN[l] || LN[l]); }

$('run').addEventListener('click', run);

const mainEl = $('main'), gap = $('gap');
const edEl = $('ed'), gh = $('gh');
const setGw = v => { edEl.style.setProperty('--gw', v + 'px'); edEl.classList.toggle('nogut', v === 0); };
gh.addEventListener('pointerdown', e => { gh.setPointerCapture(e.pointerId); gh.classList.add('on'); });
gh.addEventListener('pointermove', e => {
  if (!gh.hasPointerCapture(e.pointerId)) return;
  const w = Math.min(140, Math.max(0, e.clientX - edEl.getBoundingClientRect().left));
  setGw(w < 14 ? 0 : w);
});

// ===== РАЗДЕЛИТЕЛЬ КОД / РЕЗУЛЬТАТ =====
(function(){
  const isVert = () => getComputedStyle(mainEl).gridTemplateColumns.trim().split(/\s+/).length === 1;
  const SNAP = 0.06;
  let ratio = 0.5;
  function apply(a, finalize){
    a = Math.max(0, Math.min(1, a));
    if (a < SNAP) a = 0; else if (a > 1 - SNAP) a = 1;
    ratio = a;
    mainEl.style.setProperty('--a', a);
    mainEl.classList.toggle('c0', a === 0);
    mainEl.classList.toggle('c1', a === 1);
    mainEl.classList.toggle('vert', isVert());
    gap.setAttribute('aria-valuenow', String(Math.round(a * 100))); gap.setAttribute('aria-orientation', isVert() ? 'horizontal' : 'vertical');
    if (a > 0 && a < 1) mainEl.style.setProperty('--sw', '6px');
    else if (finalize) mainEl.style.setProperty('--sw', '18px');
    if (finalize) { try { localStorage.setItem('ml-a', String(a)); } catch(e) {} }
  }
  let sx = 0, sy = 0, moved = false, wasEdge = false;
  gap.addEventListener('pointerdown', e => {
    gap.setPointerCapture(e.pointerId); gap.classList.add('on'); mainEl.classList.add('drag');
    mainEl.classList.toggle('vert', isVert());
    sx = e.clientX; sy = e.clientY; moved = false; wasEdge = ratio === 0 || ratio === 1;
    e.preventDefault();
  });
  gap.addEventListener('pointermove', e => {
    if (!gap.hasPointerCapture(e.pointerId)) return;
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
    if (!moved) return;
    const r = mainEl.getBoundingClientRect(), v = isVert();
    const size = (v ? r.height : r.width) - 6, pos = (v ? e.clientY - r.top : e.clientX - r.left) - 3;
    apply(pos / size, false);
  });
  const end = e => {
    if (!gap.classList.contains('on')) return;
    gap.classList.remove('on'); mainEl.classList.remove('drag');
    try { gap.releasePointerCapture(e.pointerId); } catch(x) {}
    if (!moved && wasEdge) apply(0.5, true); else apply(ratio, true);   // клик по спрятанной панели — вернуть пополам
  };
  gap.addEventListener('pointerup', end);
  gap.addEventListener('pointercancel', end);
  gap.addEventListener('dblclick', () => apply(0.5, true));
  // клавиатура: стрелки двигают границу на 5%, Home/End прячут панели, Enter возвращает пополам
  gap.addEventListener('keydown', e => {
    const k = e.key, step = e.shiftKey ? 0.15 : 0.05;
    if (k === 'ArrowLeft' || k === 'ArrowUp') apply(ratio - step, true);
    else if (k === 'ArrowRight' || k === 'ArrowDown') apply(ratio + step, true);
    else if (k === 'Enter' || k === ' ') apply(0.5, true);
    else if (k === 'Home') apply(0, true);
    else if (k === 'End') apply(1, true);
    else return;
    e.preventDefault();
  });
  gap.title = 'Тяни, чтобы изменить размер. Двойной клик — поровну';
  try { const a = parseFloat(localStorage.getItem('ml-a')); if (!isNaN(a)) apply(a, true); else apply(0.5, false); } catch(e) { apply(0.5, false); }
  if (window.ResizeObserver) new ResizeObserver(() => mainEl.classList.toggle('vert', isVert())).observe(mainEl);
  window.addEventListener('resize', () => mainEl.classList.toggle('vert', isVert()));
})();

const endGh = () => { gh.classList.remove('on'); try { localStorage.setItem('ml-gw', edEl.style.getPropertyValue('--gw')); } catch(e) {} };
gh.addEventListener('pointerup', endGh);
gh.addEventListener('pointercancel', endGh);
gh.addEventListener('dblclick', () => { edEl.style.removeProperty('--gw'); edEl.classList.remove('nogut'); try { localStorage.removeItem('ml-gw'); } catch(e) {} });
try { const g = localStorage.getItem('ml-gw'); if (g) setGw(parseInt(g, 10) || 0); } catch(e) {}

try { const t = localStorage.getItem('ml-theme'); if (t) th.value = t; } catch(e) {}
document.documentElement.dataset.theme = th.value || 'dark';
th.addEventListener('change', () => {
  document.documentElement.dataset.theme = th.value;
  try { localStorage.setItem('ml-theme', th.value); } catch(e) {}
});

try {
  const sv = JSON.parse(localStorage.getItem('ml-tabs') || 'null');
  // повреждённые записи (нет кода, неизвестный язык) отбрасываем: иначе редактор не запустится
  const good = sv && Array.isArray(sv.tabs) ? sv.tabs.filter(t => t && typeof t.code === 'string' && LN[t.lang]).map(t => ({ name: String(t.name || DEFN[t.lang]), lang: t.lang, code: t.code, ext: t.ext ? 1 : undefined })) : [];
  if (good.length) { tabs = good; ai = Math.max(0, Math.min(+sv.ai || 0, tabs.length - 1)); }
  else { const o = JSON.parse(localStorage.getItem('ml-code') || 'null'); if (o && o.store && LN[o.cur]) tabs = [{ name: 'Файл 1', lang: o.cur, code: String(o.store[o.cur] || '') }]; }
} catch(e) {}
cur = tabs[ai].lang; 
code.value = tabs[ai].code; renderTabs();
try { const f = +localStorage.getItem('ml-fs'); if (FSZ.includes(f)) setFS(f); } catch(e) {}
update();
loadShared();
initDevice();
if (ML.skReady) ML.skReady.then(() => update());

// --- КНОПКА ФОРМАТИРОВАНИЯ ---
// ===== ФОРМАТИРОВАНИЕ =====
// JS/HTML/CSS форматирует Prettier (подгружается один раз при первом нажатии); если он недоступен (нет сети), работает упрощённый форматтер
const PRET = ['https://cdn.jsdelivr.net/npm/prettier@2.8.8/', 'https://cdnjs.cloudflare.com/ajax/libs/prettier/2.8.8/'];
let pretP = null;
function loadPrettier(){
  if (pretP) return pretP;
  const get = (b, n) => new Promise((ok, no) => {
    const e = document.createElement('script'); e.crossOrigin = 'anonymous';
    e.src = b + n + (b.indexOf('cdnjs') >= 0 ? '.min' : '') + '.js'; e.onload = ok; e.onerror = () => { e.remove(); no(); };
    document.head.appendChild(e);
  });
  pretP = (async () => {
    for (const b of PRET) {
      try { await get(b, 'standalone'); await Promise.all(['parser-babel', 'parser-html', 'parser-postcss'].map(n => get(b, n))); if (window.prettier && window.prettierPlugins) return; } catch(e) {}
    }
    throw new Error('prettier');
  })();
  pretP.catch(() => { pretP = null; });
  return pretP;
}
const VOID_TAG = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
function fmtSimple(src){
  let lvl = 0, inCom = false;
  return src.replace(/\r/g, '').split('\n').map(line => {
    const t = line.trim(); if (!t) return '';
    let u = t.replace(/\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
    if (cur !== 'html') u = u.replace(/\/\/.*$/, '');
    if (inCom) { if (u.includes('*/')) inCom = false; return ' '.repeat(Math.max(0, lvl) * 2) + ' ' + t; }
    if (/\/\*(?!.*\*\/)/.test(u)) inCom = true;
    let dec = (/^[}\]]+/.exec(u) || [''])[0].length, net = (u.match(/[{\[]/g) || []).length - (u.match(/[}\]]/g) || []).length;
    if (cur === 'html' && u[0] === '<' && !/^<!--/.test(u)) {
      if (/^<\//.test(u)) dec++;
      (u.match(/<\/?[a-zA-Z][\w-]*[^>]*>/g) || []).forEach(tag => {
        const nm = /^<\/?([a-zA-Z][\w-]*)/.exec(tag)[1];
        if (VOID_TAG.test(nm) || /\/>$/.test(tag)) return;
        net += tag[1] === '/' ? -1 : 1;
      });
    }
    const here = Math.max(0, lvl - dec);
    lvl = Math.max(0, lvl + net);
    return ' '.repeat(here * 2) + t;
  }).join('\n');
}
// Подставляет отформатированный текст ОДНОЙ правкой (один Ctrl+Z откатит всё) и оставляет курсор и прокрутку на прежнем месте кода.
// Место курсора ищем по числу букв/цифр перед ним: форматтеры меняют пробелы, кавычки и скобки, а слова остаются теми же.
function applyFormatted(t){
  const v = window.cmView, old = code.value, wc = /[\p{L}\p{N}_]/u;
  const before = (x, p) => { let n = 0; for (let i = 0; i < p; i++) if (wc.test(x[i])) n++; return n; };
  const after = (x, n) => { if (n <= 0) return 0; let k = 0; for (let i = 0; i < x.length; i++) if (wc.test(x[i]) && ++k === n) return i + 1; return x.length; };
  const A = v ? v.state.selection.main.anchor : code.selectionStart, H = v ? v.state.selection.main.head : code.selectionEnd;
  const na = after(t, before(old, A)), nh = after(t, before(old, H)), top = v ? v.scrollDOM.scrollTop : code.scrollTop;
  if (v) {
    let a = 0; const m = Math.min(old.length, t.length);
    while (a < m && old.charCodeAt(a) === t.charCodeAt(a)) a++;
    let b = 0; while (b < m - a && old.charCodeAt(old.length - 1 - b) === t.charCodeAt(t.length - 1 - b)) b++;
    v.dispatch({ changes: { from: a, to: old.length - b, insert: t.slice(a, t.length - b) }, selection: { anchor: na, head: nh }, userEvent: 'input.format' });
    v.scrollDOM.scrollTop = top;
    return;
  }
  code.focus(); code.select();
  if (!document.execCommand('insertText', false, t)) { code.value = t; tabs[ai].code = t; save(); }
  try { code.setSelectionRange(na, nh); code.scrollTop = top; } catch (_) {}
}
function applyFmt(t){
  if (t === code.value) { say('Уже отформатировано'); return; }
  applyFormatted(t); update(); say('Отформатировано');
}
// Black (Python) ставится из PyPI один раз за сеанс и сохраняется сервис-воркером: подготавливаем его заранее, пока человек пишет код,
// чтобы кнопка «Формат» срабатывала сразу, а не после загрузки.
let blackWarm = null, blackOk = null;
function warmFmt(){
  if (!pyoReady || !pyoW || pyoRunning || eng === 'classic' || blackWarm === pyoW) return;
  if (navigator.onLine === false || (navigator.connection && navigator.connection.saveData)) return;
  if (!tabs.some(t => t.lang === 'py')) return;
  const w = blackWarm = pyoW;
  pyoCall({ t: 'fmt', src: 'x = 1\n' }).then(d => { try { const j = JSON.parse(d.r); if (j.fail) { if (blackWarm === w) blackWarm = null; } else blackOk = w; } catch (_) {} }).catch(() => { if (blackWarm === w) blackWarm = null; });
}
let pretWarm = false;
function warmAnyFmt(){
  if (navigator.onLine === false || (navigator.connection && navigator.connection.saveData)) return;
  if (cur === 'py') warmFmt(); else if (!pretWarm) { pretWarm = true; loadPrettier().catch(() => { pretWarm = false; }); }
}
function fmtPyFallback(src, why){
  const t = fmtPy(src);
  if (t === src) { say(why ? why + ': код уже выглядит ровно' : 'Уже отформатировано'); return; }
  applyFormatted(t); update(); say(why || 'Отформатировано (упрощённо)');
}
document.getElementById('fmtBtn').addEventListener('click', async () => {
  const src = code.value;
  if (!src.trim()) return;
  if (cur === 'py') {
    // основной форматтер: Black внутри Pyodide; запасной: упрощённый fmtPy
    if (pyoRunning && eng !== 'classic') { fmtPyFallback(src, 'Программа ещё выполняется, применён упрощённый форматтер'); return; }
    if (eng !== 'classic' && window.Worker && !pyoFail && !pyoSkip) {
      const b = $('fmtBtn'); b.disabled = true;
      if (blackOk !== pyoW) say('Black: подготовка (один раз за сеанс, дальше мгновенно)…');
      let res = null;
      try {
        res = await Promise.race([
          (async () => { await startPyo(); const d = await pyoCall({ t: 'fmt', src }); return JSON.parse(d.r); })(),
          new Promise(r => setTimeout(() => r({ late: 1 }), 60000))
        ]);
      } catch (_) { res = { fail: 'x' }; } finally { b.disabled = false; }
      if (res && typeof res.ok === 'string') { blackOk = pyoW; applyFmt(res.ok); return; }
      if (res && res.syntax) { blackOk = pyoW; say('Не отформатировано, в коде есть ошибка: ' + res.syntax.slice(0, 90)); return; }
      fmtPyFallback(src, res && res.late ? 'Black долго грузится (нет интернета?), применён упрощённый форматтер' : 'Black не загрузился (нужен интернет один раз), применён упрощённый форматтер');
      return;
    }
    fmtPyFallback(src); return;
  }
  const btn = $('fmtBtn'); btn.disabled = true;
  try {
    let ready = true;
    try { await loadPrettier(); } catch(e) { ready = false; }
    if (!ready) { applyFmt(fmtSimple(src)); say('Prettier не загрузился (нет сети?): применён упрощённый форматтер'); return; }
    let out;
    try { out = prettier.format(src, { parser: cur === 'js' ? 'babel' : cur === 'css' ? 'css' : 'html', plugins: prettierPlugins, tabWidth: 2, printWidth: 100 }); }
    catch(e) { say('Не отформатировано, в коде есть ошибка: ' + String(e.message || e).split('\n')[0].slice(0, 90)); return; }
    applyFmt(out.replace(/\s+$/, '') + '\n');
  } finally { btn.disabled = false; }
});


// ===== ВЫБОР ЯЗЫКА С ЦВЕТНЫМИ ЗНАЧКАМИ =====
const LANGS = {
  py:   { n: 'Python',     b: 'PY',   c: '#3b82f6' },
  js:   { n: 'JavaScript', b: 'JS',   c: '#eab308' },
  html: { n: 'HTML',       b: 'HTML', c: '#f97316' },
  css:  { n: 'CSS',        b: 'CSS',  c: '#a855f7' }
};
const langBtn = $('langBtn'), langMenu = document.createElement('div');
langMenu.id = 'langMenu'; langMenu.hidden = true; document.body.appendChild(langMenu);
function syncLangBtn(){
  const L = LANGS[cur]; if (!L) return;
  langBtn.style.setProperty('--c', L.c);
  $('langBadge').textContent = L.b; $('langName').textContent = L.n;
}
function closeLangMenu(){ langMenu.hidden = true; }
function drawLangMenu(){
  langMenu.innerHTML = '<div class="lm-h"><span>Язык</span><span>клавиши 1–4</span></div>' +
    Object.keys(LANGS).map((k, i) => '<div class="lm-i' + (k === cur ? ' on' : '') + '" data-l="' + k + '" style="--c:' + LANGS[k].c + '"><span class="bdg">' + LANGS[k].b + '</span><b>' + LANGS[k].n + '</b>' + (k === cur ? '<span class="ck">✓</span>' : '<kbd>' + (i + 1) + '</kbd>') + '</div>').join('');
}
function pickLang(l){
  closeLangMenu();
  if (!LANGS[l] || l === cur) { code.focus(); return; }
  const t = tabs[ai];
  if (!t.code.trim() && !code.value.trim()) { t.lang = l; t.name = tabName(l); switchTab(ai); }
  else { tabs.push({ name: tabName(l), lang: l, code: '' }); switchTab(tabs.length - 1); }
  code.focus();
}
langBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!langMenu.hidden) return closeLangMenu();
  closeSaved(); closeMenu(); drawLangMenu(); langMenu.hidden = false;
  const r = langBtn.getBoundingClientRect(), w = 250;
  langMenu.style.top = (r.bottom + 6) + 'px';
  langMenu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
});
langMenu.addEventListener('click', e => { e.stopPropagation(); const it = e.target.closest('[data-l]'); if (it) pickLang(it.dataset.l); });
document.addEventListener('click', e => { if (!langMenu.hidden && !langMenu.contains(e.target) && !langBtn.contains(e.target)) closeLangMenu(); }, true);
document.addEventListener('keydown', e => {
  if (langMenu.hidden) return;
  if (e.key === 'Escape') closeLangMenu();
  else if (/^[1-4]$/.test(e.key)) { e.preventDefault(); pickLang(Object.keys(LANGS)[+e.key - 1]); }
});
syncLangBtn();

// ===== ОКНО ЭКСПОРТА =====
const EXT = { py: 'py', js: 'js', html: 'html', css: 'css' };
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b){ let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files){
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  files.forEach(f => {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true);
    ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nm);
    offset += 30 + nm.length + sz;
  });
  const csize = central.reduce((a, p) => a + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
function saveBlob(blob, name){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function tabsOf(l){ return tabs.map((t, i) => ({ t, i })).filter(o => o.t.lang === l && ((o.i === ai ? code.value : o.t.code) || '').trim()); }
function fileList(sel){
  const used = new Set(), res = [];
  sel.forEach(l => tabsOf(l).forEach(o => {
    let n = cleanName(o.t.name) || 'code', k = 2; if (langOf(n) !== l) n += '.' + EXT[l];
    const mm = /^(.*?)(\.[^./]+)$/.exec(n);
    while (used.has(n)) n = mm[1] + ' ' + k++ + mm[2];
    used.add(n); res.push({ name: n, text: o.i === ai ? code.value : o.t.code });
  }));
  return res;
}
const exm = document.createElement('div'); exm.id = 'exm'; exm.hidden = true; document.body.appendChild(exm);
function closeExport(){ exm.hidden = true; }
function exSelected(){ return Array.from(exm.querySelectorAll('input[data-l]:checked')).map(i => i.dataset.l); }
function exRefresh(){
  exm.querySelectorAll('.exr').forEach(r => r.classList.toggle('sel', r.querySelector('input').checked));
  const n = fileList(exSelected()).length, go = exm.querySelector('.go');
  go.disabled = n === 0; go.textContent = n ? 'Скачать (' + n + ')' : 'Скачать';
}
function openExport(){
  closeSaved(); closeMenu(); closeLangMenu();
  const rows = Object.keys(LANGS).map(l => {
    const L = LANGS[l], list = tabsOf(l), has = list.length > 0;
    const files = fileList([l]).map(f => f.name);
    const info = has ? (files[0] + (files.length > 1 ? ' и ещё ' + (files.length - 1) : '')) : 'нет кода';
    return '<label class="exr' + (has ? ' sel' : ' dis') + '" style="--c:' + L.c + '"><input type="checkbox" data-l="' + l + '"' + (has ? ' checked' : ' disabled') + '><span class="bdg">' + L.b + '</span><span class="nm"><b>' + L.n + '</b><span>' + esc(info) + '</span></span></label>';
  }).join('');
  exm.innerHTML = '<div class="exb"><h3>Экспорт файлов</h3><p class="sub">Отметь, что скачать. Можно выбрать сразу несколько языков.</p>' + rows +
    '<label class="exz"><input type="checkbox" id="exZip" checked> Одним ZIP-архивом (если файлов несколько)</label>' +
    '<div class="exf"><button class="all" data-x="all">Выбрать все</button><button data-x="cancel">Отмена</button><button class="go" data-x="go">Скачать</button></div></div>';
  exm.hidden = false; exRefresh();
}
exm.addEventListener('change', exRefresh);
exm.addEventListener('click', e => {
  if (e.target === exm) return closeExport();
  const b = e.target.closest('[data-x]'); if (!b) return;
  const k = b.dataset.x;
  if (k === 'cancel') closeExport();
  else if (k === 'all') {
    const boxes = Array.from(exm.querySelectorAll('input[data-l]:not(:disabled)')), allOn = boxes.every(x => x.checked);
    boxes.forEach(x => x.checked = !allOn); b.textContent = allOn ? 'Выбрать все' : 'Снять все'; exRefresh();
  } else if (k === 'go') {
    const files = fileList(exSelected()); if (!files.length) return;
    const zip = $('exZip') && $('exZip').checked;
    closeExport();
    if (files.length > 1 && zip) saveBlob(makeZip(files.map(f => ({ name: f.name, data: new TextEncoder().encode(f.text) }))), 'ml-editor-export.zip');
    else files.forEach((f, i) => setTimeout(() => saveBlob(new Blob([f.text], { type: 'text/plain;charset=utf-8' }), f.name), i * 350));
    say(files.length > 1 && zip ? 'Скачан ZIP: файлов ' + files.length : 'Скачано файлов: ' + files.length);
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !exm.hidden) closeExport(); });
$('exportMainBtn').addEventListener('click', openExport);

// подготовка форматтеров заранее (наведение, касание, начало набора), чтобы «Формат» не заставлял ждать
(function(){
  const b = $('fmtBtn'); if (!b) return;
  ['pointerenter', 'focus', 'touchstart'].forEach(e => b.addEventListener(e, () => { try { warmAnyFmt(); } catch (_) {} }, { passive: true }));
  code.addEventListener('input', function f(){ if (cur !== 'py') { try { warmAnyFmt(); } catch (_) {} code.removeEventListener('input', f); } });
})();
