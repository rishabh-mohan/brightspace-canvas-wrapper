// Optional reader for Edfinity (edfinity.com), where some courses keep homework that
// Brightspace only lists as an undated LTI link. Off unless the student switches it on.
// Personal use and read-only: the student's own session, in their own browser; nothing is
// sent anywhere except edfinity.com itself.
//
// What Edfinity is (from saved pages, 2026-11): a Rails app with a JSON-backed front end.
// Auth is the _edfinity_session cookie (Partitioned) plus a Rails CSRF meta tag for writes;
// no bearer token. Known data:
//   My Courses JSON    { page, total, pageSize, params: { sort, status }, models: [registration] }
//                      registration: { id, active, section: { id }, readonly: { section_name,
//                      accessible, dropped, expired, closed, ... } }
//   one course JSON    registration plus section_id, name, lms_provider ('d2l'), expires_at
//   assignments JSON   [{ id, name, sort_order, due_date, late_work_date, assignment_due_date,
//                      readonly: { accessible, excused, ... }, assessment?: { due_date,
//                      late_work_date, scored_session, grade } }] (no assessment: never opened)
//   assignment pages   inline <script>: _E.session = JSON.parse('…') (a started assignment) or
//                      _E.assessment = JSON.parse('…') (its start page). The assessment has
//                      assignment { id, name, available_date, due_date, late_work_date },
//                      registration { id, name }, the student's own due_date / late_work_date,
//                      and, once started, grade { status, score, points, pct_complete, ... }.
//
// Two ways in, both under the same optional host permission (https://edfinity.com/*):
//  (a) live: the background script GETs Edfinity's JSON with the student's session
//      (message bsx-edfinity). As the cookie is Partitioned, this probably only works once
//      the student has also signed in at edfinity.com directly.
//  (b) on Edfinity: this same file runs as a content script on edfinity.com (Brightspace's LTI
//      frame included, where the session lives). It reads the assignment the student has open
//      from the page's own data and, at most every 10 minutes, calls the same JSON from the
//      page (so with that session). Kept in storage.local under bsxEdfinity;
//      cleared on sign-out and when the reader is turned off.
globalThis.BSX = globalThis.BSX || {};
BSX.edfinity = (() => {
  const ORIGIN = 'https://edfinity.com';
  const KEY = 'bsxEdfinity';
  const TTL = 5 * 60 * 1000;
  const STALE = 24 * 3600e3; // "Open Edfinity to sync" once the newest copy is older than this
  const API_EVERY = 10 * 60 * 1000; // on Edfinity, the JSON is read at most this often
  const MAX_COURSES = 6; // at most this many course lists per read, one at a time
  // JSON routes (confirmed by the student, 2026-11): /registrations is My Courses,
  // /registrations/ID one course and /registrations/ID/assignments its assignments. The
  // background script only fetches paths that match its own allow-list, which mirrors these.
  const ROUTES = {
    courses: '/registrations',
    assignments: (registrationId) => `/registrations/${registrationId}/assignments`,
  };
  const ext = globalThis.browser || globalThis.chrome;
  const runtime = ext?.runtime;
  const store = ext?.storage?.local;
  const cache = new Map();

  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const iso = (s) => {
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const ID = /^[0-9a-f]{24}$/; // Edfinity ids are Mongo-style hex

  // ---- reading the page's own data (mode b) ----------------------------------
  // A single-quoted JavaScript string literal (as Rails writes it) -> its text.
  function unquote(lit) {
    const ESC = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
    return lit.slice(1, -1).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, e) => {
      if (e[0] === 'u') return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
      if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
      if (e === '\n' || e === '\r\n') return ''; // a line continuation
      return has(ESC, e) ? ESC[e] : e;
    });
  }

  // The texts of a page's inline scripts -> { session?, assessment? } from
  // `_E.session = JSON.parse('…')` and `_E.assessment = JSON.parse('…')`. Never runs them.
  function bootstrap(scripts) {
    const out = {};
    for (const s of scripts) {
      for (const m of String(s || '').matchAll(/_E\.(session|assessment)\s*=\s*JSON\.parse\(('(?:[^'\\]|\\[\s\S])*')\)/g)) {
        try {
          out[m[1]] = JSON.parse(unquote(m[2]));
        } catch {}
      }
    }
    return out;
  }

  // The page's data -> { kind: 'assignment', course, assignment } for the one it shows, or null.
  function fromBootstrap(boot) {
    const a = boot.session?.assessment || boot.assessment;
    if (!a || !a.assignment || !a.registration?.id) return null;
    const course = { id: String(a.registration.id), name: clean(a.registration.name || a.assignment.section?.name), section_id: String(a.section_id || a.assignment.section?.id || '') };
    return { kind: 'assignment', course, assignment: fromAssessment(a) };
  }

  // ---- JSON -> plain records (tested against scrubbed real answers) -----------
  // An assessment (the student's copy of an assignment) -> an assignment record. Its own
  // dates come first: they include extensions (override_availability, extra_time_awarded).
  function fromAssessment(a) {
    return fromAssignment(a.assignment, a.grade, { due_date: a.due_date, late_work_date: a.late_work_date, available_date: a.available_date, status: a.readonly?.status, excused: a.readonly?.excused });
  }

  // assignment { id, name, due_date, late_work_date, available_date } and the student's
  // grade { status, score, override_score, points, pct_complete, displayed_score_pct,
  // excused, show_scores } -> { id, name, due_at, late_due_at, available_at, score, max,
  // displayed, status, submitted }. `own` holds the student's own dates and status, when known.
  // Grade status words seen so far: 'not started', 'completed'.
  function fromAssignment(asg, grade, own = {}) {
    const g = grade || {};
    let status = clean(g.status || (own.status !== 'open' ? own.status : '')).toLowerCase();
    const excused = Boolean(g.excused || own.excused);
    const pct = num(g.pct_complete);
    const started = Boolean(status && status !== 'not started') || num(g.num_submitted) > 0;
    const shown = started && g.show_scores !== false; // the instructor can hide scores
    const done = excused || (pct != null && pct >= 100) || (/\b(complete|completed|submitted|graded|scored|finished|done)\b/.test(status) && !/\bnot\b|\bin\b/.test(status));
    const score = num(g.override_score) ?? num(g.score);
    const max = num(g.points) ?? null;
    if (excused) status = 'excused';
    const id = String(asg.id);
    return {
      id,
      name: clean(asg.name) || 'Edfinity assignment',
      due_at: iso(own.due_date || asg.due_date),
      late_due_at: iso(own.late_work_date || asg.late_work_date),
      available_at: iso(own.available_date || asg.available_date),
      score: shown && score != null ? score : null,
      max,
      displayed: shown && num(g.displayed_score_pct) != null ? `${num(g.displayed_score_pct)}%` : '',
      status: cap(status) || (done ? 'Completed' : 'Not started'),
      submitted: done,
    };
  }

  // My Courses JSON -> { kind: 'courses', courses: [{ id, section_id, name }] }, current ones only.
  function fromRegistrations(json) {
    const courses = (json?.models || [])
      .filter((r) => r && r.id && r.active !== false && !r.readonly?.dropped && !r.readonly?.expired && r.readonly?.accessible !== false)
      .map((r) => ({ id: String(r.id), section_id: String(r.section?.id || r.section_id || ''), name: clean(r.readonly?.section_name || r.name) }));
    return { kind: 'courses', courses };
  }
  // One course JSON -> { kind: 'course', course }.
  const fromRegistration = (r) => ({ kind: 'course', course: { id: String(r.id), section_id: String(r.section_id || r.section?.id || ''), name: clean(r.name || r.readonly?.section_name) } });

  // A course's assignments JSON (/registrations/ID/assignments) -> { kind: 'assignments',
  // course, assignments } in Edfinity's order (sort_order). Per entry: the student's own dates
  // (assessment, then the entry's due_date, which include extensions) win over the
  // assignment's; status and score come from assessment.grade (points from scored_session when
  // missing). No assessment means never opened. `live` and `readonly.released` are not about
  // being open (every entry in the sample, open or not, had live false; released turns true
  // after the due date), so only entries marked not accessible are left out.
  function fromAssignmentList(json, course) {
    const list = Array.isArray(json) ? json : json?.models;
    if (!Array.isArray(list)) return null; // not a list (an error answer): keep what was known
    const assignments = list
      .map((e, n) => ({ e, n, at: num(e?.sort_order) ?? Infinity }))
      .filter(({ e }) => e && e.id && (e.name || e.assessment?.readonly?.name) && e.readonly?.accessible !== false)
      .sort((x, y) => x.at - y.at || x.n - y.n)
      .map(({ e }) => {
        const s = e.assessment || {};
        const ss = s.scored_session;
        const grade = s.grade ? { ...s.grade, points: s.grade.points ?? ss?.points, show_scores: s.grade.show_scores ?? ss?.environment?.show_scores } : null;
        return fromAssignment(
          { id: e.id, name: e.name || s.readonly?.name, due_date: e.assignment_due_date, available_date: e.assignment_available_date },
          grade,
          { due_date: s.due_date || e.due_date, late_work_date: s.late_work_date || e.late_work_date, available_date: s.available_date || e.available_date, excused: e.readonly?.excused },
        );
      });
    return { kind: 'assignments', course, assignments };
  }

  // ---- matching Edfinity courses to Brightspace courses ---------------------
  // Subject and number, e.g. "STAT350" from "STAT 350 FALL 2026 (In-person)", "STAT 35000" or
  // "wl.202710.STAT.35000.001".
  const subjectKey = (s) => {
    const m = String(s || '').toUpperCase().match(/\b([A-Z]{2,5})[\s.]?(\d{3})(\d{2})?\b/);
    return m ? m[1] + m[2] : null;
  };

  // Edfinity course (registration) id -> Brightspace course. The student's own choice in `map`
  // wins (0 hides the course); then the same subject and number; then, as a last resort, the
  // one Edfinity course left over goes with the one Brightspace course left that links to
  // Edfinity (withTool: ids of courses with an Edfinity link in Content).
  function pair(edCourses, bsCourses, { map = {}, withTool = [] } = {}) {
    const out = new Map();
    const taken = new Set();
    const left = [];
    for (const e of edCourses) {
      const id = String(e.id);
      if (has(map, id)) {
        const chosen = Number(map[id]);
        const b = chosen ? bsCourses.find((c) => c.id === chosen) : null;
        if (b) {
          out.set(id, b);
          taken.add(b.id);
        }
        continue;
      }
      const key = subjectKey(e.name);
      const b = key && bsCourses.find((c) => !taken.has(c.id) && (subjectKey(c.course_code) === key || subjectKey(c.name) === key));
      if (!b) {
        left.push(e);
        continue;
      }
      out.set(id, b);
      taken.add(b.id);
    }
    const tooled = bsCourses.filter((c) => withTool.includes(c.id) && !taken.has(c.id));
    if (left.length === 1 && tooled.length === 1) out.set(String(left[0].id), tooled[0]);
    return out;
  }

  // Assignments of one Edfinity course -> external items for its Brightspace course.
  function itemsFor(edCourse, assignments, bsCourse) {
    return (assignments || []).filter((a) => a && a.name).map((a, n) => ({
      kind: 'external',
      source: 'Edfinity',
      source_id: `edf-${edCourse.id}-${a.id}`,
      course_id: bsCourse.id,
      name: a.name,
      due_at: a.due_at || null,
      late_due_at: a.late_due_at || null,
      points_possible: a.max ?? null,
      grade: a.score != null ? { score: a.score, points_possible: a.max ?? null, displayed: a.displayed || '', comment: '', graded_at: null } : null,
      submitted: Boolean(a.submitted),
      status: a.status || 'Not started',
      order: [0, n], // the order of Edfinity's own list
      html_url: link(edCourse.id, a.id),
    }));
  }
  // The page that opens an assignment (as the student's own Edfinity links do); My Courses
  // when the ids do not look like Edfinity's.
  const link = (reg, asg) =>
    ID.test(String(reg)) && ID.test(String(asg)) ? `${ORIGIN}/assessments/new?registration_id=${reg}&assignment_id=${asg}` : `${ORIGIN}/registrations`;

  // ---- what has been seen ----------------------------------------------------
  // { v: 2, courses: [{ id, section_id, name }], courses_at, api_at,
  //   lists: { id: { at, full_at, assignments } } }
  // Adds one reading to a snapshot. Returns a new snapshot, or the old one when the reading
  // had nothing to keep. A full list replaces the course's list; one assignment is updated in it.
  function mergeSnapshot(old, r, now = Date.now()) {
    const base = old && old.v === 2 ? old : { v: 2, courses: [], courses_at: null, api_at: null, lists: {} };
    const snap = { ...base, courses: [...base.courses], lists: { ...base.lists } };
    const addCourse = (c) => {
      const i = snap.courses.findIndex((x) => x.id === c.id);
      const next = { id: c.id, section_id: c.section_id || '', name: c.name || '' };
      if (i < 0) snap.courses.push(next);
      else snap.courses[i] = { ...snap.courses[i], ...Object.fromEntries(Object.entries(next).filter(([, v]) => v)) };
    };
    if (r?.kind === 'courses' && r.courses.length) {
      snap.courses = [];
      r.courses.slice(0, 50).forEach(addCourse);
      snap.courses_at = now;
    } else if (r?.kind === 'course' && r.course?.id) addCourse(r.course);
    else if (r?.kind === 'assignments' && r.course?.id) {
      addCourse(r.course);
      snap.lists[r.course.id] = { at: now, full_at: now, assignments: r.assignments.slice(0, 300) };
    } else if (r?.kind === 'assignment' && r.course?.id && r.assignment) {
      addCourse(r.course);
      const l = snap.lists[r.course.id] || { at: now, full_at: null, assignments: [] };
      const list = l.assignments.filter((a) => a.id !== r.assignment.id);
      const at = l.assignments.findIndex((a) => a.id === r.assignment.id);
      list.splice(at < 0 ? list.length : at, 0, r.assignment);
      snap.lists[r.course.id] = { ...l, at: now, assignments: list.slice(0, 300) };
    } else return old || null;
    for (const [id, l] of Object.entries(snap.lists)) if (now - l.at > 180 * 864e5) delete snap.lists[id];
    return snap;
  }

  // Two snapshots (live and stored) -> one; for each course the newer list wins.
  function combine(a, b) {
    const courses = new Map();
    for (const c of [...(b?.courses || []), ...(a?.courses || [])]) courses.set(String(c.id), { ...courses.get(String(c.id)), ...c });
    const lists = { ...(b?.lists || {}) };
    for (const [id, l] of Object.entries(a?.lists || {})) if (!lists[id] || l.at >= lists[id].at) lists[id] = l;
    const latest = (k) => Math.max(a?.[k] || 0, b?.[k] || 0) || null;
    return { v: 2, courses: [...courses.values()], courses_at: latest('courses_at'), api_at: latest('api_at'), lists };
  }

  async function load() {
    try {
      const snap = (await store.get(KEY))?.[KEY];
      return snap && snap.v === 2 ? snap : null;
    } catch {
      return null;
    }
  }
  const save = (snap) => Promise.resolve(store && store.set({ [KEY]: snap })).catch(() => {});

  // ---- reading the JSON, from either side ------------------------------------
  // get(path) -> { status, url, json } (json null when the answer was not JSON, e.g. the
  // sign-in page). keep(courses) -> the courses whose lists are worth reading.
  // Returns { state: ok | skipped | signed_out | unrecognised, snap }.
  async function readApi(get, now, keep = null) {
    if (!ROUTES.courses) return { state: 'skipped', snap: null };
    const signedOut = (res) => res.status === 401 || res.status === 403 || /\/users\/sign_in/.test(res.url || '') || res.json == null;
    const home = await get(ROUTES.courses);
    if (signedOut(home)) return { state: 'signed_out', snap: null };
    let snap = mergeSnapshot(null, fromRegistrations(home.json), now);
    if (!snap) return { state: 'unrecognised', snap: null };
    snap.api_at = now;
    if (ROUTES.assignments) {
      for (const c of (keep ? keep(snap.courses) : snap.courses).slice(0, MAX_COURSES)) {
        const res = await get(ROUTES.assignments(c.id)).catch(() => null);
        if (res && !signedOut(res)) snap = mergeSnapshot(snap, fromAssignmentList(res.json, c), now);
      }
    }
    return { state: 'ok', snap };
  }

  // Mode (a): through the background script.
  async function ask(msg) {
    if (!runtime || !runtime.sendMessage) throw new Error('Edfinity reading is not available here.');
    const res = await runtime.sendMessage({ type: 'bsx-edfinity', ...msg });
    if (res && res.error === 'permission') throw Object.assign(new Error('Edfinity access is not allowed yet.'), { code: 'permission' });
    if (!res || res.error) throw new Error((res && res.error) || 'No answer from the extension.');
    return res;
  }
  function viaBackground(path) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.promise;
    const promise = ask({ path }); // { status, url, json }
    cache.set(path, { at: Date.now(), promise });
    promise.catch(() => cache.delete(path));
    return promise;
  }

  // Work from Edfinity for the given Brightspace courses, from a live read when that works and
  // from the stored snapshot otherwise. opts: { map, withTool }. Returns { state, items,
  // courses, synced_at, stale, live } with state ok | no_permission | signed_out | no_data.
  async function forCourses(bsCourses, opts = {}, now = Date.now()) {
    let live = { state: 'error', snap: null };
    try {
      await ask({ op: 'check' });
      live = await readApi(viaBackground, now, (cs) => {
        const p = pair(cs, bsCourses, opts);
        return cs.filter((c) => p.has(String(c.id)));
      });
    } catch (e) {
      if (e && e.code === 'permission') return { state: 'no_permission', items: [], courses: [], synced_at: null, stale: true, live: 'no_permission' };
    }
    const stored = await load();
    const all = combine(live.snap, stored);
    if (live.snap) save(all);
    if (!all.courses.length) return { state: live.state === 'signed_out' ? 'signed_out' : 'no_data', items: [], courses: [], synced_at: null, stale: true, live: live.state };
    const pairs = pair(all.courses, bsCourses, opts);
    const items = [];
    let synced = null;
    for (const e of all.courses) {
      const b = pairs.get(String(e.id));
      const l = all.lists[String(e.id)];
      if (!b || !l) continue;
      items.push(...itemsFor(e, l.assignments, b));
      synced = synced == null ? l.at : Math.min(synced, l.at);
    }
    return { state: 'ok', items, courses: all.courses, synced_at: synced, stale: synced == null || now - synced > STALE, live: live.state };
  }

  // Signed out of Brightspace, or the reader turned off: drop everything kept.
  function forget() {
    cache.clear();
    try {
      Promise.resolve(store && store.remove(KEY)).catch(() => {});
    } catch {}
  }

  // ---- mode (b): running on edfinity.com itself ------------------------------
  // Same-origin GET from the page, so with the session the student is using (in Firefox,
  // content.fetch makes the request as the page rather than as the extension).
  async function fromPage(path) {
    const f = globalThis.content?.fetch || globalThis.fetch;
    const res = await f(ORIGIN + path, { credentials: 'include', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
    const json = /json/i.test(res.headers.get('content-type') || '') ? await res.json() : null;
    return { status: res.status, url: res.url, json };
  }
  async function syncHere(now = Date.now()) {
    if (!(await store.get('bsx'))?.bsx?.edfinity?.on) return;
    let snap = await load();
    const seen = fromBootstrap(bootstrap([...document.scripts].map((s) => s.textContent)));
    if (seen) snap = mergeSnapshot(snap, seen, now);
    if (ROUTES.courses && (!snap || !snap.api_at || now - snap.api_at > API_EVERY)) {
      const r = await readApi(fromPage, now).catch(() => null);
      if (r && r.snap) snap = combine(r.snap, snap);
    }
    if (snap) await save(snap);
  }
  if (store && globalThis.location?.hostname === 'edfinity.com' && globalThis.document) {
    // The app may change pages without a reload: read again when the page changes, briefly.
    let timer = 0;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => syncHere().catch(() => {}), 1500);
    };
    const start = () => {
      soon();
      const watch = new MutationObserver(soon);
      watch.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => watch.disconnect(), 60e3);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  return {
    forCourses, unquote, bootstrap, fromBootstrap, fromAssessment, fromAssignment, fromRegistrations, fromRegistration, fromAssignmentList,
    subjectKey, pair, itemsFor, mergeSnapshot, combine, readApi, load, forget, clear: () => cache.clear(), ROUTES, KEY, STALE,
  };
})();
