// Calendar export: upcoming deadlines and calendar events as an iCalendar
// (.ics, RFC 5545) file that Google Calendar, Outlook and Apple Calendar can import.
// The generator (build, escape, fold, uid, ...) is plain functions so tests can run it without
// a browser (tests/ics.test.js); gathering the events and the dialog need the wrapper (BSX.ui).
//
// Choices:
// - Times are written in UTC (…Z), so no VTIMEZONE is needed. All-day events use the event's
//   local date (DTSTART;VALUE=DATE) and end the next day (DTEND is exclusive).
// - A deadline has no length: DTEND equals DTSTART, as Canvas's and D2L's own feeds write it
//   (Outlook handles a missing DTEND inconsistently).
// - UIDs come only from what identifies an item (its source, course and id), never from its
//   title or time, so importing a newer export updates events instead of duplicating them.
(function (root) {
  const BSX = (root.BSX = root.BSX || {});
  const DOMAIN = 'brightspace-canvas-wrapper';
  const PRODID = '-//Brightspace Canvas Wrapper//Calendar export//EN';
  const DAY = 864e5;

  // ---- the generator (no browser needed) -----------------------------------
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));

  // TEXT values: backslash, semicolon and comma escaped, every line break as \n, and other
  // control characters (not allowed in TEXT) dropped.
  const escape = (s) =>
    String(s ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\\;,]/g, (c) => `\\${c}`)
      .replace(/\n/g, '\\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');

  // Lines longer than 75 octets (UTF-8 bytes) are folded: continuation lines start with one
  // space. A break never falls inside a character (multi-byte or surrogate pair).
  const octets = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
  function fold(line) {
    const out = [];
    let cur = '';
    let size = 0;
    for (const ch of String(line)) {
      const n = octets(ch.codePointAt(0));
      if (size + n > 75) {
        out.push(cur);
        cur = ' ';
        size = 1;
      }
      cur += ch;
      size += n;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  const unfold = (text) => String(text).replace(/\r\n[ \t]/g, '');

  const utc = (t) => {
    const d = new Date(toMs(t));
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };
  // The local calendar date of an instant, as [year, month (0-11), day]. A bare "YYYY-MM-DD"
  // is taken as written (Date.parse would read it as UTC midnight, the day before in the US).
  function localDay(t) {
    const m = typeof t === 'string' && t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    const d = new Date(toMs(t));
    return [d.getFullYear(), d.getMonth(), d.getDate()];
  }
  const ymd = ([y, m, d]) => {
    const x = new Date(y, m, d); // normalises day overflow (the 32nd is the 1st of next month)
    return `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
  };

  // A UID from an item's stable identity (e.g. "assignment-123-456"). Letters, digits, '.' and
  // '-' are kept; everything else (underscore included) is percent-encoded with '_' for '%', so
  // two different keys never give the same UID.
  const uid = (key) => {
    const enc = encodeURIComponent(String(key ?? '')).replace(/[_!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%/g, '_');
    return `bsx-${enc || 'item'}@${DOMAIN}`;
  };

  // The identity of a Brightspace calendar event: the assignment, quiz or topic it belongs to
  // when it has one (its event can be replaced when dates change), else the event's own id.
  function calKey(e) {
    if (e.associated && e.html_url) {
      try {
        const u = new URL(e.html_url, 'https://brightspace.invalid');
        const q = u.searchParams;
        const ou = q.get('ou') || e.course_id;
        if (q.get('db')) return `assignment-${ou}-${q.get('db')}`;
        if (q.get('qi')) return `quiz-${ou}-${q.get('qi')}`;
        const topic = u.pathname.match(/\/topics\/(\d+)/i) || [null, q.get('topicId')];
        if (topic[1]) return `discussion-${ou}-${topic[1]}`;
        const query = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}-${v}`).join('-');
        return `link-${ou}-${u.pathname}${query ? `-${query}` : ''}`;
      } catch {}
    }
    return `cal-${e.course_id}-${e.id}`;
  }

  // events: [{ key, title, start, end?, allDay?, location?, description?, url?, courseName? }]
  // (start and end as ms, Date or ISO text). Returns the .ics text, CRLF line endings.
  function build(events, { now = Date.now(), calName = 'Brightspace deadlines' } = {}) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escape(calName)}`];
    const stamp = utc(now);
    const seen = new Set();
    for (const e of events || []) {
      if (!e || e.start == null || Number.isNaN(toMs(e.start))) continue;
      const id = uid(e.key);
      if (seen.has(id)) continue; // one event per item: a re-import must not meet two with one UID
      seen.add(id);
      lines.push('BEGIN:VEVENT', `UID:${id}`, `DTSTAMP:${stamp}`);
      if (e.allDay) {
        const first = localDay(e.start);
        // Whole days covered, at least one; rounding absorbs ends that aren't at local midnight
        // (23:59, or midnight in another time zone) and daylight-saving changes.
        const days = e.end != null ? Math.max(1, Math.round((toMs(e.end) - toMs(e.start)) / DAY) || 1) : 1;
        lines.push(`DTSTART;VALUE=DATE:${ymd(first)}`, `DTEND;VALUE=DATE:${ymd([first[0], first[1], first[2] + days])}`);
      } else {
        lines.push(`DTSTART:${utc(e.start)}`);
        lines.push(`DTEND:${utc(e.end != null && toMs(e.end) > toMs(e.start) ? e.end : e.start)}`);
      }
      lines.push(`SUMMARY:${escape(e.courseName ? `${e.courseName}: ${e.title || ''}` : e.title || '')}`);
      if (e.location) lines.push(`LOCATION:${escape(e.location)}`);
      // Google Calendar ignores URL, so the link goes in the description too.
      const desc = [e.description, e.url].filter(Boolean).join('\n\n');
      if (desc) lines.push(`DESCRIPTION:${escape(desc)}`);
      if (e.url) lines.push(`URL:${String(e.url).replace(/[\r\n]/g, '')}`);
      if (e.courseName) lines.push(`CATEGORIES:${escape(e.courseName)}`);
      // Deadlines and all-day notes don't make the student busy; events with a length do.
      if (e.allDay || !(e.end != null && toMs(e.end) > toMs(e.start))) lines.push('TRANSP:TRANSPARENT');
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(fold).join('\r\n')}\r\n`;
  }

  const api = { build, escape, fold, unfold, uid, calKey, utc, localDay, ymd, DOMAIN, PRODID };
  BSX.ics = api;
  if (typeof module === 'object' && module.exports) module.exports = api;

  // ---- gathering and the dialog (inside the wrapper) -----------------------
  const ui = BSX.ui;
  if (!ui || !ui.h) return;
  const { data } = BSX;
  const { h, ic, state } = ui;
  const abs = (url) => {
    if (!url) return '';
    try {
      const u = new URL(url, location.origin);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch {
      return '';
    }
  };
  const plain = (html) => (html ? (ui.plainOf ? ui.plainOf(html) : String(html)) : '');

  // The same events the Calendar shows (ui-calendar.js), for the given courses and range:
  // Brightspace's calendar (assignments, quizzes, discussions and other events), the student's
  // own To Do items, and Gradescope and Ed work. Returns normalized events for build().
  async function gather({ courses, from, to, todos = true }) {
    const ids = courses.map((c) => c.id);
    const name = new Map(courses.map((c) => [c.id, ui.nameOf ? ui.nameOf(c) : c.name]));
    const courseName = (id) => (id == null ? '' : name.get(id) || '');
    // Brightspace's calendar in windows the size the Calendar asks for (a month grid).
    const windows = [];
    for (let t = from; t < to; t += 42 * DAY) windows.push([t, Math.min(to, t + 42 * DAY)]);
    const fetched = (await Promise.all(windows.map(([a, b]) => data.calendar(ids, a, b)))).flat();
    // An item seen in two windows (its open date in one, its due date in another) keeps the latest.
    const cal = new Map();
    for (const e of fetched) {
      const k = calKey(e);
      const end = (x) => Date.parse(x.end_at || x.start_at || 0);
      if (!cal.has(k) || end(e) > end(cal.get(k))) cal.set(k, e);
    }
    const out = [...cal.entries()].map(([key, e]) => ({
      key,
      title: e.title,
      start: e.start_at,
      end: e.end_at,
      allDay: e.all_day,
      location: e.location,
      description: plain(e.description),
      url: abs(e.html_url),
      courseName: courseName(e.course_id) || e.context_name || '',
    }));

    if (todos && ui.personalItems) {
      for (const t of ui.personalItems(from, to, new Set(ids))) {
        out.push({ key: `todo-${t.source_id}`, title: t.name, start: t.due_at, allDay: false, description: t.details, url: abs(t.link), courseName: courseName(t.course_id) });
      }
    }

    const outside = ui.externalWork ? await ui.externalWork(courses).catch(() => []) : [];
    for (const i of outside) {
      const t = i.due_at ? Date.parse(i.due_at) : NaN;
      if (!(t >= from && t <= to)) continue;
      out.push({ key: `ext-${i.source_id || `${i.source}-${i.html_url}`}`, title: `${i.name} (${i.source})`, start: i.due_at, allDay: false, url: abs(i.html_url), courseName: courseName(i.course_id) });
    }
    return out.sort((a, b) => toMs(a.start) - toMs(b.start));
  }

  function download(text, filename = 'brightspace-deadlines.ics') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = h('a', { href: url, download: filename, style: 'display:none' });
    (ui.appEl && ui.appEl() || document.body).append(a);
    a.click();
    // Kept for a minute: Firefox may show a save dialog before it reads the file (as zip.js does).
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  }

  const say = (text, kind) => (ui.flash ? ui.flash(text, kind) : null);

  // The export dialog: which courses, whether To Do, and how far ahead.
  function dialog(courses) {
    const app = ui.appEl ? ui.appEl() : null;
    if (!app) return;
    const dot = (color) => h('span', { class: 'dot', style: `background:${color}` });
    const row = (...kids) => h('label', { class: 'calrow', style: 'display:flex;font-weight:400;font-size:14.5px' }, ...kids);
    const boxes = courses.map((c) => [c, h('input', { type: 'checkbox', checked: true })]);
    const mine = h('input', { type: 'checkbox', checked: true });
    const range = h('select', { class: 'txt' },
      h('option', { value: '30' }, 'The next 30 days'),
      h('option', { value: '120', selected: true }, 'The next 4 months'),
      h('option', { value: '365' }, 'The next 12 months'));
    const close = () => overlay.remove();
    const go = h('button', { class: 'btn primary', type: 'button' }, 'Download');
    go.addEventListener('click', async () => {
      const picked = boxes.filter(([, b]) => b.checked).map(([c]) => c);
      go.disabled = true;
      go.textContent = 'Preparing…';
      try {
        const today = new Date();
        // From a week back, so work just past due stays on the calendar after a re-import.
        const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7).getTime();
        const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(range.value) + 1).getTime();
        const events = await gather({ courses: picked, from, to, todos: mine.checked });
        if (!events.length) {
          say('Nothing to export for those courses and dates.', 'bad');
          go.disabled = false;
          go.textContent = 'Download';
          return;
        }
        download(build(events, { now: Date.now(), calName: 'Brightspace deadlines' }));
        close();
        say(`Exported ${events.length} event${events.length === 1 ? '' : 's'} to brightspace-deadlines.ics.`);
      } catch (err) {
        go.disabled = false;
        go.textContent = 'Download';
        say(`Couldn’t export the calendar: ${(err && err.message) || err}`, 'bad');
      }
    });
    const overlay = h('div', { class: 'modal', onclick: (ev) => ev.target === overlay && close(), onkeydown: (ev) => ev.key === 'Escape' && (ev.stopPropagation(), close()) },
      h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Export calendar' },
        h('div', { class: 'trayhead' }, h('h2', null, 'Export calendar (.ics)'), h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: close }, ic('close'))),
        h('p', { class: 'muted small', style: 'margin:0' }, 'Google Calendar, Outlook and Apple Calendar can import this file (Google: Settings → Import & export). Re-importing updates events rather than duplicating them. It is a one-time snapshot; export again to pick up changes.'),
        // Calendar-style rows (the dialog's own label style stacks a label over its field).
        h('div', null,
          h('div', { class: 'traylabel', style: 'margin-top:0' }, 'Include'),
          boxes.map(([c, box]) => row(box, dot(ui.colorOf ? ui.colorOf(c.id) : 'var(--muted)'), h('span', null, ui.nameOf ? ui.nameOf(c) : c.name))),
          row(mine, dot('var(--muted)'), h('span', null, 'My To Do'))),
        h('label', null, 'Dates', range),
        h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:6px' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), go)));
    app.append(overlay);
    go.focus();
  }

  // The courses the Calendar lists (this term's, or all with "Courses shown: All").
  const listedCourses = async () => {
    const courses = await data.courses();
    return state.showAll ? courses : ui.focusCourses(courses);
  };
  const open = (courses) => (courses ? Promise.resolve(courses) : listedCourses()).then(dialog).catch((err) => say(`Couldn’t open the export: ${(err && err.message) || err}`, 'bad'));

  // The Calendar's three-dot menu (beside Refresh), holding "Export .ics".
  const button = (courses) => ui.menu('More calendar options', [{ label: 'Export .ics', onclick: () => open(courses) }]);

  Object.assign(api, { gather, download, dialog, button });
  ui.icsButton = button;
  (ui.accountHooks ||= []).push(() => [
    h('div', { class: 'traylabel' }, 'Calendar export'),
    // The tray sits above dialogs, so it closes first (as its own rail button would close it).
    h('button', { class: 'trayitem', type: 'button', onclick: () => { ui.appEl()?.querySelector('.rail [data-tray="account"].open')?.click(); open(); } }, ic('calendar', 18), ' Download deadlines (.ics)'),
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : this);
