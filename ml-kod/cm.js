// CodeMirror 6 вместо textarea+подсветки. Старый textarea остаётся скрытым «фасадом»: app.js работает с ним как раньше
// (value, selectionStart, setSelectionRange, scrollTop, события input/focus/blur), а все вызовы уходят в CodeMirror.
// Если библиотека не загрузилась (нет сети), редактор остаётся прежним (старый textarea со своей подсветкой и подсказками).
// Всё, что в старом режиме делал обработчик keydown на textarea (Ctrl+Enter, подсказки, «!» + Tab, прыжок Tab через скобку,
// панель символов на телефоне), здесь перенесено в CodeMirror.
(async () => {
// Все пакеты подключаются по одному адресу через import map в index.html: это гарантирует одну копию @codemirror/state и view.
let M, lastErr = '';
try {
  const N = ['codemirror', '@codemirror/state', '@codemirror/view', '@codemirror/language', '@lezer/highlight', '@codemirror/lint', '@codemirror/commands',
    '@codemirror/autocomplete', '@codemirror/lang-python', '@codemirror/lang-javascript', '@codemirror/lang-html', '@codemirror/lang-css'];
  // Если рядом лежит cm-bundle.js (собранный локально, см. cm-bundle-build/), берём его: ни esm.sh, ни интернет не нужны
  const B = window.CMB;
  const m = B ? [B.cm, B.st, B.vw, B.lg, B.hi, B.ln, B.cmd, B.ac, B.py, B.js, B.ht, B.cs]
    : await Promise.all(N.map(n => import(n).catch(e => { throw new Error(n + ': ' + (e && e.message || e)); })));
  const [cm, st, vw, lg, hi, ln, cmd, ac, py, js, ht, cs] = m;
  M = { cm, st, vw, lg, hi, ln, cmd, ac, langs: { py: py.python, js: js.javascript, html: ht.html, css: cs.css } };
} catch (e) { lastErr = String(e && e.message || e); console.warn('CodeMirror не загрузился', e); }
if (!M) { window.__mlCm = 'не загрузился: ' + lastErr.slice(0, 200); try { say('CodeMirror не загрузился: ' + lastErr.slice(0, 140)); } catch (_) {} }

if (M) try {
  const { EditorView, keymap } = M.vw, { Compartment, EditorState, Prec } = M.st, { tags: t } = M.hi;
  const ta = document.getElementById('code'), ed = document.getElementById('ed');
  const langC = new Compartment(), indC = new Compartment(), wrapC = new Compartment();
  let curLang = [], curInd = M.lg.indentUnit.of('    ');
  let wrapOn = false; try { wrapOn = localStorage.getItem('ml-wrap') === '1'; } catch (_) {}
  let synDiag = [], flDiag = [], pushQ = false, flT = 0, flSeq = 0, flFail = 0;   // диагностики: синтаксис (app.js) и pyflakes
  const indW = () => (typeof cur !== 'undefined' && cur === 'py') ? 4 : 2;

  const style = M.lg.HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.definitionKeyword], color: 'var(--hk)' },
    { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--hs)' },
    { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--hn)' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--hc)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.className], color: 'var(--hf)' },
    { tag: [t.tagName, t.typeName, t.angleBracket], color: 'var(--ht)' },
    { tag: [t.attributeName, t.propertyName, t.definition(t.propertyName)], color: 'var(--ha)' }]);
  const theme = EditorView.theme({
    '&': { height: '100%', color: 'var(--text)', background: 'transparent', fontSize: 'var(--fs,13px)' },
    '.cm-scroller': { fontFamily: 'ui-monospace,Menlo,Consolas,monospace', lineHeight: '1.6', paddingBottom: '30px' },
    '.cm-content': { caretColor: 'var(--caret)', padding: '16px 0' },
    '.cm-cursor': { borderLeftColor: 'var(--caret)' },
    '.cm-gutters': { background: 'transparent', color: 'var(--mute)', border: 'none', borderRight: '2px solid var(--line)' },
    '.cm-activeLine,.cm-activeLineGutter': { background: 'color-mix(in srgb,var(--text) 6%,transparent)' },
    '&.cm-focused .cm-selectionBackground,.cm-selectionBackground': { background: 'var(--sel)!important' },
    '.cm-tooltip': { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '8px' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--line)', color: 'var(--text)' },
    '.cm-completionDetail': { color: 'var(--mute)', fontStyle: 'normal', marginLeft: '.8em' },
    '.cm-panels': { background: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--line)' },
    '&.cm-focused': { outline: 'none' }
  });

  // ---------- подсказки: те же сниппеты, что были в старом редакторе (SN, MODM, PYM, selfAttrs из app.js) ----------
  const insertSnippet = (view, tpl, from, to) => {
    const line = view.state.doc.lineAt(from), sp = /^[ \t]*/.exec(line.text)[0];
    let s = String(tpl).replace(/\t/g, ' '.repeat(indW())).split('\n').join('\n' + sp);
    const k = s.indexOf('$0'); s = s.replace('$0', '');
    view.dispatch({ changes: { from, to, insert: s }, selection: { anchor: from + (k < 0 ? s.length : k) }, scrollIntoView: true, userEvent: 'input.complete' });
  };
  const source = ctx => {
    try {
      if (typeof cur === 'undefined' || typeof SN === 'undefined') return null;
      const doc = ctx.state.doc, line = doc.lineAt(ctx.pos), before = line.text.slice(0, ctx.pos - line.from);
      const m = (cur === 'css' ? /[\w-]+$/ : /\w+$/).exec(before), w = m ? m[0].toLowerCase() : '';
      const om = cur === 'py' ? /([A-Za-z_]\w*)\.\w*$/.exec(before) : null;
      if (w.length < (om ? 0 : 2) && !ctx.explicit) return null;   // после «модуль.» подсказки показываем сразу
      if (cur === 'css' && before.slice(0, before.length - w.length).includes(':')) return null;
      let pool;
      if (om) {
        if (om[1] === 'self') pool = selfAttrs(doc.toString());
        else pool = (typeof MODM !== 'undefined' && MODM[om[1]]) || (typeof PYM !== 'undefined' ? PYM : []);
      } else {
        pool = SN[cur] || [];
        if (cur === 'py' || cur === 'js') {
          // слова из самого кода (в окне вокруг курсора, чтобы на больших файлах не тормозило)
          const win = doc.sliceString(Math.max(0, ctx.pos - 100000), Math.min(doc.length, ctx.pos + 100000));
          const seen = new Set(pool.map(x => x[0].toLowerCase())), extra = [];
          (win.match(/[A-Za-z_]\w{2,}/g) || []).forEach(x => { const k = x.toLowerCase(); if (!seen.has(k) && k !== w) { seen.add(k); extra.push([x, 'из кода', x]); } });
          pool = pool.concat(extra);
        }
      }
      const pre = pool.filter(s => s[0].toLowerCase().startsWith(w))
        .sort((a, b) => (a[1] === 'из кода') - (b[1] === 'из кода') || a[0].length - b[0].length);
      const rest = w.length > 2 ? pool.filter(s => !s[0].toLowerCase().startsWith(w) && (s[0].toLowerCase().includes(w) || String(s[1]).toLowerCase().includes(w))) : [];
      const list = pre.concat(rest).slice(0, 10);
      if (!list.length) return null;
      let from = ctx.pos - w.length;
      if (cur === 'html' && doc.sliceString(Math.max(0, from - 1), from) === '<') from--;
      return { from, filter: false, options: list.map(s => ({ label: s[0], detail: s[1], apply: (view, c, f, to) => insertSnippet(view, s[2], f, to) })) };
    } catch (_) { return null; }
  };

  // ---------- клавиши ----------
  const HTML_TPL = ['<!DOCTYPE html>', '<html lang="ru">', '<head>', '  <meta charset="UTF-8">', '  <meta name="viewport" content="width=device-width, initial-scale=1.0">', '  <title>Document</title>', '</head>', '<body>', '  ', '</body>', '</html>'];
  const bangTemplate = view => {           // «!» + Tab в HTML → шаблон страницы
    if (typeof cur === 'undefined' || cur !== 'html') return false;
    const r = view.state.selection.main; if (!r.empty) return false;
    const line = view.state.doc.lineAt(r.head);
    if (line.text.slice(0, r.head - line.from).trim() !== '!') return false;
    const sp = /^[ \t]*/.exec(line.text)[0], nl = '\n' + sp, start = line.from + sp.length;
    view.dispatch({ changes: { from: start, to: r.head, insert: HTML_TPL.join(nl) }, selection: { anchor: start + HTML_TPL.slice(0, 9).join(nl).length }, scrollIntoView: true, userEvent: 'input' });
    return true;
  };
  const tabOver = view => {                // Tab перед закрывающей скобкой/кавычкой — перепрыгнуть
    if (typeof tabJump !== 'function') return false;
    const r = view.state.selection.main; if (!r.empty) return false;
    const line = view.state.doc.lineAt(r.head), col = r.head - line.from;
    if (!tabJump(line.text, col, col)) return false;
    view.dispatch({ selection: { anchor: r.head + 1 }, scrollIntoView: true });
    return true;
  };
  const exts = () => [
    M.cm.basicSetup,
    Prec.highest(keymap.of([
      { key: 'Mod-Enter', run: () => { try { run(); } catch (e) { console.error(e); } return true; } },
      { key: 'Tab', run: v => M.ac.acceptCompletion(v) || bangTemplate(v) || tabOver(v) }
    ])),
    keymap.of([M.cmd.indentWithTab]),
    EditorState.languageData.of(() => [{ autocomplete: source }]),
    theme, M.lg.syntaxHighlighting(style),
    M.ln.linter(null), M.ln.lintGutter(),
    langC.of(curLang), indC.of(curInd), wrapC.of(wrapOn ? EditorView.lineWrapping : []),
    EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': 'Редактор кода. Чтобы выйти из редактора клавишей Tab, нажмите Esc, затем Tab' }),
    EditorView.updateListener.of(u => {
      if (u.docChanged) {
        if (flDiag.length) flDiag = flDiag.map(x => ({ from: u.changes.mapPos(x.from, 1), to: u.changes.mapPos(x.to, -1), severity: x.severity, message: x.message, source: x.source })).filter(x => x.to > x.from);
        ev('input');
      }
      if (u.focusChanged) ev(u.view.hasFocus ? 'focus' : 'blur');
    })
  ];
  const ev = n => ta.dispatchEvent(new Event(n));
  const view = new EditorView({ parent: ed, doc: ta.value, extensions: exts() });
  ed.classList.add('cm-on');

  // ---------- «фасад» textarea ----------
  let cd = null, cs = '';                  // кеш текста: toString() у большого файла дорогой, а app.js читает value по нескольку раз
  const doc = () => view.state.doc;
  const clamp = n => Math.max(0, Math.min(doc().length, n | 0));
  const def = (k, d) => Object.defineProperty(ta, k, Object.assign({ configurable: true }, d));
  def('value', {
    get: () => { const d = doc(); if (d !== cd) { cd = d; cs = d.toString(); } return cs; },
    // новое состояние = чистая история: Ctrl+Z после смены вкладки не должен подмешивать текст другого файла
    set: v => view.setState(EditorState.create({ doc: String(v), selection: { anchor: 0 }, extensions: exts() }))
  });
  def('selectionStart', { get: () => view.state.selection.main.from });
  def('selectionEnd', { get: () => view.state.selection.main.to });
  ta.setSelectionRange = (a, b) => view.dispatch({ selection: { anchor: clamp(a), head: clamp(b == null ? a : b) } });
  ta.select = () => view.dispatch({ selection: { anchor: 0, head: doc().length } });
  ta.focus = () => view.focus();
  def('scrollTop', { get: () => view.scrollDOM.scrollTop, set: v => { view.scrollDOM.scrollTop = v; } });
  def('scrollLeft', { get: () => view.scrollDOM.scrollLeft, set: v => { view.scrollDOM.scrollLeft = v; } });
  view.scrollDOM.addEventListener('scroll', () => ev('scroll'));

  // язык и отступ следуют за текущей вкладкой
  let shown = null;
  const applyLang = () => {
    if (typeof cur === 'undefined' || cur === shown) return; shown = cur;
    const L = M.langs[cur];
    curLang = L ? L() : []; curInd = M.lg.indentUnit.of(' '.repeat(cur === 'py' ? 4 : 2));
    view.dispatch({ effects: [langC.reconfigure(curLang), indC.reconfigure(curInd)] });
  };
  // ошибки из проверки app.js (синтаксис) и предупреждения pyflakes показываем как диагностики CodeMirror.
  // dispatch откладываем в микрозадачу: update() вызывается из слушателя CodeMirror, а менять состояние во время обновления нельзя.
  let rng = null, lastDiag = '';
  const pushDiag = () => {
    if (pushQ) return; pushQ = true;
    Promise.resolve().then(() => {
      pushQ = false;
      try {
        const n = doc().length;
        const all = synDiag.concat(flDiag).map(x => ({ from: Math.min(x.from, n), to: Math.min(Math.max(x.to, x.from + 1), n), severity: x.severity, message: x.message, source: x.source }))
          .filter(x => x.from < x.to || n === 0);
        const key = JSON.stringify(all);
        if (key === lastDiag) return; lastDiag = key;
        view.dispatch(M.ln.setDiagnostics(view.state, all));
      } catch (_) {}
    });
  };

  // pyflakes (ставится в Pyodide один раз): неиспользуемые импорты и переменные, опечатки в именах. Работает только когда Pyodide уже загружен.
  const nm = m => (/'([^']+)'/.exec(m) || [])[1] || '';
  const FLR = {
    UnusedImport: m => 'Импорт «' + nm(m) + '» не используется',
    UndefinedName: m => 'Имя «' + nm(m) + '» не определено: опечатка или нет import?',
    UnusedVariable: m => 'Переменная «' + nm(m) + '» присвоена, но нигде не используется',
    RedefinedWhileUnused: m => '«' + nm(m) + '» определено заново, а прежнее нигде не использовалось',
    FStringMissingPlaceholders: () => 'f-строка без {…}: букву f можно убрать',
    IsLiteral: () => 'Сравнивайте значения через == или !=, а не через is',
    ReturnOutsideFunction: () => 'return вне функции',
    DefaultExceptNotLast: () => 'except без типа должен стоять последним'
  };
  const SKIP = new Set(['ImportStarUsed', 'ImportStarUsage', 'ImportStarNotPermitted', 'FutureFeatureNotDefined']);
  const flClear = () => { if (flDiag.length) { flDiag = []; pushDiag(); } };
  const flRun = async () => {
    try {
      if (typeof cur === 'undefined' || cur !== 'py') return;
      if (typeof pyoReady === 'undefined' || !pyoReady || !pyoW || pyoRunning) return;
      if (flFail && Date.now() - flFail < 300000) return;          // не получилось поставить: повтор не чаще раза в 5 минут
      const d0 = doc(), src = d0.toString();
      if (src.length > 60000 || (typeof pyWeb === 'function' && pyWeb(src)) || st.className === 'bad') { flClear(); return; }
      const my = ++flSeq, res = await pyoCall({ t: 'flakes', src });
      if (my !== flSeq) return;
      if (doc() !== d0) { flSched(); return; }                      // пока считали, текст изменился
      const j = JSON.parse(res.r);
      if (j.fail) { flFail = Date.now(); window.__mlFlakes = 'недоступен: ' + j.fail; return; }
      window.__mlFlakes = 'работает';
      flDiag = j.filter(x => !SKIP.has(x[2])).slice(0, 50).map(([ln, col, cls, msg]) => {
        const line = d0.line(Math.min(Math.max(ln, 1), d0.lines)), from = line.from + Math.min(col, line.length);
        let to = from + 1;
        if (cls === 'UnusedImport') to = line.to;
        else { const w = /^[\w\u0400-\u04FF]+/.exec(line.text.slice(from - line.from)); if (w) to = from + w[0].length; }
        return { from, to: Math.max(to, from + 1), severity: 'warning', source: 'pyflakes', message: FLR[cls] ? FLR[cls](msg) : msg };
      });
      pushDiag();
    } catch (_) {}
  };
  const flSched = () => { clearTimeout(flT); flT = setTimeout(flRun, 900); };

  const baseUpdate = window.update;
  // в режиме CM старая подсветка не нужна (раньше она впустую пересчитывалась на каждый символ): запоминаем только место ошибки
  window.render = function (src, s, e) { rng = s >= 0 ? [s, e] : null; return ''; };
  window.update = function () {
    const r = baseUpdate.apply(this, arguments);
    try {
      applyLang();
      const bad = st.className === 'bad' && rng;
      synDiag = bad ? [{ from: rng[0], to: Math.max(rng[1], rng[0] + 1), severity: 'error', message: st.textContent.replace(/^⚠\s*/, '') }] : [];
      if (bad) flDiag = [];
      pushDiag(); flSched();
    } catch (_) {}
    return r;
  };
  // setState сбрасывает диагностики: после смены вкладки/текста их нужно перерисовать при ближайшем update()
  const baseSet = Object.getOwnPropertyDescriptor(ta, 'value').set;
  def('value', { get: Object.getOwnPropertyDescriptor(ta, 'value').get, set: v => { lastDiag = ''; flDiag = []; flSeq++; baseSet(v); } });

  // панель символов на телефоне: клавиши идут в CodeMirror (раньше уходили в скрытую textarea)
  const typeText = k => {
    const r = view.state.selection.main, ins = () => view.state.update(view.state.replaceSelection(k), { scrollIntoView: true, userEvent: 'input.type' });
    if (view.state.facet(EditorView.inputHandler).some(h => h(view, r.from, r.to, k, ins))) return;
    view.dispatch(ins());
  };
  window.typeKey = function (k) {
    view.focus();
    if (k === '←' || k === '→') { view.dispatch({ selection: { anchor: clamp(view.state.selection.main.head + (k === '←' ? -1 : 1)) }, scrollIntoView: true }); return; }
    if (k === 'Tab') { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true, cancelable: true })); return; }
    typeText(k);
  };

  window.mlWrap = on => {
    wrapOn = on == null ? !wrapOn : !!on;
    try { localStorage.setItem('ml-wrap', wrapOn ? '1' : '0'); } catch (_) {}
    view.dispatch({ effects: wrapC.reconfigure(wrapOn ? EditorView.lineWrapping : []) });
    return wrapOn;
  };
  window.mlWrapState = () => wrapOn;
  window.__mlCm = 'работает';
  applyLang();
  document.documentElement.classList.add('cm6');
  window.cmView = view;
  try { (window.bootSay || say)('CodeMirror 6 подключён'); } catch (_) {}
} catch (e) {
  console.error('CodeMirror: ошибка запуска', e);
  window.__mlCm = 'ошибка запуска: ' + String(e && e.message || e).slice(0, 200);
  const ta0 = document.getElementById('code');
  ['value', 'selectionStart', 'selectionEnd', 'scrollTop', 'scrollLeft', 'setSelectionRange', 'select', 'focus'].forEach(k => { try { delete ta0[k]; } catch (_) {} });
  document.documentElement.classList.remove('cm6');
  document.getElementById('ed').classList.remove('cm-on');
  document.querySelectorAll('#ed .cm-editor').forEach(n => n.remove());
  try { say('CodeMirror: ошибка запуска: ' + String(e && e.message || e).slice(0, 120)); } catch (_) {}
}
})();
