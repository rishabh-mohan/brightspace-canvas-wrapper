// Edfinity reader: the page's own data (scrubbed real pages in fixtures/edfinity), the course
// JSON, grade states, course matching, the external-item shape, snapshot merging, readApi
// and forCourses with stand-in extension APIs.
// Usage: node tests/edfinity.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// A stand-in for the extension APIs: storage.local and runtime.sendMessage.
const stored = {};
let answer = () => ({ ok: true });
const sent = [];
globalThis.chrome = {
  runtime: { sendMessage: async (msg) => (sent.push(msg), answer(msg)) },
  storage: { local: {
    get: async (k) => (k in stored ? { [k]: JSON.parse(JSON.stringify(stored[k])) } : {}),
    set: async (o) => Object.assign(stored, JSON.parse(JSON.stringify(o))),
    remove: async (k) => [].concat(k).forEach((x) => delete stored[x]),
  } },
};
globalThis.BSX = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'edfinity.js'), 'utf8'));
const E = BSX.edfinity;
const fixture = (f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'edfinity', f), 'utf8');
const id = (n) => 'f0e1d2c3b4a5' + String(n).padStart(12, '0');
const REG = id(1);
const NOW = Date.parse('2026-11-10T18:00:00Z');
const DAY = 864e5;

(async () => {
  // ---- unquote: Rails' single-quoted JavaScript strings
  assert.strictEqual(E.unquote(String.raw`'a\'b\"c\\d\u00e9\x41\/\n'`), 'a\'b"c\\déA/\n');
  assert.strictEqual(E.unquote(String.raw`'{\"x\":\"\u003cb\u003e\"}'`), '{"x":"<b>"}');

  // ---- bootstrap: the page's inline scripts, never run
  assert.deepStrictEqual(E.bootstrap(['var x = 1;', '']), {});
  assert.deepStrictEqual(E.bootstrap([`_E.session = JSON.parse('{bad');`]), {}, 'bad JSON is skipped');
  const hw = E.bootstrap([fixture('session-script.txt')]);
  const ca = E.bootstrap([fixture('assessment-script.txt')]);
  assert.ok(hw.session && !hw.assessment);
  assert.ok(ca.assessment && !ca.session);

  // ---- fromBootstrap: a started assignment page (HW12) and a start page (CA5)
  const seenHw = E.fromBootstrap(hw);
  assert.strictEqual(seenHw.kind, 'assignment');
  assert.deepStrictEqual(seenHw.course, { id: REG, name: 'STAT 350 FALL 2026 (In-person) -- Lee', section_id: id(3) });
  assert.deepStrictEqual(seenHw.assignment, {
    id: id(7), name: 'Homework Assignment #12',
    due_at: '2026-12-07T04:59:59.000Z', late_due_at: '2026-12-09T04:59:59.000Z', available_at: '2026-11-08T05:00:00.000Z',
    score: null, max: 32, displayed: '', status: 'Not started', submitted: false,
  });
  const seenCa = E.fromBootstrap(ca);
  assert.strictEqual(seenCa.course.id, REG);
  assert.strictEqual(seenCa.assignment.name, 'Computer Assignment #5: Simple Linear Regression');
  assert.strictEqual(seenCa.assignment.due_at, '2026-12-07T04:59:59.000Z');
  assert.strictEqual(seenCa.assignment.score, null, 'no grade before it is started');
  assert.strictEqual(seenCa.assignment.status, 'Not started');
  assert.strictEqual(E.fromBootstrap({}), null);
  assert.strictEqual(E.fromBootstrap({ assessment: { assignment: { id: 'x' } } }), null, 'no registration');

  // ---- the student's own dates win over the assignment's (extensions)
  const own = E.fromAssessment({
    assignment: { id: id(20), name: 'HW', due_date: '2026-11-20T23:59:00-06:00' },
    registration: { id: REG }, due_date: '2026-11-22T23:59:00-06:00', readonly: { status: 'open' },
  });
  assert.strictEqual(own.due_at, '2026-11-23T05:59:00.000Z');
  assert.strictEqual(own.late_due_at, null);

  // ---- grade states
  const asg = { id: id(21), name: '  Quiz  1 ' };
  const g = (grade, o) => E.fromAssignment(asg, grade, o);
  assert.strictEqual(g(null).name, 'Quiz 1');
  assert.deepStrictEqual(
    (({ score, max, displayed, status, submitted }) => ({ score, max, displayed, status, submitted }))(
      g({ status: 'in progress', score: 12, points: 30, pct_complete: 40, displayed_score_pct: 40, num_submitted: 2 })),
    { score: 12, max: 30, displayed: '40%', status: 'In progress', submitted: false });
  const done = g({ status: 'completed', score: 28, points: 30, pct_complete: 100, displayed_score_pct: 93.3 });
  assert.strictEqual(done.submitted, true);
  assert.strictEqual(done.status, 'Completed');
  assert.strictEqual(done.displayed, '93.3%');
  assert.strictEqual(g({ status: 'submitted', score: 5, points: 10 }).submitted, true);
  assert.strictEqual(g({ status: 'not submitted', score: 0, points: 10 }).submitted, false);
  assert.strictEqual(g({ status: 'scored', pct_complete: 100, score: 9, override_score: 10, points: 10 }).score, 10, 'override wins');
  assert.strictEqual(g({ status: 'not started', score: 0, points: 10 }).score, null, 'no score before it is started');
  assert.strictEqual(g({ status: 'not started', num_submitted: 1, score: 3, points: 10 }).score, 3);
  const ex = g({ status: 'not started', points: 10 }, { excused: true });
  assert.strictEqual(ex.status, 'Excused');
  assert.strictEqual(ex.submitted, true);
  assert.strictEqual(g(null, { status: 'open' }).status, 'Not started', "the page's 'open' is not a grade");
  assert.strictEqual(E.fromAssignment({ id: 'x', name: 'Bad date', due_date: 'soon' }).due_at, null);

  // ---- My Courses and one course (scrubbed real answers)
  const courses = E.fromRegistrations(JSON.parse(fixture('registrations.json')));
  assert.deepStrictEqual(courses, { kind: 'courses', courses: [{ id: REG, section_id: id(3), name: 'STAT 350 FALL 2026 (In-person) -- Lee' }] });
  assert.deepStrictEqual(E.fromRegistration(JSON.parse(fixture('registration.json'))).course, courses.courses[0]);
  const mixed = E.fromRegistrations({ models: [
    { id: id(30), section: { id: id(31) }, readonly: { section_name: 'MA 161', dropped: true } },
    { id: id(32), section: { id: id(33) }, readonly: { section_name: 'MA 162', expired: true } },
    { id: id(34), active: false, readonly: { section_name: 'MA 163' } },
    { id: id(35), readonly: { section_name: 'MA 165', accessible: false } },
    { id: id(36), section_id: id(37), readonly: { section_name: 'MA 166' } },
  ] });
  assert.deepStrictEqual(mixed.courses.map((c) => [c.id, c.section_id]), [[id(36), id(37)]], 'dropped, expired, inactive and closed-off courses are left out');
  assert.deepStrictEqual(E.fromRegistrations(null).courses, []);

  // ---- fromAssignmentList: the real list (scrubbed, made-up scores), 17 assignments
  const c1 = courses.courses[0];
  const real = E.fromAssignmentList(JSON.parse(fixture('assignments.json')), c1);
  assert.strictEqual(real.kind, 'assignments');
  assert.strictEqual(real.course, c1);
  assert.strictEqual(real.assignments.length, 17);
  assert.deepStrictEqual(real.assignments.map((a) => a.name.replace(/^(Homework|Computer) Assignment #?(\d+).*/, '$1 $2')), [
    'Homework 1', 'Homework 2', 'Homework 3', 'Homework 4', 'Homework 5', 'Homework 6', 'Homework 7', 'Homework 8', 'Homework 9',
    'Homework 10', 'Homework 11', 'Homework 12', 'Computer 1', 'Computer 2', 'Computer 3', 'Computer 4', 'Computer 5',
  ], "Edfinity's sort_order, not the answer's order");
  // completed (grade.status 'completed', state closed)
  assert.deepStrictEqual(real.assignments[0], {
    id: real.assignments[0].id, name: 'Homework Assignment #1',
    due_at: '2026-09-02T03:59:59.000Z', late_due_at: '2026-09-04T03:59:59.000Z', available_at: '2026-08-21T04:00:00.000Z',
    score: 6, max: 6, displayed: '', status: 'Completed', submitted: true,
  });
  assert.deepStrictEqual([real.assignments[1].score, real.assignments[1].max], [15.75, 21]);
  // completed during the late period (readonly.late, past_due)
  assert.deepStrictEqual((({ status, submitted, score, max }) => ({ status, submitted, score, max }))(real.assignments[10]), { status: 'Completed', submitted: true, score: 18.5, max: 24.5 });
  // opened, not started (grade.status 'not started', state underway): the same as its page says
  assert.deepStrictEqual(real.assignments[11], seenHw.assignment);
  // never opened (no assessment)
  assert.deepStrictEqual(
    (({ id: i, status, submitted, score, max, due_at }) => ({ i, status, submitted, score, max, due_at }))(real.assignments[16]),
    { i: id(10), status: 'Not started', submitted: false, score: null, max: null, due_at: '2026-12-07T04:59:59.000Z' });
  assert.ok(real.assignments.every((a) => a.due_at && a.late_due_at), 'every assignment has a due date and a late date');
  assert.strictEqual(real.assignments.filter((a) => a.submitted).length, 15);

  // the variants the sample did not have
  const entry = (n, name, due, assessment, more = {}) => ({
    id: id(n), name, due_date: due, assignment_due_date: due, late_work_date: null, live: false,
    readonly: { accessible: true, excused: false, released: false }, ...(assessment ? { assessment } : {}), ...more,
  });
  const listA = E.fromAssignmentList([
    entry(40, 'HW 1', '2026-11-12T22:59:59.000-06:00', { grade: { status: 'completed', score: 10, points: 10, pct_complete: 100 } }),
    entry(41, 'HW 2', '2026-11-19T22:59:59.000-06:00'),
    { id: id(42) }, null,
  ], c1);
  assert.deepStrictEqual(listA.assignments.map((a) => [a.name, a.submitted, a.score]), [['HW 1', true, 10], ['HW 2', false, null]]);
  const listB = E.fromAssignmentList({ models: [entry(43, 'HW 3', '2026-11-26T22:59:59.000-06:00', { grade: { status: 'in progress', score: 2, points: 8 } })] }, c1);
  assert.deepStrictEqual(listB.assignments.map((a) => [a.name, a.due_at, a.score, a.max, a.status, a.submitted]), [['HW 3', '2026-11-27T04:59:59.000Z', 2, 8, 'In progress', false]]);
  const v = E.fromAssignmentList([
    // an extension: the student's own dates win
    entry(44, 'Extended', '2026-11-20T22:59:59.000-06:00', { due_date: '2026-11-22T22:59:59.000-06:00', late_work_date: '2026-11-24T22:59:59.000-06:00', grade: { status: 'not started', points: 5 } }, { sort_order: 2 }),
    // excused, with no grade
    entry(45, 'Excused', '2026-11-20T22:59:59.000-06:00', null, { sort_order: 1, readonly: { accessible: true, excused: true } }),
    // scores hidden by the instructor
    entry(46, 'Hidden', '2026-11-20T22:59:59.000-06:00', { scored_session: { points: 9, score: 7, environment: { show_scores: false } }, grade: { status: 'completed', score: 7, pct_complete: 100 } }, { sort_order: 0 }),
    // an override, and points only on the scored session
    entry(47, 'Override', '2026-11-20T22:59:59.000-06:00', { scored_session: { points: 12 }, grade: { status: 'completed', score: 6, override_score: 11, pct_complete: 100 } }, { sort_order: 3 }),
    // not accessible: left out
    entry(48, 'Locked', '2026-11-20T22:59:59.000-06:00', null, { sort_order: 4, readonly: { accessible: false } }),
    // the name only on the assessment
    { id: id(49), sort_order: 5, readonly: {}, assessment: { readonly: { name: 'From assessment' } } },
  ], c1).assignments;
  assert.deepStrictEqual(v.map((a) => [a.name, a.status, a.submitted, a.score, a.max]), [
    ['Hidden', 'Completed', true, null, 9],
    ['Excused', 'Excused', true, null, null],
    ['Extended', 'Not started', false, null, 5],
    ['Override', 'Completed', true, 11, 12],
    ['From assessment', 'Not started', false, null, null],
  ]);
  assert.deepStrictEqual([v[2].due_at, v[2].late_due_at], ['2026-11-23T04:59:59.000Z', '2026-11-25T04:59:59.000Z']);
  assert.strictEqual(E.fromAssignmentList(undefined, c1), null, 'not a list');
  assert.strictEqual(E.fromAssignmentList({ error: 'Not found' }, c1), null);
  assert.deepStrictEqual(E.fromAssignmentList([], c1).assignments, [], 'an empty list is a list');

  // ---- subjectKey and pair
  assert.strictEqual(E.subjectKey('STAT 350 FALL 2026 (In-person) -- Lee'), 'STAT350');
  assert.strictEqual(E.subjectKey('wl.202710.STAT.35000.001'), 'STAT350');
  assert.strictEqual(E.subjectKey('MA 16100'), 'MA161');
  assert.strictEqual(E.subjectKey('Statistics'), null);
  const bs = [
    { id: 11, name: 'STAT 35000: Intro to Statistics', course_code: 'wl.202710.STAT.35000.001' },
    { id: 12, name: 'MA 16100', course_code: 'wl.202710.MA.16100.002' },
    { id: 13, name: 'Physics', course_code: 'PHYS-X' },
  ];
  const ed = [c1, { id: id(50), name: 'MA 161 Fall 2026' }, { id: id(51), name: 'Homework (Smith)' }];
  let p = E.pair(ed, bs);
  assert.strictEqual(p.get(REG).id, 11);
  assert.strictEqual(p.get(id(50)).id, 12);
  assert.ok(!p.has(id(51)), 'no guess without a link in Content');
  p = E.pair(ed, bs, { withTool: [13] });
  assert.strictEqual(p.get(id(51)).id, 13, 'the one left over goes with the one course that links to Edfinity');
  p = E.pair([...ed, { id: id(52), name: 'Other' }], bs, { withTool: [13] });
  assert.ok(!p.has(id(51)) && !p.has(id(52)), 'no guess with two left over');
  p = E.pair(ed, bs, { map: { [REG]: 13, [id(50)]: 0 } });
  assert.strictEqual(p.get(REG).id, 13, "the student's choice wins");
  assert.ok(!p.has(id(50)), '0 hides a course');
  p = E.pair([c1, { id: id(53), name: 'STAT 350 lab' }], bs);
  assert.strictEqual(p.size, 1, 'a Brightspace course is used once');

  // ---- itemsFor: the external-item shape
  const items = E.itemsFor(c1, [...listA.assignments, { ...listB.assignments[0], id: 'odd' }], bs[0]);
  assert.strictEqual(items.length, 3);
  assert.deepStrictEqual(items[0], {
    kind: 'external', source: 'Edfinity', source_id: `edf-${REG}-${id(40)}`, course_id: 11, name: 'HW 1',
    due_at: '2026-11-13T04:59:59.000Z', late_due_at: null, points_possible: 10,
    grade: { score: 10, points_possible: 10, displayed: '', comment: '', graded_at: null },
    submitted: true, status: 'Completed', order: [0, 0],
    html_url: `https://edfinity.com/assessments/new?registration_id=${REG}&assignment_id=${id(40)}`,
  });
  assert.strictEqual(items[1].grade, null);
  assert.strictEqual(items[1].status, 'Not started');
  assert.deepStrictEqual(items[1].order, [0, 1]);
  assert.strictEqual(items[2].html_url, 'https://edfinity.com/registrations', 'odd ids fall back to My Courses');
  const hwItem = E.itemsFor(seenHw.course, [seenHw.assignment], bs[0])[0];
  assert.strictEqual(hwItem.late_due_at, '2026-12-09T04:59:59.000Z');
  assert.strictEqual(hwItem.points_possible, 32);

  // ---- mergeSnapshot
  let snap = E.mergeSnapshot(null, courses, NOW);
  assert.deepStrictEqual(snap, { v: 2, courses: [c1], courses_at: NOW, api_at: null, lists: {} });
  assert.strictEqual(E.mergeSnapshot(snap, { kind: 'courses', courses: [] }, NOW), snap, 'an empty list keeps the old');
  assert.strictEqual(E.mergeSnapshot(null, null, NOW), null);
  assert.strictEqual(E.mergeSnapshot({ v: 1, items: [] }, { kind: 'nothing' }, NOW).v, 1, 'nothing to keep: the old one, as it was');
  snap = E.mergeSnapshot(snap, listA, NOW);
  assert.deepStrictEqual(snap.lists[REG].assignments.map((a) => a.id), [id(40), id(41)]);
  assert.strictEqual(snap.lists[REG].full_at, NOW);
  // one assignment seen on its page: updated in place, a new one appended
  const hw2 = { ...listA.assignments[1], status: 'In progress', score: 3 };
  snap = E.mergeSnapshot(snap, { kind: 'assignment', course: { id: REG, name: '', section_id: '' }, assignment: hw2 }, NOW + 1000);
  assert.deepStrictEqual(snap.lists[REG].assignments.map((a) => [a.id, a.status]), [[id(40), 'Completed'], [id(41), 'In progress']]);
  assert.strictEqual(snap.lists[REG].at, NOW + 1000);
  assert.strictEqual(snap.lists[REG].full_at, NOW, 'one assignment is not a full list');
  assert.strictEqual(snap.courses[0].name, c1.name, 'a blank name does not erase a known one');
  snap = E.mergeSnapshot(snap, seenHw, NOW + 2000);
  assert.deepStrictEqual(snap.lists[REG].assignments.map((a) => a.id), [id(40), id(41), id(7)]);
  // a page seen in a course with no list yet
  const other = E.mergeSnapshot(null, seenCa, NOW);
  assert.deepStrictEqual(other.courses, [seenCa.course]);
  assert.strictEqual(other.lists[REG].full_at, null);
  assert.strictEqual(E.mergeSnapshot(null, { kind: 'course', course: c1 }, NOW).courses[0].id, REG);
  // lists not seen for 180 days are dropped
  const old = E.mergeSnapshot(null, { kind: 'assignment', course: { id: id(60) }, assignment: hw2 }, NOW - 181 * DAY);
  assert.ok(!E.mergeSnapshot(old, courses, NOW).lists[id(60)]);

  // ---- combine: the newer list wins, course names are kept
  const a = { v: 2, courses: [{ id: REG, name: '' }], courses_at: null, api_at: NOW, lists: { [REG]: { at: NOW + 5, assignments: [1] } } };
  const b = { v: 2, courses: [{ id: REG, name: 'Kept' }, { id: id(61), name: 'B only' }], courses_at: NOW - 9, api_at: null, lists: { [REG]: { at: NOW, assignments: [2] }, [id(61)]: { at: NOW, assignments: [3] } } };
  const both = E.combine(a, b);
  assert.deepStrictEqual(both.lists[REG].assignments, [1]);
  assert.deepStrictEqual(both.lists[id(61)].assignments, [3]);
  assert.strictEqual(both.courses.length, 2);
  assert.strictEqual(both.courses_at, NOW - 9);
  assert.strictEqual(both.api_at, NOW);
  assert.deepStrictEqual(E.combine(null, null), { v: 2, courses: [], courses_at: null, api_at: null, lists: {} });

  // ---- readApi with a stand-in get
  const routes = { ...E.ROUTES };
  assert.strictEqual(E.ROUTES.courses, '/registrations');
  assert.strictEqual(E.ROUTES.assignments(REG), `/registrations/${REG}/assignments`);
  const asked = [];
  const getter = (by) => async (p) => (asked.push(p), by(p));
  let r = await E.readApi(getter(() => ({ status: 200, url: 'https://edfinity.com/users/sign_in', json: null })), NOW);
  assert.strictEqual(r.state, 'signed_out');
  r = await E.readApi(getter(() => ({ status: 401, url: '', json: {} })), NOW);
  assert.strictEqual(r.state, 'signed_out');
  r = await E.readApi(getter(() => ({ status: 200, url: '', json: { models: [] } })), NOW);
  assert.strictEqual(r.state, 'unrecognised');
  const LIST = `/registrations/${REG}/assignments`;
  const site = (p) => ({ status: 200, url: '', json: p === '/registrations' ? JSON.parse(fixture('registrations.json')) : p === LIST ? JSON.parse(fixture('assignments.json')) : null });
  asked.length = 0;
  r = await E.readApi(getter(site), NOW);
  assert.strictEqual(r.state, 'ok');
  assert.strictEqual(r.snap.api_at, NOW);
  assert.deepStrictEqual(asked, ['/registrations', LIST]);
  assert.strictEqual(r.snap.lists[REG].assignments.length, 17);
  // keep narrows the lists read; a list that fails to load is skipped
  asked.length = 0;
  const twoCourses = { models: [{ id: REG, readonly: { section_name: 'STAT 350' } }, { id: id(62), readonly: { section_name: 'ENGL 106' } }] };
  r = await E.readApi(getter((p) => (p === '/registrations' ? { status: 200, json: twoCourses } : site(p))), NOW, (cs) => cs.filter((c) => c.id === REG));
  assert.deepStrictEqual(asked, ['/registrations', LIST], 'keep narrows the lists read');
  assert.strictEqual(r.snap.lists[REG].assignments.length, 17);
  r = await E.readApi(getter((p) => (p === '/registrations' ? { status: 200, json: twoCourses } : p === LIST ? site(p) : { status: 500, json: { error: 'x' } })), NOW);
  assert.ok(r.snap.lists[REG] && !r.snap.lists[id(62)], 'an error answer is not an empty list');
  // without a list route: only My Courses
  E.ROUTES.assignments = null;
  asked.length = 0;
  r = await E.readApi(getter(site), NOW);
  assert.deepStrictEqual(asked, ['/registrations']);
  E.ROUTES.courses = null;
  assert.strictEqual((await E.readApi(getter(() => assert.fail('no request')), NOW)).state, 'skipped');
  Object.assign(E.ROUTES, routes);

  // ---- forCourses
  const opts = { map: {}, withTool: [] };
  answer = () => ({ error: 'permission' });
  r = await E.forCourses(bs, opts, NOW);
  assert.strictEqual(r.state, 'no_permission');
  assert.deepStrictEqual(r.items, []);

  // live read fails (e.g. the partitioned cookie): nothing stored yet
  answer = (m) => (m.op === 'check' ? { ok: true } : { status: 200, url: 'https://edfinity.com/users/sign_in', json: null });
  E.clear();
  r = await E.forCourses(bs, opts, NOW);
  assert.strictEqual(r.state, 'signed_out');
  answer = (m) => (m.op === 'check' ? { ok: true } : { error: 'Network error' });
  E.clear();
  r = await E.forCourses(bs, opts, NOW);
  assert.strictEqual(r.state, 'no_data');

  // what the content script stored on edfinity.com is used
  stored[E.KEY] = E.mergeSnapshot(E.mergeSnapshot(null, courses, NOW - 2 * DAY), seenHw, NOW - 2 * DAY);
  r = await E.forCourses(bs, opts, NOW);
  assert.strictEqual(r.state, 'ok');
  assert.strictEqual(r.live, 'error');
  assert.deepStrictEqual(r.items.map((x) => [x.name, x.course_id]), [['Homework Assignment #12', 11]]);
  assert.strictEqual(r.synced_at, NOW - 2 * DAY);
  assert.strictEqual(r.stale, true, 'older than a day');
  r = await E.forCourses(bs, opts, NOW - 2 * DAY + 3600e3);
  assert.strictEqual(r.stale, false);
  r = await E.forCourses(bs, { map: { [REG]: 0 }, withTool: [] }, NOW);
  assert.deepStrictEqual(r.items, [], 'a hidden course gives nothing');

  // a live read whose list fails keeps what is stored, and is saved
  answer = (m) => (m.op === 'check' ? { ok: true } : m.path === '/registrations' ? site(m.path) : { status: 404, url: '', json: null });
  E.clear();
  sent.length = 0;
  r = await E.forCourses(bs, opts, NOW);
  assert.strictEqual(r.live, 'ok');
  assert.strictEqual(r.items.length, 1, 'the stored list survives');
  assert.deepStrictEqual(sent.map((m) => m.op || m.path), ['check', '/registrations', LIST]);
  assert.ok(sent.every((m) => m.type === 'bsx-edfinity'));
  await new Promise((done) => setTimeout(done, 0));
  assert.strictEqual(stored[E.KEY].api_at, NOW);
  assert.ok(stored[E.KEY].lists[REG], 'the saved copy keeps the list');
  // a full live read replaces the course's list
  answer = (m) => (m.op === 'check' ? { ok: true } : site(m.path));
  E.clear();
  r = await E.forCourses(bs, opts, NOW + 1000);
  assert.strictEqual(r.items.length, 17);
  assert.ok(r.items.every((x) => x.course_id === 11 && x.source === 'Edfinity'));
  assert.strictEqual(r.synced_at, NOW + 1000);
  assert.strictEqual(r.stale, false);
  assert.deepStrictEqual(r.items.filter((x) => !x.submitted).map((x) => x.name), ['Homework Assignment #12', 'Computer Assignment #5: Simple Linear Regression']);
  // cached: a second read in the same minutes does not ask again
  sent.length = 0;
  await E.forCourses(bs, opts, NOW + 1000);
  assert.deepStrictEqual(sent.map((m) => m.op || m.path), ['check']);

  // ---- forget
  E.forget();
  await new Promise((done) => setTimeout(done, 0));
  assert.ok(!(E.KEY in stored));
  assert.strictEqual(await E.load(), null);

  console.log('edfinity tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
