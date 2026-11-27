// What's new since the last visit, per course: new announcements, grades and feedback, new
// assignments, quizzes and discussions, changed due dates, and new or updated module content.
// Each course keeps a small snapshot in extension storage (ids, due dates, change stamps and grade
// scores only; feedback comments as a short hash, no titles or text); the current data is compared
// with it. "Mark seen" replaces a course's snapshot with what was shown. A course seen for the
// first time is only recorded, so the first visit lists nothing. Everything is worked out from
// answers the wrapper already loads (and keeps), so it adds no requests beyond each course's
// announcements and content, and those wait until the page has been drawn.
// The diff is plain functions, so tests run them without a browser (tests/whatsnew.test.js);
// the rest (storage, the Dashboard's card, the Recent Activity section) needs BSX.ui.
(function (root) {
  const SECTION = { assignment: 'assignments', quiz: 'quizzes', discussion: 'discussions' };
  const WORK_LABEL = { assignment: 'New assignment', quiz: 'New quiz', discussion: 'New discussion' };
  // Each kind is its own part: the three come from separate Brightspace tools, and one that fails
  // for a moment must not make the others look new.
  const KIND_PART = { assignment: 'assignments', quiz: 'quizzes', discussion: 'discussions' };
  const LINKED = new Set(['File', 'Link', 'External tool', 'Module overview']); // open in the module viewer
  const ORDER = { news: 0, grade: 1, due: 2, work: 3, content: 4 };
  const PARTS = ['assignments', 'quizzes', 'discussions', 'grades', 'news', 'content'];
  const YEAR = 365 * 864e5; // courses not marked seen for longer are dropped (and seeded again)
  const ms = (iso) => (iso ? Date.parse(iso) : NaN);
  const low = (s) => String(s || '').trim().toLowerCase();

  // ---- snapshot and diff (pure) ----------------------------------------------
  // `parts` holds a course's current data, each list or null when it could not be read:
  //   work: data.assignments(ou)   grades: data.recentFeedback rows   news: data.announcements(ou)
  //   modules: data.modules(ou)
  // FNV-1a (32-bit): a comment is kept only as this, enough to notice it changed.
  function fnv(s) {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return x.toString(16).padStart(8, '0');
  }
  const HASHED = /^(#[0-9a-f]{8})?$/; // the comment part of a signature: empty or a hash
  const sigParts = (sig) => {
    const p = String(sig).split('|');
    return { score: p[0], displayed: p[1] || '', comment: p.slice(2).join('|') };
  };
  const gradeSig = (g) => `${g.score ?? ''}|${g.displayed || ''}|${g.comment ? `#${fnv(g.comment)}` : ''}`;
  // A signature stored before comments were hashed holds the comment itself: hash it.
  const upgradeSig = (sig) => {
    const p = sigParts(sig);
    return HASHED.test(p.comment) ? String(sig) : `${p.score}|${p.displayed}|#${fnv(p.comment)}`;
  };
  // Same grade? An old-style signature (comment not hashed) is compared on the score alone.
  const sameGrade = (was, sig) => was === sig || (!HASHED.test(sigParts(was).comment) && sigParts(was).score === sigParts(sig).score);

  const contentItems = (modules) => (modules || []).flatMap((m) => (m.items || []).map((i) => ({ ...i, module: m.name })));
  const workOf = (kind) => (p) => p.work && Object.fromEntries(p.work.filter((a) => a.kind === kind).map((a) => [String(a.id), a.due_at || '']));
  const builders = {
    assignments: workOf('assignment'),
    quizzes: workOf('quiz'),
    discussions: workOf('discussion'),
    grades: (p) => p.grades && Object.fromEntries(p.grades.filter((r) => r.grade).map((r) => [String(r.id), gradeSig(r.grade)])),
    news: (p) => p.news && Object.fromEntries(p.news.map((n) => [String(n.id), 1])),
    content: (p) => p.modules && Object.fromEntries(contentItems(p.modules).map((i) => [String(i.id), i.updated_at || ''])),
  };
  // A part that comes back empty when the snapshot had entries is taken as unreadable (a tool
  // switched off for a moment), not as everything removed, so it cannot flood the list later.
  function current(parts, prev) {
    const out = {};
    for (const name of PARTS) {
      const built = builders[name](parts);
      const had = prev && prev[name];
      out[name] = built && (Object.keys(built).length || !had || !Object.keys(had).length) ? built : null;
    }
    return out;
  }

  // The snapshot to keep for `parts`: what is there now, or the old part where now is unknown.
  function snapshot(parts, prev = null) {
    const now = current(parts, prev);
    const out = {};
    for (const name of PARTS) out[name] = now[name] || (prev && prev[name]) || null;
    return out;
  }

  // What changed in one course since `prev` (its stored snapshot). Parts not recorded in `prev`
  // yet, or unreadable now, give nothing.
  function diff(courseId, prev, parts) {
    if (!prev) return [];
    const now = current(parts, prev);
    const items = [];
    const seen = new Set();
    const add = (it) => {
      it.course_id = courseId;
      it.key = `${it.type}:${courseId}:${it.ref}`;
      if (seen.has(it.key)) return;
      seen.add(it.key);
      items.push(it);
    };
    const work = parts.work || [];
    if (now.news && prev.news) {
      for (const n of parts.news) if (!(String(n.id) in prev.news)) add({ type: 'news', ref: n.id, label: 'Announcement', title: n.title, at: n.posted_at || null, section: 'announcements', item: n.id });
    }
    if (now.grades && prev.grades) {
      const byGradeItem = new Map(work.filter((a) => a.grade_item_id != null && a.kind !== 'discussion').map((a) => [String(a.grade_item_id), a]));
      for (const r of parts.grades) {
        if (!r.grade) continue;
        const was = prev.grades[String(r.id)];
        const sig = gradeSig(r.grade);
        if (was != null && sameGrade(was, sig)) continue;
        const label = was == null ? 'New grade' : sigParts(was).score !== String(r.grade.score ?? '') ? 'Grade changed' : 'New feedback';
        const a = byGradeItem.get(String(r.id));
        add({ type: 'grade', ref: r.id, label, title: r.title, at: r.grade.graded_at || null, score: r.grade.score ?? null, points_possible: r.grade.points_possible ?? null, comment: r.grade.comment || '', section: a ? SECTION[a.kind] : 'grades', item: a ? a.source_id : null });
      }
    }
    for (const a of work) {
      const part = KIND_PART[a.kind];
      if (!part || !now[part] || !prev[part]) continue;
      const was = prev[part];
      const id = String(a.id);
      const link = { section: SECTION[a.kind], item: a.source_id };
      if (!(id in was)) add({ type: 'work', ref: id, label: WORK_LABEL[a.kind], title: a.name, at: null, kind: a.kind, new_due: a.due_at || null, ...link });
      else if ((was[id] || '') !== (a.due_at || '') && ms(was[id]) !== ms(a.due_at)) {
        add({ type: 'due', ref: id, label: a.due_at ? (was[id] ? 'Due date changed' : 'Due date set') : 'Due date removed', title: a.name, at: null, kind: a.kind, old_due: was[id] || null, new_due: a.due_at || null, ...link });
      }
    }
    if (now.content && prev.content) {
      // A module entry that is the same assignment, quiz or discussion as one in the work list is
      // left to the work list (as search does).
      const workKeys = new Set(work.map((a) => `${a.kind}:${low(a.name)}`));
      for (const i of contentItems(parts.modules)) {
        if (workKeys.has(`${low(i.type)}:${low(i.title)}`)) continue;
        const id = String(i.id);
        const link = LINKED.has(i.type) ? { section: 'modules', item: i.id } : { url: i.html_url || null, section: 'modules', item: null };
        if (!(id in prev.content)) add({ type: 'content', ref: id, label: 'New in Modules', title: i.title, module: i.module, at: i.updated_at || null, ...link });
        // Only against a recorded stamp: one Brightspace starts giving later is not an update.
        else if (i.updated_at && prev.content[id] && ms(i.updated_at) > ms(prev.content[id])) add({ type: 'content', ref: id, label: 'Updated in Modules', title: i.title, module: i.module, at: i.updated_at, ...link });
      }
    }
    return items.sort((a, b) => ORDER[a.type] - ORDER[b.type] || (ms(b.at) || 0) - (ms(a.at) || 0));
  }

  // ---- stored state (pure) -------------------------------------------------------
  // { courses: { [ou]: { at, assignments, quizzes, discussions, grades, news, content } } }; `at`
  // is when it was last marked seen. Older stored forms are brought up to date here: one `work`
  // map for all kinds is split by id prefix (a kind with no entries there is recorded again,
  // silently), and grade signatures holding a comment get it hashed. Courses not marked seen for a
  // year are dropped.
  const isMap = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  function parseState(raw, now = Date.now()) {
    const out = { courses: {} };
    if (!isMap(raw) || !isMap(raw.courses)) return out;
    for (const [id, e] of Object.entries(raw.courses)) {
      if (!isMap(e) || typeof e.at !== 'number' || now - e.at > YEAR) continue;
      const entry = { at: e.at };
      for (const name of PARTS) entry[name] = isMap(e[name]) ? e[name] : null;
      if (isMap(e.work)) {
        for (const [kind, part] of Object.entries(KIND_PART)) {
          if (entry[part]) continue;
          const old = Object.fromEntries(Object.entries(e.work).filter(([k]) => k.startsWith(`${kind}-`)));
          entry[part] = Object.keys(old).length ? old : null;
        }
      }
      if (entry.grades) entry.grades = Object.fromEntries(Object.entries(entry.grades).map(([k, v]) => [k, upgradeSig(v)]));
      out.courses[id] = entry;
    }
    return out;
  }

  // Two pages (tabs) keep their own copy: per course the one marked seen later wins, and a part
  // it lacks is taken from the other.
  function merge(mine, theirs) {
    const out = { courses: { ...theirs.courses } };
    for (const [id, e] of Object.entries(mine.courses)) {
      const t = theirs.courses[id];
      if (!t) {
        out.courses[id] = e;
        continue;
      }
      const [win, lose] = e.at >= t.at ? [e, t] : [t, e];
      const entry = { ...win };
      for (const name of PARTS) entry[name] = win[name] || lose[name] || null;
      out.courses[id] = entry;
    }
    return out;
  }

  // One course on a visit: the new items, and whether the state changed (a course or a part
  // recorded for the first time, or a change stamp given for the first time, which show nothing).
  function step(state, courseId, parts, now = Date.now()) {
    const prev = state.courses[courseId];
    if (!prev) {
      state.courses[courseId] = { at: now, ...snapshot(parts) };
      return { items: [], changed: true, seeded: true };
    }
    const items = diff(courseId, prev, parts);
    let changed = false;
    const fill = snapshot(parts, prev);
    for (const name of PARTS) {
      if (!prev[name] && fill[name]) {
        prev[name] = fill[name];
        changed = true;
      }
    }
    const stamps = current(parts, prev).content;
    if (stamps && prev.content) {
      for (const [id, at] of Object.entries(stamps)) {
        if (at && prev.content[id] === '') {
          prev.content[id] = at;
          changed = true;
        }
      }
    }
    return { items, changed, seeded: false };
  }

  // The given courses (id -> parts) are seen as they are now.
  function markSeen(state, byCourse, now = Date.now()) {
    for (const [id, parts] of byCourse) state.courses[id] = { at: now, ...snapshot(parts, state.courses[id] || null) };
    return state;
  }

  // Keys the Recent Activity stream already shows above it, as `news:<ou>:<id>` and `grade:<ou>:<id>`.
  const listed = (items) => new Set(items.filter((i) => i.type === 'news' || i.type === 'grade').map((i) => `${i.type}:${i.course_id}:${i.ref}`));

  const pure = { snapshot, diff, parseState, merge, step, markSeen, listed, fnv };
  if (typeof module === 'object' && module.exports) {
    module.exports = pure;
    return;
  }

  // ---- browser side ---------------------------------------------------------------
  const BSX = (root.BSX = root.BSX || {});
  const store = (root.browser || root.chrome)?.storage?.local;
  const KEY = `bsxSeen:${root.location?.host || ''}`;
  let state = { courses: {} };
  let firstVisit = false; // nothing was stored when this page opened
  let saveTimer = null;
  let epoch = 0; // bumped by forget(), so reads and writes begun before it are dropped
  const ready = (async () => {
    const at = epoch;
    let raw = null;
    try {
      raw = (await store.get(KEY))?.[KEY];
    } catch {}
    if (at !== epoch) return;
    state = parseState(raw);
    firstVisit = !Object.keys(state.courses).length;
    // Brought up to date or pruned: write the new form back (no comment text stays stored).
    if (isMap(raw) && isMap(raw.courses) && JSON.stringify(raw.courses) !== JSON.stringify(state.courses)) save();
  })();
  // Another page may have saved since: merge with what is stored, then write.
  function save() {
    clearTimeout(saveTimer);
    const at = epoch;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        const stored = parseState((await store.get(KEY))?.[KEY]);
        if (at !== epoch) return;
        state.courses = merge(state, stored).courses;
        await store.set({ [KEY]: state });
      } catch {}
    }, 300);
  }
  // Signed out: drop the snapshot held here (client.forget removes the stored one).
  function forget() {
    clearTimeout(saveTimer);
    saveTimer = null;
    epoch++;
    state = { courses: {} };
    firstVisit = true;
    memo.clear();
  }

  // The first fetches wait until the page is drawn and the browser is idle (once per page).
  let idle = null;
  const settled = () =>
    idle ||
    (idle = new Promise((resolve) => {
      const later = () => (root.requestIdleCallback ? root.requestIdleCallback(() => resolve(), { timeout: 2000 }) : setTimeout(resolve, 300));
      if (root.requestAnimationFrame) root.requestAnimationFrame(later);
      else later();
    }));

  // Each course's result is shared by its card's badge, the Dashboard card and Recent Activity,
  // and worked out again once Brightspace's fresh answers arrive.
  const memo = new Map(); // course id -> { at, promise }
  const MEMO = 10e3;
  if (BSX.client) BSX.client.onChange(() => memo.clear()); // registered before the page's redraw
  const gather = async (c) => {
    const { data } = BSX;
    const [work, grades, news, modules] = await Promise.all([
      data.assignments(c.id).catch(() => null),
      data.recentFeedback([c], 3650).catch(() => null),
      data.announcements(c.id).catch(() => null),
      data.modules(c.id).catch(() => null),
    ]);
    return { work, grades, news, modules };
  };
  function forCourse(c) {
    const hit = memo.get(c.id);
    if (hit && Date.now() - hit.at < MEMO) return hit.promise;
    const promise = (async () => {
      await ready;
      await settled();
      const parts = await gather(c);
      const r = step(state, c.id, parts); // items keep the course id as the page has it (for names and colours)
      if (r.changed) save();
      return { course: c, parts, items: r.items, since: state.courses[c.id].at };
    })();
    memo.set(c.id, { at: Date.now(), promise });
    promise.catch(() => memo.delete(c.id));
    return promise;
  }
  async function load(courses) {
    const per = await Promise.all(courses.map((c) => forCourse(c).catch(() => null)));
    const list = per.filter(Boolean);
    return { first: firstVisit, courses: list, items: list.flatMap((x) => x.items) };
  }
  // Marks seen exactly what was shown: the results the list was drawn from, not a new read.
  function seen(results) {
    markSeen(state, new Map(results.map((x) => [String(x.course.id), x.parts])));
    firstVisit = false;
    memo.clear();
    save();
    BSX.ui.render();
  }

  // ---- rendering --------------------------------------------------------------
  const ICON = { news: 'announcement', grade: 'check', due: 'clock', work: 'assignment', content: 'module' };
  const KIND_ICON = { assignment: 'assignment', quiz: 'quiz', discussion: 'discussion' };
  const hrefOf = (it) => it.url || BSX.ui.courseHref(it.course_id, it.section, it.item);
  function detail(it) {
    const { ui } = BSX;
    if (it.type === 'grade') return `${it.score != null ? `${ui.num(it.score)}${it.points_possible ? ` out of ${ui.num(it.points_possible)}` : ''}` : ''}${it.comment ? `${it.score != null ? ' · ' : ''}“${ui.clip(it.comment, 90)}”` : ''}`;
    if (it.type === 'due') return it.new_due ? `${it.old_due ? `Was ${ui.when(it.old_due)} · now` : 'Due'} ${ui.when(it.new_due)}` : `Was due ${ui.when(it.old_due)}`;
    if (it.type === 'work') return it.new_due ? `Due ${ui.when(it.new_due)}` : '';
    if (it.type === 'content') return it.module || '';
    if (it.type === 'news') return it.at ? ui.when(it.at) : '';
    return '';
  }
  // One entry: icon in the course's colour, kind and course, the title as a link, and a detail line.
  function row(it, names, { labels = true } = {}) {
    const { h, ic, colorOf } = BSX.ui;
    const color = colorOf(it.course_id);
    const sub = detail(it);
    return h('div', { class: 'todo' },
      h('span', { class: 'todoic', style: `color:${color}` }, ic(it.kind && it.type === 'work' ? KIND_ICON[it.kind] || ICON.work : ICON[it.type], 18)),
      h('div', { class: 'tmid' },
        h('a', { class: 't', href: hrefOf(it) }, it.title || '(untitled)'),
        h('div', { class: 'ctx', style: `--c:${color}` }, labels ? `${it.label} · ${names.get(it.course_id) || ''}` : it.label),
        sub ? h('div', { class: 'm' }, sub) : null));
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const markButton = (label, results, title) => BSX.ui.h('button', { class: 'btn small', type: 'button', title, onclick: () => seen(results) }, label);

  // "N new" on a course card, when there is anything.
  function cardBadge(c) {
    const { h } = BSX.ui;
    const tag = h('span', { class: 'tag okt', hidden: true });
    forCourse(c).then((r) => {
      if (!r.items.length) return;
      tag.textContent = `${r.items.length > 99 ? '99+' : r.items.length} new`;
      tag.title = `New since you last marked this course seen: ${[...new Set(r.items.map((i) => i.label))].join(', ')}`;
      tag.hidden = false;
    }).catch(() => {});
    return tag;
  }

  // The Dashboard's compact card: the newest few, Mark all seen, and the rest on Recent Activity.
  const SIDE_LIMIT = 6;
  function side(courses) {
    const { ui } = BSX;
    const { h } = ui;
    const names = new Map(courses.map((c) => [c.id, ui.nameOf(c)]));
    const action = h('span', { class: 'tkact' });
    const body = ui.lazy(load(courses), (r) => {
      if (r.first && !r.items.length) return h('p', { class: 'muted small' }, 'New announcements, grades, work, due-date changes and module content will show here from now on.');
      if (!r.items.length) return h('p', { class: 'muted small' }, 'Nothing new since your last visit.');
      action.replaceChildren(markButton('Mark all seen', r.courses, 'Mark everything here as seen'));
      const more = r.items.length - SIDE_LIMIT;
      const showAll = h('button', { class: 'btn small', type: 'button', onclick: () => { ui.settings.dash = 'activity'; ui.saveSettings(); ui.render(); } }, more > 0 ? `See all ${r.items.length}` : 'See by course');
      return [r.items.slice(0, SIDE_LIMIT).map((it) => row(it, names)), h('div', { class: 'row', style: 'margin-top:8px' }, showAll)];
    }, 'Loading…');
    return ui.sideSection(['What’s New', action], body);
  }

  // The top of Recent Activity: everything new, by course, each with Mark seen.
  const PER_COURSE = 12;
  function section(courses) {
    const { ui } = BSX;
    const { h } = ui;
    const names = new Map(courses.map((c) => [c.id, ui.nameOf(c)]));
    const expanded = new Set();
    return ui.lazy(load(courses), (r) => {
      const head = (extra) => h('div', { class: 'toolbar', style: 'margin:0 0 4px' }, h('h2', { class: 'sect', style: 'margin:0;border:0;padding:0' }, 'New since your last visit'), extra);
      const tail = h('h2', { class: 'sect' }, 'Recent activity'); // the stream below
      if (r.first && !r.items.length) return [head(null), h('p', { class: 'muted small' }, 'From now on, new announcements, grades, assignments and quizzes, changed due dates and new module content will be listed here until you mark them seen.'), tail];
      if (!r.items.length) return [head(null), h('p', { class: 'muted small' }, 'Nothing new since your last visit.'), tail];
      const groups = r.courses.filter((x) => x.items.length).map((x) => {
        const box = h('div');
        const paint = () => {
          const all = expanded.has(x.course.id);
          const shown = all ? x.items : x.items.slice(0, PER_COURSE);
          box.replaceChildren(
            h('div', { class: 'toolbar', style: 'margin:14px 0 0' },
              h('div', null, h('a', { class: 't', href: ui.courseHref(x.course.id), style: `color:${ui.colorOf(x.course.id)}` }, names.get(x.course.id) || x.course.name), h('span', { class: 'muted small' }, ` · ${plural(x.items.length, 'change')} since ${ui.fmt.short.format(new Date(x.since))}`)),
              markButton('Mark seen', [x], `Mark ${names.get(x.course.id) || ''} as seen`)),
            ...shown.map((it) => row(it, names, { labels: false })),
            shown.length < x.items.length ? h('button', { class: 'btn small', type: 'button', style: 'margin-top:6px', onclick: () => { expanded.add(x.course.id); paint(); } }, `Show ${x.items.length - shown.length} more`) : '');
        };
        paint();
        return box;
      });
      return [head(markButton('Mark all seen', r.courses, 'Mark everything here as seen')), groups, tail];
    }, 'Loading…');
  }

  BSX.whatsnew = { ...pure, load, forCourse, seen, forget, cardBadge, side, section };
})(typeof globalThis !== 'undefined' ? globalThis : this);
