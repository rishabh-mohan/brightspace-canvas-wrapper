// Layer 2: adapters. Turn Brightspace responses into Canvas-shaped objects.
// Field names follow the Canvas API (course_code, due_at, points_possible, html_url).
// html_url always points at the original Brightspace page for the item.
BSX.data = (() => {
  const { client } = BSX;
  const DAY = 864e5;

  // A tool that is switched off, not permitted or broken counts as empty, not as a failure.
  // Signed-out (401) and throttled (429) answers still surface, since they affect everything.
  const soft = (promise, fallback) =>
    promise.catch((e) => {
      if (e instanceof client.ApiError && e.status !== 401 && e.status !== 429) return fallback;
      throw e;
    });
  const list = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.Objects) ? v.Objects : []);
  const sameId = (a, b) => a != null && b != null && String(a) === String(b);

  // ---- courses -------------------------------------------------------------
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

  async function me() {
    const w = await client.lp('users/whoami');
    return { id: w.Identifier, name: [w.FirstName, w.LastName].filter(Boolean).join(' ') || w.UniqueName || '', login: w.UniqueName || '' };
  }

  // Unread counts for a course card.
  async function updates(ou) {
    const u = await soft(client.le(`${ou}/updates/myUpdates`), null);
    return { discussions: u?.UnreadDiscussions || 0, feedback: u?.UnreadAssignmentFeedback || 0, quizzes: u?.UnattemptedQuizzes || 0 };
  }

  // ---- grade values --------------------------------------------------------
  const gradeValues = (ou) => soft(client.le(`${ou}/grades/values/myGradeValues/`), []);

  const toValue = (v) =>
    v && {
      score: v.PointsNumerator,
      points_possible: v.PointsDenominator,
      weighted_score: v.WeightedNumerator,
      weighted_possible: v.WeightedDenominator,
      displayed: v.DisplayedGrade || '',
      comment: v.Comments?.Text || '',
      graded_at: v.LastModified || null,
    };

  // ---- assignments, quizzes, discussions -----------------------------------
  const mapFolder = (f, ou, grade) => ({
    id: `assignment-${f.Id}`,
    source_id: f.Id,
    kind: 'assignment',
    name: f.Name,
    due_at: f.DueDate || null,
    points_possible: f.Assessment?.ScoreDenominator ?? null,
    grade_item_id: f.GradeItemId ?? null,
    grade,
    html_url: `/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${f.Id}&ou=${ou}`,
  });

  const mapQuiz = (q, ou, grade) => ({
    id: `quiz-${q.QuizId}`,
    source_id: q.QuizId,
    kind: 'quiz',
    name: q.Name,
    due_at: q.DueDate || q.EndDate || null,
    points_possible: null,
    grade_item_id: q.GradeItemId ?? null,
    grade,
    html_url: `/d2l/lms/quizzing/quizzing.d2l?ou=${ou}&qi=${q.QuizId}`,
  });

  const mapTopic = (t, ou) => ({
    id: `discussion-${t.TopicId}`,
    source_id: t.TopicId,
    forum_id: t.ForumId,
    kind: 'discussion',
    name: t.Name,
    forum: t.forumName || null,
    due_at: t.DueDate || t.EndDate || null,
    points_possible: t.ScoreOutOf ?? null,
    grade_item_id: null,
    grade: null,
    locked: Boolean(t.IsLocked),
    html_url: `/d2l/le/${ou}/discussions/topics/${t.TopicId}/View`,
  });

  const folders = (ou) => soft(client.le(`${ou}/dropbox/folders/`), []);
  const quizList = (ou) => soft(client.leObjects(`${ou}/quizzes/`), []);

  async function topicList(ou) {
    const forums = list(await soft(client.le(`${ou}/discussions/forums/`), [])).filter((f) => !f.IsHidden);
    const perForum = await Promise.all(
      forums.map((f) =>
        soft(client.le(`${ou}/discussions/forums/${f.ForumId}/topics/`), [])
          .then((topics) => list(topics).map((t) => ({ ...t, ForumId: t.ForumId ?? f.ForumId, forumName: f.Name })))
          .catch(() => [])
      )
    );
    return perForum.flat().filter((t) => !t.IsHidden);
  }

  // Every discussion topic in the course, flattened out of its forums.
  const discussions = async (ou) => (await topicList(ou)).map((t) => mapTopic(t, ou));

  // Assignments, quizzes and discussion topics merged into one Canvas-style list.
  async function assignments(ou) {
    const [fs, qs, values, topics] = await Promise.all([folders(ou), quizList(ou), gradeValues(ou), discussions(ou).catch(() => [])]);
    const byItem = new Map(values.map((v) => [String(v.GradeObjectIdentifier), v]));
    const grade = (id) => (id == null ? null : toValue(byItem.get(String(id))) || null);
    return [
      ...fs.filter((f) => !f.IsHidden).map((f) => mapFolder(f, ou, grade(f.GradeItemId))),
      ...qs.filter((q) => q.IsActive !== false).map((q) => mapQuiz(q, ou, grade(q.GradeItemId))),
      ...topics,
    ];
  }

  // Grade item id -> grade category name, for "show by type" on the assignment list.
  async function assignmentGroups(ou) {
    const [items, categories] = await Promise.all([soft(client.le(`${ou}/grades/`), []), soft(client.le(`${ou}/grades/categories/`), [])]);
    const names = new Map(categories.map((c) => [c.Id, c.Name]));
    return new Map(items.map((i) => [String(i.Id), names.get(i.CategoryId) || null]));
  }

  // Dropbox status codes: 0 unsubmitted, 1 submitted, 2 draft, 3 feedback published.
  // An entry can exist for an empty or draft submission, so require a date or files too.
  async function submissionEntries(ou, folderId) {
    return list(await soft(client.le(`${ou}/dropbox/folders/${folderId}/submissions/mysubmissions/`), []));
  }

  function readSubmission(entries) {
    const out = { submitted: false, submitted_at: null, status: 'unsubmitted', submissions: [], feedback: null };
    for (const e of entries) {
      const subs = (e.Submissions || []).map((s) => ({
        submitted_at: s.SubmissionDate || null,
        comment: s.Comment?.Text || '',
        files: (s.Files || []).filter((f) => !f.IsDeleted).map((f) => ({ name: f.FileName, size: f.Size })),
      }));
      const real = subs.some((s) => s.submitted_at || s.files.length);
      if ((e.Status === 1 || e.Status === 3) && real) {
        out.submitted = true;
        out.status = e.Status === 3 ? 'graded' : 'submitted';
      } else if (e.Status === 2 && !out.submitted) {
        out.status = 'draft';
      }
      out.submissions.push(...subs);
      const fb = e.Feedback;
      if (fb && (fb.Score != null || fb.Feedback?.Text || fb.Feedback?.Html)) {
        out.feedback = { score: fb.Score ?? null, comment_html: fb.Feedback?.Html || '', comment: fb.Feedback?.Text || '', graded: Boolean(fb.IsGraded) };
      }
    }
    out.submissions.sort((a, b) => Date.parse(b.submitted_at || 0) - Date.parse(a.submitted_at || 0));
    out.submitted_at = out.submitted ? out.submissions.find((s) => s.submitted_at)?.submitted_at || null : null;
    return out;
  }

  async function submission(ou, folderId) {
    const s = readSubmission(await submissionEntries(ou, folderId));
    return { submitted: s.submitted, submitted_at: s.submitted_at };
  }

  // One assignment with its instructions, the student's submissions and any feedback.
  async function assignment(ou, folderId) {
    const [fs, entries, values] = await Promise.all([folders(ou), submissionEntries(ou, folderId), gradeValues(ou)]);
    const f = fs.find((x) => sameId(x.Id, folderId));
    if (!f) return null;
    const v = values.find((x) => sameId(x.GradeObjectIdentifier, f.GradeItemId));
    return {
      ...mapFolder(f, ou, toValue(v) || null),
      description_html: f.CustomInstructions?.Html || '',
      description: f.CustomInstructions?.Text || '',
      attachments: (f.Attachments || []).map((a) => ({ name: a.FileName, size: a.Size })),
      ...readSubmission(entries),
    };
  }

  // How many attempts the student has made on a quiz. `known` is false when Brightspace
  // will not say (the endpoint is refused for some roles), so callers must not guess.
  async function quizAttempts(ou, quizId) {
    const [attempts, who] = await Promise.all([
      soft(client.leObjects(`${ou}/quizzes/${quizId}/attempts/`), null),
      client.lp('users/whoami').catch(() => null),
    ]);
    if (!attempts) return { known: false, attempts_used: 0 };
    const mine = attempts.filter((a) => a.UserId == null || !who || sameId(a.UserId, who.Identifier));
    return { known: true, attempts_used: mine.length };
  }

  async function quiz(ou, quizId) {
    const [qs, values, attempts] = await Promise.all([quizList(ou), gradeValues(ou), quizAttempts(ou, quizId).catch(() => ({ known: false, attempts_used: 0 }))]);
    const q = qs.find((x) => sameId(x.QuizId, quizId));
    if (!q) return null;
    const v = values.find((x) => sameId(x.GradeObjectIdentifier, q.GradeItemId));
    const shown = (part) => (part && part.IsDisplayed !== false ? part.Text : null);
    return {
      ...mapQuiz(q, ou, toValue(v) || null),
      description_html: shown(q.Description)?.Html || '',
      description: shown(q.Description)?.Text || '',
      instructions_html: shown(q.Instructions)?.Html || '',
      instructions: shown(q.Instructions)?.Text || '',
      unlock_at: q.StartDate || null,
      lock_at: q.EndDate || null,
      real_due_at: q.DueDate || null,
      time_limit: q.SubmissionTimeLimit?.IsEnforced ? q.SubmissionTimeLimit.TimeLimitValue : null,
      allowed_attempts: q.AttemptsAllowed?.IsUnlimited ? null : q.AttemptsAllowed?.NumberOfAttemptsAllowed ?? null,
      attempts,
    };
  }

  // One discussion topic with its posts (read-only).
  async function discussion(ou, topicId) {
    const t = (await topicList(ou)).find((x) => sameId(x.TopicId, topicId));
    if (!t) return null;
    const raw = list(await soft(client.le(`${ou}/discussions/forums/${t.ForumId}/topics/${t.TopicId}/posts/`), []));
    const posts = raw
      .filter((p) => !p.IsDeleted)
      .map((p) => ({
        id: p.PostId,
        parent_id: p.ParentPostId || null,
        subject: p.Subject || '',
        message_html: p.Message?.Html || '',
        message: p.Message?.Text || '',
        author: p.IsAnonymous ? 'Anonymous' : p.PostingUserDisplayName || 'Unknown',
        posted_at: p.DatePosted || null,
      }))
      .sort((a, b) => Date.parse(a.posted_at || 0) - Date.parse(b.posted_at || 0));
    return {
      ...mapTopic(t, ou),
      description_html: t.Description?.Html || '',
      description: t.Description?.Text || '',
      must_post_first: Boolean(t.MustPostToParticipate),
      posts,
    };
  }

  // ---- to-do, planner, feedback --------------------------------------------
  const perCourse = async (courseList, fn) =>
    (
      await Promise.all(
        courseList.map((c) =>
          fn(c)
            .then((items) => items.map((i) => ({ ...i, course_id: c.id, context_name: c.name })))
            .catch(() => []) // a course with a broken tool is skipped, not fatal
        )
      )
    ).flat();

  // Work due soon that is neither graded nor turned in, across the given courses.
  async function todo(courseList, days = 14) {
    const now = Date.now();
    const due = (await perCourse(courseList, (c) => assignments(c.id))).filter((a) => {
      const t = a.due_at ? Date.parse(a.due_at) : NaN;
      return !a.grade && t >= now && t <= now + days * DAY;
    });
    const open = await Promise.all(
      due.map(async (a) => {
        if (a.kind === 'quiz') {
          const q = await quizAttempts(a.course_id, a.source_id).catch(() => ({ known: false }));
          return q.known && q.attempts_used > 0 ? null : a;
        }
        if (a.kind === 'discussion') return a; // no way to tell whether the student has posted
        const s = await submission(a.course_id, a.source_id).catch(() => ({ submitted: false }));
        return s.submitted ? null : a;
      })
    );
    return open.filter(Boolean).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  }

  // Every dated item between two instants, for the dashboard list view.
  async function planner(courseList, from, to) {
    return (await perCourse(courseList, (c) => assignments(c.id)))
      .filter((a) => a.due_at && Date.parse(a.due_at) >= from && Date.parse(a.due_at) <= to)
      .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  }

  async function overdue() {
    const items = await soft(client.leObjects('overdueItems/myItems'), []);
    return items
      .map((i) => ({ id: i.ItemId, title: i.ItemName, course_id: i.OrgUnitId, due_at: i.DueDate }))
      .sort((a, b) => Date.parse(b.due_at) - Date.parse(a.due_at));
  }

  // Grade rows that changed recently. Types 1-4 are real items; 5-9 are computed rows and category totals.
  async function recentFeedback(courseList, days = 14) {
    const since = Date.now() - days * DAY;
    const rows = await perCourse(courseList, async (c) =>
      (await gradeValues(c.id))
        .filter((v) => (v.GradeObjectType == null || v.GradeObjectType <= 4) && v.LastModified && Date.parse(v.LastModified) >= since && v.PointsNumerator != null)
        .map((v) => ({ id: v.GradeObjectIdentifier, title: v.GradeObjectName, grade: toValue(v) }))
    );
    return rows.sort((a, b) => Date.parse(b.grade.graded_at) - Date.parse(a.grade.graded_at));
  }

  // ---- grades --------------------------------------------------------------
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

  // One line per course for the all-courses Grades page.
  async function courseTotals(courseList) {
    return Promise.all(
      courseList.map((c) =>
        grades(c.id)
          .then((g) => ({ course_id: c.id, final: g.final, estimate: g.estimate }))
          .catch(() => ({ course_id: c.id, final: null, estimate: null }))
      )
    );
  }

  // ---- announcements -------------------------------------------------------
  async function announcements(ou) {
    const items = list(await soft(client.le(`${ou}/news/`), []));
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
    return (await perCourse(courseList, (c) => announcements(c.id)))
      .filter((a) => a.posted_at && Date.parse(a.posted_at) >= since)
      .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
  }

  // ---- content -------------------------------------------------------------
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
    const walk = (mods, depth) => {
      for (const m of mods || []) {
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
              updated_at: t.LastModifiedDate || null,
              html_url: `/d2l/le/content/${ou}/viewContent/${t.TopicId}/View`,
            })),
        });
        walk(m.Modules, depth + 1);
      }
    };
    walk(toc.Modules, 0);
    return out;
  }

  const itemsOfType = async (ou, type) => {
    const seen = new Map();
    for (const m of await modules(ou)) {
      for (const i of m.items) if (i.type === type && !seen.has(`${i.title}`)) seen.set(i.title, { ...i, module: m.name });
    }
    return [...seen.values()];
  };

  // Gradescope, publisher homework sites and the like: found as LTI links in Content.
  const externalTools = (ou) => itemsOfType(ou, 'External tool');
  const files = (ou) => itemsOfType(ou, 'File');

  // The course overview, which is where Brightspace keeps a syllabus description.
  async function syllabus(ou) {
    const o = await soft(client.le(`${ou}/overview`), null);
    if (!o) return null;
    return { html: o.Description?.Html || '', text: o.Description?.Text || '', has_attachment: Boolean(o.HasAttachment) };
  }

  async function people(ou) {
    return list(await soft(client.le(`${ou}/classlist/`), []))
      .map((p) => ({ id: p.Identifier, name: p.DisplayName || [p.FirstName, p.LastName].filter(Boolean).join(' '), role: p.ClasslistRoleDisplayName || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- calendar ------------------------------------------------------------
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
    courses, me, updates,
    assignments, assignmentGroups, assignment, submission, quiz, quizAttempts, discussions, discussion,
    todo, planner, overdue, recentFeedback,
    grades, estimate, estimable, courseTotals,
    announcements, recentAnnouncements,
    modules, externalTools, files, syllabus, people,
    calendar,
  };
})();
