// Optional reader for Ed Discussion (edstem.org), where some courses keep lessons and
// homework with due dates. Off unless the student switches it on and gives an Ed API token
// (Ed → Settings → API Tokens). Read-only: the background script GETs /api/user (courses)
// and /api/courses/{id}/lessons with that token.
//
// /api/user returns { courses: [{ course: { id, code, name, year, session, status, features: { lessons } } }] }
// (as documented by the public edapi project). Lesson fields are read defensively: title,
// due_at, available_at, is_hidden, state, and a completion status where Ed provides one.
BSX.ed = (() => {
  const runtime = (globalThis.browser || globalThis.chrome)?.runtime;
  const TTL = 5 * 60 * 1000;
  const cache = new Map();

  function get(path) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.promise;
    const promise = (async () => {
      if (!runtime || !runtime.sendMessage) throw new Error('Ed reading is not available here.');
      const res = await runtime.sendMessage({ type: 'bsx-ed', path });
      if (res && ['permission', 'no_token', 'bad_token'].includes(res.error)) throw Object.assign(new Error(res.error), { code: res.error });
      if (!res || res.error) throw new Error((res && res.error) || 'No answer from the extension.');
      return res.json;
    })();
    cache.set(path, { at: Date.now(), promise });
    promise.catch(() => cache.delete(path));
    return promise;
  }

  // Subject and number, e.g. "CS251" from "CS 251", "CS 25100" or "wl.202710.CS.25100.LE1".
  const subjectKey = (s) => {
    const m = String(s || '').toUpperCase().match(/\b([A-Z]{2,5})[\s.]?(\d{3})(\d{2})?\b/);
    return m ? m[1] + m[2] : null;
  };

  // The student's current Ed courses that have lessons.
  async function courses() {
    const user = await get('/api/user');
    return (user.courses || [])
      .map((c) => c.course || c)
      .filter((c) => c && c.id != null && c.status !== 'archived')
      .map((c) => ({ id: c.id, code: c.code || '', name: c.name || '', term: [c.session, c.year].filter(Boolean).join(' '), lessons: c.features ? c.features.lessons !== false : true }));
  }

  // Which Brightspace course an Ed course belongs to: the student's own choice in `map`
  // (0 hides it), otherwise the same subject and number.
  function brightspaceFor(edCourse, bsCourses, map = {}) {
    if (Object.prototype.hasOwnProperty.call(map, edCourse.id)) {
      const chosen = Number(map[edCourse.id]);
      return chosen ? bsCourses.find((c) => c.id === chosen) || null : null;
    }
    const key = subjectKey(edCourse.code) || subjectKey(edCourse.name);
    return (key && bsCourses.find((c) => subjectKey(c.course_code) === key || subjectKey(c.name) === key)) || null;
  }

  const doneStatus = (l) => {
    const s = String(l.status || l.state_user || '').toLowerCase();
    if (l.is_completed || l.completed || l.completed_at || s === 'completed' || s === 'complete') return 'Completed';
    if (l.attempted || s === 'attempted' || s === 'in_progress') return 'Attempted';
    return '';
  };

  function lessonItems(edCourse, json, bsCourse, region) {
    const list = Array.isArray(json) ? json : json.lessons || [];
    return list
      .filter((l) => l && l.id != null && !l.is_hidden && l.state !== 'draft' && (l.due_at || l.locked_at))
      .map((l) => {
        const status = doneStatus(l);
        return {
          kind: 'external',
          source: 'Ed',
          source_id: `ed-${edCourse.id}-${l.id}`,
          course_id: bsCourse.id,
          name: l.title || 'Ed lesson',
          due_at: l.due_at || l.locked_at || null,
          points_possible: null,
          grade: null,
          submitted: status === 'Completed',
          status: status || 'Not completed',
          html_url: `https://edstem.org/${region}/courses/${edCourse.id}/lessons/${l.id}`,
        };
      });
  }

  // Work from Ed for the given Brightspace courses. state: ok | no_token | bad_token | no_permission
  async function forCourses(bsCourses, { map = {}, region = 'us' } = {}) {
    try {
      const eds = (await courses()).filter((c) => c.lessons);
      const pairs = eds.map((e) => [e, brightspaceFor(e, bsCourses, map)]).filter(([, b]) => b);
      const lists = await Promise.all(pairs.map(([e, b]) => get(`/api/courses/${e.id}/lessons`).then((j) => lessonItems(e, j, b, region)).catch(() => [])));
      return { state: 'ok', items: lists.flat(), courses: eds };
    } catch (e) {
      if (e && e.code) return { state: e.code === 'permission' ? 'no_permission' : e.code, items: [], courses: [] };
      throw e;
    }
  }

  // Field names and types of Ed's answers, with no values, for checking the reader against
  // a real account (like the Brightspace access probe).
  function shape(v, depth = 0) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return { _array: v.length, _of: v.length ? shape(v[0], depth + 1) : null };
    if (typeof v === 'object') {
      if (depth > 5) return 'object';
      const out = {};
      for (const k of Object.keys(v).slice(0, 80)) out[k] = shape(v[k], depth + 1);
      return out;
    }
    return typeof v;
  }
  async function report() {
    const out = { generatedAt: new Date().toISOString(), user: null, lessons: null, notes: [] };
    try {
      const user = await get('/api/user');
      out.user = shape(user);
      const first = (user.courses || []).map((c) => c.course || c).find((c) => c && c.id != null && c.status !== 'archived');
      if (first) {
        const lessons = await get(`/api/courses/${first.id}/lessons`);
        out.lessons = shape(lessons);
        const list = Array.isArray(lessons) ? lessons : lessons.lessons || [];
        // Which status words appear, so completion can be read correctly (words only, no titles).
        out.lessonStatusValues = [...new Set(list.map((l) => String(l.status ?? '')).filter(Boolean))].slice(0, 20);
        out.lessonStateValues = [...new Set(list.map((l) => String(l.state ?? '')).filter(Boolean))].slice(0, 20);
      } else out.notes.push('No current course found.');
    } catch (e) {
      out.notes.push(`Error: ${e.code || e.message}`);
    }
    return out;
  }

  return { courses, forCourses, brightspaceFor, lessonItems, subjectKey, report, clear: () => cache.clear() };
})();
