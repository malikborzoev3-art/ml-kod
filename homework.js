// Домашние задания и тесты.
// Учитель (вошёл через кнопку «Класс») создаёт задание: код, который ученик должен переписать. Получает ссылку и отправляет её ученикам.
// Ученик открывает ссылку: в правой панели вместо результата появляется код задания (только для чтения), а слева он набирает свой код.
// Само задание лежит В ССЫЛКЕ (#hw=...), сервер не нужен; учитель хранит свои задания в этом браузере (ключ ml-hw-db).
// Подключается после school.js: вешается на MLSchool.ext. Использует глобальные из app.js: tabs, ai, cur, newWith, say.
(function(){
  'use strict';
  const LS_DB = 'ml-hw-db', LS_CUR = 'ml-hw-cur', LS_NAME = 'ml-hw-name';
  const LANGS = { py: 'Python', js: 'JavaScript', html: 'HTML', css: 'CSS' };
  const DEF = { py: 'main.py', js: 'script.js', html: 'index.html', css: 'style.css' };
  const MAX_CODE = 20000, MAX_LINK = 90000, MAX_Q = 30, MAX_LINES = 400;

  const $ = id => document.getElementById(id);
  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = t => { try { say(t); } catch (_) {} };
  const fail = m => { const e = new Error(m); e.ml = true; throw e; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const lsPut = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
  const lines = s => String(s).replace(/\r\n?/g, '\n').split('\n');

  // ---------- ссылка: JSON → deflate → base64url ----------
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const un64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  // cap защищает от «бомбы»: маленькая ссылка, которая распаковывается в гигабайты
  async function pipe(data, T, cap){
    const st = new T('deflate-raw'), w = st.writable.getWriter();
    w.write(data).catch(() => {}); w.close().catch(() => {});
    const r = st.readable.getReader(), parts = []; let n = 0;
    for (;;) {
      const { done, value } = await r.read(); if (done) break;
      n += value.length; if (cap && n > cap) { r.cancel().catch(() => {}); throw new Error('too big'); }
      parts.push(value);
    }
    const o = new Uint8Array(n); let p = 0; for (const x of parts) { o.set(x, p); p += x.length; } return o;
  }
  async function pack(obj){
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream !== 'undefined') { try { return 'z' + b64(await pipe(raw, CompressionStream)); } catch (_) {} }
    return 'p' + b64(raw);
  }
  async function unpack(str){
    let u = un64(str.slice(1));
    if (str[0] === 'z') { if (typeof DecompressionStream === 'undefined') fail('Этот браузер не открывает такие ссылки: обновите его'); u = await pipe(u, DecompressionStream, 1e6); }
    else if (str[0] !== 'p') fail('Ссылка повреждена');
    return JSON.parse(new TextDecoder().decode(u));
  }
  const base = () => location.href.split('#')[0];
  async function linkOf(kind, obj){
    const url = base() + '#' + kind + '=' + await pack(obj);
    if (url.length > MAX_LINK) fail('Слишком большое задание для ссылки: сократите текст или код');
    return url;
  }

  // ---------- проверка того, что пришло из ссылки (ссылке доверять нельзя) ----------
  function cleanHw(o){
    if (!o || o.k !== 'hw' || typeof o.c !== 'string' || !o.c.trim()) return null;
    return { k: 'hw', t: String(o.t || 'Задание').slice(0, 80), d: String(o.d || '').slice(0, 2000), l: LANGS[o.l] ? o.l : 'py', c: o.c.slice(0, 30000), n: o.n ? 1 : 0, cn: String(o.cn || '').slice(0, 60) };
  }
  function cleanTest(o){
    if (!o || o.k !== 'test' || !Array.isArray(o.q)) return null;
    const q = o.q.slice(0, MAX_Q).map(x => {
      const opts = Array.isArray(x && x.o) ? x.o.slice(0, 6).map(v => String(v).slice(0, 200)) : [];
      return { p: String(x && x.p || '').slice(0, 400), o: opts, a: (x && x.a) | 0 };
    }).filter(x => x.p && x.o.length >= 2 && x.a >= 0 && x.a < x.o.length);
    return q.length ? { k: 'test', t: String(o.t || 'Тест').slice(0, 80), cn: String(o.cn || '').slice(0, 60), q } : null;
  }
  const sig = hw => { let x = 5381; const s = hw.t + '\u0001' + hw.c; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36) + s.length; };

  async function copy(text, ok){
    try { await navigator.clipboard.writeText(text); toast(ok); return true; } catch (_) {}
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
    let done = false; try { done = document.execCommand('copy'); } catch (_) {}
    t.remove(); if (done) toast(ok); else prompt('Скопируйте вручную:', text); return done;
  }

  // =====================================================================
  //  СТОРОНА УЧИТЕЛЯ (внутри окна «Класс»)
  // =====================================================================
  const S = { hw: null, ts: null };   // черновики: задание и тест, которые сейчас редактируются
  const store = tid => { const u = (lsGet(LS_DB, {}) || {})[tid] || {}; return { hw: Array.isArray(u.hw) ? u.hw : [], ts: Array.isArray(u.ts) ? u.ts : [] }; };
  function putStore(tid, u){
    const db = lsGet(LS_DB, {}); db[tid] = u;
    if (!lsPut(LS_DB, db)) fail('Не удалось сохранить: память браузера заполнена');
  }
  const api = () => window.MLSchool.api;
  async function teacher(){ const s = await api().session(); if (!s || s.role !== 'teacher') fail('Войдите как учитель'); return s; }
  const fld = (label, inner) => '<label class="sc-f"><span>' + label + '</span>' + inner + '</label>';
  const opt = (v, t, curV) => '<option value="' + h(v) + '"' + (String(curV) === String(v) ? ' selected' : '') + '>' + h(t) + '</option>';
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return (m > 10 && m < 15) ? c : k === 1 ? a : (k > 1 && k < 5) ? b : c; };

  // ----- задания -----
  function hwList(u){
    const items = u.hw.slice().sort((a, b) => b.created - a.created);
    return '<p class="msub">Домашнее задание: код, который ученик должен переписать. По ссылке он откроется у ученика справа, вместо результата.</p>' +
      (items.length ? items.map((x, i) => {
        const n = lines(x.code).filter(l => l.trim()).length;
        return '<div class="hw-card sc-in" style="--i:' + Math.min(i, 10) + '"><div class="hw-ct"><span class="hw-n">' + h(x.title) + '</span><span class="hw-m">' +
          h((x.className ? x.className + ' · ' : '') + (LANGS[x.lang] || 'Python') + ' · ' + n + ' ' + plural(n, 'строка', 'строки', 'строк')) + '</span></div>' +
          '<div class="hw-cb"><button class="go" data-act="x:hwLink" data-id="' + h(x.id) + '">Копировать ссылку</button><button data-act="x:hwView" data-id="' + h(x.id) + '">Посмотреть</button><button data-act="x:hwEdit" data-id="' + h(x.id) + '">Изменить</button>' +
          '<button class="sc-x" data-act="x:hwDel" data-id="' + h(x.id) + '" aria-label="Удалить задание ' + h(x.title) + '">×</button></div></div>';
      }).join('') : '<div class="sc-empty sc-in" style="--i:0">Заданий пока нет. Создайте первое: напишите код, получите ссылку и отправьте её ученикам.</div>') +
      '<div class="mlf"><button class="go" data-act="x:hwNew">+ Новое задание</button></div>';
  }
  async function hwEditor(){
    const D = S.hw, classes = await api().listClasses();
    return '<button class="sc-back" data-act="x:hwList">← Все задания</button>' +
      '<div class="sc-title"><h4>' + (D.id ? 'Изменить задание' : 'Новое задание') + '</h4></div>' +
      fld('Название', '<input data-hw="title" maxlength="60" autocomplete="off" placeholder="Например: цикл for" value="' + h(D.title) + '">') +
      '<div class="hw-two">' + fld('Класс', '<select data-hw="classId">' + opt('', 'Без класса', D.classId) + classes.map(c => opt(c.id, c.name, D.classId)).join('') + '</select>') +
      fld('Язык', '<select data-hw="lang">' + Object.keys(LANGS).map(k => opt(k, LANGS[k], D.lang)).join('') + '</select>') + '</div>' +
      fld('Что нужно сделать', '<textarea data-hw="text" rows="3" maxlength="2000" placeholder="Например: перепишите код из задания, ничего не копируя, и запустите его">' + h(D.text) + '</textarea>') +
      fld('Код, который ученик должен переписать', '<textarea class="hw-code" data-hw="code" rows="11" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Вставьте или напишите код задания">' + h(D.code) + '</textarea>') +
      '<div class="hw-row"><button type="button" data-act="x:hwFromEd" title="Подставить код из открытой вкладки редактора">Взять код из редактора</button>' +
      '<label class="hw-chk"><input type="checkbox" data-hw="noCopy"' + (D.noCopy ? ' checked' : '') + '> Ученик не может скопировать код</label></div>' +
      '<div class="sc-err" role="alert" id="hwErr"></div>' +
      '<div class="mlf"><button class="go" data-act="x:hwSave">Сохранить и скопировать ссылку</button><button data-act="x:hwList">Отмена</button></div>';
  }
  const hwObj = x => ({ k: 'hw', t: x.title, d: x.text, l: x.lang, c: x.code, n: x.noCopy ? 1 : 0, cn: x.className || '' });

  async function hwSave(ctx){
    const err = m => { const e = $('hwErr'); if (e) e.textContent = m; };
    const D = S.hw; if (!D) return;
    const s = await teacher(), classes = await api().listClasses();
    const title = String(D.title || '').replace(/\s+/g, ' ').trim(), code = String(D.code || '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    if (!title) return err('Введите название задания');
    if (!code.trim()) return err('Введите код, который ученик должен переписать');
    if (code.length > MAX_CODE) return err('Код слишком длинный: не больше ' + MAX_CODE + ' символов');
    const cl = classes.find(c => c.id === D.classId);
    const rec = { id: D.id || uid(), classId: cl ? cl.id : '', className: cl ? cl.name : '', title: title.slice(0, 60), text: String(D.text || '').trim().slice(0, 2000), lang: LANGS[D.lang] ? D.lang : 'py', code, noCopy: !!D.noCopy, created: D.created || Date.now() };
    let url; try { url = await linkOf('hw', hwObj(rec)); } catch (e) { return err(e.ml ? e.message : 'Не удалось создать ссылку'); }
    const u = store(s.id), i = u.hw.findIndex(x => x.id === rec.id);
    if (i >= 0) u.hw[i] = rec; else u.hw.push(rec);
    try { putStore(s.id, u); } catch (e) { return err(e.message); }
    S.hw = null; await ctx.render();
    const ok = await copy(url, 'Задание сохранено, ссылка скопирована: отправьте её ученикам');
    if (ok && url.length > 6000) toast('Ссылка длинная: в некоторых мессенджерах её может обрезать');
  }

  // ----- тесты -----
  function tsList(u){
    const items = u.ts.slice().sort((a, b) => b.created - a.created);
    return '<p class="msub">Тест: вопросы с вариантами ответа. Ученик открывает ссылку, отвечает и сразу видит результат.</p>' +
      (items.length ? items.map((x, i) =>
        '<div class="hw-card sc-in" style="--i:' + Math.min(i, 10) + '"><div class="hw-ct"><span class="hw-n">' + h(x.title) + '</span><span class="hw-m">' +
        h((x.className ? x.className + ' · ' : '') + x.qs.length + ' ' + plural(x.qs.length, 'вопрос', 'вопроса', 'вопросов')) + '</span></div>' +
        '<div class="hw-cb"><button class="go" data-act="x:tsLink" data-id="' + h(x.id) + '">Копировать ссылку</button><button data-act="x:tsView" data-id="' + h(x.id) + '">Посмотреть</button><button data-act="x:tsEdit" data-id="' + h(x.id) + '">Изменить</button>' +
        '<button class="sc-x" data-act="x:tsDel" data-id="' + h(x.id) + '" aria-label="Удалить тест ' + h(x.title) + '">×</button></div></div>').join('')
      : '<div class="sc-empty sc-in" style="--i:0">Тестов пока нет.</div>') +
      '<div class="mlf"><button class="go" data-act="x:tsNew">+ Новый тест</button></div>';
  }
  async function tsEditor(){
    const D = S.ts, classes = await api().listClasses();
    const qs = D.qs.map((q, i) =>
      '<div class="ts-q"><div class="ts-qh"><b>Вопрос ' + (i + 1) + '</b>' + (D.qs.length > 1 ? '<button class="sc-x" data-act="x:tqDel" data-id="' + i + '" aria-label="Удалить вопрос ' + (i + 1) + '">×</button>' : '') + '</div>' +
      '<textarea class="hw-in" data-qp="' + i + '" rows="2" maxlength="400" placeholder="Текст вопроса" aria-label="Текст вопроса ' + (i + 1) + '">' + h(q.p) + '</textarea>' +
      q.o.map((t, j) => '<div class="ts-o"><input type="radio" name="qa' + i + '" data-qa="' + i + '" value="' + j + '"' + (q.a === j ? ' checked' : '') + ' aria-label="Правильный ответ: вариант ' + (j + 1) + '">' +
        '<input class="hw-in" type="text" data-qo="' + i + '" data-oi="' + j + '" maxlength="200" autocomplete="off" placeholder="Вариант ' + (j + 1) + '" value="' + h(t) + '">' +
        (q.o.length > 2 ? '<button class="sc-x" data-act="x:toDel" data-id="' + i + '.' + j + '" aria-label="Удалить вариант ' + (j + 1) + '">×</button>' : '') + '</div>').join('') +
      (q.o.length < 6 ? '<button class="ts-add" data-act="x:toAdd" data-id="' + i + '">+ вариант</button>' : '') + '</div>').join('');
    return '<button class="sc-back" data-act="x:tsList">← Все тесты</button>' +
      '<div class="sc-title"><h4>' + (D.id ? 'Изменить тест' : 'Новый тест') + '</h4></div>' +
      fld('Название', '<input data-tt="title" maxlength="60" autocomplete="off" placeholder="Например: переменные и типы" value="' + h(D.title) + '">') +
      fld('Класс', '<select data-tt="classId">' + opt('', 'Без класса', D.classId) + classes.map(c => opt(c.id, c.name, D.classId)).join('') + '</select>') +
      '<p class="sc-hint">Отметьте кружком правильный вариант в каждом вопросе.</p>' + qs +
      (D.qs.length < MAX_Q ? '<button class="ts-add" data-act="x:tqAdd">+ вопрос</button>' : '') +
      '<div class="sc-err" role="alert" id="hwErr"></div>' +
      '<div class="mlf"><button class="go" data-act="x:tsSave">Сохранить и скопировать ссылку</button><button data-act="x:tsList">Отмена</button></div>';
  }
  const tsObj = x => ({ k: 'test', t: x.title, cn: x.className || '', q: x.qs.map(q => ({ p: q.p, o: q.o, a: q.a })) });
  async function tsSave(ctx){
    const err = m => { const e = $('hwErr'); if (e) e.textContent = m; };
    const D = S.ts; if (!D) return;
    const s = await teacher(), classes = await api().listClasses();
    const title = String(D.title || '').replace(/\s+/g, ' ').trim();
    if (!title) return err('Введите название теста');
    const qs = [];
    for (let i = 0; i < D.qs.length; i++) {
      const q = D.qs[i], p = String(q.p || '').trim();
      if (!p) return err('Вопрос ' + (i + 1) + ': введите текст вопроса');
      const op = q.o.map((t, idx) => ({ t: String(t).trim(), idx })).filter(x => x.t);
      if (op.length < 2) return err('Вопрос ' + (i + 1) + ': нужно хотя бы два варианта ответа');
      const a = op.findIndex(x => x.idx === q.a);
      if (a < 0) return err('Вопрос ' + (i + 1) + ': отметьте правильный вариант (он не должен быть пустым)');
      qs.push({ p: p.slice(0, 400), o: op.map(x => x.t.slice(0, 200)), a });
    }
    const cl = classes.find(c => c.id === D.classId);
    const rec = { id: D.id || uid(), classId: cl ? cl.id : '', className: cl ? cl.name : '', title: title.slice(0, 60), qs, created: D.created || Date.now() };
    let url; try { url = await linkOf('test', tsObj(rec)); } catch (e) { return err(e.ml ? e.message : 'Не удалось создать ссылку'); }
    const u = store(s.id), i = u.ts.findIndex(x => x.id === rec.id);
    if (i >= 0) u.ts[i] = rec; else u.ts.push(rec);
    try { putStore(s.id, u); } catch (e) { return err(e.message); }
    S.ts = null; await ctx.render();
    await copy(url, 'Тест сохранён, ссылка скопирована: отправьте её ученикам');
  }

  // ----- действия из окна «Класс» -----
  const newHw = classId => ({ id: '', title: '', classId: classId || '', lang: 'py', text: '', code: '', noCopy: true });
  async function act(name, el, ctx){
    const id = el && el.dataset ? el.dataset.id : '';
    if (name === 'hwNew') { S.hw = newHw(''); return ctx.render({ anim: true }); }
    if (name === 'hwForClass') { S.hw = newHw(ctx.classId); return ctx.goSect('hw'); }
    if (name === 'hwList') { S.hw = null; return ctx.render({ anim: true }); }
    if (name === 'hwFromEd') {
      const D = S.hw; if (!D) return;
      const src = $('code') ? $('code').value : '';
      if (!src.trim()) { toast('В редакторе пока нет кода'); return; }
      D.code = src; if (typeof cur !== 'undefined' && LANGS[cur]) D.lang = cur;
      return ctx.render();
    }
    if (name === 'hwSave') return hwSave(ctx);
    const s = await teacher(), u = store(s.id);
    if (name === 'hwLink' || name === 'hwView' || name === 'hwEdit' || name === 'hwDel') {
      const x = u.hw.find(v => v.id === id); if (!x) { toast('Задание не найдено'); return ctx.render(); }
      if (name === 'hwLink') { try { return await copy(await linkOf('hw', hwObj(x)), 'Ссылка скопирована: отправьте её ученикам'); } catch (e) { toast(e.ml ? e.message : 'Не удалось создать ссылку'); return; } }
      if (name === 'hwView') { const o = cleanHw(hwObj(x)); ctx.close(); if (o) startHw(o); return; }
      if (name === 'hwEdit') { S.hw = { id: x.id, title: x.title, classId: x.classId, lang: x.lang, text: x.text, code: x.code, noCopy: x.noCopy, created: x.created }; return ctx.render({ anim: true }); }
      if (!confirm('Удалить задание «' + x.title + '»? Ссылки, которые вы уже отправили, продолжат работать.')) return;
      u.hw = u.hw.filter(v => v.id !== id); putStore(s.id, u); toast('Задание удалено'); return ctx.render();
    }
    // тесты
    if (name === 'tsNew') { S.ts = { id: '', title: '', classId: '', qs: [{ p: '', o: ['', ''], a: 0 }] }; return ctx.render({ anim: true }); }
    if (name === 'tsList') { S.ts = null; return ctx.render({ anim: true }); }
    if (name === 'tsSave') return tsSave(ctx);
    if (name === 'tqAdd') { if (S.ts && S.ts.qs.length < MAX_Q) S.ts.qs.push({ p: '', o: ['', ''], a: 0 }); return ctx.render(); }
    if (name === 'tqDel') { if (S.ts && S.ts.qs.length > 1) S.ts.qs.splice(+id, 1); return ctx.render(); }
    if (name === 'toAdd') { const q = S.ts && S.ts.qs[+id]; if (q && q.o.length < 6) q.o.push(''); return ctx.render(); }
    if (name === 'toDel') {
      const [qi, oi] = String(id).split('.').map(Number), q = S.ts && S.ts.qs[qi];
      if (q && q.o.length > 2) { q.o.splice(oi, 1); if (q.a === oi) q.a = 0; else if (q.a > oi) q.a--; }
      return ctx.render();
    }
    if (name === 'tsLink' || name === 'tsView' || name === 'tsEdit' || name === 'tsDel') {
      const x = u.ts.find(v => v.id === id); if (!x) { toast('Тест не найден'); return ctx.render(); }
      if (name === 'tsLink') { try { return await copy(await linkOf('test', tsObj(x)), 'Ссылка скопирована: отправьте её ученикам'); } catch (e) { toast(e.ml ? e.message : 'Не удалось создать ссылку'); return; } }
      if (name === 'tsView') { const o = cleanTest(tsObj(x)); if (o) openTest(o); return; }
      if (name === 'tsEdit') { S.ts = { id: x.id, title: x.title, classId: x.classId, created: x.created, qs: x.qs.map(q => ({ p: q.p, o: q.o.slice(), a: q.a })) }; return ctx.render({ anim: true }); }
      if (!confirm('Удалить тест «' + x.title + '»? Ссылки, которые вы уже отправили, продолжат работать.')) return;
      u.ts = u.ts.filter(v => v.id !== id); putStore(s.id, u); toast('Тест удалён'); return ctx.render();
    }
  }
  // поля формы пишем в черновик сразу при вводе: окно «Класс» иногда перерисовывается, а набранное терять нельзя
  function onInput(e){
    const t = e.target, d = t && t.dataset; if (!d) return;
    if (d.hw && S.hw) S.hw[d.hw] = t.type === 'checkbox' ? t.checked : t.value;
    else if (d.tt && S.ts) S.ts[d.tt] = t.value;
    else if (d.qp !== undefined && S.ts && S.ts.qs[+d.qp]) S.ts.qs[+d.qp].p = t.value;
    else if (d.qo !== undefined && S.ts && S.ts.qs[+d.qo]) S.ts.qs[+d.qo].o[+d.oi] = t.value;
    else if (d.qa !== undefined && S.ts && S.ts.qs[+d.qa]) S.ts.qs[+d.qa].a = +t.value;
  }
  // Tab в поле кода вставляет отступ, а не уводит фокус (Esc закрывает окно, черновик сохраняется)
  function onKey(e){
    const t = e.target;
    if (e.key !== 'Tab' || e.shiftKey || !t || !t.matches || !t.matches('textarea[data-hw="code"]')) return false;
    e.preventDefault(); t.setRangeText('    ', t.selectionStart, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); return true;
  }
  const ext = {
    html: async sect => (sect === 'hw' ? (S.hw ? await hwEditor() : hwList(store((await teacher()).id))) : (S.ts ? await tsEditor() : tsList(store((await teacher()).id)))),
    act: (name, el, ctx) => act(name, el, ctx).catch(e => toast(e && e.ml ? e.message : 'Что-то пошло не так')),
    input: onInput, key: onKey,
    busy: sect => (sect === 'hw' && !!S.hw) || (sect === 'tests' && !!S.ts),
    reset: () => { S.hw = null; S.ts = null; }
  };

  // =====================================================================
  //  СТОРОНА УЧЕНИКА: панель задания справа
  // =====================================================================
  let P = null, task = null;   // P: элементы панели; task: { hw, tab, collapsed, done, sig, ref }

  const expand = s => s.replace(/\t/g, '    ').replace(/\s+$/, '');
  // строки для сравнения: пустые отбрасываем; в Python отступ важен, в остальных языках нет
  const norm = (ls, l) => ls.map((s, i) => ({ t: l === 'py' ? expand(s) : s.trim(), i })).filter(x => x.t !== '');
  // самая длинная общая цепочка строк: какие строки задания ученик уже набрал верно и в том же порядке
  function lcs(a, b){
    const n = a.length, m = b.length, set = new Set();
    if (!n || !m) return { set, len: 0 };
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].t === b[j].t ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i].t === b[j].t) { set.add(a[i].i); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
    return { set, len: dp[0][0] };
  }

  function mount(){
    if (P) return P;
    const out = $('out'), pane = out && out.parentNode; if (!pane) return null;
    const root = document.createElement('section'); root.id = 'hw'; root.hidden = true; root.setAttribute('aria-label', 'Задание');
    root.innerHTML = '<div class="hwh"><div class="hwt"><span class="hwtt"></span><span class="hwm"></span></div><div class="hwb">' +
      '<button type="button" data-hwhide title="Показать результат запуска">К результату</button><button type="button" data-hwx aria-label="Закрыть задание" title="Закрыть задание">×</button></div></div>' +
      '<div class="hwtask"></div><div class="hwcode" tabindex="0" role="group" aria-label="Код, который нужно переписать"></div>' +
      '<div class="hwf"><div class="hwbar" aria-hidden="true"><i></i></div><span class="hwst" role="status" aria-live="polite"></span></div>';
    const pill = document.createElement('button'); pill.type = 'button'; pill.id = 'hwTab'; pill.hidden = true; pill.textContent = 'Задание'; pill.title = 'Показать задание';
    pane.appendChild(root); pane.appendChild(pill);
    root.addEventListener('click', e => { if (e.target.closest('[data-hwhide]')) collapse(true); else if (e.target.closest('[data-hwx]')) closeHw(); });
    pill.addEventListener('click', () => collapse(false));
    ['copy', 'cut', 'dragstart', 'contextmenu'].forEach(ev => root.addEventListener(ev, e => { if (task && task.hw.n && e.target.closest && e.target.closest('.hwcode')) e.preventDefault(); }));
    P = { root, pill, tt: root.querySelector('.hwtt'), m: root.querySelector('.hwm'), task: root.querySelector('.hwtask'), code: root.querySelector('.hwcode'), bar: root.querySelector('.hwbar i'), st: root.querySelector('.hwst'), nodes: [] };
    return P;
  }
  const persist = () => { if (task) lsPut(LS_CUR, { hw: task.hw, tab: task.tab, collapsed: task.collapsed, done: task.done }); else { try { localStorage.removeItem(LS_CUR); } catch (_) {} } };
  function paint(){
    if (!P) return;
    P.root.hidden = !task || task.collapsed; P.pill.hidden = !task || !task.collapsed;
  }
  function collapse(v){
    if (!task) return; task.collapsed = !!v; persist(); paint();
    if (!v) { progress(); try { P.code.focus({ preventScroll: true }); } catch (_) {} }
  }
  function closeHw(){
    if (!task) return;
    if (!confirm('Закрыть задание? Ваш код останется в редакторе.')) return;
    task = null; persist(); paint(); toast('Задание закрыто');
  }
  function studentCode(){
    const t = tabs.find(x => x.name === task.tab);
    return t && tabs[ai] !== t ? (t.code || '') : ($('code') ? $('code').value : '');
  }
  function progress(){
    if (!task || !P || P.root.hidden) return;
    const sN = norm(lines(studentCode()).slice(0, MAX_LINES), task.hw.l), r = lcs(task.ref, sN), total = task.ref.length;
    P.nodes.forEach((n, i) => n.classList.toggle('ok', r.set.has(i)));
    const done = r.len === total && sN.length === total;
    P.bar.style.width = Math.round(100 * r.len / total) + '%';
    P.root.classList.toggle('done', done);
    const extra = sN.length - r.len;
    P.st.textContent = done ? 'Готово: код совпадает с заданием ✓' : 'Совпало ' + r.len + ' из ' + total + ' ' + plural(total, 'строки', 'строк', 'строк') + (extra > 0 ? ' · лишних строк: ' + extra : '');
    if (done && !task.done) { task.done = true; persist(); toast('Отлично! Код совпадает с заданием'); }
  }
  function showHw(){
    const p = mount(); if (!p || !task) return;
    const hw = task.hw, ls = lines(hw.c).slice(0, MAX_LINES * 5);
    p.tt.textContent = hw.t; p.m.textContent = (hw.cn ? hw.cn + ' · ' : '') + (LANGS[hw.l] || '');
    p.task.textContent = hw.d || 'Перепишите этот код в редактор слева и запустите его.'; p.task.hidden = false;
    p.root.classList.toggle('nocopy', !!hw.n);
    p.code.textContent = ''; p.nodes = [];
    const fr = document.createDocumentFragment();
    ls.forEach((l, i) => { const d = document.createElement('div'), n = document.createElement('i'), s = document.createElement('span'); d.className = 'hwl'; n.textContent = i + 1; s.textContent = l === '' ? ' ' : l; d.appendChild(n); d.appendChild(s); fr.appendChild(d); p.nodes.push(d); });
    p.code.appendChild(fr);
    task.ref = norm(ls.slice(0, MAX_LINES), hw.l).map((x, k) => ({ t: x.t, i: x.i }));
    paint(); progress();
  }
  function startHw(hw){
    const s = sig(hw);
    if (task && task.sig === s) { task.collapsed = false; persist(); showHw(); return; }
    if (task && !confirm('Сейчас открыто другое задание. Заменить его новым?')) return;
    // заготовка для ответа: пустая вкладка нужного языка (если текущая вкладка пустая, используем её)
    const t0 = tabs[ai];
    if (!(t0 && t0.lang === hw.l && !String(t0.code || '').trim() && !($('code') && $('code').value.trim()))) { try { newWith('', DEF[hw.l], hw.l); } catch (_) {} }
    task = { hw, tab: (tabs[ai] && tabs[ai].name) || DEF[hw.l], collapsed: false, done: false, sig: s, ref: [] };
    persist(); showHw();
    toast('Задание открыто: перепишите код справа в редактор слева');
  }
  function restore(){
    const s = lsGet(LS_CUR, null), hw = s && cleanHw(s.hw); if (!hw) return;
    task = { hw, tab: String(s.tab || ''), collapsed: !!s.collapsed, done: !!s.done, sig: sig(hw), ref: [] };
    showHw();
  }
  // кнопка «Запуск» и Ctrl+Enter убирают панель, чтобы показать результат; вернуть её можно кнопкой «Задание»
  document.addEventListener('click', e => { if (task && P && !P.root.hidden && e.target.closest && e.target.closest('#run')) collapse(true); }, true);
  document.addEventListener('keydown', e => { if (task && P && !P.root.hidden && (e.ctrlKey || e.metaKey) && e.key === 'Enter') collapse(true); }, true);
  const ta = $('code'); if (ta) ta.addEventListener('input', () => { if (task) progress(); });
  setInterval(() => { if (task && !document.hidden) progress(); }, 1200);

  // =====================================================================
  //  СТОРОНА УЧЕНИКА: тест
  // =====================================================================
  let tm = null, tmPrev = null;
  function closeTest(){ if (!tm) return; tm.remove(); tm = null; if (tmPrev && tmPrev.focus) { try { tmPrev.focus(); } catch (_) {} } tmPrev = null; }
  function openTest(t){
    if (!tm) tmPrev = document.activeElement; else { tm.remove(); tm = null; }
    const o = document.createElement('div'); o.className = 'mlm';
    const qs = t.q.map((q, i) => '<fieldset class="ts-q" data-q="' + i + '"><legend>' + (i + 1) + '. ' + h(q.p) + '</legend>' +
      q.o.map((x, j) => '<label class="ts-o"><input type="radio" name="q' + i + '" value="' + j + '"><span>' + h(x) + '</span></label>').join('') + '</fieldset>').join('');
    let nm = ''; try { nm = localStorage.getItem(LS_NAME) || ''; } catch (_) {}
    o.innerHTML = '<div class="mlb wide" role="dialog" aria-modal="true" aria-label="' + h(t.t) + '"><div class="mlh"><h3>' + h(t.t) + '</h3><button class="mlx" data-close aria-label="Закрыть">×</button></div><div class="mlc">' +
      (t.cn ? '<p class="msub">Класс: ' + h(t.cn) + '</p>' : '') +
      fld('Ваше имя (попадёт в результат)', '<input data-tname maxlength="40" autocomplete="off" placeholder="Иван Петров" value="' + h(nm) + '">') +
      '<div class="ts-list">' + qs + '</div><div class="ts-res" role="status" aria-live="polite"></div>' +
      '<div class="mlf"><button class="go" data-check>Проверить</button><button data-copy hidden>Скопировать результат</button><button data-again hidden>Пройти заново</button></div></div>';
    let resText = '';
    o.addEventListener('mousedown', e => { if (e.target === o) closeTest(); });
    o.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) { closeTest(); return; }
      if (e.target.closest('[data-again]')) { openTest(t); return; }
      if (e.target.closest('[data-copy]')) { copy(resText, 'Результат скопирован: отправьте его учителю'); return; }
      if (!e.target.closest('[data-check]')) return;
      const picked = t.q.map((q, i) => { const r = o.querySelector('input[name="q' + i + '"]:checked'); return r ? +r.value : -1; });
      const first = picked.indexOf(-1);
      if (first >= 0) { toast('Ответьте на все вопросы (не отвечено: ' + (first + 1) + ')'); const f = o.querySelector('input[name="q' + first + '"]'); if (f) f.focus(); return; }
      let score = 0;
      t.q.forEach((q, i) => {
        if (picked[i] === q.a) score++;
        o.querySelectorAll('input[name="q' + i + '"]').forEach((r, j) => {
          r.disabled = true; const lb = r.closest('label');
          if (j === q.a) lb.classList.add('ok'); else if (j === picked[i]) lb.classList.add('bad');
        });
      });
      const pc = Math.round(100 * score / t.q.length), name = o.querySelector('[data-tname]').value.trim() || 'без имени';
      try { localStorage.setItem(LS_NAME, name === 'без имени' ? '' : name); } catch (_) {}
      resText = 'Тест «' + t.t + '»' + (t.cn ? ' (' + t.cn + ')' : '') + ': ' + name + ' — ' + score + ' из ' + t.q.length + ' (' + pc + '%)';
      o.querySelector('.ts-res').textContent = 'Верно: ' + score + ' из ' + t.q.length + ' (' + pc + '%)';
      o.querySelector('[data-check]').hidden = true; o.querySelector('[data-copy]').hidden = false; o.querySelector('[data-again]').hidden = false;
      o.querySelector('.ts-res').scrollIntoView({ block: 'nearest' });
    });
    o.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTest(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(o.querySelectorAll('button, input, textarea, select')).filter(x => !x.disabled && !x.hidden && x.offsetParent !== null); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    document.body.appendChild(o); tm = o;
    const f = o.querySelector('input'); if (f) f.focus();
  }

  // =====================================================================
  //  ссылки #hw=... и #test=...
  // =====================================================================
  async function fromHash(){
    const m = /^#(hw|test)=([A-Za-z0-9_-]{8,})$/.exec(location.hash); if (!m) return;
    const clear = () => { try { history.replaceState(null, '', location.href.split('#')[0]); } catch (_) {} };
    if (m[2].length > MAX_LINK + 1000) { clear(); toast('Ссылка слишком длинная: отклонена'); return; }
    let o;
    try { o = await unpack(m[2]); }
    catch (e) { clear(); toast(e && e.ml ? e.message : e && e.message === 'too big' ? 'Ссылка распаковывается в слишком большой объём: отклонена' : 'Ссылка повреждена'); return; }
    clear();
    if (m[1] === 'hw') { const hw = cleanHw(o); if (!hw) { toast('Ссылка повреждена или это не задание'); return; } startHw(hw); }
    else { const t = cleanTest(o); if (!t) { toast('Ссылка повреждена или это не тест'); return; } openTest(t); }
  }

  window.MLHW = { startHw, openTest, closeTest };
  if (window.MLSchool) window.MLSchool.ext = ext;
  try { restore(); } catch (_) {}
  addEventListener('hashchange', () => { fromHash(); });
  setTimeout(fromHash, 500);
})();
