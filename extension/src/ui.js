// Layer 3: Canvas-style interface. Reads only the Canvas-shaped objects from BSX.data.
// Shown over the Brightspace home pages and over Brightspace's own Grades, Assignments
// and Announcements pages; every other Brightspace page is left alone.
// Routes live in the URL hash:
//   #/                               dashboard
//   #/calendar[/YYYY-MM]             calendar
//   #/courses/{id}/{grades|assignments|announcements|modules}
//   #brightspace                     wrapper off, original page visible
(() => {
  if (window.top !== window) return;

  // Which Brightspace page are we on, and which wrapper view stands in for it?
  const entry = (() => {
    const p = location.pathname;
    const ou = Number(new URLSearchParams(location.search).get('ou')) || null;
    const m = p.match(/^\/d2l\/home(?:\/(\d+))?\/?$/);
    if (m) return { kind: 'home', id: m[1] ? Number(m[1]) : null };
    if (/^\/d2l\/lms\/grades\/my_grades\/main\.d2l$/i.test(p)) return { kind: 'grades', id: ou };
    if (/^\/d2l\/lms\/dropbox\/(user\/folders_list|dropbox)\.d2l$/i.test(p)) return { kind: 'assignments', id: ou };
    if (/^\/d2l\/lms\/news\/main\.d2l$/i.test(p)) return { kind: 'announcements', id: ou };
    if (/^\/d2l\/lms\/quizzing\/user\/quizzes_list\.d2l$/i.test(p)) return { kind: 'quizzes', id: ou };
    let t = p.match(/^\/d2l\/le\/content\/(\d+)\/Home\/?$/i);
    if (t) return { kind: 'modules', id: Number(t[1]) };
    t = p.match(/^\/d2l\/le\/(\d+)\/discussions\/List\/?$/i);
    if (t) return { kind: 'discussions', id: Number(t[1]) };
    return null;
  })();
  if (!entry) return;

  const { data, client } = BSX;
  const OFF = '#brightspace';
  const DAY = 864e5;
  const COLORS = ['#0b874b', '#bd3c14', '#0374b5', '#8f3e97', '#d97900', '#4554a4', '#06a3b7', '#e71f63', '#65499d', '#177b63'];

  // ---- small helpers -------------------------------------------------------
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : String(kid));
    }
    return n;
  }

  // Links built from API data: same-origin https only.
  function safeHref(url) {
    try {
      const u = new URL(url, location.origin);
      return u.protocol === 'https:' && u.origin === location.origin ? u.href : null;
    } catch {
      return null;
    }
  }

  // Links inside instructor-written text: any http(s) address, nothing else.
  function webHref(url) {
    try {
      const u = new URL(url, location.origin);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch {
      return null;
    }
  }

  // Instructor-written HTML is untrusted. Rebuild it from an allowlist of plain
  // formatting tags; no attributes survive except a checked link address.
  const KEEP = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'SPAN', 'DIV', 'PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'HR', 'SUB', 'SUP']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'VIDEO', 'AUDIO']);
  function cleanHtml(html) {
    const out = document.createDocumentFragment();
    const walk = (src, dst) => {
      for (const n of src.childNodes) {
        if (n.nodeType === 3) dst.append(n.nodeValue);
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toUpperCase();
        if (DROP.has(tag)) continue;
        if (tag === 'IMG') {
          const alt = n.getAttribute('alt');
          dst.append(alt ? `[image: ${alt}]` : '[image]');
        } else if (KEEP.has(tag)) {
          const el = document.createElement(tag.toLowerCase());
          if (tag === 'A') {
            const href = webHref(n.getAttribute('href') || '');
            if (href) {
              el.href = href;
              el.target = '_blank';
              el.rel = 'noopener noreferrer';
            }
          }
          walk(n, el);
          dst.append(el);
        } else {
          walk(n, dst);
        }
      }
    };
    walk(new DOMParser().parseFromString(html, 'text/html').body, out);
    return out;
  }

  const num = (n) => (n == null ? '–' : String(Math.round(n * 100) / 100));
  const pct = (a, b) => (a == null || !b ? '' : `${num((a / b) * 100)}%`);
  const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const when = (iso) => (iso ? dateFmt.format(new Date(iso)) : 'No due date');
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

  // Per-user preferences, kept in extension storage (not visible to the Brightspace page):
  // theme, and a nickname and colour per course.
  const THEMES = ['auto', 'light', 'dark'];
  const store = (globalThis.browser || globalThis.chrome)?.storage?.local;
  let settings = { theme: 'auto', courses: {} };
  async function loadSettings() {
    try {
      const saved = (await store.get('bsx'))?.bsx;
      if (saved) settings = { theme: THEMES.includes(saved.theme) ? saved.theme : 'auto', courses: { ...(saved.courses || {}) } };
    } catch {}
  }
  function saveSettings() {
    try {
      store.set({ bsx: settings });
    } catch {}
  }
  const colorOf = (id) => {
    const chosen = settings.courses[id]?.color;
    return COLORS.includes(chosen) ? chosen : COLORS[Number(id) % COLORS.length];
  };
  const nameOf = (c) => settings.courses[c.id]?.nickname || c.name;
  // Pages the wrapper takes over carry the off-switch hash so these links reach the original.
  const bs = {
    home: (id) => `/d2l/home/${id}${OFF}`,
    news: (id) => `/d2l/lms/news/main.d2l?ou=${id}${OFF}`,
    grades: (id) => `/d2l/lms/grades/my_grades/main.d2l?ou=${id}${OFF}`,
    assignments: (id) => `/d2l/lms/dropbox/user/folders_list.d2l?ou=${id}${OFF}`,
    content: (id) => `/d2l/le/content/${id}/Home${OFF}`,
    quizzes: (id) => `/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${id}${OFF}`,
    discussions: (id) => `/d2l/le/${id}/discussions/List${OFF}`,
    classlist: (id) => `/d2l/lms/classlist/classlist.d2l?ou=${id}`,
  };

  // This term's courses; without any, pinned ones; without those, everything.
  function focusCourses(courses) {
    const term = courses.filter((c) => c.current_term);
    if (term.length) return { list: term, label: 'Show this term only' };
    const pinned = courses.filter((c) => c.pinned);
    if (pinned.length) return { list: pinned, label: 'Show pinned courses only' };
    return { list: courses, label: '' };
  }

  // ---- mount ---------------------------------------------------------------
  const host = document.createElement('div');
  host.id = 'bsx-root';
  const root = host.attachShadow({ mode: 'open' });
  // Constructed sheets are not subject to the page's content security policy; fall back to a style element.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(BSX.styles);
    root.adoptedStyleSheets = [sheet];
  } catch {
    root.append(h('style', null, BSX.styles));
  }
  const mount = h('div');
  root.append(mount);
  document.documentElement.append(host);

  let showAll = false;
  let editing = null; // id of the course card whose nickname and colour are being edited
  let renderId = 0;
  const app = (...kids) => h('div', { class: 'app', 'data-theme': settings.theme }, ...kids);
  const whatIf = { on: false, courseId: null, overrides: new Map() };
  const COURSE_VIEWS = ['home', 'announcements', 'assignments', 'quizzes', 'discussions', 'grades', 'modules'];

  function route() {
    const hash = location.hash;
    if (hash === OFF) return { view: 'off' };
    let m = hash.match(/^#\/courses\/(\d+)\/([a-z]+)$/);
    if (m && COURSE_VIEWS.includes(m[2])) return { view: m[2], courseId: Number(m[1]) };
    m = hash.match(/^#\/calendar(?:\/(\d{4})-(\d{2}))?$/);
    if (m) return { view: 'calendar', year: m[1] ? Number(m[1]) : null, month: m[2] ? Number(m[2]) - 1 : null };
    if (hash === '#/') return { view: 'dashboard' };
    return { view: 'entry' };
  }

  const reload = () => {
    client.clear();
    render();
  };

  function rail(current) {
    const item = (key, href, glyph, label) => h('a', { href, class: current === key ? 'on' : null }, h('span', { class: 'glyph' }, glyph), label);
    return h(
      'nav',
      { class: 'rail' },
      item('dashboard', '#/', '▦', 'Dashboard'),
      item('calendar', '#/calendar', '▤', 'Calendar'),
      h('span', { class: 'gap' }),
      h('button', {
        title: 'Switch between automatic, light and dark',
        onclick: () => {
          settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
          saveSettings();
          render();
        },
      }, h('span', { class: 'glyph' }, '◐'), `Theme: ${settings.theme}`),
      h('button', { onclick: () => (location.hash = OFF), title: 'Show the original Brightspace page' }, h('span', { class: 'glyph' }, '⇄'), 'Brightspace')
    );
  }

  function header(title, extra) {
    return h('div', { class: 'head' }, h('h1', { title }, title), extra, h('span', { class: 'stamp' }, `Updated ${timeFmt.format(new Date())}`), h('button', { class: 'btn', onclick: reload }, 'Refresh'));
  }

  function shell(current, title, body, extra) {
    return app(rail(current), h('div', { class: 'main' }, header(title, extra), body));
  }

  function errorBox(e) {
    return h('div', { class: 'error' }, `Could not load this view. ${e && e.message ? e.message : e}`, ' ', h('button', { class: 'btn', onclick: reload }, 'Try again'));
  }

  // A sidebar section that fills in when its data arrives and fails on its own.
  function lazySection(titleText, promise, build) {
    const body = h('div', { class: 'muted small', style: 'padding:8px 0' }, 'Loading…');
    promise
      .then((value) => {
        const built = [build(value)].flat(Infinity).filter(Boolean);
        body.className = '';
        body.style.cssText = '';
        body.replaceChildren(...(built.length ? built : [h('div', { class: 'muted small', style: 'padding:8px 0' }, 'Nothing here.')]));
      })
      .catch((e) => (body.textContent = `Unavailable. ${e.message || e}`));
    return h('section', null, h('h2', null, titleText), body);
  }

  // ---- dashboard -----------------------------------------------------------
  function cardEditor(c) {
    const saved = settings.courses[c.id] || {};
    let color = COLORS.includes(saved.color) ? saved.color : null;
    const nick = h('input', { class: 'txt', type: 'text', maxlength: '60', value: saved.nickname || '', placeholder: c.name });
    const swatches = COLORS.map((col) => h('button', { class: 'sw', type: 'button', style: `background:${col}`, 'aria-label': `Colour ${col}`, onclick: () => { color = col; mark(); } }));
    const mark = () => swatches.forEach((b, i) => b.classList.toggle('on', COLORS[i] === (color || colorOf(c.id))));
    mark();
    const done = (next) => {
      if (next && Object.keys(next).length) settings.courses[c.id] = next;
      else delete settings.courses[c.id];
      saveSettings();
      editing = null;
      render();
    };
    const save = () => {
      const next = {};
      if (nick.value.trim()) next.nickname = nick.value.trim();
      if (color) next.color = color;
      done(next);
    };
    nick.addEventListener('keydown', (ev) => ev.key === 'Enter' && save());
    return h('div', { class: 'edit' },
      h('label', null, 'Nickname', nick),
      h('label', null, 'Colour', h('div', { class: 'swatches' }, swatches)),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: save }, 'Save'), h('button', { class: 'btn', onclick: () => done(null) }, 'Reset'), h('button', { class: 'btn', onclick: () => { editing = null; render(); } }, 'Cancel')));
  }

  function card(c) {
    const img = h('img', { src: c.image_url, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.remove());
    const name = nameOf(c);
    const body = editing === c.id
      ? cardEditor(c)
      : [
          h('div', { class: 'text' }, h('a', { class: 'name', href: `#/courses/${c.id}/home`, title: name === c.name ? name : `${name} (${c.name})`, style: `--c:${colorOf(c.id)}` }, name), h('div', { class: 'code', title: c.course_code }, c.course_code)),
          h('div', { class: 'links' }, h('a', { href: `#/courses/${c.id}/announcements` }, 'Announcements'), h('a', { href: `#/courses/${c.id}/assignments` }, 'Assignments'), h('a', { href: `#/courses/${c.id}/grades` }, 'Grades'), h('a', { href: `#/courses/${c.id}/modules` }, 'Modules')),
        ];
    return h(
      'div',
      { class: 'card' },
      h('a', { class: 'hero', href: `#/courses/${c.id}/home`, style: `background:${colorOf(c.id)}`, 'aria-label': name }, img),
      h('button', { class: 'more', title: 'Nickname and colour', 'aria-label': `Nickname and colour for ${name}`, onclick: () => { editing = editing === c.id ? null : c.id; render(); } }, '⋮'),
      body
    );
  }

  function todoItems(items, courseName, late) {
    const shown = items.slice(0, 10);
    return [
      shown.map((i) => {
        const href = (i.html_url && safeHref(i.html_url)) || `#/courses/${i.course_id}/assignments`;
        const course = courseName(i.course_id);
        return h('div', { class: late ? 'todo late' : 'todo' }, h('a', { class: 't', href }, i.title || i.name), h('div', { class: 'm' }, course ? [course, ' · '] : null, late ? h('b', null, `was due ${when(i.due_at)}`) : when(i.due_at)));
      }),
      items.length > shown.length ? h('div', { class: 'muted small', style: 'padding-top:6px' }, `${items.length - shown.length} more`) : null,
    ];
  }

  async function dashboard() {
    const courses = await data.courses();
    const focus = focusCourses(courses);
    const visible = showAll ? courses : focus.list;
    const ids = new Set(visible.map((c) => c.id));
    const names = new Map(courses.map((c) => [c.id, nameOf(c)]));
    const courseName = (id) => names.get(id) || 'Course';

    const side = h(
      'aside',
      { class: 'side' },
      lazySection('To Do', data.todo(visible), (items) => todoItems(items, courseName, false)),
      lazySection('Overdue', data.overdue(), (items) => todoItems(items.filter((i) => ids.has(i.course_id)), courseName, true)),
      lazySection('Recent Announcements', data.recentAnnouncements(visible), (items) =>
        items.slice(0, 6).map((a) => h('div', { class: 'todo' }, h('a', { class: 't', href: `#/courses/${a.course_id}/announcements` }, a.title), h('div', { class: 'm' }, courseName(a.course_id), ' · ', when(a.posted_at))))
      )
    );

    const toggle =
      focus.list.length < courses.length
        ? h('div', { class: 'small', style: 'margin-top:16px' }, h('a', { href: '#/', onclick: (ev) => { ev.preventDefault(); showAll = !showAll; render(); } }, showAll ? focus.label : `Show all ${courses.length} courses`))
        : null;

    const cards = visible.length ? h('div', { class: 'cards' }, visible.map(card)) : h('div', { class: 'msg' }, 'No current courses found.');
    return shell('dashboard', 'Dashboard', h('div', { class: 'body' }, h('div', { class: 'grow' }, cards, toggle), side));
  }

  // ---- calendar ------------------------------------------------------------
  async function calendarPage(r) {
    const today = new Date();
    const year = r.year ?? today.getFullYear();
    const month = r.month ?? today.getMonth();
    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - first.getDay());
    const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 42);

    const courses = await data.courses();
    const visible = showAll ? courses : focusCourses(courses).list;
    const events = await data.calendar(visible.map((c) => c.id), gridStart.getTime(), gridEnd.getTime());

    const names = new Map(courses.map((c) => [c.id, nameOf(c)]));
    const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const byDay = new Map();
    for (const e of events) {
      const k = key(new Date(e.start_at));
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }

    const link = (d) => `#/calendar/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const nav = h('span', { class: 'calnav' }, h('a', { class: 'btn', href: link(new Date(year, month - 1, 1)) }, '‹'), h('a', { class: 'btn', href: '#/calendar' }, 'Today'), h('a', { class: 'btn', href: link(new Date(year, month + 1, 1)) }, '›'));

    const cells = [];
    for (const name of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) cells.push(h('div', { class: 'dow' }, name));
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const cls = ['day', d.getMonth() !== month ? 'other' : '', key(d) === key(today) ? 'today' : ''].filter(Boolean).join(' ');
      cells.push(
        h('div', { class: cls }, h('div', { class: 'dnum' }, d.getDate()),
          (byDay.get(key(d)) || []).map((e) => {
            const label = [e.all_day ? null : h('span', { class: 'etime' }, timeFmt.format(new Date(e.start_at))), ' ', e.title];
            const href = e.html_url && safeHref(e.html_url);
            const attrs = { class: 'event', style: `border-left-color:${colorOf(e.course_id)}`, title: `${e.title} · ${names.get(e.course_id) || e.context_name || ''}` };
            return href ? h('a', { ...attrs, href }, label) : h('div', attrs, label);
          }))
      );
    }
    const note = h('div', { class: 'muted small', style: 'margin-top:10px' }, 'From the Brightspace calendar. An item can appear more than once when it has both a due date and an availability date.');
    return shell('calendar', monthFmt.format(first), h('div', { class: 'body' }, h('div', { class: 'grow' }, h('div', { class: 'cal' }, cells), note)), nav);
  }

  // ---- course pages --------------------------------------------------------
  function courseNav(id, current) {
    const link = (key, label) => h('a', { href: `#/courses/${id}/${key}`, class: current === key ? 'on' : null }, label);
    const tools = h('div');
    data.externalTools(id)
      .then((list) => {
        if (list.length) tools.replaceChildren(h('div', { class: 'sep' }, 'External tools'), ...list.map((t) => h('a', { href: t.html_url, title: 'Opens through Brightspace' }, t.title)));
      })
      .catch(() => {});
    return h(
      'nav',
      { class: 'cnav' },
      link('home', 'Home'),
      link('announcements', 'Announcements'),
      link('assignments', 'Assignments'),
      link('quizzes', 'Quizzes'),
      link('discussions', 'Discussions'),
      link('grades', 'Grades'),
      link('modules', 'Modules'),
      h('div', { class: 'sep' }, 'In Brightspace'),
      h('a', { href: bs.home(id) }, 'Course home'),
      h('a', { href: bs.classlist(id) }, 'Classlist'),
      tools
    );
  }

  async function coursePage(id, current, build) {
    const [courses, content] = await Promise.all([data.courses(), build(id)]);
    const course = courses.find((c) => c.id === id);
    return shell(null, course ? nameOf(course) : 'Course', h('div', { class: 'body' }, courseNav(id, current), h('div', { class: 'grow' }, content)));
  }

  async function gradesView(id) {
    if (whatIf.courseId !== id) Object.assign(whatIf, { on: false, courseId: id, overrides: new Map() });
    const g = await data.grades(id);
    const points = g.system === 'Points';
    const weighted = g.system === 'Weighted';
    const pair = (t) => (points ? h('span', { class: 'muted' }, `${num(t.score)} / ${num(t.points_possible)}`) : null);

    const totalBox = h('div', { class: 'total' });
    function drawTotal() {
      const actual = g.final ? g.final.displayed || pct(g.final.score, g.final.points_possible) : g.estimate ? `${pct(g.estimate.score, g.estimate.points_possible)} (estimate)` : 'not released';
      const hyp = whatIf.on && whatIf.overrides.size ? data.estimate(g, whatIf.overrides) : null;
      let kids;
      if (hyp) {
        kids = [h('span', null, 'What-If total'), h('span', { class: 'big' }, pct(hyp.score, hyp.points_possible)), pair(hyp), h('span', { class: 'tag' }, 'hypothetical'), h('span', { class: 'muted' }, `Actual: ${actual}`)];
      } else if (g.final) {
        kids = [h('span', null, 'Total'), h('span', { class: 'big' }, g.final.displayed || pct(g.final.score, g.final.points_possible) || '–'), g.final.points_possible ? h('span', { class: 'muted' }, `${num(g.final.score)} / ${num(g.final.points_possible)}`) : null, h('span', { class: 'tag' }, 'released by instructor')];
      } else if (g.estimate) {
        kids = [h('span', null, 'Total'), h('span', { class: 'big' }, pct(g.estimate.score, g.estimate.points_possible)), pair(g.estimate), h('span', { class: 'tag' }, 'estimate from graded items, not official')];
      } else {
        kids = [h('span', null, 'Total'), h('span', { class: 'muted' }, 'Not released by the instructor.')];
      }
      if (points || weighted) {
        kids.push(h('span', { style: 'flex:1' }), h('button', { class: 'btn', onclick: () => { whatIf.on = !whatIf.on; whatIf.overrides = new Map(); render(); } }, whatIf.on ? 'Exit What-If' : 'What-If scores'));
      }
      totalBox.replaceChildren(...kids.filter(Boolean));
    }
    drawTotal();

    const rows = [];
    for (const group of g.groups) {
      if (group.name) {
        const v = group.value;
        rows.push(h('tr', { class: 'group' }, h('td', null, group.name, weighted && group.weight != null ? h('span', { class: 'tag' }, `${num(group.weight)}% of total`) : null),
          h('td', { class: 'num' }, v ? num(v.score) : ''), h('td', { class: 'num' }, v ? num(v.points_possible) : ''), h('td', { class: 'num' }, v ? pct(v.score, v.points_possible) : ''), h('td', null, v ? v.displayed : '')));
      }
      for (const i of group.items) {
        const v = i.value;
        const possible = v ? v.points_possible : i.points_possible;
        const pctCell = h('td', { class: 'num' }, v ? pct(v.score, v.points_possible) : '');
        let scoreCell;
        if (whatIf.on && data.estimable(g, i)) {
          const input = h('input', { class: 'wi', type: 'number', min: '0', step: 'any', value: v && v.score != null ? String(v.score) : '', 'aria-label': `What-If score for ${i.name}` });
          input.addEventListener('input', () => {
            const typed = input.value === '' ? null : Number(input.value);
            const changed = typed != null && Number.isFinite(typed) && typed !== (v ? v.score : null);
            if (changed) whatIf.overrides.set(i.id, typed);
            else whatIf.overrides.delete(i.id);
            input.classList.toggle('changed', changed);
            pctCell.textContent = typed != null && Number.isFinite(typed) ? pct(typed, possible) : '';
            drawTotal();
          });
          scoreCell = h('td', { class: 'num' }, input);
        } else {
          scoreCell = h('td', { class: 'num' }, v ? num(v.score) : '–');
        }
        rows.push(h('tr', null,
          h('td', null, i.name, i.bonus ? h('span', { class: 'tag' }, 'bonus') : null, i.excluded ? h('span', { class: 'tag' }, 'not counted') : null, v && v.comment ? h('div', { class: 'note' }, v.comment) : null),
          scoreCell,
          h('td', { class: 'num' }, num(possible)),
          pctCell,
          h('td', null, v ? v.displayed : '')));
      }
    }

    const table = rows.length
      ? h('table', null, h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', { class: 'num' }, 'Score'), h('th', { class: 'num' }, 'Out of'), h('th', { class: 'num' }, '%'), h('th', null, 'Grade'))), h('tbody', null, rows))
      : h('div', { class: 'msg' }, 'No grade items in this course.');
    const hint = whatIf.on
      ? h('div', { class: 'muted small', style: 'margin:-10px 0 14px' }, weighted
        ? 'Type scores to see the effect. Only graded items can be changed in a weighted gradebook, and dropped-score rules are ignored.'
        : 'Type scores to see the effect, including for work not graded yet. Dropped-score rules are ignored.')
      : null;
    return [totalBox, hint, table, h('div', { class: 'small', style: 'margin-top:14px' }, h('a', { href: bs.grades(id) }, 'Open Grades in Brightspace'))];
  }

  // Course home: what's coming up, the latest announcements, then the modules.
  async function homeView(id) {
    const [news, mods] = await Promise.all([data.announcements(id), modulesView(id)]);
    const snippet = (a) => {
      const text = (a.message || (a.message_html ? cleanHtml(a.message_html).textContent : '')).replace(/\s+/g, ' ').trim();
      return text.length > 240 ? `${text.slice(0, 240)}…` : text;
    };
    return [
      h('div', { class: 'side', style: 'width:auto' }, lazySection('Coming Up', data.todo([{ id, name: '' }]), (items) => todoItems(items, () => '', false))),
      h('h2', { class: 'sect' }, 'Recent Announcements'),
      news.length
        ? [
            news.slice(0, 3).map((a) => h('article', { class: 'post' }, h('h2', null, h('a', { href: `#/courses/${id}/announcements` }, a.title)), h('div', { class: 'muted small' }, a.posted_at ? `Posted ${when(a.posted_at)}` : ''), h('div', { class: 'prose' }, snippet(a)))),
            news.length > 3 ? h('div', { class: 'small' }, h('a', { href: `#/courses/${id}/announcements` }, `All ${news.length} announcements`)) : null,
          ]
        : h('div', { class: 'muted small' }, 'No announcements.'),
      h('h2', { class: 'sect' }, 'Modules'),
      mods,
    ];
  }

  const KINDS = {
    assignment: { tag: 'Assignment', none: 'No assignments, quizzes or discussions in this course.', open: 'Open Assignments in Brightspace', href: (id) => bs.assignments(id) },
    quiz: { tag: 'Quiz', none: 'No quizzes in this course.', open: 'Open Quizzes in Brightspace', href: (id) => bs.quizzes(id) },
    discussion: { tag: 'Discussion', none: 'No discussion topics in this course.', open: 'Open Discussions in Brightspace', href: (id) => bs.discussions(id) },
  };

  // `kind` narrows the merged list to quizzes or discussions; without it, everything is shown.
  async function assignmentsView(id, kind) {
    const all = (await data.assignments(id)).filter((a) => !kind || a.kind === kind);
    const now = Date.now();
    const byDue = (a, b) => Date.parse(a.due_at) - Date.parse(b.due_at);
    const upcoming = all.filter((a) => a.due_at && Date.parse(a.due_at) >= now).sort(byDue);
    const undated = all.filter((a) => !a.due_at);
    const past = all.filter((a) => a.due_at && Date.parse(a.due_at) < now).sort(byDue).reverse();

    const item = (a) => {
      const possible = a.grade ? a.grade.points_possible : a.points_possible;
      const score = a.grade ? `${num(a.grade.score)} / ${num(possible)} pts` : possible != null ? `– / ${num(possible)} pts` : '';
      // Ungraded work: look up whether it was turned in or attempted, after the list is on screen.
      const status = h('span', { class: 'small' });
      const show = (done, text) => {
        status.textContent = text;
        status.className = `small ${done ? 'ok' : a.due_at && Date.parse(a.due_at) < now ? 'bad' : 'muted'}`;
      };
      if (a.kind === 'assignment' && !a.grade) {
        data.submission(id, a.source_id).then((s) => show(s.submitted, s.submitted ? `Submitted${s.submitted_at ? ` ${when(s.submitted_at)}` : ''}` : 'Not submitted')).catch(() => {});
      } else if (a.kind === 'quiz' && !a.grade) {
        data.quizAttempts(id, a.source_id).then((q) => {
          if (q.known) show(q.attempts_used > 0, q.attempts_used > 0 ? `Attempted${q.attempts_used > 1 ? ` ×${q.attempts_used}` : ''}` : 'Not attempted');
        }).catch(() => {});
      }
      return h('div', { class: 'item' },
        h('span', { class: 'tag', style: 'margin:0' }, KINDS[a.kind].tag),
        h('div', { class: 'mid' }, h('a', { href: a.html_url }, a.name), h('div', { class: 'muted small' }, a.forum ? `${a.forum} · ` : null, a.due_at ? `Due ${when(a.due_at)}` : 'No due date')),
        status,
        h('span', { class: 'muted small' }, score));
    };
    const section = (titleText, items) => (items.length ? h('div', { class: 'list' }, h('h2', null, `${titleText} (${items.length})`), items.map(item)) : null);

    const k = KINDS[kind || 'assignment'];
    const footer = h('div', { class: 'small' }, h('a', { href: k.href(id) }, k.open));
    if (!all.length) return [h('div', { class: 'msg' }, k.none), footer];
    return [section('Upcoming', upcoming), section('Undated', undated), section('Past', past), footer];
  }

  async function announcementsView(id) {
    const list = await data.announcements(id);
    if (!list.length) return h('div', { class: 'msg' }, 'No announcements in this course.');
    return [
      list.map((a) =>
        h('article', { class: 'post' },
          h('h2', null, a.title, a.pinned ? h('span', { class: 'tag' }, 'pinned') : null),
          h('div', { class: 'muted small' }, a.posted_at ? `Posted ${when(a.posted_at)}` : ''),
          h('div', { class: 'prose' }, a.message_html ? cleanHtml(a.message_html) : a.message))),
      h('div', { class: 'small' }, h('a', { href: bs.news(id) }, 'Open Announcements in Brightspace')),
    ];
  }

  async function modulesView(id) {
    const list = await data.modules(id);
    if (!list.length) return h('div', { class: 'msg' }, 'No content in this course.');
    return [
      list.map((m) =>
        h('details', { class: 'module', open: true, style: `margin-left:${Math.min(m.depth, 4) * 20}px` },
          h('summary', null, m.name, m.locked ? h('span', { class: 'tag' }, 'locked') : null, h('span', { class: 'muted small', style: 'font-weight:400;margin-left:8px' }, m.items.length ? `${m.items.length} items` : '')),
          m.items.map((i) =>
            h('div', { class: 'item' },
              h('span', { class: 'tag', style: 'margin:0' }, i.type),
              h('div', { class: 'mid' }, h('a', { href: i.html_url, style: i.unread ? null : 'font-weight:400' }, i.title)),
              i.locked ? h('span', { class: 'muted small' }, 'locked') : i.unread ? h('span', { class: 'small linkc' }, 'new') : null)))),
      h('div', { class: 'small' }, h('a', { href: bs.content(id) }, 'Open Content in Brightspace')),
    ];
  }

  const COURSE_BUILDERS = {
    home: homeView,
    announcements: announcementsView,
    assignments: (id) => assignmentsView(id),
    quizzes: (id) => assignmentsView(id, 'quiz'),
    discussions: (id) => assignmentsView(id, 'discussion'),
    grades: gradesView,
    modules: modulesView,
  };

  // ---- render loop ---------------------------------------------------------
  async function render() {
    const id = ++renderId;
    const r = route();

    if (r.view === 'off') {
      mount.replaceChildren(h('button', { class: 'pill', onclick: () => { history.replaceState(null, '', location.pathname + location.search); render(); } }, 'Canvas view'));
      return;
    }
    if (!mount.querySelector('.app')) mount.replaceChildren(app(rail(null), h('div', { class: 'main' }, h('div', { class: 'msg' }, 'Loading…'))));

    try {
      // Arriving on a Brightspace URL: pick the wrapper view that stands in for that page.
      if (r.view === 'entry') {
        const courses = entry.id ? await data.courses() : [];
        const known = courses.some((c) => c.id === entry.id);
        let target;
        if (entry.kind === 'home') target = known ? `#/courses/${entry.id}/home` : '#/';
        else target = known ? `#/courses/${entry.id}/${entry.kind}` : OFF;
        history.replaceState(null, '', target);
        return render();
      }
      const page =
        COURSE_BUILDERS[r.view] ? await coursePage(r.courseId, r.view, COURSE_BUILDERS[r.view])
        : r.view === 'calendar' ? await calendarPage(r)
        : await dashboard();
      if (id === renderId) mount.replaceChildren(page);
    } catch (e) {
      if (id === renderId) mount.replaceChildren(app(rail(null), h('div', { class: 'main' }, errorBox(e))));
    }
  }

  window.addEventListener('hashchange', render);
  loadSettings().then(render);
})();
