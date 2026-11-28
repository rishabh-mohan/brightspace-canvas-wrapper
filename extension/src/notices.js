// Notifications: which courses and kinds of work may notify (Account, Notifications), and the
// Alerts tray in the left menu: work due within a day and What's New items, each unread until
// opened or marked read. Everything stays in this browser: the mutes in bsxNotify (one list for
// the page and the reminders, src/reminders.js), what was read in bsxRead:<host> (keys and times
// only, no titles). The list is built from answers the wrapper already loads (To Do and What's
// New), so it needs no permission and works where reminders cannot (Firefox for Android).
// The filtering is plain functions, so tests run them without a browser (tests/notices.test.js).
(function (root) {
  const DAY = 864e5;
  const KEEP = 60 * DAY; // how long a read mark is remembered
  const TYPES = [
    ['assignment', 'Assignments'],
    ['quiz', 'Quizzes'],
    ['discussion', 'Discussions'],
    ['news', 'Announcements'],
    ['grade', 'Grades and feedback'],
    ['content', 'Module content'],
    ['other', 'My To Do and outside work'],
  ];
  const TYPE_IDS = TYPES.map(([id]) => id);
  const WORK = { assignment: 'assignment', quiz: 'quiz', discussion: 'discussion' };
  const isMap = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

  // ---- mutes (pure) -------------------------------------------------------------
  // { courses: [course id as text], types: [ids from TYPES] }
  const cleanMute = (v) => ({
    courses: isMap(v) && Array.isArray(v.courses) ? [...new Set(v.courses.filter((c) => c != null && c !== '').map(String))] : [],
    types: isMap(v) && Array.isArray(v.types) ? [...new Set(v.types.filter((t) => TYPE_IDS.includes(t)))] : [],
  });
  // A piece of work in To Do: its kind, or 'other' for the student's own items and outside work.
  const typeOfWork = (i) => WORK[i && i.kind] || 'other';
  // A What's New item (src/whatsnew.js): announcements, grades and module content by type, new
  // work and changed due dates by the kind of work.
  const typeOfNew = (it) => (['news', 'grade', 'content'].includes(it.type) ? it.type : WORK[it.kind] || 'assignment');
  const isMuted = (mute, courseId, type) => mute.types.includes(type) || (courseId != null && mute.courses.includes(String(courseId)));

  // ---- the list (pure) ------------------------------------------------------------
  function dueIn(ms) {
    const m = Math.max(1, Math.round(ms / 60e3));
    const unit = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (m < 60) return `Due in ${unit(m, 'minute')}`;
    const hrs = Math.round(m / 60);
    return hrs < 24 ? `Due in ${unit(hrs, 'hour')}` : 'Due in 1 day';
  }
  // Entries for work due within `window` of `now` (`todo`, as To Do lists it) and What's New
  // items (`fresh`). A key changes when the due date or the change does, so a moved due date or
  // a second grade change is unread again.
  function entries({ todo = [], fresh = [], now = Date.now(), window = DAY, keyOf }) {
    const out = [];
    const seen = new Set();
    const add = (e) => !seen.has(e.key) && seen.add(e.key) && out.push(e);
    for (const i of todo) {
      const due = Date.parse(i.due_at);
      if (!(due > now && due <= now + window)) continue;
      add({ key: `remind:${keyOf(i)}|${i.due_at}`, group: 'due', type: typeOfWork(i), course_id: i.course_id ?? null, title: String(i.name || i.title || 'Untitled'), label: dueIn(due - now), at: due, item: i });
    }
    for (const it of fresh) {
      add({ key: `new:${it.key}|${it.label}|${it.new_due || it.at || ''}`, group: 'new', type: typeOfNew(it), course_id: it.course_id ?? null, title: String(it.title || '(untitled)'), label: it.label, at: Date.parse(it.at) || null, item: it });
    }
    return out;
  }
  // What the tray shows: muted and hidden courses' entries left out, each marked unread or not.
  function view(list, { mute = cleanMute(null), read = {}, hidden = () => false } = {}) {
    const shown = list.filter((e) => !isMuted(mute, e.course_id, e.type) && !(e.course_id != null && hidden(e.course_id))).map((e) => ({ ...e, unread: !read[e.key] }));
    return {
      due: shown.filter((e) => e.group === 'due').sort((a, b) => a.at - b.at),
      fresh: shown.filter((e) => e.group === 'new'),
      unread: shown.filter((e) => e.unread).length,
    };
  }

  // ---- read marks (pure) --------------------------------------------------------
  // { [entry key]: when read }, older marks dropped.
  const parseRead = (raw, now = Date.now()) => (isMap(raw) ? Object.fromEntries(Object.entries(raw).filter(([, at]) => typeof at === 'number' && now - at < KEEP)) : {});
  const markRead = (read, keys, now = Date.now()) => ({ ...read, ...Object.fromEntries(keys.map((k) => [k, now])) });
  // Two tabs keep their own copy: every mark from either, the later time where both have one.
  const mergeRead = (a, b) => {
    const out = { ...b };
    for (const [k, at] of Object.entries(a)) out[k] = Math.max(at, out[k] || 0);
    return out;
  };

  const pure = { TYPES, cleanMute, typeOfWork, typeOfNew, isMuted, dueIn, entries, view, parseRead, markRead, mergeRead };
  if (typeof module === 'object' && module.exports) {
    module.exports = pure;
    return;
  }

  // ---- browser side ---------------------------------------------------------------
  const BSX = (root.BSX = root.BSX || {});
  const ui = BSX.ui;
  const store = (root.browser || root.chrome)?.storage?.local;
  if (!ui || !store) return;
  const { h, ic } = ui;
  const MUTE = 'bsxNotify';
  const READ = `bsxRead:${root.location?.host || ''}`;
  const EVERY = 5 * 60e3; // the list is gathered again at most this often, or when the tray opens
  let mute = cleanMute(null);
  let read = {};
  const ready = Promise.all([
    Promise.resolve(store.get(MUTE)).then((v) => { mute = cleanMute(v && v[MUTE]); }),
    Promise.resolve(store.get(READ)).then((v) => { read = parseRead(v && v[READ]); }),
  ]).catch(() => {});
  const hidden = (id) => Boolean(ui.isHiddenCourse && ui.isHiddenCourse(id));
  // For src/reminders.js: work that must not be handed to the background.
  const mutedWork = (i) => isMuted(mute, i.course_id, typeOfWork(i)) || (i.course_id != null && hidden(i.course_id));

  const saveMute = () => Promise.resolve(store.set({ [MUTE]: mute })).catch(() => {});
  // Another tab may have marked some read since: merge with what is stored, then write.
  async function saveRead() {
    try {
      const stored = parseRead((await store.get(READ))?.[READ]);
      read = mergeRead(read, stored);
      await store.set({ [READ]: read });
    } catch {}
  }

  // The same work To Do lists and the reminders hand over, and What's New's items. data.* and
  // What's New keep their answers, so on the Dashboard this asks Brightspace for nothing more.
  let last = null; // { at, promise }
  function collect(force = false) {
    if (!force && last && Date.now() - last.at < EVERY) return last.promise;
    const promise = (async () => {
      await ready;
      const { data } = BSX;
      const courses = ui.focusCourses(await data.courses());
      const now = Date.now();
      const [work, outside, fresh] = await Promise.all([
        data.todo(courses).catch(() => []),
        ui.externalWork(courses).catch(() => []),
        BSX.whatsnew ? BSX.whatsnew.load(courses).then((r) => r.items).catch(() => []) : [],
      ]);
      const todo = [...work, ...outside.filter((i) => !i.submitted && !i.grade), ...ui.personalItems(now, now + DAY, null)].filter((i) => !ui.isDone(i) && !ui.isDismissed(i));
      return { courses, list: entries({ todo, fresh, now, window: DAY, keyOf: ui.keyOf }) };
    })();
    last = { at: Date.now(), promise };
    promise.catch(() => last && last.promise === promise && (last = null));
    return promise;
  }
  const current = (r) => view(r.list, { mute, read, hidden });

  // ---- the count on the Alerts button ---------------------------------------------
  function paintBadge(n) {
    const btn = ui.appEl()?.querySelector('.rail [data-tray="alerts"]');
    if (!btn) return;
    let b = btn.querySelector('.railbadge');
    if (!b) btn.append((b = h('b', { class: 'railbadge', hidden: true })));
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = !n;
    btn.title = n ? `Notifications: ${n} unread` : 'Notifications';
    btn.setAttribute('aria-label', btn.title);
  }
  const refresh = (force) => collect(force).then((r) => paintBadge(current(r).unread)).catch(() => {});

  // ---- the tray --------------------------------------------------------------------
  const ICON = { assignment: 'assignment', quiz: 'quiz', discussion: 'discussion', news: 'announcement', grade: 'check', content: 'module', other: 'note' };
  // Where an entry leads: the wrapper's page for Brightspace work and What's New items, the
  // outside tool (new tab) for outside work, the Dashboard for the student's own items.
  function target(e) {
    const i = e.item;
    if (e.group === 'new') return { href: i.url || ui.courseHref(i.course_id, i.section, i.item) };
    if (i.kind === 'external') return { href: ui.safeHref(i.html_url) || '#/', target: '_blank', rel: 'noopener noreferrer' };
    if (i.personal) return { href: '#/' };
    return { href: ui.itemHref(i.course_id, i) };
  }
  function row(e, names, onRead) {
    const color = e.course_id == null ? 'var(--muted)' : ui.colorOf(e.course_id);
    const course = e.course_id == null ? 'My To Do' : names.get(e.course_id) || '';
    const link = target(e);
    const el = h('a', { class: e.unread ? 'nitem unread' : 'nitem', ...link, onclick: () => {
      if (!el.classList.contains('unread')) return;
      el.classList.remove('unread');
      el.querySelector('.newdot')?.remove();
      onRead([e.key]);
    } },
      h('span', { class: 'todoic', style: `color:${color}` }, ic(ICON[e.type] || 'item', 18)),
      h('span', { class: 'tmid' }, h('span', { class: 't' }, e.title), h('span', { class: 'ctx', style: `--c:${color}` }, course ? `${e.label} · ${course}` : e.label)),
      e.unread ? h('span', { class: 'newdot', title: 'Unread' }) : null);
    return el;
  }
  function trayContent(close) {
    const action = h('div', { class: 'row', style: 'margin:-6px 0 4px;gap:8px' });
    const settings = ui.button('Settings', () => {
      ui.openTray('account');
      ui.appEl()?.querySelector('#bsx-notify')?.scrollIntoView({ block: 'start' });
    }, 'small');
    const body = h('div');
    const paint = (r) => {
      const v = current(r);
      paintBadge(v.unread);
      const names = new Map(r.courses.map((c) => [c.id, ui.nameOf(c)]));
      const onRead = (keys) => {
        read = markRead(read, keys);
        saveRead();
        paintBadge(current(r).unread);
      };
      const all = [...v.due, ...v.fresh];
      action.replaceChildren(...[v.unread ? ui.button('Mark all read', () => { onRead(all.filter((e) => e.unread).map((e) => e.key)); paint(r); }, 'small') : null, settings].filter(Boolean));
      const muted = mute.courses.length + mute.types.length;
      body.replaceChildren(...[
        v.due.length ? h('div', { class: 'traylabel' }, 'Due soon') : null,
        ...v.due.map((e) => row(e, names, onRead)),
        v.fresh.length ? h('div', { class: 'traylabel' }, 'New in your courses') : null,
        ...v.fresh.slice(0, 40).map((e) => row(e, names, onRead)),
        all.length ? null : h('p', { class: 'muted small', style: 'margin:12px 4px 0' }, 'Nothing for now. Work due within a day, and new announcements, grades, work and module content (as in What\u2019s New), show here until you open them.'),
        muted ? h('p', { class: 'muted small', style: 'margin:12px 4px 0' }, 'Some courses or kinds of work are muted in Settings.') : null,
      ].filter(Boolean));
    };
    collect(!last || Date.now() - last.at > 30e3).then(paint).catch((e) => body.replaceChildren(h('p', { class: 'muted small' }, `Unavailable. ${e.message || e}`)));
    body.append(h('p', { class: 'muted small' }, 'Loading…'));
    return [h('div', { class: 'trayhead' }, h('h2', null, 'Notifications'), close), action, body];
  }
  (ui.trays ||= {}).alerts = { icon: 'bell', label: 'Alerts', content: trayContent };

  // ---- Account: what may notify --------------------------------------------------
  function setMute(patch) {
    mute = cleanMute({ ...mute, ...patch });
    saveMute();
    if (last) last.promise.then((r) => paintBadge(current(r).unread)).catch(() => {});
    if (BSX.reminders) BSX.reminders.refresh(); // the due dates handed over lose the muted ones
  }
  const toggle = (list, id, on) => (on ? list.filter((x) => x !== id) : [...list, id]);
  (ui.accountHooks ||= []).push(() => {
    const box = h('div', { style: 'display:contents' });
    const check = (on, label, onchange, dot) => h('label', { class: 'calrow', style: 'padding:3px 0' }, h('input', { type: 'checkbox', checked: on, onchange: (ev) => onchange(ev.target.checked) }), dot ? h('span', { class: 'dot', style: `background:${dot}` }) : null, label);
    const paint = () => box.replaceChildren(
      h('div', { class: 'traylabel', id: 'bsx-notify' }, 'Notifications'),
      h('p', { class: 'muted small', style: 'margin:0 4px 6px' }, 'What reminders and the Alerts list may tell you about. Untick to mute.'),
      h('div', { class: 'row', style: 'margin:0 4px;gap:0 14px' }, TYPES.map(([id, label]) => check(!mute.types.includes(id), label, (on) => setMute({ types: toggle(mute.types, id, on) })))),
      ui.lazy(BSX.data.courses(), (courses) => h('div', { style: 'margin:6px 4px 0' }, ui.focusCourses(courses).map((c) => check(!mute.courses.includes(String(c.id)), ui.nameOf(c), (on) => setMute({ courses: toggle(mute.courses, String(c.id), on) }), ui.colorOf(c.id)))), ''));
    paint();
    ready.then(paint);
    return box;
  });

  // The count fills in once the page has drawn, and again after moving between pages (from the
  // list already gathered unless it is old) and when Brightspace's fresh answers arrive.
  ready.then(() => setTimeout(() => refresh(false), 4000));
  let timer = 0;
  root.addEventListener('hashchange', () => {
    clearTimeout(timer);
    timer = setTimeout(() => refresh(false), 1500);
  });
  if (BSX.client) BSX.client.onChange(() => (last = null));

  BSX.notices = { ...pure, ready, mutedWork, refresh, forget: () => { read = {}; last = null; paintBadge(0); } }; // forget: signed out (src/client.js)
})(typeof globalThis !== 'undefined' ? globalThis : this);
