// Диагностика редактора: меню «Диагностика редактора…». Прогоняет заготовленные программы через все движки и показывает, что работает.
// Использует глобальные из app.js: pyoCall, startPyo, stopPyo, pyoReady, pyoRunning, pyoSync, pyBusy, getProxy, Sk, runnerJs, project, tabs, eng, say, PYACT, ML.
(function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const timeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('таймаут ' + Math.round(ms / 1000) + ' с')), ms))]);
  const lastLine = s => String(s || '').trim().split('\n').filter(Boolean).pop() || '';
  const q = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const withTabs = (list, fn) => { const sv = tabs; tabs = list; try { return fn(); } finally { tabs = sv; } };
  const miss = (exp, got) => ({ ok: false, note: 'ожидалось «' + exp + '», получено «' + String(got).trim().slice(0, 140) + '»' });

  // ---------- Python · Pyodide ----------
  async function ensurePy(){
    if (pyoRunning) return 'сейчас выполняется программа: нажмите «Стоп» и повторите';
    if (pyoReady) return '';
    try { await timeout(Promise.resolve(startPyo()), 90000); } catch (e) { return 'Pyodide не загрузился (нет интернета?)'; }
    return pyoReady ? '' : 'Pyodide не загрузился';
  }
  const py = (n, code, exp, o) => {
    o = o || {};
    return { g: 'Python · Pyodide (CPython 3.12)', n, run: async () => {
      const w = await ensurePy(); if (w) return { skip: w };
      let r;
      try { r = await timeout(pyoCall({ t: 'test', src: code, files: o.files || [], stdin: o.stdin || '', inter: false, sid: 'diag', sync: '', seed: 1, proxy: getProxy(), origin: location.origin }), o.net ? 120000 : 40000); }
      catch (e) { try { stopPyo(true); } catch (_) {} return { ok: false, note: e.message }; }
      if (r.err) return { ok: false, note: lastLine(r.err) };
      if (o.im) return (r.im || []).length ? { ok: true } : { ok: false, note: 'картинка не получена' };
      if (o.pf) return (r.pf || []).length ? { ok: true } : { ok: false, note: 'график plotly не получен' };
      return r.buf.includes(exp) ? { ok: true } : miss(exp, r.buf);
    } };
  };

  // ---------- Python · Skulpt ----------
  const sk = (n, code, exp, input) => ({ g: 'Python · Skulpt (быстрый запуск, turtle)', n, run: async () => {
    if (typeof Sk === 'undefined') { try { if (ML && ML.skReady) await timeout(ML.skReady, 8000); } catch (_) {} }
    if (typeof Sk === 'undefined' || !Sk.configure) return { skip: 'Skulpt не загружен' };
    if (pyBusy) return { skip: 'сейчас выполняется программа' };
    let buf = '';
    Sk.configure({ output: t => { buf += t; }, __future__: Sk.python3, execLimit: 8000, inputfunTakesPrompt: true,
      read: x => { if (!Sk.builtinFiles || !Sk.builtinFiles.files[x]) throw 'File not found: ' + x; return Sk.builtinFiles.files[x]; },
      inputfun: p => { buf += p || ''; return input || ''; } });
    Sk.execStart = Date.now();
    await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<diag>', false, code, true));
    return buf.includes(exp) ? { ok: true } : miss(exp, buf);
  } });

  // ---------- JavaScript и HTML (в невидимом iframe, настоящими функциями редактора) ----------
  const frame = (html, check, ms) => new Promise(res => {
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:-9999px;top:0;width:480px;height:320px;border:0';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin'); document.body.appendChild(f);
    const t0 = Date.now();
    const poll = () => {
      let okk = false, txt = '';
      try { const d = f.contentDocument; okk = !!check(d); txt = d.body ? d.body.innerText : ''; } catch (_) {}
      if (okk) { f.remove(); res({ ok: true }); }
      else if (Date.now() - t0 > ms) { f.remove(); res({ ok: false, note: 'нет ожидаемого результата; вывод: «' + txt.trim().slice(0, 140) + '»' }); }
      else setTimeout(poll, 120);
    };
    f.srcdoc = html; setTimeout(poll, 250);
  });
  const jt = (n, code, exp, o) => ({ g: 'JavaScript', n, run: () => frame(runnerJs(code), d => d.body && d.body.innerText.includes(exp), o && o.net ? 15000 : 4000) });
  const PAGE = '<p id="a"></p><script>document.getElementById("a").textContent = "ok-html";<\/script>';
  const PROJ = '<link rel="stylesheet" href="css/style.css"><p id="a"></p><script src="js/app.js"><\/script>';
  const ht = [
    { g: 'HTML', n: 'Страница со скриптом', run: () => frame(withTabs([{ name: 'index.html', lang: 'html', code: PAGE }], () => project(PAGE, [])), d => { const e = d.getElementById('a'); return e && e.textContent === 'ok-html'; }, 4000) },
    { g: 'HTML', n: 'Проект из файлов: CSS и JS-модуль во вкладках', run: () => {
      const list = [{ name: 'index.html', lang: 'html', code: PROJ }, { name: 'css/style.css', lang: 'css', code: '#a{color:rgb(255,0,0)}' },
        { name: 'js/app.js', lang: 'js', code: 'import { v } from "data:text/javascript,export const v = 3";\ndocument.getElementById("a").textContent = "mod-" + v;' }];
      return frame(withTabs(list, () => project(PROJ, [])), d => { const e = d.getElementById('a'); return e && e.textContent === 'mod-3' && d.defaultView.getComputedStyle(e).color === 'rgb(255, 0, 0)'; }, 4000);
    } }
  ];

  const TESTS = [
    py('print, генераторы, классы', 'class A:\n    def __init__(s, n): s.n = n\n    def __repr__(s): return f"A({s.n})"\nprint(sum(i * i for i in range(5)), A(3))', '30 A(3)'),
    py('match/case и моржовый оператор', 'def f(x):\n    match x:\n        case [a, b]: return a + b\n        case _: return -1\nprint(f([1, 2]), (n := 5) * 2)', '3 10'),
    py('dataclass и typing', 'from dataclasses import dataclass\nfrom typing import Optional\n@dataclass\nclass P:\n    x: int\n    y: Optional[int] = None\nprint(P(1))', 'P(x=1, y=None)'),
    py('async/await (asyncio)', 'import asyncio\nasync def g():\n    await asyncio.sleep(0.01)\n    return 7\nprint(asyncio.run(g()))', '7'),
    py('input() и входные данные', 'name = input("Имя: ")\nprint("Привет,", name)', 'Привет, Мир', { stdin: 'Мир' }),
    py('исключения перехватываются', 'try:\n    1 / 0\nexcept ZeroDivisionError as e:\n    print("ok:", e)', 'ok: division by zero'),
    py('запись и чтение файла', 'with open("t.txt", "w") as f:\n    f.write("42")\nprint(open("t.txt").read())', '42'),
    py('импорт своего модуля из другой вкладки', 'import mymod\nprint(mymod.X)', '5', { files: [{ p: 'mymod.py', c: 'X = 5' }] }),
    py('numpy и pandas', 'import numpy as np, pandas as pd\nprint(int(pd.DataFrame({"a": [1, 2]}).a.sum() + np.arange(3).sum()))', '6', { net: true }),
    py('matplotlib: график-картинка', 'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.show()', '', { im: true, net: true }),
    py('seaborn (ставится из PyPI)', 'import matplotlib.pyplot as plt, numpy as np, seaborn as sns\nsns.heatmap(np.random.rand(3, 3))\nplt.show()', '', { im: true, net: true }),
    py('plotly: интерактивный график (ставится из PyPI)', 'import plotly.graph_objects as go\nfig = go.Figure(data=go.Scatter(x=[1, 2], y=[3, 4]))\nfig.show()', '', { pf: true, net: true }),
    py('автоустановка любого пакета с PyPI (tabulate)', 'import tabulate\nprint(tabulate.tabulate([[1, 2]], tablefmt="plain"))', '1  2', { net: true }),
    sk('print, цикл, класс', 'class A:\n    def __init__(self, n): self.n = n\nfor i in range(3): print(i, end=" ")\nprint(A(4).n)', '0 1 2 4'),
    sk('input()', 'x = input("Имя: ")\nprint("Привет,", x)', 'Привет, Мир', 'Мир'),
    sk('math и random', 'import math, random\nprint(math.sqrt(16), 0 <= random.random() < 1)', '4.0 True'),
    jt('имена f, er, ru, RU в коде пользователя не конфликтуют с раннером', 'const f = n => n * 2, er = 1, ru = 2, RU = 3;\nconsole.log(f(21), er + ru + RU);', '42 6'),
    jt('async/await, классы, деструктуризация', '(async () => {\n  const { a, ...r } = { a: 1, b: 2 };\n  await null;\n  console.log(a, JSON.stringify(r));\n})();', '1 {"b":2}'),
    jt('ES-модули: import из data-URL', 'import { v } from "data:text/javascript,export const v = 7";\nconsole.log("v =", v);', 'v = 7'),
    jt('await на верхнем уровне', 'const v = await Promise.resolve(5);\nconsole.log("tla", v);', 'tla 5'),
    jt('import «голого» имени из CDN (lodash через esm.sh)', 'import camelCase from "lodash/camelCase";\nconsole.log(camelCase("hello world"));', 'helloWorld', { net: true }),
    ht[0], ht[1]
  ];

  // ---------- интерфейс ----------
  const CSS = '#diag{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:12px}' +
    '#diag .dg{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:12px;width:min(720px,100%);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.5);font:13px/1.45 system-ui,sans-serif}' +
    '#diag .dh{display:flex;justify-content:space-between;align-items:baseline;padding:14px 16px 6px;font-size:15px}#diag .dh span{color:var(--mute);font-size:12px}' +
    '#diag .di{padding:0 16px 8px;color:var(--mute);font-size:12px}' +
    '#diag .db{overflow:auto;padding:4px 8px 8px;flex:1}#diag .dgp{padding:10px 8px 4px;color:var(--mute);font-size:11px;text-transform:uppercase;letter-spacing:.04em}' +
    '#diag .dr{display:flex;gap:8px;padding:5px 8px;border-radius:6px}#diag .dr:hover{background:var(--line)}#diag .dr i{font-style:normal;width:16px;flex:none;text-align:center}' +
    '#diag .dr .t{flex:1;min-width:0}#diag .dr small{display:block;color:var(--mute);font-size:12px;word-break:break-word}#diag .dr.f{color:var(--err)}#diag .dr.f small{color:var(--err)}#diag .dr .ms{color:var(--mute);font-size:11px;flex:none}' +
    '#diag .df{display:flex;gap:8px;justify-content:flex-end;padding:10px 16px 14px;border-top:1px solid var(--line)}';
  let token = 0;
  async function open(){
    if (document.getElementById('diag')) return;
    if (!document.getElementById('diagcss')) { const s = document.createElement('style'); s.id = 'diagcss'; s.textContent = CSS; document.head.appendChild(s); }
    const ov = document.createElement('div'); ov.id = 'diag';
    ov.innerHTML = '<div class="dg" role="dialog" aria-label="Диагностика"><div class="dh"><b>Диагностика редактора</b><span id="dsum">запуск…</span></div><div class="di" id="dinfo"></div><div class="db" id="dlist"></div>' +
      '<div class="df"><button id="dre">Запустить заново</button><button id="dcp">Копировать отчёт</button><button id="dcl">Закрыть</button></div></div>';
    document.body.appendChild(ov);
    const my = ++token, close = () => { token++; ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#dcl').onclick = close;
    const list = ov.querySelector('#dlist'), sum = ov.querySelector('#dsum'), info = ov.querySelector('#dinfo');
    let results = [], running = false;
    const env = () => {
      const sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      return 'Адрес: ' + location.protocol + '//' + location.host + ' · сервис-воркер: ' + (sw ? 'активен' : 'нет') + ' · блокирующий input(): ' + (pyoSync ? 'да' : 'нет') + ' · движок Python: ' + (eng === 'classic' ? 'классический' : 'Pyodide') + ' · ' + (navigator.onLine === false ? 'без сети' : 'сеть есть');
    };
    async function runAll(){
      if (running) return; running = true; results = []; list.innerHTML = ''; info.textContent = env(); sum.textContent = 'идёт проверка…';
      let group = '', rows = [];
      for (const t of TESTS) {
        if (token !== my) return;
        if (t.g !== group) { group = t.g; const h = document.createElement('div'); h.className = 'dgp'; h.textContent = group; list.appendChild(h); }
        const r = document.createElement('div'); r.className = 'dr'; r.innerHTML = '<i>…</i><div class="t">' + q(t.n) + '<small></small></div><span class="ms"></span>'; list.appendChild(r);
        r.scrollIntoView({ block: 'nearest' });
        const t0 = Date.now(); let res;
        try { res = await t.run(); } catch (e) { res = { ok: false, note: lastLine(e && e.message || e) }; }
        if (token !== my) return;
        const ms = Date.now() - t0, st = res.skip ? 'skip' : (res.ok ? 'ok' : 'fail');
        r.querySelector('i').textContent = st === 'ok' ? '✓' : st === 'fail' ? '✗' : '–';
        if (st === 'fail') r.classList.add('f');
        r.querySelector('small').textContent = res.skip ? 'пропущено: ' + res.skip : (res.note || '');
        r.querySelector('.ms').textContent = st === 'skip' ? '' : (ms < 1000 ? ms + ' мс' : (ms / 1000).toFixed(1) + ' с');
        results.push({ g: t.g, n: t.n, st, note: res.skip || res.note || '', ms });
      }
      const ok = results.filter(r => r.st === 'ok').length, bad = results.filter(r => r.st === 'fail').length, sk2 = results.filter(r => r.st === 'skip').length;
      sum.textContent = 'пройдено ' + ok + ' из ' + results.length + (bad ? ' · ошибок: ' + bad : '') + (sk2 ? ' · пропущено: ' + sk2 : '');
      running = false;
    }
    ov.querySelector('#dre').onclick = () => { if (!running) runAll(); };
    ov.querySelector('#dcp').onclick = async () => {
      const txt = 'Диагностика редактора, ' + new Date().toLocaleString() + '\n' + env() + '\n' + navigator.userAgent + '\n\n' +
        results.map(r => (r.st === 'ok' ? '✓ ' : r.st === 'fail' ? '✗ ' : '– ') + r.n + ' [' + r.g + ']' + (r.note ? ' — ' + r.note : '')).join('\n');
      try { await navigator.clipboard.writeText(txt); say('Отчёт скопирован'); } catch (_) { prompt('Скопируйте отчёт:', txt); }
    };
    runAll();
  }
  window.mlDiag = open;
  if (typeof PYACT !== 'undefined') PYACT.diag = open;
})();
