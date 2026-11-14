// Layer 3, part 2: dashboard (card, list and activity views), all courses, all grades.
(() => {
  const ui = BSX.ui;
  if (!ui) return;
  const { data } = BSX;
  const { h, ic, settings, state, colorOf, nameOf, when, num, pct, courseHref, itemHref, COLORS } = ui;
  const KIND_ICON = { assignment: 'assignment', quiz: 'quiz', discussion: 'discussion', todo: 'note' };
  let editing = null; // id of the course card whose nickname and colour are being edited
  let listSeen = false; // the list view scrolls to today once per visit
  window.addEventListener('hashchange', () => (listSeen = false));

  // ---- sidebar shared by the dashboard and course home ----------------------
  // A title that opens the wrapper page for an item, or the editor for one of the student's own.
  function titleOf(i, courses) {
    if (i.personal) return h('button', { class: 't linklike', type: 'button', title: 'Edit', onclick: () => ui.todoDialog(i, courses) }, i.name);
    return h('a', { class: 't', href: i.kind ? itemHref(i.course_id, i) : courseHref(i.course_id, 'assignments') }, i.name || i.title);
  }
  const tint = (id) => (id == null ? 'var(--muted)' : colorOf(id));

  function todoRow(i, courseLabel, late, courses) {
    const points = i.points_possible != null ? `${num(i.points_possible)} points · ` : '';
    return h('div', { class: 'todo' },
      h('span', { class: 'todoic', style: `color:${tint(i.course_id)}` }, ic(KIND_ICON[i.kind] || 'assignment')),
      h('div', { class: 'tmid' },
        titleOf(i, courses),
        courseLabel ? h('div', { class: 'ctx', style: `--c:${tint(i.course_id)}` }, courseLabel) : null,
        h('div', { class: late ? 'm bad' : 'm' }, late ? `Overdue · was due ${when(i.due_at)}` : `${points}${when(i.due_at)}`)),
      h('button', { class: 'iconbtn xs', type: 'button', title: 'Dismiss', 'aria-label': `Dismiss ${i.name || i.title}`, onclick: () => ui.setFlag('dismissed', i, true) }, ic('close', 14)));
  }

  // To Do (overdue first), Recent Feedback, and a grades button.
  // With `only`, the lists are limited to that one course (used on course pages).
  ui.todoSide = (courseList, { labels = true, gradesHref = '#/grades', only = null } = {}) => {
    const ids = new Set(courseList.map((c) => c.id));
    const names = new Map(courseList.map((c) => [c.id, nameOf(c)]));
    const label = (id) => (labels ? (id == null ? 'My To Do' : names.get(id) || '') : '');
    const now = Date.now();
    const open = (i) => !ui.isDone(i) && !ui.isDismissed(i) && (only == null || i.course_id === only);
    const mine = ui.personalItems(now - 60 * ui.DAY, now + 14 * ui.DAY, null).filter(open);
    const todo = Promise.all([data.todo(courseList), data.overdue().catch(() => [])]);
    const add = h('button', { class: 'iconbtn xs', type: 'button', title: 'Add To Do', 'aria-label': 'Add To Do', onclick: () => ui.todoDialog(null, courseList) }, ic('plus', 16));
    return [
      ui.sideSection(['To Do', add], ui.lazy(todo, ([upcoming, late]) => {
        const lateRows = [...late.filter((i) => ids.has(i.course_id)), ...mine.filter((i) => Date.parse(i.due_at) < now)].filter(open).slice(0, 6).map((i) => todoRow(i, label(i.course_id), true, courseList));
        const coming = [...upcoming, ...mine.filter((i) => Date.parse(i.due_at) >= now)].filter(open).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
        const rows = coming.slice(0, 8).map((i) => todoRow(i, label(i.course_id), false, courseList));
        const more = coming.length > 8 ? h('div', { class: 'muted small pad' }, `${coming.length - 8} more`) : null;
        return [lateRows, rows, more];
      }, 'Loading…')),
      ui.sideSection('Recent Feedback', ui.lazy(data.recentFeedback(courseList), (rows) =>
        rows.slice(0, 5).map((f) => h('div', { class: 'todo' },
          h('span', { class: 'todoic ok' }, ic('check')),
          h('div', null,
            h('a', { class: 't', href: courseHref(f.course_id, 'grades') }, f.title),
            labels ? h('div', { class: 'ctx', style: `--c:${colorOf(f.course_id)}` }, names.get(f.course_id) || '') : null,
            h('div', { class: 'm' }, `${num(f.grade.score)} out of ${num(f.grade.points_possible)}`),
            f.grade.comment ? h('div', { class: 'm quote' }, `“${ui.clip(f.grade.comment, 90)}”`) : null))))),
      ui.linkButton('View Grades', gradesHref, 'wide'),
    ];
  };

  // ---- cards ---------------------------------------------------------------
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
      ui.saveSettings();
      editing = null;
      ui.render();
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
      h('div', { class: 'row' }, ui.button('Apply', save, 'primary'), ui.button('Reset', () => done(null)), ui.button('Cancel', () => { editing = null; ui.render(); })));
  }

  function card(c) {
    const img = h('img', { src: c.image_url, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.remove());
    const name = nameOf(c);
    const badge = (pick) => {
      const b = h('span', { class: 'badge', hidden: true });
      data.updates(c.id).then((u) => {
        const n = pick(u);
        if (n > 0) {
          b.textContent = n > 99 ? '99+' : String(n);
          b.hidden = false;
        }
      }).catch(() => {});
      return b;
    };
    const action = (section, icon, label, pick) => h('a', { class: 'cardic', href: courseHref(c.id, section), title: label, 'aria-label': `${label} - ${name}` }, ic(icon, 22), pick ? badge(pick) : null);
    const body = editing === c.id
      ? cardEditor(c)
      : [
          h('a', { class: 'text', href: courseHref(c.id), title: name === c.name ? name : `${name} (${c.name})` }, h('span', { class: 'name', style: `--c:${colorOf(c.id)}` }, name), h('span', { class: 'code' }, c.course_code)),
          h('div', { class: 'cardics' },
            action('announcements', 'announcement', 'Announcements'),
            action('assignments', 'assignment', 'Assignments', (u) => u.feedback),
            action('discussions', 'discussion', 'Discussions', (u) => u.discussions),
            action('files', 'file', 'Files')),
        ];
    return h('div', { class: 'card' },
      h('a', { class: 'hero', href: courseHref(c.id), style: `background:${colorOf(c.id)}`, 'aria-label': name }, img),
      h('button', { class: 'more', type: 'button', title: 'Nickname and colour', 'aria-label': `Nickname and colour for ${name}`, onclick: () => { editing = editing === c.id ? null : c.id; ui.render(); } }, ic('dots', 20)),
      body);
  }

  // ---- list view (planner) ---------------------------------------------------
  function listView(courses) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const names = new Map(courses.map((c) => [c.id, nameOf(c)]));
    const from = start.getTime() - 7 * ui.DAY;
    const to = start.getTime() + 28 * ui.DAY;
    return ui.lazy(data.planner(courses, from, to), (fetched) => {
      const items = [...fetched, ...ui.personalItems(from, to, null)].sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
      if (!items.length) return ui.empty('Nothing due in the last week or the next four.');
      const days = new Map();
      for (const i of items) {
        const d = new Date(i.due_at);
        const k = ui.dayKey(d);
        if (!days.has(k)) days.set(k, { date: d, items: [] });
        days.get(k).items.push(i);
      }
      const todayKey = ui.dayKey(new Date());
      const tomorrowKey = ui.dayKey(new Date(Date.now() + ui.DAY));
      const sections = [...days.entries()].map(([k, day]) =>
        h('section', { class: k === todayKey ? 'pday today' : 'pday', 'data-at': String(day.date.getTime()) },
          h('h2', null, k === todayKey ? 'Today' : k === tomorrowKey ? 'Tomorrow' : ui.fmt.day.format(day.date), k === todayKey || k === tomorrowKey ? h('span', { class: 'muted' }, ` ${ui.fmt.day.format(day.date)}`) : null),
          day.items.map((i) => {
            const done = Boolean(i.grade) || ui.isDone(i);
            const check = h('button', { class: done ? 'pcheck done' : 'pcheck', type: 'button', disabled: Boolean(i.grade), title: i.grade ? 'Graded' : done ? 'Marked done. Click to undo' : 'Mark as done', 'aria-label': `${done ? 'Done' : 'Not done'}: ${i.name}`, onclick: () => ui.setFlag('done', i, !ui.isDone(i)) }, done ? ic('check', 14) : null);
            return h('div', { class: done ? 'prow isdone' : 'prow', style: `--c:${tint(i.course_id)}` },
              check,
              h('span', { class: 'pic' }, ic(KIND_ICON[i.kind] || 'assignment', 22)),
              h('div', { class: 'pmid' }, h('div', { class: 'ctx' }, i.course_id == null ? 'My To Do' : names.get(i.course_id) || ''), titleOf(i, courses)),
              i.grade ? ui.tag('Graded', 'okt') : null,
              h('div', { class: 'pend' }, i.grade ? h('div', null, `${num(i.grade.score)} / ${num(i.grade.points_possible)}`) : i.points_possible != null ? h('div', null, `${num(i.points_possible)} pts`) : null, h('div', { class: 'muted' }, `${i.personal ? '' : 'Due '}${ui.fmt.time.format(new Date(i.due_at))}`)));
          })));
      // Open on today (or the next day with work), the way a planner does.
      if (!listSeen) {
        listSeen = true;
        const target = sections.find((s) => Number(s.dataset.at) >= start.getTime());
        if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 0);
      }
      return sections;
    });
  }

  // ---- recent activity -------------------------------------------------------
  function activityView(courses) {
    const names = new Map(courses.map((c) => [c.id, nameOf(c)]));
    return ui.lazy(Promise.all([data.recentAnnouncements(courses, 21), data.recentFeedback(courses, 21)]), ([news, feedback]) => {
      const rows = [
        ...news.map((a) => ({ at: a.posted_at, icon: 'announcement', title: a.title, href: courseHref(a.course_id, 'announcements', a.id), course: a.course_id, kind: 'Announcement', text: ui.clip(ui.plainOf(a.message_html, a.message), 160) })),
        ...feedback.map((f) => ({ at: f.grade.graded_at, icon: 'check', title: f.title, href: courseHref(f.course_id, 'grades'), course: f.course_id, kind: 'Grade', text: `${num(f.grade.score)} out of ${num(f.grade.points_possible)}${f.grade.comment ? ` · ${ui.clip(f.grade.comment, 100)}` : ''}` })),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      if (!rows.length) return ui.empty('No recent announcements or grades.');
      return h('div', { class: 'stream' }, rows.map((r) => h('div', { class: 'srow' },
        h('span', { class: 'todoic', style: `color:${colorOf(r.course)}` }, ic(r.icon, 22)),
        h('div', { class: 'pmid' }, h('div', { class: 'ctx', style: `--c:${colorOf(r.course)}` }, `${r.kind} · ${names.get(r.course) || ''}`), h('a', { class: 't', href: r.href }, r.title), r.text ? h('div', { class: 'muted small' }, r.text) : null),
        h('div', { class: 'muted small nowrap' }, when(r.at)))));
    });
  }

  // ---- pages ---------------------------------------------------------------
  ui.views.dashboard = async () => {
    const courses = await data.courses();
    const focus = ui.focusCourses(courses);
    const visible = state.showAll ? courses : focus;
    const mode = settings.dash;
    const pick = (key, label) => h('button', { type: 'button', class: mode === key ? 'on' : null, onclick: () => { settings.dash = key; listSeen = false; ui.saveSettings(); ui.render(); } }, label);
    const actions = [
      h('button', { class: 'btn', type: 'button', onclick: () => ui.todoDialog(null, visible) }, ic('plus', 16), 'To Do'),
      h('div', { class: 'seg' }, pick('cards', 'Card View'), pick('list', 'List View'), pick('activity', 'Recent Activity')),
    ];
    const toggle = focus.length < courses.length
      ? h('div', { class: 'small', style: 'margin-top:20px' }, h('a', { href: '#/', onclick: (ev) => { ev.preventDefault(); settings.showAll = state.showAll = !state.showAll; ui.saveSettings(); ui.render(); } }, state.showAll ? 'Show current courses only' : `Show all ${courses.length} courses`))
      : null;

    let body;
    if (mode === 'list') body = listView(visible);
    else if (mode === 'activity') body = activityView(visible);
    else body = visible.length ? h('div', { class: 'cards' }, visible.map(card)) : ui.empty('No current courses found.');
    return { title: 'Dashboard', actions, body: [body, toggle], side: mode === 'list' ? null : ui.todoSide(visible) };
  };

  ui.views.courses = async () => {
    const courses = await data.courses();
    const table = (list) => h('table', { class: 'grid' },
      h('thead', null, h('tr', null, h('th', null, 'Course'), h('th', null, 'Nickname'), h('th', null, 'Code'))),
      h('tbody', null, list.map((c) => h('tr', null,
        h('td', null, h('span', { class: 'dot', style: `background:${colorOf(c.id)}` }), ' ', h('a', { href: courseHref(c.id) }, c.name)),
        h('td', null, settings.courses[c.id]?.nickname || ''),
        h('td', { class: 'muted' }, c.course_code)))));
    const term = courses.filter((c) => c.current_term);
    const other = courses.filter((c) => !c.current_term);
    return {
      title: 'All Courses',
      body: [
        term.length ? [h('h2', { class: 'sect' }, 'This term'), table(term)] : null,
        other.length ? [h('h2', { class: 'sect' }, term.length ? 'Other courses' : 'Courses'), table(other)] : null,
        courses.length ? null : ui.empty('No courses found.'),
      ],
    };
  };

  ui.views.allgrades = async () => {
    const courses = await data.courses();
    const visible = state.showAll ? courses : ui.focusCourses(courses);
    const totals = await data.courseTotals(visible);
    const byId = new Map(totals.map((t) => [t.course_id, t]));
    const cell = (t) => {
      if (t?.final) return [h('strong', null, t.final.displayed || pct(t.final.score, t.final.points_possible))];
      if (t?.estimate) return [h('strong', null, pct(t.estimate.score, t.estimate.points_possible)), ui.tag('estimate')];
      return [h('span', { class: 'muted' }, 'Not released')];
    };
    return {
      title: 'Courses I’m Taking',
      body: [
        h('table', { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, 'Course'), h('th', { class: 'num' }, 'Grade'))),
          h('tbody', null, visible.map((c) => h('tr', null, h('td', null, h('span', { class: 'dot', style: `background:${colorOf(c.id)}` }), ' ', h('a', { href: courseHref(c.id, 'grades') }, nameOf(c))), h('td', { class: 'num' }, cell(byId.get(c.id))))))),
        h('p', { class: 'muted small' }, 'Estimates are computed from graded items, ignore dropped-score rules and are not official.'),
      ],
    };
  };
})();
