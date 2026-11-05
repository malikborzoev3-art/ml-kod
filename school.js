// Школа: классы и аккаунты (учитель создаёт класс, ученики входят по коду).
// Сейчас данные лежат в этом браузере (демо-режим). Слой api ниже можно заменить на облачный сервер с теми же методами.
// Использует глобальные say и PYACT из app.js; оформление берёт из style.css (классы .mlm, .mlb и sc-*).
(function(){
  'use strict';
  const LS_DB = 'ml-school-db', LS_SES = 'ml-school-session';
  const ONLINE_MS = 45000, BEAT_MS = 20000;
  const MAX_CLASSES = 30, MAX_STUDENTS = 60;
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // без похожих символов: 0/O, 1/I/L

  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fail = m => { const e = new Error(m); e.ml = true; throw e; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const showCode = c => c.slice(0, 3) + '-' + c.slice(3);
  const low = s => s.toLocaleLowerCase('ru');
  const toast = t => { try { say(t); } catch (_) {} };

  // ---------- хеш пароля и PIN (в демо-режиме это не защита, а порядок: открытый текст не хранится) ----------
  async function hash(salt, text){
    const data = new TextEncoder().encode(salt + '\u0000' + text);
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const b = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) {}
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;   // запасной вариант, если браузер не даёт SubtleCrypto
    for (let i = 0; i < data.length; i++) { h1 = Math.imul(h1 ^ data[i], 2654435761); h2 = Math.imul(h2 ^ data[i], 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'f' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  // ---------- хранилище и события ----------
  const subs = new Set();
  let bc = null;
  try { bc = new BroadcastChannel('ml-school'); bc.onmessage = () => emit(true); } catch (_) {}
  function emit(fromOther){
    subs.forEach(f => { try { f(); } catch (_) {} });
    if (!fromOther && bc) { try { bc.postMessage(1); } catch (_) {} }
  }
  if (typeof addEventListener === 'function') addEventListener('storage', e => { if (e.key === LS_DB || e.key === LS_SES) emit(true); });

  const load = () => {
    try { const d = JSON.parse(localStorage.getItem(LS_DB)); if (d && Array.isArray(d.teachers) && Array.isArray(d.classes) && Array.isArray(d.students)) return d; } catch (_) {}
    return { teachers: [], classes: [], students: [] };
  };
  function save(d, quiet){
    try { localStorage.setItem(LS_DB, JSON.stringify(d)); } catch (_) { fail('Не удалось сохранить: память браузера заполнена или закрыта'); }
    if (quiet) { if (bc) { try { bc.postMessage(1); } catch (_) {} } } else emit();
  }
  // вход хранится и в sessionStorage (у каждой вкладки свой), и в localStorage (чтобы вход пережил закрытие вкладки)
  function getSes(){
    for (const st of [() => sessionStorage, () => localStorage]) {
      try { const s = JSON.parse(st().getItem(LS_SES)); if (s && s.id && (s.role === 'teacher' || s.role === 'student')) return s; } catch (_) {}
    }
    return null;
  }
  function setSes(s){
    for (const st of [() => sessionStorage, () => localStorage]) {
      try { s ? st().setItem(LS_SES, JSON.stringify(s)) : st().removeItem(LS_SES); } catch (_) {}
    }
  }

  function genCode(d){
    for (let n = 0; n < 200; n++) {
      let c = '';
      const r = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(6)) : Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
      for (let i = 0; i < 6; i++) c += ALPHA[r[i] % ALPHA.length];
      if (!d.classes.some(x => x.code === c)) return c;
    }
    return fail('Не удалось придумать код класса, попробуйте ещё раз');
  }
  const cleanName = (s, what) => { const n = norm(s); if (!n) fail(what + ': введите название'); if (n.length > 40) fail(what + ': не больше 40 символов'); return n; };
  const needPin = p => { p = String(p || '').trim(); if (!/^\d{4}$/.test(p)) fail('PIN: ровно 4 цифры'); return p; };
  function teacherOf(d){
    const s = getSes(); const t = s && s.role === 'teacher' && d.teachers.find(x => x.id === s.id);
    return t || fail('Войдите как учитель');
  }
  const classOf = (d, t, id) => d.classes.find(c => c.id === id && c.teacherId === t.id) || fail('Класс не найден');

  // ---------- api: этот же набор методов должен уметь облачный сервер ----------
  const localApi = {
    mode: 'local',
    subscribe(f){ subs.add(f); return () => subs.delete(f); },

    async session(){
      const s = getSes(); if (!s) return null;
      const d = load();
      if (s.role === 'teacher') {
        const t = d.teachers.find(x => x.id === s.id); if (!t) { setSes(null); return null; }
        return { role: 'teacher', id: t.id, name: t.name, email: t.email };
      }
      const st = d.students.find(x => x.id === s.id), c = st && d.classes.find(x => x.id === st.classId);
      if (!st || !c) { setSes(null); return null; }
      const t = d.teachers.find(x => x.id === c.teacherId);
      return { role: 'student', id: st.id, name: st.name, classId: c.id, className: c.name, teacherName: t ? t.name : '', classmates: d.students.filter(x => x.classId === c.id).length };
    },
    async signOut(){ setSes(null); emit(); },

    async teacherSignUp({ name, email, password }){
      name = cleanName(name, 'Имя'); email = norm(email).toLowerCase(); password = String(password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Проверьте email');
      if (password.length < 6) fail('Пароль: не короче 6 символов');
      if (password.length > 100) fail('Пароль слишком длинный');
      const salt = uid(), hp = await hash(salt, password);
      const d = load();
      if (d.teachers.some(t => t.email === email)) fail('Этот email уже зарегистрирован. Войдите в аккаунт');
      const t = { id: uid(), name, email, salt, hash: hp, created: Date.now() };
      d.teachers.push(t); save(d); setSes({ role: 'teacher', id: t.id }); emit();
    },
    async teacherSignIn({ email, password }){
      email = norm(email).toLowerCase(); password = String(password || '');
      const d = load(), t = d.teachers.find(x => x.email === email);
      const ok = t && (await hash(t.salt, password)) === t.hash;
      if (!ok) fail('Неверный email или пароль');
      setSes({ role: 'teacher', id: t.id }); emit();
    },

    async studentJoin({ code, name, pin }){
      code = normCode(code); name = cleanName(name, 'Имя'); pin = needPin(pin);
      if (code.length !== 6) fail('Код класса состоит из 6 символов, например K7M-4PQ');
      let d = load(); const c = d.classes.find(x => x.code === code);
      if (!c) fail('Класс с таким кодом не найден');
      const same = d.students.find(x => x.classId === c.id && low(x.name) === low(name));
      if (same) {
        if ((await hash(same.salt, pin)) !== same.hash) fail('Неверный PIN для этого имени. Если забыли, попросите учителя сбросить PIN');
        d = load(); const s2 = d.students.find(x => x.id === same.id); if (!s2) fail('Ученик удалён из класса');
        s2.seen = Date.now(); save(d); setSes({ role: 'student', id: s2.id }); emit(); return;
      }
      if (!c.open) fail('Приём в этот класс закрыт. Обратитесь к учителю');
      const salt = uid(), hp = await hash(salt, pin);
      d = load();
      const c2 = d.classes.find(x => x.id === c.id); if (!c2) fail('Класс удалён');
      if (!c2.open) fail('Приём в этот класс закрыт. Обратитесь к учителю');
      if (d.students.filter(x => x.classId === c.id).length >= MAX_STUDENTS) fail('В классе уже ' + MAX_STUDENTS + ' учеников');
      if (d.students.some(x => x.classId === c.id && low(x.name) === low(name))) fail('Ученик с таким именем уже есть. Введите свой PIN');
      const st = { id: uid(), classId: c.id, name, salt, hash: hp, created: Date.now(), seen: Date.now() };
      d.students.push(st); save(d); setSes({ role: 'student', id: st.id }); emit();
    },
    async heartbeat(){
      const s = getSes(); if (!s || s.role !== 'student') return;
      const d = load(), st = d.students.find(x => x.id === s.id); if (!st) return;
      st.seen = Date.now(); save(d, true);
    },

    async listClasses(){
      const d = load(), t = teacherOf(d);
      return d.classes.filter(c => c.teacherId === t.id).sort((a, b) => a.created - b.created)
        .map(c => ({ id: c.id, name: c.name, code: c.code, open: c.open, students: d.students.filter(s => s.classId === c.id).length }));
    },
    async createClass(name){
      name = cleanName(name, 'Класс');
      const d = load(), t = teacherOf(d);
      if (d.classes.filter(c => c.teacherId === t.id).length >= MAX_CLASSES) fail('Можно создать не больше ' + MAX_CLASSES + ' классов');
      if (d.classes.some(c => c.teacherId === t.id && low(c.name) === low(name))) fail('Класс «' + name + '» уже есть');
      const c = { id: uid(), teacherId: t.id, name, code: genCode(d), open: true, created: Date.now() };
      d.classes.push(c); save(d); return c.id;
    },
    async classInfo(id){
      const d = load(), t = teacherOf(d), c = classOf(d, t, id), n = Date.now();
      const students = d.students.filter(s => s.classId === c.id).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map(s => ({ id: s.id, name: s.name, seen: s.seen || 0, online: n - (s.seen || 0) < ONLINE_MS }));
      return { id: c.id, name: c.name, code: c.code, open: c.open, students };
    },
    async renameClass(id, name){
      name = cleanName(name, 'Класс'); const d = load(), t = teacherOf(d), c = classOf(d, t, id);
      if (d.classes.some(x => x.teacherId === t.id && x.id !== id && low(x.name) === low(name))) fail('Класс «' + name + '» уже есть');
      c.name = name; save(d);
    },
    async setOpen(id, open){ const d = load(), t = teacherOf(d); classOf(d, t, id).open = !!open; save(d); },
    async newCode(id){ const d = load(), t = teacherOf(d), c = classOf(d, t, id); c.code = genCode(d); save(d); },
    async deleteClass(id){
      const d = load(), t = teacherOf(d); classOf(d, t, id);
      d.classes = d.classes.filter(c => c.id !== id); d.students = d.students.filter(s => s.classId !== id); save(d);
    },
    async removeStudent(classId, studentId){
      const d = load(), t = teacherOf(d); classOf(d, t, classId);
      d.students = d.students.filter(s => !(s.id === studentId && s.classId === classId)); save(d);
    },
    async resetPin(classId, studentId, pin){
      pin = needPin(pin); const salt = uid(), hp = await hash(salt, pin);
      const d = load(), t = teacherOf(d); classOf(d, t, classId);
      const s = d.students.find(x => x.id === studentId && x.classId === classId); if (!s) fail('Ученик не найден');
      s.salt = salt; s.hash = hp; save(d);
    }
  };


  // ---------- облачный api (Supabase): вход через REST, данные только через функции из supabase-setup.sql ----------
  const CFG = window.ML_SCHOOL || {};
  const BASE = String(CFG.url || '').replace(/\/+$/, '');
  const useCloud = /^https:\/\/[\w.-]+/.test(BASE) && !!CFG.key;
  const LS_CLOUD = 'ml-school-cloud';
  const readCS = st => { try { const s = JSON.parse(st().getItem(LS_CLOUD)); return s && s.at && s.rt ? s : null; } catch (_) { return null; } };
  const getCS = () => readCS(() => sessionStorage) || readCS(() => localStorage);
  function setCS(s){
    for (const st of [() => sessionStorage, () => localStorage]) { try { s ? st().setItem(LS_CLOUD, JSON.stringify(s)) : st().removeItem(LS_CLOUD); } catch (_) {} }
  }
  const storeSession = j => {
    const s = { at: j.access_token, rt: j.refresh_token, exp: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)), user: j.user || {} };
    setCS(s); return s;
  };
  const AUTH_ERR = {
    invalid_credentials: 'Неверный email или пароль', user_already_exists: 'Этот email уже зарегистрирован. Войдите в аккаунт',
    email_exists: 'Этот email уже зарегистрирован. Войдите в аккаунт', weak_password: 'Пароль слишком простой, придумайте другой',
    email_not_confirmed: 'Подтвердите email: письмо пришло при регистрации', over_email_send_rate_limit: 'Слишком много писем, подождите немного',
    over_request_rate_limit: 'Слишком много попыток, подождите немного', anonymous_provider_disabled: 'На сервере выключен анонимный вход (Anonymous sign-ins в Supabase)',
    signup_disabled: 'Регистрация на сервере выключена', validation_failed: 'Проверьте введённые данные'
  };
  async function raw(path, body, token){
    const headers = { 'Content-Type': 'application/json', apikey: CFG.key };
    if (token) headers.Authorization = 'Bearer ' + token;
    let r;
    try { r = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body === undefined ? {} : body) }); }
    catch (_) { fail('Нет связи с сервером. Проверьте интернет'); }
    let j = null; try { j = await r.json(); } catch (_) {}
    if (r.ok) return j;
    const code = j && (j.error_code || j.code), msg = j && (j.message || j.msg || j.error_description || j.error);
    const e = new Error(AUTH_ERR[code] || (code === 'P0001' && msg) || (/Invalid login credentials/i.test(msg || '') ? AUTH_ERR.invalid_credentials : '') || 'Ошибка сервера' + (r.status ? ' (' + r.status + ')' : ''));
    e.status = r.status; e.ml = true;   // текст уже понятный человеку
    throw e;
  }
  async function token(){
    let s = getCS(); if (!s) return null;
    if (s.exp - 60 > Date.now() / 1000) return s.at;
    const tries = [s]; const other = readCS(() => localStorage); if (other && other.rt !== s.rt) tries.push(other);   // вторая вкладка могла уже обновить вход
    for (const t of tries) {
      if (t !== s && t.exp - 60 > Date.now() / 1000) { setCS(t); return t.at; }
      try { return storeSession(await raw('/auth/v1/token?grant_type=refresh_token', { refresh_token: t.rt })).at; }
      catch (e) { if (!(e.status >= 400 && e.status < 500)) throw e; }
    }
    setCS(null); return null;
  }
  async function rpc(name, args){
    const t = await token(); if (!t) fail('Сеанс закончился. Войдите ещё раз');
    try { return await raw('/rest/v1/rpc/' + name, args || {}, t); }
    catch (e) { if (e.status === 401) { setCS(null); fail('Сеанс закончился. Войдите ещё раз'); } throw e; }
  }
  const isAnon = s => !!(s && s.user && s.user.is_anonymous);

  const cloudApi = {
    mode: 'cloud',
    subscribe(f){ subs.add(f); return () => subs.delete(f); },
    async session(){
      const s = getCS(); if (!s) return null;
      if (isAnon(s)) {
        const st = await rpc('my_student');
        return st ? { role: 'student', id: st.id, name: st.name, classId: st.classId, className: st.className, teacherName: st.teacherName, classmates: st.classmates } : null;
      }
      const u = s.user || {};
      return { role: 'teacher', id: u.id, name: (u.user_metadata && u.user_metadata.name) || u.email || 'Учитель', email: u.email || '' };
    },
    async signOut(){ setCS(null); emit(); },
    async teacherSignUp({ name, email, password }){
      name = cleanName(name, 'Имя'); email = norm(email).toLowerCase(); password = String(password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Проверьте email');
      if (password.length < 6) fail('Пароль: не короче 6 символов');
      if (password.length > 100) fail('Пароль слишком длинный');
      const j = await raw('/auth/v1/signup', { email, password, data: { name } });
      if (j && j.access_token) { storeSession(j); emit(); return {}; }
      return { confirm: true };   // на сервере включено подтверждение почты
    },
    async teacherSignIn({ email, password }){
      email = norm(email).toLowerCase(); password = String(password || '');
      if (!email || !password) fail('Введите email и пароль');
      storeSession(await raw('/auth/v1/token?grant_type=password', { email, password })); emit();
    },
    async studentJoin({ code, name, pin }){
      code = normCode(code); name = cleanName(name, 'Имя'); pin = needPin(pin);
      if (code.length !== 6) fail('Код класса состоит из 6 символов, например K7M-4PQ');
      let s = getCS();
      if (!isAnon(s)) s = storeSession(await raw('/auth/v1/signup', { data: {}, gotrue_meta_security: {} }));   // анонимный вход
      const r = await rpc('student_join', { p_code: code, p_name: name, p_pin: pin });
      if (r && r.error) fail(r.error);
      emit();
    },
    async heartbeat(){ if (isAnon(getCS())) await rpc('student_beat'); },
    listClasses: () => rpc('list_classes'),
    async createClass(name){ return rpc('create_class', { p_name: name }); },
    classInfo: id => rpc('class_view', { p_class: id }),
    async renameClass(id, name){ await rpc('rename_class', { p_class: id, p_name: name }); },
    async setOpen(id, open){ await rpc('set_open', { p_class: id, p_open: !!open }); },
    async newCode(id){ await rpc('new_code', { p_class: id }); },
    async deleteClass(id){ await rpc('delete_class', { p_class: id }); },
    async removeStudent(classId, studentId){ await rpc('remove_student', { p_class: classId, p_student: studentId }); },
    async resetPin(classId, studentId, pin){ await rpc('reset_pin', { p_class: classId, p_student: studentId, p_pin: needPin(pin) }); }
  };
  const api = useCloud ? cloudApi : localApi;

  // ---------- оформление ----------
  const $ = id => document.getElementById(id);
  const ago = s => {
    if (s.online) return 'в сети';
    if (!s.seen) return 'не заходил';
    const m = Math.max(1, Math.round((Date.now() - s.seen) / 60000));
    if (m < 60) return m + ' мин назад';
    if (m < 60 * 24) return Math.round(m / 60) + ' ч назад';
    return new Date(s.seen).toLocaleDateString('ru-RU');
  };
  async function copy(text, ok){
    try { await navigator.clipboard.writeText(text); toast(ok); return; } catch (_) {}
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
    let done = false; try { done = document.execCommand('copy'); } catch (_) {}
    t.remove(); if (done) toast(ok); else prompt('Скопируйте вручную:', text);
  }
  const joinLink = code => location.href.split('#')[0] + '#join=' + code;

  let modal = null, rid = 0, timer = 0, unsub = null, deb = 0;
  const view = { tab: 'student', tmode: 'in', classId: null, code: '', sect: 'classes' };
  // расширение (homework.js): разделы «Домашние задания» и «Тесты» в кабинете учителя
  const EXT = () => (window.MLSchool && window.MLSchool.ext) || null;

  function demoBanner(){ return api.mode !== 'cloud' ? '<div class="sc-demo">Демо-режим: данные хранятся только в этом браузере. Чтобы ученики заходили со своих компьютеров, подключается сервер.</div>' : ''; }
  function seg(items, cur, act, key, small){
    return '<div class="sc-seg' + (small ? ' sm' : '') + '" role="tablist">' + items.map(([v, t]) => '<button type="button" role="tab" aria-selected="' + (cur === v) + '" data-act="' + act + '" data-v="' + v + '">' + t + '</button>').join('') + '</div>';
  }
  const field = (name, label, o) => '<label class="sc-f"><span>' + label + '</span><input name="' + name + '" ' + (o || '') + '></label>';

  function authHtml(){
    let b = seg([['student', 'Я ученик'], ['teacher', 'Я учитель']], view.tab, 'tab');
    if (view.tab === 'student') {
      b += '<form class="sc-form" data-form="join" novalidate>' +
        field('code', 'Код класса', 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" placeholder="например K7M-4PQ" value="' + h(view.code) + '"') +
        field('name', 'Имя и фамилия', 'autocomplete="off" maxlength="40" placeholder="Иван Петров"') +
        field('pin', 'PIN (4 цифры)', 'type="password" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="••••"') +
        '<p class="sc-hint">При первом входе придумайте PIN и запомните его: с ним можно войти с другого компьютера.</p>' +
        '<div class="sc-err" role="alert"></div><div class="mlf"><button class="go" type="submit">Войти в класс</button></div></form>';
    } else {
      b += seg([['in', 'Вход'], ['up', 'Регистрация']], view.tmode, 'tmode', '', true);
      b += view.tmode === 'in'
        ? '<form class="sc-form" data-form="tin" novalidate>' + field('email', 'Email', 'type="email" autocomplete="username" placeholder="teacher@school.ru"') + field('password', 'Пароль', 'type="password" autocomplete="current-password"') +
          '<div class="sc-err" role="alert"></div><div class="mlf"><button class="go" type="submit">Войти</button></div></form>'
        : '<form class="sc-form" data-form="tup" novalidate>' + field('name', 'Как к вам обращаться', 'autocomplete="name" maxlength="40" placeholder="Анна Сергеевна"') + field('email', 'Email', 'type="email" autocomplete="username" placeholder="teacher@school.ru"') + field('password', 'Пароль (не короче 6 символов)', 'type="password" autocomplete="new-password"') +
          '<div class="sc-err" role="alert"></div><div class="mlf"><button class="go" type="submit">Создать аккаунт</button></div></form>';
    }
    return b;
  }
  function studentHtml(s){
    return '<div class="sc-card sc-in" style="--i:0"><div class="sc-k">Вы в классе</div><div class="sc-big">' + h(s.className) + '</div>' +
      '<div class="sc-meta">Учитель: ' + h(s.teacherName || '—') + ' · учеников: ' + s.classmates + '</div></div>' +
      '<p class="msub sc-in" style="--i:1">Вы вошли как <b>' + h(s.name) + '</b>. Учитель видит, что вы в сети.</p>' +
      '<div class="mlf sc-in" style="--i:2"><button data-act="out">Выйти из класса</button></div>';
  }
  async function teacherHtml(s){
    if (view.classId) {
      let c; try { c = await api.classInfo(view.classId); } catch (_) { view.classId = null; return teacherHtml(s); }
      const rows = c.students.length ? c.students.map((st, i) =>
        '<div class="sc-row sc-in" style="--i:' + Math.min(i + 3, 12) + '"><span class="sc-dot' + (st.online ? ' on' : '') + '" aria-hidden="true"></span><span class="sc-nm">' + h(st.name) + '</span><span class="sc-seen">' + h(ago(st)) + '</span>' +
        '<button data-act="pin" data-id="' + h(st.id) + '" title="Задать новый PIN">PIN</button><button class="sc-x" data-act="rm" data-id="' + h(st.id) + '" aria-label="Удалить ученика ' + h(st.name) + '">×</button></div>').join('')
        : '<div class="sc-empty sc-in" style="--i:3">Пока никого. Передайте ученикам код или ссылку.</div>';
      return '<button class="sc-back" data-act="back">← Все классы</button>' +
        '<div class="sc-title sc-in" style="--i:0"><h4>' + h(c.name) + '</h4><button class="sc-x" data-act="ren" aria-label="Переименовать класс">✎</button></div>' +
        '<div class="sc-codebox sc-in" style="--i:1"><div><div class="sc-k">Код класса</div><div class="sc-code" aria-label="Код класса ' + h(showCode(c.code)) + '">' + h(showCode(c.code)) + '</div></div>' +
        '<div class="sc-cb"><button data-act="copyCode">Копировать код</button><button data-act="copyLink">Ссылка для учеников</button></div></div>' +
        '<div class="sc-ctl sc-in" style="--i:2"><button data-act="toggleOpen" aria-pressed="' + c.open + '">Приём учеников: ' + (c.open ? 'открыт' : 'закрыт') + '</button><button data-act="newCode">Новый код</button>' + (EXT() ? '<button data-act="x:hwForClass">Дать задание</button>' : '') + '</div>' +
        '<div class="kh">Ученики · ' + c.students.length + '</div>' + rows +
        '<div class="mlf"><button class="sc-danger" data-act="delClass">Удалить класс</button></div>';
    }
    const X = EXT(), nav = X ? seg([['classes', 'Классы'], ['hw', 'Задания'], ['tests', 'Тесты']], view.sect, 'sect') : '';
    if (view.sect !== 'classes' && X && X.html) {
      try { return nav + '<p class="msub">Вы вошли как <b>' + h(s.name) + '</b></p>' + await X.html(view.sect); }
      catch (e) { return nav + '<div class="sc-err" role="alert">' + h(e && e.ml ? e.message : 'Не удалось открыть раздел') + '</div>'; }
    }
    view.sect = 'classes';
    const list = await api.listClasses();
    return nav + '<p class="msub">Вы вошли как <b>' + h(s.name) + '</b> (' + h(s.email) + ')</p>' +
      (list.length ? list.map((c, i) => '<button class="sc-cls sc-in" style="--i:' + Math.min(i, 10) + '" data-act="openClass" data-id="' + h(c.id) + '"><span class="sc-cn">' + h(c.name) + '</span><span class="sc-cm">код ' + h(showCode(c.code)) + ' · учеников: ' + c.students + (c.open ? '' : ' · приём закрыт') + '</span></button>').join('')
        : '<div class="sc-empty sc-in" style="--i:0">Классов пока нет. Создайте первый, и ученики смогут войти по коду.</div>') +
      '<div class="mlf"><button class="go" data-act="newClass">+ Новый класс</button><button data-act="out">Выйти</button></div>';
  }

  async function render(o){
    if (!modal) return; o = o || {};
    const my = ++rid, ae = document.activeElement, fk = ae && modal.contains(ae) && ae.dataset ? ae.dataset.fk : '';
    const typing = ae && modal.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName);
    if (!o.force && typing) return;   // не трогаем форму, пока человек печатает
    { const X = EXT(); if (!o.force && X && X.busy && view.sect !== 'classes' && X.busy(view.sect)) return; }   // и пока открыт редактор задания или теста
    let s = null, body = '';
    try {
      s = await api.session();
      body = !s ? authHtml() : s.role === 'student' ? studentHtml(s) : await teacherHtml(s);
    } catch (e) { body = '<div class="sc-err" role="alert">' + h(e.ml ? e.message : 'Не удалось загрузить данные') + '</div>'; }
    if (my !== rid || !modal) return;
    const box = modal.querySelector('.mlb'), c = modal.querySelector('.mlc');
    box.classList.toggle('wide', !!(s && s.role === 'teacher' && (view.classId || view.sect !== 'classes')));
    c.classList.toggle('sc-anim', !!o.anim);
    c.innerHTML = demoBanner() + body;
    c.querySelectorAll('[data-act]').forEach(el => { el.dataset.fk = el.dataset.act + ':' + (el.dataset.id || el.dataset.v || ''); });
    if (o.anim) { const f = c.querySelector('input') || c.querySelector('[data-act="newClass"]') || c.querySelector('.sc-back') || c.querySelector('button'); if (f) f.focus(); }
    else if (fk) { const f = c.querySelector('[data-fk="' + fk.replace(/"/g, '') + '"]'); if (f) f.focus(); }
    paintBtn(s);
  }
  const later = () => { clearTimeout(deb); deb = setTimeout(() => render({}), 150); };

  async function guard(fn, okMsg){
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.ml ? e.message : 'Что-то пошло не так'); }
  }
  async function act(a, el){
    const id = el.dataset.id, v = el.dataset.v;
    if (a === 'tab') { view.tab = v; return render({ anim: true, force: true }); }
    if (a === 'tmode') { view.tmode = v; return render({ anim: true, force: true }); }
    if (a === 'out') { view.classId = null; view.sect = 'classes'; const X0 = EXT(); if (X0 && X0.reset) X0.reset(); await api.signOut(); return render({ anim: true, force: true }); }
    if (a === 'sect') { view.sect = v; view.classId = null; return render({ anim: true, force: true }); }
    if (a.indexOf('x:') === 0) {
      const X = EXT(); if (!X || !X.act) return;
      return X.act(a.slice(2), el, {
        classId: view.classId, close,
        render: o => render(Object.assign({ force: true }, o || {})),
        goSect: (sct) => { view.sect = sct; view.classId = null; return render({ anim: true, force: true }); }
      });
    }
    if (a === 'openClass') { view.classId = id; return render({ anim: true, force: true }); }
    if (a === 'back') { view.classId = null; return render({ anim: true, force: true }); }
    if (a === 'newClass') {
      const n = prompt('Название класса, например 9А'); if (n === null) return;
      try { view.classId = await api.createClass(n); await render({ anim: true, force: true }); } catch (e) { toast(e.ml ? e.message : 'Не удалось создать класс'); }
      return;
    }
    const cid = view.classId; if (!cid) return;
    if (a === 'copyCode' || a === 'copyLink') { const c = await api.classInfo(cid); return copy(a === 'copyCode' ? showCode(c.code) : joinLink(c.code), a === 'copyCode' ? 'Код скопирован' : 'Ссылка скопирована'); }
    if (a === 'toggleOpen') { const c = await api.classInfo(cid); return guard(() => api.setOpen(cid, !c.open), c.open ? 'Приём закрыт' : 'Приём открыт').then(() => render({ force: true })); }
    if (a === 'newCode') { if (!confirm('Старый код и ссылка перестанут работать. Продолжить?')) return; return guard(() => api.newCode(cid), 'Код обновлён').then(() => render({ force: true })); }
    if (a === 'ren') { const c = await api.classInfo(cid), n = prompt('Новое название класса', c.name); if (n === null) return; return guard(() => api.renameClass(cid, n)).then(() => render({ force: true })); }
    if (a === 'pin') { const n = prompt('Новый PIN для ученика (4 цифры)'); if (n === null) return; return guard(() => api.resetPin(cid, id, n), 'PIN обновлён'); }
    if (a === 'rm') { if (!confirm('Удалить ученика из класса?')) return; return guard(() => api.removeStudent(cid, id), 'Ученик удалён').then(() => render({ force: true })); }
    if (a === 'delClass') { const c = await api.classInfo(cid); if (!confirm('Удалить класс «' + c.name + '» вместе со всеми учениками? Это нельзя отменить.')) return; view.classId = null; return guard(() => api.deleteClass(cid), 'Класс удалён').then(() => render({ anim: true, force: true })); }
  }

  function close(){
    if (!modal) return;
    modal.remove(); modal = null; clearInterval(timer); if (unsub) { unsub(); unsub = null; }
    const b = $('schoolBtn'); if (b) b.focus();
  }
  function open(o){
    if (modal) return;
    if (o && o.code) { view.tab = 'student'; view.code = o.code; }
    const m = document.createElement('div'); m.className = 'mlm';
    m.innerHTML = '<div class="mlb" role="dialog" aria-modal="true" aria-label="Школа: классы"><div class="mlh"><h3>Школа</h3><button class="mlx" data-close aria-label="Закрыть">×</button></div><div class="mlc"></div></div>';
    m.addEventListener('mousedown', e => { if (e.target === m) close(); });
    m.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) { close(); return; }
      const el = e.target.closest('[data-act]'); if (el) act(el.dataset.act, el).catch(() => {});
    });
    m.addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target.closest('form'); if (!f) return;
      const fd = {}; new FormData(f).forEach((v, k) => { fd[k] = v; });
      const err = f.querySelector('.sc-err'), btn = f.querySelector('[type=submit]'); err.textContent = ''; btn.disabled = true;
      try {
        let res = null;
        if (f.dataset.form === 'join') await api.studentJoin(fd); else if (f.dataset.form === 'tin') await api.teacherSignIn(fd); else res = await api.teacherSignUp(fd);
        view.classId = null; view.code = '';
        if (res && res.confirm) { view.tmode = 'in'; await render({ anim: true, force: true }); toast('Письмо отправлено: подтвердите email и войдите'); return; }
        await render({ anim: true, force: true });
      } catch (x) { err.textContent = x.ml ? x.message : 'Что-то пошло не так. Попробуйте ещё раз'; btn.disabled = false; }
    });
    ['input', 'change'].forEach(t => m.addEventListener(t, e => { const X = EXT(); if (X && X.input) X.input(e); }));
    m.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      { const X = EXT(); if (X && X.key && X.key(e)) return; }
      const f = Array.from(m.querySelectorAll('button, input, textarea, select, [tabindex="0"]')).filter(x => !x.disabled && x.offsetParent !== null); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.body.appendChild(m); modal = m;
    unsub = api.subscribe(later); timer = setInterval(() => render({}), 15000);
    render({ anim: true, force: true });
  }

  // ---------- кнопка в шапке, пункт меню, присутствие ученика ----------
  function paintBtn(s){
    const b = $('schoolBtn'); if (!b) return;
    b.classList.toggle('on', !!s);
    b.title = s ? (s.role === 'student' ? 'Класс «' + s.className + '»' : 'Кабинет учителя') : 'Классы: вход для учеников и учителей';
  }
  async function refreshBtn(){ try { paintBtn(await api.session()); } catch (_) {} }
  function beat(){ if (!document.hidden) api.heartbeat().catch(() => {}); }

  window.MLSchool = { api, open, close };
  if (typeof document === 'undefined' || !document.getElementById) return;

  const tm = window.toolsMenu;
  window.toolsMenu = function(){ return '<div class="mi" data-a="school">Школа: классы и ученики…</div>' + (typeof tm === 'function' ? tm() : ''); };
  try { PYACT.school = () => open(); } catch (_) {}
  const bt = $('schoolBtn'); if (bt) bt.addEventListener('click', () => open());
  api.subscribe(refreshBtn); refreshBtn();
  setInterval(beat, BEAT_MS); document.addEventListener('visibilitychange', beat); beat();

  // ссылка для учеников: #join=КОД
  const jm = /^#join=([A-Za-z0-9-]{4,12})$/.exec(location.hash);
  if (jm) { history.replaceState(null, '', location.href.split('#')[0]); setTimeout(() => { api.session().then(s => { if (!s) open({ code: showCode(normCode(jm[1])) }); }); }, 600); }
})();
