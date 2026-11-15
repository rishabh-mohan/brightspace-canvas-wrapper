// Layer 3, part 2: dashboard (card, list and activity views), all courses, all grades.
(() => {
  const ui = BSX.ui;
  if (!ui) return;
  const { data } = BSX;
  const { h, ic, settings, state, colorOf, nameOf, when, num, pct, courseHref, itemHref, COLORS } = ui;
  const KIND_ICON = { assignment: 'assignment', quiz: 'quiz', discussion: 'discussion', todo: 'note', external: 'external' };
  let editing = null; // id of the course card whose nickname and colour are being edited
  let listSeen = false; // the list view scrolls to today once per visit
  window.addEventListener('hashchange', () => (listSeen = false));

  // ---- sidebar shared by the dashboard and course home ----------------------
  const titleOf = (i, courses) => ui.itemLink(i, courses);
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
    // Outside work counts as to-do while it has no submission; two weeks back for overdue.
    const outside = ui.externalWork(courseList).then((items) => items.filter((i) => i.due_at && !i.submitted && !i.grade && Date.parse(i.due_at) >= now - 14 * ui.DAY && Date.parse(i.due_at) <= now + 14 * ui.DAY)).catch(() => []);
    const todo = Promise.all([data.todo(courseList), data.overdue().catch(() => []), outside]).then(([upcoming, late, ext]) => [
      [...upcoming, ...ext.filter((i) => Date.parse(i.due_at) >= now)],
      [...late, ...ext.filter((i) => Date.parse(i.due_at) < now)],
    ]);
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
          h('div', { class: 'tmid' },
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
    const outside = ui.externalWork(courses).then((list) => list.filter((i) => i.due_at && Date.parse(i.due_at) >= from && Date.parse(i.due_at) <= to)).catch(() => []);
    return ui.lazy(Promise.all([data.planner(courses, from, to), outside]), ([fetched, ext]) => {
      const items = [...fetched, ...ext, ...ui.personalItems(from, to, null)].sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
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
            const settled = Boolean(i.grade) || Boolean(i.submitted); // Brightspace or the outside tool already says so
            const done = settled || ui.isDone(i);
            const check = h('button', { class: done ? 'pcheck done' : 'pcheck', type: 'button', disabled: settled, title: i.grade ? 'Graded' : i.submitted ? 'Submitted' : done ? 'Marked done. Click to undo' : 'Mark as done', 'aria-label': `${done ? 'Done' : 'Not done'}: ${i.name}`, onclick: () => ui.setFlag('done', i, !ui.isDone(i)) }, done ? ic('check', 14) : null);
            return h('div', { class: done ? 'prow isdone' : 'prow', style: `--c:${tint(i.course_id)}` },
              check,
              h('span', { class: 'pic' }, ic(KIND_ICON[i.kind] || 'assignment', 22)),
              h('div', { class: 'pmid' }, h('div', { class: 'ctx' }, i.course_id == null ? 'My To Do' : names.get(i.course_id) || ''), titleOf(i, courses)),
              i.source ? ui.tag(i.source) : null,
              i.grade ? ui.tag('Graded', 'okt') : i.submitted ? ui.tag('Submitted', 'okt') : null,
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

  ui.activityView = activityView; // also a course's own Recent Activity

  // ---- Tasks panel ---------------------------------------------------------
  // A week of work in the sidebar, after the open-source Tasks for Canvas extension
  // (MIT, github.com/jtcheng26/canvas-task-extension), rebuilt here on Brightspace data: a
  // progress bar per course, then Unfinished and Completed lists. Work counts as done
  // once it is graded above zero, handed in, attempted, posted in or ticked off.
  const taskView = { week: 0, tab: 'unfinished' };
  function weekRange(offset) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + offset * 7);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return [start, end];
  }

  function tasksPanel(courses) {
    const [start, end] = weekRange(taskView.week);
    const label = taskView.week === 0 ? 'This week' : taskView.week === -1 ? 'Last week' : taskView.week === 1 ? 'Next week' : `${ui.fmt.short.format(start)} – ${ui.fmt.short.format(new Date(end - 1))}`;
    const shift = (d) => () => { taskView.week += d; ui.render(); };
    const head = h('div', { class: 'tkhead' },
      h('button', { class: 'iconbtn xs', type: 'button', 'aria-label': 'Previous week', onclick: shift(-1) }, ic('left', 16)),
      h('span', { class: 'tkweek' }, label),
      h('button', { class: 'iconbtn xs', type: 'button', 'aria-label': 'Next week', onclick: shift(1) }, ic('right', 16)));
    const add = h('button', { class: 'iconbtn xs', type: 'button', title: 'Add task', 'aria-label': 'Add task', onclick: () => ui.todoDialog(null, courses) }, ic('plus', 16));

    const mine = ui.personalItems(start.getTime(), end.getTime(), null).map((t) => ({ ...t, done: ui.isDone(t) }));
    const outside = ui.externalWork(courses).then((items) => items.filter((i) => i.due_at && Date.parse(i.due_at) >= start && Date.parse(i.due_at) < end).map((i) => ({ ...i, done: Boolean(i.submitted || i.grade) || ui.isDone(i) }))).catch(() => []);
    const all = Promise.all([data.tasks(courses, start.getTime(), end.getTime() - 1), outside]).then(([work, ext]) =>
      [...work.map((a) => ({ ...a, done: a.done || ui.isDone(a) })), ...ext, ...mine].filter((i) => !ui.isDismissed(i)).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at)));

    const body = ui.lazy(all, (items) => {
      // One bar per course with work this week, in the course's colour.
      const byCourse = new Map();
      for (const i of items) {
        const k = i.course_id ?? 0;
        if (!byCourse.has(k)) byCourse.set(k, { done: 0, total: 0 });
        const c = byCourse.get(k);
        c.total++;
        if (i.done) c.done++;
      }
      const names = new Map(courses.map((c) => [c.id, nameOf(c)]));
      const done = items.filter((i) => i.done).length;
      const bars = [...byCourse.entries()].map(([id, c]) => h('div', { class: 'tkbar', title: `${id ? names.get(id) || '' : 'My tasks'}: ${c.done} of ${c.total} done` },
        h('div', { class: 'tkfill', style: `width:${c.total ? (c.done / c.total) * 100 : 0}%;background:${id ? colorOf(id) : 'var(--muted)'}` })));
      const summary = h('div', { class: 'tksum' }, h('span', { class: 'tkbig' }, items.length ? `${Math.round((done / items.length) * 100)}%` : '–'), h('span', { class: 'muted small' }, items.length ? `${done} of ${items.length} done` : 'Nothing due'));

      const list = items.filter((i) => (taskView.tab === 'completed' ? i.done : !i.done));
      const tab = (key, text, n) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(taskView.tab === key), class: taskView.tab === key ? 'on' : null, onclick: () => { taskView.tab = key; ui.render(); } }, `${text} (${n})`);
      const row = (i) => {
        const late = !i.done && Date.parse(i.due_at) < Date.now();
        const tick = h('button', { class: i.done ? 'pcheck done' : 'pcheck', type: 'button', 'aria-pressed': String(i.done), 'aria-label': i.done ? `Mark ${i.name || i.title} not done` : `Mark ${i.name || i.title} done`, onclick: () => ui.setFlag('done', i, !i.done) }, i.done ? ic('check', 14) : null);
        return h('div', { class: 'tkrow', style: `--c:${i.course_id == null ? 'var(--muted)' : colorOf(i.course_id)}` },
          tick,
          h('div', { class: 'tmid' }, ui.itemLink(i, courses), h('div', { class: 'ctx', style: `--c:${i.course_id == null ? 'var(--muted)' : colorOf(i.course_id)}` }, i.course_id == null ? 'My task' : names.get(i.course_id) || ''),
            h('div', { class: late ? 'm bad' : 'm' }, [late ? 'Missing · ' : '', ui.when(i.due_at), i.points_possible != null ? ` · ${num(i.points_possible)} pts` : ''].join(''))));
      };
      return [
        h('div', { class: 'tkprog' }, summary, h('div', { class: 'tkbars' }, bars)),
        h('div', { class: 'seg tktabs', role: 'tablist' }, tab('unfinished', 'Unfinished', items.length - done), tab('completed', 'Completed', done)),
        list.length ? list.map(row) : h('div', { class: 'muted small pad' }, taskView.tab === 'completed' ? 'Nothing finished yet this week.' : 'All done for this week.'),
      ];
    });
    return ui.sideSection(['Tasks', add], [head, body]);
  }

  // ---- pages ---------------------------------------------------------------
  ui.views.dashboard = async () => {
    const courses = await data.courses();
    const focus = ui.focusCourses(courses);
    const visible = state.showAll ? courses : focus;
    const mode = settings.dash;
    // Canvas's "Dashboard Options" menu: the three views, and the colour overlay on cards.
    const pick = (key, label) => ({ label, on: mode === key, onclick: () => { settings.dash = key; listSeen = false; ui.saveSettings(); ui.render(); } });
    const overlay = settings.overlay !== false;
    const actions = [
      h('button', { class: 'btn', type: 'button', onclick: () => ui.todoDialog(null, visible) }, ic('plus', 16), 'To Do'),
      ui.menu('Dashboard Options', [
        { label: 'Tasks Panel', on: Boolean(settings.tasks), onclick: () => { settings.tasks = !settings.tasks; ui.saveSettings(); ui.render(); } },
        null,
        pick('cards', 'Card View'), pick('list', 'List View'), pick('activity', 'Recent Activity'),
        mode === 'cards' ? null : undefined,
        mode === 'cards' ? { label: 'Color Overlay', on: overlay, onclick: () => { settings.overlay = !overlay; ui.saveSettings(); ui.render(); } } : undefined,
        // Brightspace course images are wide banners; wide cards show them uncropped.
        mode === 'cards' ? { label: 'Wide Cards', on: Boolean(settings.wideCards), onclick: () => { settings.wideCards = !settings.wideCards; ui.saveSettings(); ui.render(); } } : undefined,
      ].filter((x) => x !== undefined)),
    ];
    const toggle = focus.length < courses.length
      ? h('div', { class: 'small', style: 'margin-top:20px' }, h('a', { href: '#/', onclick: (ev) => { ev.preventDefault(); settings.showAll = state.showAll = !state.showAll; ui.saveSettings(); ui.render(); } }, state.showAll ? 'Show current courses only' : `Show all ${courses.length} courses`))
      : null;

    let body;
    if (mode === 'list') body = listView(visible);
    else if (mode === 'activity') body = activityView(visible);
    else body = visible.length ? h('div', { class: 'cards' }, visible.map(card)) : ui.empty('No current courses found.');
    // With the Tasks panel on, it takes the To Do list's place at the top of the sidebar.
    const side = mode === 'list' ? null : settings.tasks ? [tasksPanel(visible), ...ui.todoSide(visible).slice(1)] : ui.todoSide(visible);
    return { title: 'Dashboard', actions, body: [body, toggle], side };
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

  // Canvas's Groups page: each group you belong to, its course and category, and members
  // where Brightspace lets a student see them.
  ui.views.groups = async () => {
    const courses = await data.courses();
    const list = await data.groups(courses);
    const byCourse = new Map(courses.map((c) => [c.id, c]));
    const card = (g) => {
      const c = g.course_id != null ? byCourse.get(g.course_id) : null;
      const members = g.member_ids && c
        ? ui.lazy(data.people(c.id), (people) => {
            const names = new Map(people.map((p) => [String(p.id), p.name]));
            const shown = g.member_ids.map((id) => names.get(id)).filter(Boolean);
            return shown.length ? h('div', { class: 'members' }, shown.map((n) => h('span', { class: 'member' }, h('span', { class: 'avatar xs' }, n.slice(0, 1).toUpperCase()), n))) : null;
          }, '')
        : null;
      return h('div', { class: 'gcard', style: c ? `--c:${colorOf(c.id)}` : null },
        h('div', { class: 'gtop' },
          h('span', { class: 'avatar' }, ic('groups', 22)),
          h('div', { class: 'imid' },
            h('div', { class: 't' }, g.name),
            h('div', { class: 'muted small' }, [c ? h('a', { href: courseHref(c.id) }, nameOf(c)) : 'Course not shown to students', g.category ? ` · ${g.category}` : null, g.member_ids ? ` · ${g.member_ids.length} member${g.member_ids.length === 1 ? '' : 's'}` : null])),
          h('a', { class: 'btn', href: `/d2l/lms/group/user_group_list.d2l?ou=${g.course_id ?? g.id}`, title: 'Open groups in Brightspace' }, 'Brightspace ', ic('external', 14))),
        g.description ? h('p', { class: 'muted small' }, ui.clip(g.description, 220)) : null,
        members);
    };
    return {
      title: 'Groups',
      body: list.length
        ? [h('p', { class: 'muted small' }, `You belong to ${list.length} group${list.length === 1 ? '' : 's'}.`), h('div', { class: 'gcards' }, list.map(card))]
        : ui.empty('You are not in any groups.'),
    };
  };

  // Brightspace mail cannot be read from here, so the Inbox is a doorway to it, with the
  // messages instructors did send through Brightspace (announcements) listed underneath.
  ui.views.inbox = async () => {
    const courses = await data.courses();
    const visible = state.showAll ? courses : ui.focusCourses(courses);
    const names = new Map(courses.map((c) => [c.id, nameOf(c)]));
    const org = await data.orgId().catch(() => null);
    const mail = ui.bs.email(org);
    return {
      title: 'Inbox',
      actions: h('a', { class: 'btn', href: mail, target: '_blank', rel: 'noopener' }, 'Open in a new tab ', ic('external', 14)),
      body: [
        // Brightspace has no interface for reading mail, so its own Email tool is shown in a frame.
        h('iframe', { class: 'viewer', src: mail, title: 'Brightspace Email', loading: 'lazy' }),
        h('p', { class: 'muted small' }, 'This is Brightspace’s own Email tool. If it stays blank, use “Open in a new tab”.'),
        h('h2', { class: 'sect' }, 'Announcements from your instructors'),
        ui.lazy(data.recentAnnouncements(visible, 30), (news) => news.length
          ? h('div', { class: 'rows' }, news.map((a) => h('a', { class: 'arow', href: courseHref(a.course_id, 'announcements', a.id) },
              h('span', { class: 'avatar sm', style: `color:${colorOf(a.course_id)}` }, ic('announcement', 18)),
              h('div', { class: 'imid' }, h('div', { class: 'ctx', style: `--c:${colorOf(a.course_id)}` }, names.get(a.course_id) || ''), h('div', { class: 't' }, a.title), h('div', { class: 'muted small' }, ui.clip(ui.plainOf(a.message_html, a.message), 180))),
              h('div', { class: 'muted small nowrap' }, when(a.posted_at)))))
          : ui.empty('No announcements in the last 30 days.')),
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
