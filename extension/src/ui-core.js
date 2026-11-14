// Layer 3, part 1: the frame around every page (global navigation, trays, header),
// routing, preferences and shared helpers. Pages register themselves on BSX.ui.views.
//
// The wrapper is shown over the Brightspace home pages and over Brightspace's own list
// pages (grades, assignments, announcements, quizzes, discussions, content); every other
// Brightspace page is left alone. Routes live in the URL hash:
//   #/                      dashboard          #/courses        all courses
//   #/grades                all grades         #/calendar[/YYYY-MM]
//   #/courses/{id}[/{section}[/{item}]]        a course page or one item in it
//   #brightspace            wrapper off, original page visible
BSX.ui = (() => {
  // Never inside a frame. (BSX_DEV_FRAME is set only by the dev server's phone-width preview;
  // extension scripts run in their own world and never see it.)
  if (window.top !== window && !globalThis.BSX_DEV_FRAME) return null;

  // Which Brightspace page are we on, and which wrapper page stands in for it?
  const entry = (() => {
    const p = location.pathname;
    const ou = Number(new URLSearchParams(location.search).get('ou')) || null;
    let m = p.match(/^\/d2l\/home(?:\/(\d+))?\/?$/);
    if (m) return { kind: 'home', id: m[1] ? Number(m[1]) : null };
    if (/^\/d2l\/lms\/grades\/my_grades\/main\.d2l$/i.test(p)) return { kind: 'grades', id: ou };
    if (/^\/d2l\/lms\/dropbox\/(user\/folders_list|dropbox)\.d2l$/i.test(p)) return { kind: 'assignments', id: ou };
    if (/^\/d2l\/lms\/news\/main\.d2l$/i.test(p)) return { kind: 'announcements', id: ou };
    if (/^\/d2l\/lms\/quizzing\/user\/quizzes_list\.d2l$/i.test(p)) return { kind: 'quizzes', id: ou };
    if (/^\/d2l\/lms\/classlist\/classlist\.d2l$/i.test(p)) return { kind: 'people', id: ou };
    m = p.match(/^\/d2l\/le\/content\/(\d+)\/Home\/?$/i) || p.match(/^\/d2l\/le\/lessons\/(\d+)\/?$/i); // classic and newer Content
    if (m) return { kind: 'modules', id: Number(m[1]) };
    m = p.match(/^\/d2l\/le\/(\d+)\/discussions\/List\/?$/i);
    if (m) return { kind: 'discussions', id: Number(m[1]) };
    return null;
  })();
  const LAST = 'bsx.last'; // the wrapper page most recently shown, for the way back

  // On Brightspace pages the wrapper does not cover, offer a small way back to it.
  if (!entry) {
    if (!location.pathname.startsWith('/d2l/')) return null;
    let back = '/d2l/home#/';
    try {
      if (sessionStorage.getItem('bsx.nopill')) return null;
      const saved = sessionStorage.getItem(LAST);
      if (saved && saved.startsWith('/d2l/')) back = saved;
    } catch {}
    const pillHost = document.createElement('div');
    const shadow = pillHost.attachShadow({ mode: 'open' });
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;left:12px;bottom:12px;display:flex;border-radius:18px;overflow:hidden;background:#2d3b45;box-shadow:0 2px 8px rgba(0,0,0,.3);font:13px/1.2 Lato,"Helvetica Neue",Helvetica,Arial,sans-serif';
    const link = document.createElement('a');
    link.href = back;
    link.textContent = '← Canvas view';
    link.style.cssText = 'color:#fff;text-decoration:none;padding:8px 6px 8px 14px';
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.textContent = '×';
    hide.title = 'Hide until the next visit';
    hide.setAttribute('aria-label', 'Hide the Canvas view button');
    hide.style.cssText = 'color:#fff;background:none;border:0;padding:8px 12px 8px 6px;cursor:pointer;font:inherit';
    hide.addEventListener('click', () => {
      try {
        sessionStorage.setItem('bsx.nopill', '1');
      } catch {}
      pillHost.remove();
    });
    box.append(link, hide);
    shadow.append(box);
    const place = () => document.documentElement.append(pillHost);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place);
    else place();
    return null;
  }

  const { data, client } = BSX;
  const OFF = '#brightspace';
  const DAY = 864e5;
  const COLORS = ['#0b874b', '#bd3c14', '#0374b5', '#8f3e97', '#d97900', '#4554a4', '#06a3b7', '#e71f63', '#65499d', '#177b63'];
  const SECTIONS = ['home', 'announcements', 'assignments', 'discussions', 'grades', 'people', 'files', 'syllabus', 'quizzes', 'modules'];

  // ---- elements ------------------------------------------------------------
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

  const SVG = 'http://www.w3.org/2000/svg';
  function ic(name, size = 20) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('class', 'ic');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', BSX.icons[name] || BSX.icons.item);
    svg.append(path);
    return svg;
  }

  // Links built from API data: this site only.
  function safeHref(url) {
    try {
      const u = new URL(url, location.origin);
      return u.origin === location.origin ? u.href : null;
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

  // Instructor- and student-written HTML is untrusted. Rebuild it from an allowlist of
  // plain formatting tags; no attributes survive except a checked link address.
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
  // Rich text as a block: sanitised HTML when there is some, else the plain text.
  const prose = (htmlText, plain) => (htmlText || plain ? h('div', { class: 'prose' }, htmlText ? cleanHtml(htmlText) : plain) : null);
  const plainOf = (htmlText, plain) => (plain || (htmlText ? cleanHtml(htmlText).textContent : '')).replace(/\s+/g, ' ').trim();
  const clip = (text, n) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

  // ---- formatting ----------------------------------------------------------
  const num = (n) => (n == null ? '–' : String(Math.round(n * 100) / 100));
  const pct = (a, b) => (a == null || !b ? '' : `${num((a / b) * 100)}%`);
  const F = (o) => new Intl.DateTimeFormat(undefined, o);
  const fmt = { full: F({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), time: F({ hour: 'numeric', minute: '2-digit' }), day: F({ weekday: 'long', month: 'long', day: 'numeric' }), short: F({ month: 'short', day: 'numeric' }), month: F({ month: 'long', year: 'numeric' }) };
  const when = (iso) => (iso ? fmt.full.format(new Date(iso)).replace(',', ' at').replace(' at at', ' at') : '');
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const bytes = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${Math.round(n / 104857.6) / 10} MB`);

  // ---- preferences ---------------------------------------------------------
  // Kept in extension storage (not visible to the Brightspace page).
  const THEMES = ['auto', 'light', 'dark'];
  const store = (globalThis.browser || globalThis.chrome)?.storage?.local;
  // todos: the student's own planner items. done / dismissed: keys of items ticked off or hidden.
  const settings = { theme: 'auto', courses: {}, dash: 'cards', navOpen: true, calHidden: [], asgBy: 'date', todos: [], done: {}, dismissed: {} };
  async function loadSettings() {
    try {
      const saved = (await store.get('bsx'))?.bsx;
      if (!saved) return;
      if (THEMES.includes(saved.theme)) settings.theme = saved.theme;
      if (saved.courses && typeof saved.courses === 'object') settings.courses = { ...saved.courses };
      if (['cards', 'list', 'activity'].includes(saved.dash)) settings.dash = saved.dash;
      if (typeof saved.navOpen === 'boolean') settings.navOpen = saved.navOpen;
      if (Array.isArray(saved.calHidden)) settings.calHidden = saved.calHidden.map(Number);
      if (['date', 'type'].includes(saved.asgBy)) settings.asgBy = saved.asgBy;
      if (Array.isArray(saved.todos)) settings.todos = saved.todos.filter((t) => t && typeof t.title === 'string' && t.id != null);
      if (saved.done && typeof saved.done === 'object') settings.done = { ...saved.done };
      if (saved.dismissed && typeof saved.dismissed === 'object') settings.dismissed = { ...saved.dismissed };
      if (typeof saved.showAll === 'boolean') settings.showAll = state.showAll = saved.showAll;
      if (['group', 'due', 'title'].includes(saved.gradeSort)) settings.gradeSort = saved.gradeSort;
      if (typeof saved.gradescope === 'boolean') settings.gradescope = saved.gradescope;
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
  // Brightspace course names carry the term and merge markers ("Fall 2026 CS 18000 - Merge");
  // show the part that identifies the course unless the student chose a nickname.
  const shortName = (name) => name.replace(/^(Fall|Spring|Summer|Winter)\s+\d{4}\s+/i, '').replace(/\s+-\s+Merge$/i, '').trim() || name;
  const nameOf = (c) => settings.courses[c.id]?.nickname || shortName(c.name);

  // ---- the student's own planner items, and ticking things off --------------
  const keyOf = (i) => (i.personal ? `todo-${i.source_id}` : `${i.kind || 'overdue'}-${i.course_id}-${i.source_id ?? i.id}`);
  const isDone = (i) => Boolean(settings.done[keyOf(i)]);
  const isDismissed = (i) => Boolean(settings.dismissed[keyOf(i)]);
  function setFlag(bag, i, on) {
    if (on) settings[bag][keyOf(i)] = 1;
    else delete settings[bag][keyOf(i)];
    saveSettings();
    render();
  }
  // Personal items shaped like assignments so every list can show them.
  const personalItems = (from, to, courseIds) =>
    settings.todos
      .filter((t) => t.due_at && Date.parse(t.due_at) >= from && Date.parse(t.due_at) <= to && (!courseIds || t.course_id == null || courseIds.has(t.course_id)))
      .map((t) => ({ personal: true, kind: 'todo', source_id: t.id, name: t.title, due_at: t.due_at, course_id: t.course_id ?? null, details: t.details || '', link: t.link || '', grade: null, points_possible: null }));

  // The title of a piece of work as a link: the wrapper page for Brightspace work, the
  // outside tool (new tab) for external work, the editor for one of the student's own items.
  function itemLink(i, courses) {
    if (i.personal) return h('button', { class: 't linklike', type: 'button', title: 'Edit', onclick: () => todoDialog(i, courses || []) }, i.name);
    if (i.kind === 'external') return h('a', { class: 't', href: webHref(i.html_url) || '#/', target: '_blank', rel: 'noopener noreferrer', title: `Opens ${i.source}` }, i.name, ' ', ic('external', 13));
    return h('a', { class: 't', href: i.kind ? itemHref(i.course_id, i) : courseHref(i.course_id, 'assignments') }, i.name || i.title);
  }

  // Work in Gradescope for the given courses, when the student has switched that on.
  // Only courses with a Gradescope link in their Content are asked about.
  async function externalWork(courses) {
    if (!settings.gradescope || !BSX.gradescope) return [];
    const has = await Promise.all(courses.map((c) => data.externalTools(c.id).then((tools) => tools.some((t) => /gradescope/i.test(t.title))).catch(() => false)));
    return BSX.gradescope.forCourses(courses.filter((c, n) => has[n]));
  }

  function todoDialog(existing, courses) {
    if (!frame) return;
    const t = existing ? settings.todos.find((x) => x.id === existing.source_id) : null;
    const local = (iso) => {
      const d = iso ? new Date(iso) : new Date(Date.now() + DAY);
      if (!iso) d.setHours(23, 59, 0, 0);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const title = h('input', { class: 'txt', type: 'text', maxlength: '120', value: t?.title || '', required: true });
    const due = h('input', { class: 'txt', type: 'datetime-local', value: local(t?.due_at) });
    const course = h('select', { class: 'txt' }, h('option', { value: '' }, 'None'), courses.map((c) => h('option', { value: String(c.id), selected: t?.course_id === c.id }, nameOf(c))));
    const link = h('input', { class: 'txt', type: 'url', placeholder: 'https://', value: t?.link || '' });
    const details = h('textarea', { class: 'txt', rows: '3', maxlength: '600' }, t?.details || '');
    const close = () => overlay.remove();
    const save = () => {
      if (!title.value.trim() || !due.value) {
        title.focus();
        return;
      }
      const item = { id: t?.id ?? Date.now(), title: title.value.trim(), due_at: new Date(due.value).toISOString(), course_id: course.value ? Number(course.value) : null, link: webHref(link.value.trim()) && link.value.trim() ? link.value.trim() : '', details: details.value.trim() };
      settings.todos = [...settings.todos.filter((x) => x.id !== item.id), item];
      saveSettings();
      close();
      render();
    };
    const remove = () => {
      settings.todos = settings.todos.filter((x) => x.id !== t.id);
      delete settings.done[`todo-${t.id}`];
      saveSettings();
      close();
      render();
    };
    const overlay = h('div', { class: 'modal', onclick: (ev) => ev.target === overlay && close() },
      h('div', { class: 'dialog', role: 'dialog', 'aria-label': t ? 'Edit To Do' : 'Add To Do' },
        h('div', { class: 'trayhead' }, h('h2', null, t ? 'Edit To Do' : 'Add To Do'), h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: close }, ic('close'))),
        h('p', { class: 'muted small', style: 'margin-top:0' }, 'For work that lives outside Brightspace, or anything else you want on your list. Saved in this browser only.'),
        h('label', null, 'Title', title),
        h('label', null, 'Date', due),
        h('label', null, 'Course', course),
        h('label', null, 'Link (optional)', link),
        h('label', null, 'Details', details),
        h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:6px' }, t ? button('Delete', remove) : null, button('Cancel', close), button('Save', save, 'primary'))));
    overlay.addEventListener('keydown', (ev) => ev.key === 'Escape' && close());
    frame.app.append(overlay);
    title.focus();
  }

  // This term's courses; without any, pinned ones; without those, everything.
  function focusCourses(courses) {
    const term = courses.filter((c) => c.current_term);
    if (term.length) return term;
    const pinned = courses.filter((c) => c.pinned);
    return pinned.length ? pinned : courses;
  }

  // ---- links ---------------------------------------------------------------
  const PLURAL = { assignment: 'assignments', quiz: 'quizzes', discussion: 'discussions' };
  const courseHref = (id, section, item) => `#/courses/${id}${section ? `/${section}` : ''}${item != null ? `/${item}` : ''}`;
  // Work read from an outside tool links straight to that tool.
  const itemHref = (courseId, a) => (a.kind === 'external' ? a.html_url : courseHref(courseId, PLURAL[a.kind], a.source_id));
  // A Brightspace address for an assignment or quiz, mapped to the wrapper's page for it.
  function wrapHref(url) {
    try {
      const u = new URL(url, location.origin);
      const ou = u.searchParams.get('ou');
      if (/folder_submit_files\.d2l$/i.test(u.pathname) && ou && u.searchParams.get('db')) return courseHref(ou, 'assignments', u.searchParams.get('db'));
      if (/quizzing\.d2l$/i.test(u.pathname) && ou && u.searchParams.get('qi')) return courseHref(ou, 'quizzes', u.searchParams.get('qi'));
    } catch {}
    return safeHref(url);
  }
  // Original Brightspace pages. Ones the wrapper takes over carry the off-switch hash.
  const bs = {
    home: (id) => `/d2l/home/${id}${OFF}`,
    news: (id) => `/d2l/lms/news/main.d2l?ou=${id}${OFF}`,
    grades: (id) => `/d2l/lms/grades/my_grades/main.d2l?ou=${id}${OFF}`,
    assignments: (id) => `/d2l/lms/dropbox/user/folders_list.d2l?ou=${id}${OFF}`,
    content: (id) => `/d2l/le/content/${id}/Home${OFF}`,
    quizzes: (id) => `/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${id}${OFF}`,
    discussions: (id) => `/d2l/le/${id}/discussions/List${OFF}`,
    classlist: (id) => `/d2l/lms/classlist/classlist.d2l?ou=${id}${OFF}`,
    calendar: (id) => `/d2l/le/calendar/${id}`,
    email: (orgId) => `/d2l/lms/email/frame.d2l${orgId ? `?ou=${orgId}` : ''}`,
  };

  // ---- small building blocks -----------------------------------------------
  const empty = (text) => h('div', { class: 'empty' }, text);
  const tag = (text, cls) => h('span', { class: `tag${cls ? ` ${cls}` : ''}` }, text);
  const button = (label, onclick, cls) => h('button', { class: `btn${cls ? ` ${cls}` : ''}`, type: 'button', onclick }, label);
  const linkButton = (label, href, cls) => h('a', { class: `btn${cls ? ` ${cls}` : ''}`, href }, label);

  // A block that fills in when its data arrives and fails on its own.
  function lazy(promise, build, placeholder = 'Loading…') {
    // An empty placeholder marks an optional block: it takes no room until it has content.
    const optional = placeholder === '';
    const box = h('div', { class: 'muted small pad', hidden: optional }, placeholder);
    promise
      .then((value) => {
        const built = [build(value)].flat(Infinity).filter(Boolean);
        if (optional && !built.length) return;
        box.hidden = false;
        box.className = '';
        box.replaceChildren(...(built.length ? built : [h('div', { class: 'muted small pad' }, 'Nothing for now.')]));
        // A page redrawn in place (ticking an item, changing a setting) keeps its scroll position
        // even though this block arrived after the redraw.
        if (frame && keepScroll != null) frame.main.scrollTop = keepScroll;
      })
      .catch((e) => {
        if (!optional) box.textContent = `Unavailable. ${e.message || e}`;
      });
    return box;
  }
  const sideSection = (title, body) => h('section', { class: 'sidesec' }, h('h2', null, title), body);

  // A text box that filters rows as the user types. `rows` is a list of [element, text].
  function filterBox(placeholder, rows, onCount) {
    const input = h('input', { class: 'txt search', type: 'search', placeholder, 'aria-label': placeholder });
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      for (const [el, text] of rows) {
        const hit = !q || text.toLowerCase().includes(q);
        el.hidden = !hit;
        if (hit) shown++;
      }
      if (onCount) onCount(shown);
    });
    return input;
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

  const views = {};
  const state = { showAll: false, tray: null };
  let frame = null;
  let renderId = 0;
  let lastHash = null;
  let keepScroll = null; // scroll position to hold while late blocks arrive after an in-place redraw
  let keepTimer = 0;
  // The tab title follows the wrapper page. Brightspace sets its own title while the page
  // loads, so remember that one (for when the wrapper is switched off) and put ours back.
  let originalTitle = document.title;
  let ourTitle = null;
  const setTitle = (t) => {
    ourTitle = t;
    document.title = t;
  };
  document.addEventListener('DOMContentLoaded', () => {
    if (document.title === ourTitle) return;
    originalTitle = document.title;
    if (frame && ourTitle) document.title = ourTitle;
  });

  function route() {
    const hash = location.hash;
    if (hash === OFF) return { view: 'off' };
    if (hash === '#/') return { view: 'dashboard', nav: 'dashboard' };
    if (hash === '#/courses') return { view: 'courses', nav: 'courses' };
    if (hash === '#/grades') return { view: 'allgrades', nav: 'dashboard' };
    if (hash === '#/inbox') return { view: 'inbox', nav: 'inbox' };
    let m = hash.match(/^#\/calendar(?:\/(\d{4})-(\d{2}))?$/);
    if (m) return { view: 'calendar', nav: 'calendar', year: m[1] ? Number(m[1]) : null, month: m[2] ? Number(m[2]) - 1 : null };
    m = hash.match(/^#\/courses\/(\d+)(?:\/([a-z]+)(?:\/(\d+))?)?$/);
    if (m && (!m[2] || SECTIONS.includes(m[2]))) return { view: 'course', nav: 'courses', courseId: Number(m[1]), section: m[2] || 'home', itemId: m[3] ? Number(m[3]) : null };
    return { view: 'entry' };
  }

  const reload = () => {
    client.clear();
    if (BSX.gradescope) BSX.gradescope.clear();
    render();
  };
  const turnOff = () => (location.hash = OFF);

  // ---- global navigation and trays ------------------------------------------
  function setTheme(theme) {
    settings.theme = theme;
    saveSettings();
    if (frame) frame.app.setAttribute('data-theme', theme);
    if (state.tray === 'account') openTray('account');
  }

  function trayContent(name) {
    const close = h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: () => openTray(null) }, ic('close'));
    if (name === 'courses') {
      return [
        h('div', { class: 'trayhead' }, h('h2', null, 'Courses'), close),
        lazy(data.courses(), (courses) => [
          focusCourses(courses).map((c) => h('a', { class: 'trayitem', href: courseHref(c.id) }, h('span', { class: 'dot', style: `background:${colorOf(c.id)}` }), h('span', null, h('span', { class: 'tname' }, nameOf(c)), h('span', { class: 'muted small tcode' }, c.course_code)))),
          h('a', { class: 'trayitem all', href: '#/courses' }, 'All Courses'),
        ]),
      ];
    }
    if (name === 'help') {
      const tip = (title, text) => h('div', { class: 'tip' }, h('div', { class: 'tname' }, title), h('div', { class: 'muted small' }, text));
      return [
        h('div', { class: 'trayhead' }, h('h2', null, 'Help'), close),
        tip('What this is', 'A Canvas-style view of your Brightspace courses. It only reads: nothing here can submit work, take a quiz or post.'),
        tip('Doing the work', 'Buttons such as “Start Assignment in Brightspace” open the real Brightspace page for that item.'),
        tip('Work outside Brightspace', 'Use “+ To Do” for Gradescope, publisher sites or anything else. Those items appear in To Do, the list view and the calendar.'),
        tip('Grades', 'A total marked as an estimate is computed here from graded items. It applies each group\'s dropped-score rules but is not official.'),
        tip('Names and colours', 'The ⋮ button on a course card sets a nickname and colour.'),
        tip('Something looks wrong', 'Use Refresh (top right) to reload data, or the Brightspace button to see the original page.'),
        h('button', { class: 'trayitem', type: 'button', onclick: turnOff }, 'Show the original Brightspace page'),
      ];
    }
    const scope = (all, label) => h('button', { type: 'button', class: state.showAll === all ? 'on' : null, onclick: () => { settings.showAll = state.showAll = all; saveSettings(); render(); openTray('account'); } }, label);
    return [
      h('div', { class: 'trayhead' }, h('h2', null, 'Account'), close),
      lazy(data.me(), (me) => h('div', { class: 'who' }, h('div', { class: 'avatar' }, (me.name || '?').slice(0, 1).toUpperCase()), h('div', null, h('div', { class: 'tname' }, me.name), h('div', { class: 'muted small' }, me.login)))),
      h('div', { class: 'traylabel' }, 'Theme'),
      h('div', { class: 'seg' }, THEMES.map((t) => h('button', { type: 'button', class: settings.theme === t ? 'on' : null, onclick: () => setTheme(t) }, t[0].toUpperCase() + t.slice(1)))),
      h('div', { class: 'traylabel' }, 'Courses shown'),
      h('div', { class: 'seg' }, scope(false, 'Current'), scope(true, 'All')),
      h('div', { class: 'traylabel' }, 'Gradescope'),
      h('div', { class: 'seg' }, [false, true].map((on) => h('button', { type: 'button', class: Boolean(settings.gradescope) === on ? 'on' : null, onclick: () => { settings.gradescope = on; saveSettings(); reload(); openTray('account'); } }, on ? 'Read it' : 'Off'))),
      h('p', { class: 'muted small', style: 'margin:8px 4px 0' }, 'When on, courses with a Gradescope link also show your Gradescope assignments, due dates and scores. It reads two Gradescope pages with your own Gradescope sign-in and changes nothing there.'),
      h('div', { class: 'traylabel' }, 'Pages'),
      h('a', { class: 'trayitem', href: '#/grades' }, 'Grades for all courses'),
      h('a', { class: 'trayitem', href: '#/courses' }, 'All Courses'),
      h('button', { class: 'trayitem', type: 'button', onclick: turnOff }, 'Show the original Brightspace page'),
      h('p', { class: 'muted small', style: 'padding:14px 4px 0' }, 'This is a read-only view of your Brightspace data. Submitting work, taking quizzes and posting always happen in Brightspace.'),
    ];
  }

  function openTray(name) {
    state.tray = name;
    if (!frame) return;
    frame.tray.hidden = !name;
    frame.tray.replaceChildren(...(name ? trayContent(name) : []));
    frame.rail.querySelectorAll('[data-tray]').forEach((b) => b.classList.toggle('open', b.dataset.tray === name));
  }

  function buildFrame() {
    const item = (key, href, icon, label) => h('a', { href, 'data-nav': key }, ic(icon, 26), h('span', null, label));
    const trayBtn = (key, icon, label) => h('button', { type: 'button', 'data-nav': key, 'data-tray': key, onclick: () => openTray(state.tray === key ? null : key) }, ic(icon, 26), h('span', null, label));
    const rail = h(
      'nav',
      { class: 'rail', 'aria-label': 'Global navigation' },
      trayBtn('account', 'account', 'Account'),
      item('dashboard', '#/', 'dashboard', 'Dashboard'),
      trayBtn('courses', 'courses', 'Courses'),
      item('calendar', '#/calendar', 'calendar', 'Calendar'),
      item('inbox', '#/inbox', 'inbox', 'Inbox'),
      trayBtn('help', 'help', 'Help'),
      h('span', { class: 'gap' }),
      h('button', { type: 'button', onclick: turnOff, title: 'Show the original Brightspace page' }, ic('swap', 26), h('span', null, 'Brightspace'))
    );
    const tray = h('div', { class: 'tray', hidden: true });
    const main = h('div', { class: 'main' });
    const app = h('div', { class: 'app', 'data-theme': settings.theme }, rail, tray, main);
    app.addEventListener('keydown', (ev) => ev.key === 'Escape' && state.tray && openTray(null));
    main.addEventListener('click', () => state.tray && openTray(null));
    for (const type of ['wheel', 'touchmove', 'keydown']) main.addEventListener(type, () => (keepScroll = null), { passive: true });
    frame = { app, rail, tray, main };
    mount.replaceChildren(app);
    main.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  }

  function pageNodes(page, inPlace) {
    const refresh = h('button', { class: 'iconbtn', type: 'button', title: `Updated ${fmt.time.format(new Date())}. Refresh`, 'aria-label': 'Refresh', onclick: reload }, ic('refresh'));
    let head;
    if (page.crumbs) {
      const toggle = h('button', { class: 'iconbtn', type: 'button', 'aria-label': settings.navOpen ? 'Hide course navigation' : 'Show course navigation', onclick: () => { settings.navOpen = !settings.navOpen; saveSettings(); render(); } }, ic('menu', 24));
      const trail = page.crumbs.map((c, i) => [i ? h('span', { class: 'sep' }, ic('right', 14)) : null, c.href && i < page.crumbs.length - 1 ? h('a', { href: c.href }, c.label) : h('span', { class: 'here' }, c.label)]);
      head = h('div', { class: 'crumbs' }, toggle, h('div', { class: 'trail' }, trail), page.actions, refresh);
    } else {
      head = h('div', { class: 'head' }, h('h1', null, page.title), page.actions, refresh);
    }
    return [
      head,
      h('div', { class: inPlace ? 'layout still' : 'layout' }, page.leftNav && settings.navOpen ? page.leftNav : null, h('div', { class: 'content' }, page.body), page.side ? h('aside', { class: 'right' }, page.side) : null),
    ];
  }

  function errorBox(e) {
    const signedOut = e && (e.status === 401 || e.status === 403);
    return h('div', { class: 'error' },
      h('p', { style: 'margin-top:0' }, signedOut ? 'Brightspace did not accept the request. Your session has probably expired: sign in to Brightspace again, then try again.' : `Could not load this page. ${e && e.message ? e.message : e}`),
      h('div', { class: 'row' }, button('Try again', reload), button('Show the original Brightspace page', turnOff)));
  }

  // ---- render loop ---------------------------------------------------------
  async function render() {
    const id = ++renderId;
    const r = route();

    if (r.view === 'off') {
      frame = null;
      ourTitle = null;
      if (originalTitle) document.title = originalTitle;
      mount.replaceChildren(h('button', { class: 'pill', type: 'button', onclick: () => { history.replaceState(null, '', location.pathname + location.search); render(); } }, 'Canvas view'));
      return;
    }
    if (!frame) buildFrame();
    const sameRoute = location.hash === lastHash;
    const scroll = sameRoute ? frame.main.scrollTop : 0;
    if (!sameRoute && state.tray) openTray(null);
    frame.rail.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === r.nav));

    try {
      // Arriving on a Brightspace URL: pick the wrapper page that stands in for it.
      if (r.view === 'entry') {
        const courses = entry.id ? await data.courses() : [];
        const known = courses.some((c) => c.id === entry.id);
        let target;
        if (entry.kind === 'home') target = known ? courseHref(entry.id) : '#/';
        else target = known ? courseHref(entry.id, entry.kind) : OFF;
        history.replaceState(null, '', target);
        return render();
      }
      const page = await views[r.view](r);
      if (id !== renderId) return;
      frame.main.replaceChildren(...pageNodes(page, sameRoute));
      frame.main.scrollTop = scroll;
      keepScroll = sameRoute ? scroll : null;
      clearTimeout(keepTimer);
      keepTimer = setTimeout(() => (keepScroll = null), 4000);
      lastHash = location.hash;
      setTitle(page.crumbs ? page.crumbs.slice().reverse().map((c) => c.label).join(': ') : page.title);
      try {
        sessionStorage.setItem(LAST, location.pathname + location.search + location.hash);
      } catch {}
    } catch (e) {
      if (id === renderId && frame) frame.main.replaceChildren(errorBox(e));
    }
  }

  function start() {
    window.addEventListener('hashchange', render);
    // Pages draw first from the answers saved on the last visit; when Brightspace's real
    // answers differ, redraw in place, unless the student is typing or has a dialog open.
    client.onChange(() => {
      const busy = root.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(root.activeElement.tagName);
      if (!busy && !root.querySelector('.modal, .wi.changed') && route().view !== 'off') render();
    });
    loadSettings().then(render);
  }

  return {
    h, ic, safeHref, cleanHtml, prose, plainOf, clip, num, pct, fmt, when, dayKey, bytes, DAY, COLORS,
    settings, saveSettings, colorOf, nameOf, focusCourses, state,
    keyOf, isDone, isDismissed, setFlag, personalItems, todoDialog, itemLink, externalWork,
    courseHref, itemHref, wrapHref, bs, PLURAL,
    empty, tag, button, linkButton, lazy, sideSection, filterBox,
    views, render, reload, start,
  };
})();
