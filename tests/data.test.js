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
    { OrgUnit: { Id: 12, Type: { Code: 'Course Offering' }, Name: 'Old', Code: 'c' }, Access: { IsActive: true, CanAccess: true, EndDate: past }, PinDate: null },
    { OrgUnit: { Id: 70, Type: { Code: 'Group' }, Name: 'Team 7', Code: 'g7' }, Access: { IsActive: true, CanAccess: true }, PinDate: null },
    { OrgUnit: { Id: 71, Type: { Code: 'Group' }, Name: 'Lonely', Code: 'g8' }, Access: { IsActive: true, CanAccess: true }, PinDate: null }] },
  '/d2l/api/lp/1.64/10/groupcategories/': [{ GroupCategoryId: 3, Name: 'Projects' }],
  '/d2l/api/lp/1.64/10/groupcategories/3/groups/': [{ GroupId: 70, Name: 'Team 7', Enrollments: [42, 43] }, { GroupId: 99, Name: 'Not mine', Enrollments: [1] }],
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
const posts = [];
const ctx = {
  console, URL, Date, Math, JSON, Promise, Map, Set, encodeURIComponent, setTimeout, clearTimeout, Blob,
  localStorage: { getItem: (k) => (k === 'XSRF.Token' ? 'x1' : null) },
  location: { origin: 'https://x.brightspace.com', host: 'x.brightspace.com' },
  sessionStorage: { getItem: () => null, setItem() {} },
  fetch: async (p, opts = {}) => {
    calls.push(p);
    if (opts.method === 'POST') {
      posts.push({ p, opts });
      if (p === '/d2l/lp/auth/oauth2/token') return { ok: opts.headers['X-Csrf-Token'] === 'x1', json: async () => ({ access_token: 'tok' }) };
      return { ok: true, status: 200, text: async () => '{}' };
    }
    if (p.startsWith('/d2l/lms/')) return { ok: true, status: 200, url: p, text: async () => '<html><td>Attempts</td><td>Allowed - 2, Completed - 1</td><p>Due on 11/12/2026 11:59 PM</p></html>' };
    if (p.startsWith('/d2l/api/le/1.100/calendar/events/myEvents/')) {
      return { ok: true, json: async () => ({ Objects: [
        { CalendarEventId: 3, Title: 'HW1 - Available', OrgUnitId: 10, OrgUnitName: 'A', StartDateTime: past, EndDateTime: past, IsAssociatedWithEntity: true, AssociatedEntity: { AssociatedEntityType: 'Dropbox', AssociatedEntityId: 5, Link: '/x' } },
        { CalendarEventId: 1, Title: 'HW1 - Due', OrgUnitId: 10, OrgUnitName: 'A', StartDateTime: soon, EndDateTime: soon, IsAssociatedWithEntity: true, AssociatedEntity: { AssociatedEntityType: 'Dropbox', AssociatedEntityId: 5, Link: '/x' } },
        { CalendarEventId: 2, Title: 'Lecture', OrgUnitId: 10, OrgUnitName: 'A', StartDateTime: soon, EndDateTime: soon, IsAssociatedWithEntity: false }], Next: null }) };
    }
    if (!(p in routes)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[p] };
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['src/client.js', 'src/data.js', 'src/gradescope.js', 'src/ed.js']) vm.runInContext(fs.readFileSync(path.join(ext, f), 'utf8'), ctx, { filename: f });

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
  assert.strictEqual(cal.length, 2, 'availability and due events for one item merged');
  assert.deepStrictEqual(Array.from(cal, (e) => e.id).sort(), [1, 2]);
  assert.strictEqual(cal.find((e) => e.id === 1).html_url, '/x');

  // Drop-lowest: the worst score in a category is left out.
  const dropped = { system: 'Points', groups: [{ drop_lowest: 1, items: [
    { id: 1, type: 'Numeric', points_possible: 10, value: { score: 2, points_possible: 10 } },
    { id: 2, type: 'Numeric', points_possible: 10, value: { score: 9, points_possible: 10 } },
    { id: 3, type: 'Numeric', points_possible: 10, value: { score: 7, points_possible: 10 } }] }] };
  assert.deepEqual({ ...data.estimate(dropped) }, { score: 16, points_possible: 20 });
  // Unticked "based only on graded assignments": ungraded items count as zero.
  const some = { system: 'Points', groups: [{ items: [
    { id: 1, type: 'Numeric', points_possible: 10, value: { score: 8, points_possible: 10 } },
    { id: 2, type: 'Numeric', points_possible: 10, value: null }] }] };
  assert.deepEqual({ ...data.estimate(some, new Map(), { allItems: true }) }, { score: 8, points_possible: 20 });
  // Weighted What-If on an ungraded item: its share is item weight x category weight.
  const wu = { system: 'Weighted', groups: [{ items: [
    { id: 1, type: 'Numeric', value: { score: 8, points_possible: 10, weighted_possible: 20 } },
    { id: 2, type: 'Numeric', value: null, points_possible: 50, weight: 25, group_weight: 40 }] }] };
  assert.strictEqual(data.estimable(wu, wu.groups[0].items[1]), true);
  assert.deepEqual({ ...data.estimate(wu, new Map([[2, 25]])) }, { score: 21, points_possible: 30 });

  // Quiz attempts: when the API refuses, Brightspace's quiz summary page is read instead.
  const sum = await data.quizAttempts(10, 7);
  assert.strictEqual(sum.known, true);
  assert.strictEqual(sum.attempts_used, 1);
  assert.strictEqual(sum.remaining, 1);
  const p = data.parseQuizSummary;
  assert.strictEqual(p('Completed on 11/12/2026').known, false, 'a date is not an attempt count');
  assert.deepStrictEqual([p('Attempts Allowed: 3 Attempts Remaining: 1').attempts_used, p('Attempts Allowed: 3 Attempts Remaining: 1').remaining], [2, 1]);
  assert.strictEqual(p('Allowed - Unlimited, Completed - 4').remaining, null);
  assert.strictEqual(p('<p>Nothing useful</p>').known, false);
  // Purdue's wording, from the probe: "<due date> PM Attempts Allowed - 1, Completed - 0".
  const purdue = p('<td>Due 11/12/2026 11:59 PM</td><td>Attempts</td><td>Allowed - 2, Completed - 1</td>');
  assert.deepStrictEqual([purdue.known, purdue.attempts_used, purdue.allowed, purdue.remaining], [true, 1, 2, 1]);
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
  // Once the student has posted in the topic, it leaves To Do.
  routes['/d2l/api/lp/1.64/users/whoami'] = { Identifier: '42', FirstName: 'A' };
  routes['/d2l/api/le/1.100/12/discussions/forums/1/topics/31/posts/?sort=creationdate&pageSize=1000'] = [{ PostId: 1, PostingUserId: 42, DatePosted: past, Message: {} }];
  ctx.BSX.client.clear();
  assert.strictEqual((await data.todo([{ id: 12, name: 'C' }])).length, 0);
  assert.strictEqual((await data.discussion(12, 31)).posts[0].mine, true);

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

  await data.courses();
  const before = calls.length;
  await data.courses();
  assert.strictEqual(calls.length, before, 'second read served from cache');

  // Groups: memberships from enrolments; course, category and members where readable.
  const grp = await data.groups(courses);
  assert.deepStrictEqual(Array.from(grp, (g) => `${g.name}:${g.course_id}:${g.category}`), ['Team 7:10:Projects', 'Lonely:null:']);
  assert.deepStrictEqual(Array.from(grp[0].member_ids), ['42', '43']);
  assert.strictEqual(grp[1].member_ids, null);

  // Assignment detail: rubric, rubric results, feedback files, download addresses.
  routes['/d2l/api/le/1.100/13/dropbox/folders/'] = [{ Id: 5, Name: 'Essay', DueDate: soon, SubmissionType: 0, SubmissionsRule: 4, Availability: null, GradeItemId: null,
    Attachments: [{ FileId: 3, FileName: 'prompt.pdf', Size: 10 }],
    Assessment: { ScoreDenominator: 10, Rubrics: [{ RubricId: 9, Name: 'R', ScoringMethod: 1, CriteriaGroups: [{ Name: 'G', Levels: [{ Id: 1, Name: 'Good' }, { Id: 2, Name: 'Poor' }], Criteria: [{ Id: 91, Name: 'Clarity', Cells: [{ Points: 10, Description: { Text: 'clear' } }, { Points: 0, Description: { Text: 'unclear' } }] }] }], OverallLevels: [] }] } }];
  routes['/d2l/api/le/1.100/13/dropbox/folders/5/submissions/mysubmissions/'] = [{ Entity: { EntityId: 42, EntityType: 'User' }, Status: 3,
    Submissions: [{ Id: 8, SubmissionDate: past, Files: [{ FileId: 4, FileName: 'mine.pdf', Size: 5 }] }],
    Feedback: { Score: 10, IsGraded: true, Feedback: { Text: 'Nice' }, Files: [{ FileId: 6, FileName: 'notes.pdf', Size: 2 }], Links: [],
      RubricAssessments: [{ RubricId: 9, OverallOutcome: { Score: 10 }, CriteriaOutcome: [{ CriterionId: 91, LevelId: 1, Score: 10, Feedback: { Text: 'Well put' } }] }] } }];
  const essay = await data.assignment(13, 5);
  assert.strictEqual(essay.rubrics[0].criteria[0].levels[0].points, 10);
  assert.strictEqual(essay.rubrics[0].criteria[0].levels[1].description, 'unclear');
  assert.strictEqual(essay.feedback.rubrics[0].criteria[0].level_id, 1);
  assert.strictEqual(essay.feedback.rubrics[0].criteria[0].feedback, 'Well put');
  assert.strictEqual(essay.feedback.files[0].url, '/d2l/api/le/1.100/13/dropbox/folders/5/feedback/user/42/attachments/6');
  assert.strictEqual(essay.submissions[0].files[0].url, '/d2l/api/le/1.100/13/dropbox/folders/5/submissions/8/files/4');
  assert.strictEqual(essay.attachments[0].url, '/d2l/api/le/1.100/13/dropbox/folders/5/attachments/3');
  assert.strictEqual(data.canSubmit(essay).ok, false, 'only one submission allowed and already handed in');
  assert.strictEqual(data.canSubmit({ ...essay, submitted: false }).ok, true);
  assert.strictEqual(data.canSubmit({ ...essay, submitted: false, lock_at: past }).ok, false);
  assert.strictEqual(data.canSubmit({ ...essay, submitted: false, submission_type: 2 }).ok, false);

  // Handing in: token first, then one multipart/mixed POST with a JSON comment and the file.
  await data.submit(13, 5, new Blob(['hello'], { type: 'text/plain' }), 'my comment');
  assert.strictEqual(posts[0].p, '/d2l/lp/auth/oauth2/token');
  const sent = posts[1];
  assert.strictEqual(sent.p, '/d2l/api/le/1.100/13/dropbox/folders/5/submissions/mysubmissions/');
  assert.strictEqual(sent.opts.headers.Authorization, 'Bearer tok');
  assert.match(sent.opts.headers['Content-Type'], /^multipart\/mixed;boundary=/);
  const bodyText = await sent.opts.body.text();
  assert.match(bodyText, /Content-Type: application\/json\r\n\r\n\{"Text":"my comment","Html":null\}\r\n--/);
  assert.match(bodyText, /filename="file"[\s\S]*Content-Type: text\/plain\r\n\r\nhello\r\n--bsx\w+--/);

  // Ed reader: course matching (automatic, chosen, hidden) and lessons turned into work items.
  const edr = ctx.BSX.ed;
  const bsCourses = [{ id: 101, course_code: 'wl.202710.CS.25100.LE1', name: 'CS 25100' }, { id: 102, course_code: 'wl.202710.MA.26100.050', name: 'MA 26100' }];
  assert.strictEqual(edr.brightspaceFor({ id: 7, code: 'CS 251', name: 'DSA' }, bsCourses).id, 101);
  assert.strictEqual(edr.brightspaceFor({ id: 7, code: 'CS 251', name: 'DSA' }, bsCourses, { 7: 102 }).id, 102);
  assert.strictEqual(edr.brightspaceFor({ id: 7, code: 'CS 251', name: 'DSA' }, bsCourses, { 7: 0 }), null);
  assert.strictEqual(edr.brightspaceFor({ id: 8, code: 'ECE 100', name: 'Club' }, bsCourses), null);
  const lessons = edr.lessonItems({ id: 7 }, { lessons: [
    { id: 1, title: 'HW 1', due_at: soon, status: 'completed' },
    { id: 2, title: 'HW 2', due_at: soon, status: 'unattempted' },
    { id: 3, title: 'Hidden', due_at: soon, is_hidden: true },
    { id: 4, title: 'Draft', due_at: soon, state: 'draft' },
    { id: 5, title: 'No date' }] }, bsCourses[0], 'us');
  assert.deepStrictEqual(Array.from(lessons, (l) => `${l.name}:${l.submitted}`), ['HW 1:true', 'HW 2:false']);
  assert.strictEqual(lessons[0].html_url, 'https://edstem.org/us/courses/7/lessons/1');
  assert.strictEqual(lessons[0].course_id, 101);

  // Posting in a discussion: one JSON POST in Brightspace's CreatePostData shape.
  posts.length = 0;
  await data.post(12, 1, 31, { parentId: 7, subject: 'Re: Week 1', message: 'Agreed.' });
  const pp = posts.find((x) => x.p.endsWith('/posts/'));
  assert.strictEqual(pp.p, '/d2l/api/le/1.100/12/discussions/forums/1/topics/31/posts/');
  assert.strictEqual(pp.opts.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(pp.opts.body), { ParentPostId: 7, Subject: 'Re: Week 1', Message: { Content: 'Agreed.', Type: 'Text' }, IsAnonymous: false });

  // Saved answers: a new page draws from the last visit at once, then redraws when
  // Brightspace's real answer differs.
  const savedKey = 'bsxCache:x.brightspace.com';
  const stored = { [savedKey]: { entries: {
    '/d2l/api/versions/': { at: Date.now(), json: JSON.stringify([{ ProductCode: 'lp', LatestVersion: '1.64' }, { ProductCode: 'le', LatestVersion: '1.100' }]) },
    '/d2l/api/lp/1.64/users/whoami': { at: Date.now(), json: JSON.stringify({ Identifier: '42', FirstName: 'Old' }) } } } };
  let written = null;
  const ctx2 = { ...ctx, BSX: undefined, chrome: { storage: { local: { get: async (k) => ({ [k]: stored[k] }), set: async (o) => (written = o) } } } };
  ctx2.globalThis = ctx2;
  vm.createContext(ctx2);
  vm.runInContext(fs.readFileSync(path.join(ext, 'src/client.js'), 'utf8'), ctx2, { filename: 'client.js' });
  vm.runInContext(fs.readFileSync(path.join(ext, 'src/data.js'), 'utf8'), ctx2, { filename: 'data.js' });
  let redraws = 0;
  ctx2.BSX.client.onChange(() => redraws++);
  assert.strictEqual((await ctx2.BSX.data.me()).name, 'Old', 'first answer comes from the saved copy');
  await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual(redraws, 1, 'one redraw once the real answer arrived');
  assert.strictEqual((await ctx2.BSX.data.me()).name, 'A');
  assert.ok(written && written[savedKey].entries['/d2l/api/lp/1.64/users/whoami'].json.includes('"A"'), 'real answer saved for next time');
  console.log('data tests ok,', calls.length, 'requests');
})().catch((e) => { console.error('DATA TESTS FAILED', e); process.exit(1); });
