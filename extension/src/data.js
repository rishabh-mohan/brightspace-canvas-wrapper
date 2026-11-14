// Layer 2: adapters. Turn Brightspace responses into Canvas-shaped objects.
// Field names follow the Canvas API (course_code, due_at, points_possible, html_url).
BSX.data = (() => {
  const { client } = BSX;
  const DAY = 864e5;

  // A tool that is switched off or not permitted counts as empty, not as a failure.
  const soft = (promise, fallback) =>
    promise.catch((e) => {
      if (e instanceof client.ApiError && [403, 404].includes(e.status)) return fallback;
      throw e;
    });

  // Term code as it appears inside course codes, e.g. wl.202710.CS.18000: the academic
  // year that ends, then 10 fall, 20 spring, 30 summer. Fall 2026 is 202710.
  function currentTermCode(date = new Date()) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    if (m >= 8) return `${y + 1}10`;
    if (m <= 5) return `${y}20`;
    return `${y}30`;
  }

  async function courses() {
    const [items, imageBase] = await Promise.all([client.lpBookmarked('enrollments/myenrollments/'), client.lpPath('courses')]);
    const now = Date.now();
    const term = new RegExp(`(^|[^0-9])${currentTermCode()}([^0-9]|$)`);
    return items
      .filter(
        (e) =>
          e.OrgUnit?.Type?.Code === 'Course Offering' &&
          e.Access?.CanAccess !== false &&
          e.Access?.IsActive !== false &&
          (!e.Access?.EndDate || Date.parse(e.Access.EndDate) > now)
      )
      .map((e) => ({
        id: e.OrgUnit.Id,
        name: e.OrgUnit.Name,
        course_code: e.OrgUnit.Code,
        image_url: `${imageBase}/${e.OrgUnit.Id}/image`,
        current_term: term.test(e.OrgUnit.Code || ''),
        pinned: Boolean(e.PinDate),
        last_accessed: e.Access?.LastAccessed || null,
      }))
      .sort(
        (a, b) =>
          b.current_term - a.current_term || b.pinned - a.pinned || Date.parse(b.last_accessed || 0) - Date.parse(a.last_accessed || 0)
      );
  }

  // Dropbox status codes: 0 unsubmitted, 1 submitted, 2 draft, 3 feedback published.
  // An entry can exist for an empty or draft submission, so require a date or files too.
  async function submission(ou, folderId) {
    const entries = await soft(client.le(`${ou}/dropbox/folders/${folderId}/submissions/mysubmissions/`), []);
    const dates = [];
    let submitted = false;
    for (const e of entries || []) {
      if (e.Status !== 1 && e.Status !== 3) continue;
      for (const s of e.Submissions || []) {
        if (s.SubmissionDate || (s.Files || []).length) submitted = true;
        if (s.SubmissionDate) dates.push(s.SubmissionDate);
      }
    }
    return { submitted, submitted_at: dates.sort().pop() || null };
  }

  // How many attempts the student has made on a quiz. `known` is false when Brightspace
  // will not say (the endpoint is refused for some roles), so callers must not guess.
  async function quizAttempts(ou, quizId) {
    const [list, me] = await Promise.all([
      soft(client.leObjects(`${ou}/quizzes/${quizId}/attempts/`), null),
      client.lp('users/whoami').catch(() => null),
    ]);
    if (!list) return { known: false, attempts_used: 0 };
    const mine = list.filter((a) => a.UserId == null || !me || String(a.UserId) === String(me.Identifier));
    return { known: true, attempts_used: mine.length };
  }

  // Work due soon that is neither graded nor turned in, across the given courses.
  // A course with a broken tool is skipped rather than failing the whole list.
  async function todo(courseList, days = 14) {
    const now = Date.now();
    const perCourse = await Promise.all(
      courseList.map((c) =>
        assignments(c.id)
          .then((list) => list.map((a) => ({ ...a, course_id: c.id, context_name: c.name })))
          .catch(() => [])
      )
    );
    const due = perCourse.flat().filter((a) => {
      const t = a.due_at ? Date.parse(a.due_at) : NaN;
      return !a.grade && t >= now && t <= now + days * DAY;
    });
    const open = await Promise.all(
      due.map(async (a) => {
        if (a.kind === 'quiz') {
          const q = await quizAttempts(a.course_id, a.source_id).catch(() => ({ known: false }));
          return q.known && q.attempts_used > 0 ? null : a;
        }
        const s = await submission(a.course_id, a.source_id).catch(() => ({ submitted: false }));
        return s.submitted ? null : a;
      })
    );
    return open.filter(Boolean).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  }

  async function overdue() {
    const items = await soft(client.leObjects('overdueItems/myItems'), []);
    return items
      .map((i) => ({ id: i.ItemId, title: i.ItemName, course_id: i.OrgUnitId, due_at: i.DueDate }))
      .sort((a, b) => Date.parse(b.due_at) - Date.parse(a.due_at));
  }

  const gradeValues = (ou) => soft(client.le(`${ou}/grades/values/myGradeValues/`), []);

  const toValue = (v) =>
    v && {
      score: v.PointsNumerator,
      points_possible: v.PointsDenominator,
      weighted_score: v.WeightedNumerator,
      weighted_possible: v.WeightedDenominator,
      displayed: v.DisplayedGrade || '',
      comment: v.Comments?.Text || '',
    };

  // Assignments and quizzes merged into one Canvas-style list.
  async function assignments(ou) {
    const [folders, quizzes, values] = await Promise.all([
      soft(client.le(`${ou}/dropbox/folders/`), []),
      soft(client.leObjects(`${ou}/quizzes/`), []),
      gradeValues(ou),
    ]);
    const byItem = new Map(values.map((v) => [String(v.GradeObjectIdentifier), v]));
    const grade = (id) => (id == null ? null : toValue(byItem.get(String(id))) || null);
    return [
      ...folders
        .filter((f) => !f.IsHidden)
        .map((f) => ({
          id: `assignment-${f.Id}`,
          source_id: f.Id,
          kind: 'assignment',
          name: f.Name,
          due_at: f.DueDate || null,
          points_possible: f.Assessment?.ScoreDenominator ?? null,
          grade: grade(f.GradeItemId),
          html_url: `/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${f.Id}&ou=${ou}`,
        })),
      ...quizzes
        .filter((q) => q.IsActive !== false)
        .map((q) => ({
          id: `quiz-${q.QuizId}`,
          source_id: q.QuizId,
          kind: 'quiz',
          name: q.Name,
          due_at: q.DueDate || q.EndDate || null,
          points_possible: null,
          grade: grade(q.GradeItemId),
          html_url: `/d2l/lms/quizzing/quizzing.d2l?ou=${ou}&qi=${q.QuizId}`,
        })),
    ];
  }

  async function grades(ou) {
    const [items, categories, values, final, setup] = await Promise.all([
      soft(client.le(`${ou}/grades/`), []),
      soft(client.le(`${ou}/grades/categories/`), []),
      gradeValues(ou),
      soft(client.le(`${ou}/grades/final/values/myGradeValue`), null),
      soft(client.le(`${ou}/grades/setup/`), null),
    ]);
    const byId = new Map(values.map((v) => [String(v.GradeObjectIdentifier), v]));
    const categoryById = new Map(categories.map((c) => [c.Id, c]));
    const groups = new Map();
    for (const item of items) {
      if (item.IsHidden) continue;
      const key = categoryById.has(item.CategoryId) ? item.CategoryId : 0;
      if (!groups.has(key)) {
        const c = categoryById.get(key);
        groups.set(key, {
          id: key,
          name: c ? c.Name : null,
          weight: c ? c.Weight : null,
          value: c ? toValue(byId.get(String(c.Id))) || null : null,
          items: [],
        });
      }
      groups.get(key).items.push({
        id: item.Id,
        name: item.Name,
        type: item.GradeType,
        points_possible: item.MaxPoints,
        weight: item.Weight,
        bonus: Boolean(item.IsBonus),
        excluded: Boolean(item.ExcludeFromFinalGradeCalculation),
        value: toValue(byId.get(String(item.Id))) || null,
      });
    }

    const result = { system: setup?.GradingSystem || null, final: toValue(final) || null, estimate: null, groups: [...groups.values()] };
    result.estimate = estimate(result);
    return result;
  }

  // Can this item take part in an estimate or a What-If score?
  function estimable(g, i) {
    if (i.excluded || i.type !== 'Numeric') return false;
    if (g.system === 'Points') return (i.value?.points_possible ?? i.points_possible) > 0;
    if (g.system === 'Weighted') return i.value?.weighted_possible > 0 && i.value?.points_possible > 0;
    return false;
  }

  // Unofficial running total from real grade items only (category subtotals and calculated
  // rows are never added in, which would double-count). `overrides` maps item id to a
  // hypothetical score. Ignores dropped-lowest rules, so the result is always an estimate.
  // Points gradebooks: plain sum. Weighted: each item's share of the final, as Brightspace reports it.
  function estimate(g, overrides = new Map()) {
    let score = 0;
    let possible = 0;
    for (const group of g.groups) {
      for (const i of group.items) {
        if (!estimable(g, i)) continue;
        const override = overrides.get(i.id);
        const actual = i.value ? i.value.score : null;
        const s = override != null ? override : actual;
        if (s == null) continue;
        if (g.system === 'Points') {
          score += s;
          if (!i.bonus) possible += i.value?.points_possible ?? i.points_possible;
        } else {
          score += (s / i.value.points_possible) * i.value.weighted_possible;
          if (!i.bonus) possible += i.value.weighted_possible;
        }
      }
    }
    return possible > 0 ? { score, points_possible: possible } : null;
  }

  async function announcements(ou) {
    const items = await soft(client.le(`${ou}/news/`), []);
    const now = Date.now();
    return items
      .filter(
        (n) =>
          !n.IsHidden &&
          n.IsPublished !== false &&
          (!n.StartDate || Date.parse(n.StartDate) <= now) &&
          (!n.EndDate || Date.parse(n.EndDate) > now)
      )
      .map((n) => ({
        id: n.Id,
        title: n.Title,
        message_html: n.Body?.Html || '', // untrusted: the interface sanitises before showing
        message: n.Body?.Text || '',
        posted_at: n.StartDate || n.CreatedDate || null,
        pinned: Boolean(n.IsPinned),
      }))
      .sort((a, b) => b.pinned - a.pinned || Date.parse(b.posted_at || 0) - Date.parse(a.posted_at || 0));
  }

  async function recentAnnouncements(courseList, days = 7) {
    const since = Date.now() - days * DAY;
    const perCourse = await Promise.all(
      courseList.map((c) =>
        announcements(c.id)
          .then((list) => list.map((a) => ({ ...a, course_id: c.id, context_name: c.name })))
          .catch(() => [])
      )
    );
    return perCourse
      .flat()
      .filter((a) => a.posted_at && Date.parse(a.posted_at) >= since)
      .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
  }

  function topicType(t) {
    const url = t.Url || '';
    if (/type=lti/i.test(url)) return 'External tool';
    if (/type=dropbox/i.test(url) || /\/dropbox\//i.test(url)) return 'Assignment';
    if (/type=quiz/i.test(url) || /\/quizzing\//i.test(url)) return 'Quiz';
    if (/type=discuss/i.test(url) || /\/discussions\//i.test(url)) return 'Discussion';
    if (t.TypeIdentifier === 'Link') return 'Link';
    if (t.TypeIdentifier === 'File') return 'File';
    return t.TypeIdentifier || 'Item';
  }

  // Content tree flattened to a list of modules; `depth` keeps the nesting for indentation.
  async function modules(ou) {
    const toc = await soft(client.le(`${ou}/content/toc`), { Modules: [] });
    const out = [];
    const walk = (list, depth) => {
      for (const m of list || []) {
        if (m.IsHidden) continue;
        out.push({
          id: m.ModuleId,
          name: m.Title,
          depth,
          locked: Boolean(m.IsLocked),
          items: (m.Topics || [])
            .filter((t) => !t.IsHidden)
            .map((t) => ({
              id: t.TopicId,
              title: t.Title,
              type: topicType(t),
              unread: Boolean(t.Unread),
              locked: Boolean(t.IsLocked),
              html_url: `/d2l/le/content/${ou}/viewContent/${t.TopicId}/View`,
            })),
        });
        walk(m.Modules, depth + 1);
      }
    };
    walk(toc.Modules, 0);
    return out;
  }

  // Gradescope, publisher homework sites and the like: found as LTI links in Content.
  async function externalTools(ou) {
    const seen = new Map();
    for (const m of await modules(ou)) {
      for (const i of m.items) if (i.type === 'External tool' && !seen.has(i.title)) seen.set(i.title, i);
    }
    return [...seen.values()].slice(0, 8);
  }

  // Calendar events for the given courses between two instants (milliseconds).
  async function calendar(courseIds, from, to) {
    if (!courseIds.length) return [];
    const range = `startDateTime=${encodeURIComponent(new Date(from).toISOString())}&endDateTime=${encodeURIComponent(new Date(to).toISOString())}`;
    const events = await client.leObjects(`calendar/events/myEvents/?orgUnitIdsCSV=${courseIds.join(',')}&${range}`);
    return events
      .map((e) => ({
        id: e.CalendarEventId,
        title: e.Title,
        course_id: e.OrgUnitId,
        context_name: e.OrgUnitName,
        start_at: e.StartDateTime || e.EndDateTime,
        end_at: e.EndDateTime || e.StartDateTime,
        all_day: Boolean(e.IsAllDayEvent),
        html_url: e.AssociatedEntity?.Link || e.CalendarEventViewUrl || null,
      }))
      .filter((e) => e.start_at)
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  }

  return {
    courses, todo, overdue, submission, quizAttempts, assignments, grades, estimate, estimable,
    announcements, recentAnnouncements, modules, externalTools, calendar,
  };
})();
