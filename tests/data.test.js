// Data-layer test: runs client.js and data.js against a stubbed fetch. Usage: node tests/data.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ext = process.argv[2] || path.join(__dirname, '..', 'extension');
const soon = new Date(Date.now() + 2 * 864e5).toISOString();
const past = new Date(Date.now() - 2 * 864e5).toISOString();
const routes = {
  '/d2l/api/versions/': [{ ProductCode: 'lp', LatestVersion: '1.64' }, { ProductCode: 'le', LatestVersion: '1.100' }],
  '/d2l/api/lp/1.64/enrollments/myenrollments/': { PagingInfo: { Bookmark: 'b1', HasMoreItems: true }, Items: [
    { OrgUnit: { Id: 1, Type: { Code: 'Organization' }, Name: 'Org', Code: 'o' }, Access: { IsActive: true, CanAccess: true }, PinDate: null },
    { OrgUnit: { Id: 10, Type: { Code: 'Course Offering' }, Name: 'A', Code: 'a' }, Access: { IsActive: true, CanAccess: true, EndDate: null, LastAccessed: past }, PinDate: null }] },
  '/d2l/api/lp/1.64/enrollments/myenrollments/?bookmark=b1': { PagingInfo: { Bookmark: 'b2', HasMoreItems: false }, Items: [
    { OrgUnit: { Id: 11, Type: { Code: 'Course Offering' }, Name: 'B', Code: 'b' }, Access: { IsActive: true, CanAccess: true, EndDate: null, LastAccessed: past }, PinDate: past },
    { OrgUnit: { Id: 12, Type: { Code: 'Course Offering' }, Name: 'Old', Code: 'c' }, Access: { IsActive: true, CanAccess: true, EndDate: past }, PinDate: null }] },
  '/d2l/api/le/1.100/10/dropbox/folders/': [{ Id: 5, Name: 'HW1', DueDate: soon, IsHidden: false, Assessment: { ScoreDenominator: 10 }, GradeItemId: 100 }, { Id: 6, Name: 'Hidden', IsHidden: true }],
  '/d2l/api/le/1.100/11/dropbox/folders/': [{ Id: 20, Name: 'HW2', DueDate: soon, IsHidden: false }, { Id: 21, Name: 'HW3', DueDate: soon, IsHidden: false }, { Id: 22, Name: 'Draft', DueDate: soon, IsHidden: false }],
  '/d2l/api/le/1.100/11/dropbox/folders/21/submissions/mysubmissions/': [{ Status: 1, Submissions: [{ SubmissionDate: past, Files: [{ FileName: 'a.pdf' }] }] }],
  '/d2l/api/le/1.100/11/dropbox/folders/22/submissions/mysubmissions/': [{ Status: 2, Submissions: [{ SubmissionDate: past, Files: [] }] }],
  '/d2l/api/le/1.100/10/quizzes/': { Objects: [{ QuizId: 7, Name: 'Q1', DueDate: null, EndDate: past, GradeItemId: 101, IsActive: true }], Next: '/d2l/api/le/1.100/10/quizzes/?p=2' },
  '/d2l/api/le/1.100/10/quizzes/?p=2': { Objects: [{ QuizId: 8, Name: 'Q2', DueDate: null, EndDate: null, GradeItemId: null, IsActive: true }], Next: null },
  '/d2l/api/le/1.100/10/grades/values/myGradeValues/': [
    { GradeObjectIdentifier: '100', PointsNumerator: 8, PointsDenominator: 10, DisplayedGrade: '80 %', Comments: { Text: 'ok' } },
    { GradeObjectIdentifier: '101', PointsNumerator: 4, PointsDenominator: 5, DisplayedGrade: '80 %', Comments: { Text: '' } },
    { GradeObjectIdentifier: '50', PointsNumerator: 12, PointsDenominator: 15, DisplayedGrade: '80 %' }],
  '/d2l/api/le/1.100/10/grades/': [
    { Id: 100, Name: 'HW1', GradeType: 'Numeric', MaxPoints: 10, CategoryId: 50, Weight: 10, IsHidden: false },
    { Id: 101, Name: 'Q1', GradeType: 'Numeric', MaxPoints: 5, CategoryId: 50, Weight: 5, IsHidden: false },
    { Id: 102, Name: 'Final', GradeType: 'Numeric', MaxPoints: 100, CategoryId: 0, Weight: 50, IsHidden: false }],
  '/d2l/api/le/1.100/10/grades/categories/': [{ Id: 50, Name: 'Homework', Weight: 30 }],
  '/d2l/api/le/1.100/10/grades/setup/': { GradingSystem: 'Points' },
  '/d2l/api/le/1.100/overdueItems/myItems': { Objects: [{ ItemId: 1, ItemName: 'Late', OrgUnitId: 10, DueDate: past }], Next: null },
};
const calls = [];
const ctx = {
  console, URL, Date, Math, JSON, Promise, Map, Set, encodeURIComponent,
  location: { origin: 'https://x.brightspace.com' },
  sessionStorage: { getItem: () => null, setItem() {} },
  fetch: async (p) => {
    calls.push(p);
    if (p.startsWith('/d2l/api/le/1.100/calendar/events/myEvents/')) {
      return { ok: true, json: async () => ({ Objects: [
        { CalendarEventId: 1, Title: 'HW1 - Due', OrgUnitId: 10, OrgUnitName: 'A', StartDateTime: soon, EndDateTime: soon, IsAssociatedWithEntity: true, AssociatedEntity: { Link: '/x' } },
        { CalendarEventId: 2, Title: 'Lecture', OrgUnitId: 10, OrgUnitName: 'A', StartDateTime: soon, EndDateTime: soon, IsAssociatedWithEntity: false }], Next: null }) };
    }
    if (!(p in routes)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[p] };
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['src/client.js', 'src/data.js', 'src/gradescope.js']) vm.runInContext(fs.readFileSync(path.join(ext, f), 'utf8'), ctx, { filename: f });

const assert = require('assert');
(async () => {
  const { data } = ctx.BSX;
  const courses = await data.courses();
  assert.deepStrictEqual(Array.from(courses, (c) => c.id), [11, 10], 'pinned first, ended and non-course dropped');
  assert.strictEqual(courses[0].image_url, '/d2l/api/lp/1.64/courses/11/image');

  const todo = await data.todo(courses);
  assert.deepStrictEqual(Array.from(todo, (t) => t.name), ['HW2', 'Draft'], 'graded and submitted work dropped, draft kept');
  assert.strictEqual(todo[0].context_name, 'B');
  assert.strictEqual((await data.submission(11, 21)).submitted, true);
  assert.strictEqual(courses[0].current_term, false);

  const late = await data.overdue();
  assert.strictEqual(late[0].title, 'Late');

  const as = await data.assignments(10);
  assert.deepStrictEqual(Array.from(as, (a) => a.name), ['HW1', 'Q1', 'Q2']);
  assert.strictEqual(as[0].grade.score, 8);
  assert.strictEqual(as[2].grade, null);

  const g = await data.grades(10); // final value route missing -> 404 -> not released
  assert.strictEqual(g.final, null);
  assert.strictEqual(g.system, 'Points');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.estimate)), { score: 12, points_possible: 15 });
  assert.strictEqual(g.groups.length, 2);
  assert.strictEqual(g.groups[0].name, 'Homework');
  assert.strictEqual(g.groups[0].value.score, 12);
  assert.strictEqual(g.groups[1].name, null);
  assert.strictEqual(g.groups[1].items[0].value, null);

  // What-If: HW1 8 -> 10, and a score for the ungraded Final (points gradebook).
  const hyp = data.estimate(g, new Map([[100, 10], [102, 90]]));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(hyp)), { score: 104, points_possible: 115 });
  // Weighted gradebook: only items with a reported weight share count.
  const w = { system: 'Weighted', groups: [{ items: [
    { id: 1, type: 'Numeric', value: { score: 8, points_possible: 10, weighted_possible: 20 } },
    { id: 2, type: 'Numeric', value: null, points_possible: 50 },
    { id: 3, type: 'Calculated', value: { score: 99, points_possible: 100, weighted_possible: 100 } }] }] };
  assert.deepEqual({ ...data.estimate(w) }, { score: 16, points_possible: 20 });
  assert.deepEqual({ ...data.estimate(w, new Map([[1, 5], [2, 50]])) }, { score: 10, points_possible: 20 });

  routes['/d2l/api/le/1.100/10/news/'] = [
    { Id: 1, Title: 'Old', Body: { Html: '<p>x</p>', Text: 'x' }, StartDate: past, IsHidden: false, IsPublished: true, IsPinned: false },
    { Id: 2, Title: 'Future', Body: {}, StartDate: soon, IsHidden: false, IsPublished: true },
    { Id: 3, Title: 'Pinned', Body: {}, StartDate: new Date(Date.now() - 20 * 864e5).toISOString(), IsPinned: true }];
  const news = await data.announcements(10);
  assert.deepStrictEqual(Array.from(news, (n) => n.title), ['Pinned', 'Old']);
  assert.deepStrictEqual(Array.from(await data.recentAnnouncements(courses), (n) => n.title), ['Old']);

  routes['/d2l/api/le/1.100/10/content/toc'] = { Modules: [
    { ModuleId: 1, Title: 'Week 1', IsHidden: false, Topics: [
      { TopicId: 11, Title: 'Slides', TypeIdentifier: 'File', Url: '/content/x.pdf' },
      { TopicId: 12, Title: 'Gradescope', TypeIdentifier: 'Link', Url: '/d2l/common/dialogs/quickLink/quickLink.d2l?ou=10&type=lti&rcode=abc' },
      { TopicId: 13, Title: 'Secret', IsHidden: true }],
      Modules: [{ ModuleId: 2, Title: 'Sub', Topics: [], Modules: [] }] },
    { ModuleId: 3, Title: 'Hidden', IsHidden: true, Topics: [], Modules: [] }] };
  const mods = await data.modules(10);
  assert.deepStrictEqual(Array.from(mods, (m) => `${m.depth}:${m.name}:${m.items.length}`), ['0:Week 1:2', '1:Sub:0']);
  assert.deepStrictEqual(Array.from(await data.externalTools(10), (t) => t.title), ['Gradescope']);

  const cal = await data.calendar([10], Date.now(), Date.now() + 5 * 864e5);
  assert.strictEqual(cal.length, 2);
  assert.strictEqual(cal[0].html_url, '/x');

  // Quiz attempts: unknown when Brightspace refuses, counted when it answers.
  assert.strictEqual((await data.quizAttempts(10, 7)).known, false);
  routes['/d2l/api/le/1.100/10/quizzes/8/attempts/'] = { Objects: [{ AttemptId: 1, UserId: 42 }, { AttemptId: 2, UserId: 42 }], Next: null };
  const q = await data.quizAttempts(10, 8);
  assert.strictEqual(q.known, true);
  assert.strictEqual(q.attempts_used, 2);

  // Discussions: topics flattened out of forums and merged into the assignment list.
  routes['/d2l/api/le/1.100/12/discussions/forums/'] = [{ ForumId: 1, Name: 'Weekly', IsHidden: false }, { ForumId: 2, Name: 'Gone', IsHidden: true }];
  routes['/d2l/api/le/1.100/12/discussions/forums/1/topics/'] = [
    { TopicId: 31, Name: 'Week 1', DueDate: soon, ScoreOutOf: 5, IsHidden: false },
    { TopicId: 32, Name: 'Hidden', IsHidden: true }];
  const merged = await data.assignments(12);
  assert.deepStrictEqual(Array.from(merged, (a) => `${a.kind}:${a.name}:${a.forum}`), ['discussion:Week 1:Weekly']);
  assert.strictEqual(merged[0].html_url, '/d2l/le/12/discussions/topics/31/View');
  assert.strictEqual((await data.todo([{ id: 12, name: 'C' }])).length, 1);

  // Module items carry the address of the file itself, for the in-page viewer.
  assert.strictEqual(mods[0].items[0].file_url, '/d2l/api/le/1.100/10/content/topics/11/file?stream=true');

  // Quiz attempts: one handed in, one still open.
  routes['/d2l/api/le/1.100/10/quizzes/9/attempts/'] = { Objects: [{ AttemptId: 1, Completed: past }, { AttemptId: 2, Completed: null }], Next: null };
  const open = await data.quizAttempts(10, 9);
  assert.strictEqual(open.attempts_used, 1);
  assert.strictEqual(open.in_progress, 1);

  // Gradescope reader: date format and matching a Gradescope course to a Brightspace one.
  const gs = ctx.BSX.gradescope;
  assert.strictEqual(gs.toIso('2026-11-16 23:59:00 -0500'), '2026-11-17T04:59:00.000Z');
  assert.strictEqual(gs.toIso(''), null);
  const gsCourses = [{ id: '1', short_name: 'Other', name: 'Unrelated' }, { id: '2', short_name: 'wl.202710.MATH.20100.102', name: 'Calculus' }, { id: '3', short_name: 'CS 180', name: 'Programming' }];
  assert.strictEqual(gs.match({ course_code: 'WL.202710.MATH.20100.102', name: 'x' }, gsCourses).id, '2');
  assert.strictEqual(gs.match({ course_code: 'wl.202710.CS.18000.BLK', name: 'Fall 2026 CS 18000' }, gsCourses).id, '3');
  assert.strictEqual(gs.match({ course_code: 'wl.202710.ENGL.10600.Y12', name: 'English' }, gsCourses), null);

  const before = calls.length;
  await data.courses();
  assert.strictEqual(calls.length, before, 'second read served from cache');
  console.log('data tests ok,', calls.length, 'requests');
})().catch((e) => { console.error('DATA TESTS FAILED', e); process.exit(1); });
