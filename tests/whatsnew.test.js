// What's new since the last visit (src/whatsnew.js): snapshots, diffs and mark seen.
// Usage: node tests/whatsnew.test.js
const assert = require('assert');
const path = require('path');
const ext = process.argv[2] || path.join(__dirname, '..', 'extension');
const W = require(path.join(ext, 'src', 'whatsnew.js'));

const T0 = Date.parse('2026-11-20T12:00:00Z');
const iso = (h) => new Date(T0 + h * 36e5).toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));

// A course's data as data.js returns it (only the fields whatsnew reads).
function course() {
  return {
    work: [
      { id: 'assignment-1', source_id: 1, kind: 'assignment', name: 'Homework 1', due_at: iso(24), grade_item_id: 501 },
      { id: 'quiz-2', source_id: 2, kind: 'quiz', name: 'Quiz 1', due_at: iso(48), grade_item_id: 502 },
      { id: 'discussion-3', source_id: 3, kind: 'discussion', name: 'Intro post', due_at: null, grade_item_id: null },
    ],
    grades: [
      { id: 501, title: 'Homework 1', grade: { score: 8, points_possible: 10, displayed: '8 / 10', comment: '', graded_at: iso(-5) } },
      { id: 900, title: 'Participation', grade: { score: 5, points_possible: 5, displayed: '5 / 5', comment: '', graded_at: iso(-50) } },
    ],
    news: [{ id: 11, title: 'Welcome', posted_at: iso(-100) }],
    modules: [
      { id: 1, name: 'Week 1', items: [
        { id: 1001, title: 'Slides 1', type: 'File', updated_at: iso(-200), html_url: '/d2l/le/content/101/viewContent/1001/View' },
        { id: 1002, title: 'Homework 1', type: 'Assignment', updated_at: iso(-200), html_url: '/x' },
        { id: 1003, title: 'Reading', type: 'Item', updated_at: iso(-200), html_url: '/d2l/le/content/101/viewContent/1003/View' },
      ] },
    ],
  };
}
const keys = (items) => items.map((i) => i.key);

// ---- first visit: recorded, nothing listed ----
let state = W.parseState(undefined);
assert.deepStrictEqual(state, { courses: {} });
let r = W.step(state, '101', course(), T0);
assert.deepStrictEqual(r, { items: [], changed: true, seeded: true });
assert.strictEqual(state.courses['101'].at, T0);
assert.deepStrictEqual(state.courses['101'].assignments, { 'assignment-1': iso(24) });
assert.deepStrictEqual(state.courses['101'].quizzes, { 'quiz-2': iso(48) });
assert.deepStrictEqual(state.courses['101'].discussions, { 'discussion-3': '' });
assert.deepStrictEqual(state.courses['101'].news, { 11: 1 });
assert.deepStrictEqual(Object.keys(state.courses['101'].content).sort(), ['1001', '1002', '1003']);
assert.strictEqual(state.courses['101'].grades['501'], '8|8 / 10|');

// Same data again: nothing new, nothing to save.
r = W.step(state, '101', course(), T0 + 1);
assert.deepStrictEqual(r, { items: [], changed: false, seeded: false });

// The state survives storage (JSON) and parsing unchanged.
assert.deepStrictEqual(W.parseState(clone(state), T0), state);
state = W.parseState(clone(state), T0);
assert.deepStrictEqual(W.step(state, '101', course()).items, []);

// ---- changes ----
const now = course();
now.news.unshift({ id: 12, title: 'Exam room', posted_at: iso(2) });
now.work.push({ id: 'quiz-4', source_id: 4, kind: 'quiz', name: 'Quiz 2', due_at: iso(96), grade_item_id: 504 });
now.work.push({ id: 'assignment-5', source_id: 5, kind: 'assignment', name: 'Lab 1', due_at: null, grade_item_id: null });
now.work[0].due_at = iso(30); // moved
now.work[2].due_at = iso(72); // set
now.grades.unshift({ id: 502, title: 'Quiz 1', grade: { score: 9, points_possible: 10, displayed: '9 / 10', comment: 'Nice', graded_at: iso(1) } });
now.grades[1].grade = { ...now.grades[1].grade, comment: 'See me', graded_at: iso(3) }; // feedback added to 501
now.grades[2].grade = { ...now.grades[2].grade, score: 4, displayed: '4 / 5', graded_at: iso(4) }; // regraded
now.modules[0].items.push({ id: 1004, title: 'Slides 2', type: 'File', updated_at: iso(1), html_url: '/s2' });
now.modules[0].items.push({ id: 1005, title: 'Lab 1', type: 'Assignment', updated_at: iso(1), html_url: '/lab' }); // same as new work
now.modules[0].items[2].updated_at = iso(5); // Reading updated
now.modules.push({ id: 2, name: 'Week 2', items: [{ id: 1e9 + 2, title: 'Week 2', type: 'Module overview', html_url: '/m2' }] });

const items = W.diff('101', state.courses['101'], now);
const by = Object.fromEntries(items.map((i) => [i.key, i]));
assert.deepStrictEqual(keys(items), [
  'news:101:12',
  'grade:101:900', // newest grading first within a kind
  'grade:101:501',
  'grade:101:502',
  'due:101:assignment-1',
  'due:101:discussion-3',
  'work:101:quiz-4',
  'work:101:assignment-5',
  'content:101:1003',
  'content:101:1004',
  'content:101:1000000002',
]);
assert.strictEqual(new Set(keys(items)).size, items.length, 'no duplicates');

assert.deepStrictEqual([by['news:101:12'].label, by['news:101:12'].section, by['news:101:12'].item], ['Announcement', 'announcements', 12]);
// Grades: new, feedback only, changed score; linked to the quiz or assignment when known.
assert.deepStrictEqual([by['grade:101:502'].label, by['grade:101:502'].section, by['grade:101:502'].item, by['grade:101:502'].comment], ['New grade', 'quizzes', 2, 'Nice']);
assert.deepStrictEqual([by['grade:101:501'].label, by['grade:101:501'].section, by['grade:101:501'].item], ['New feedback', 'assignments', 1]);
assert.deepStrictEqual([by['grade:101:900'].label, by['grade:101:900'].section, by['grade:101:900'].item, by['grade:101:900'].score], ['Grade changed', 'grades', null, 4]);
// Due dates.
assert.deepStrictEqual([by['due:101:assignment-1'].label, by['due:101:assignment-1'].old_due, by['due:101:assignment-1'].new_due], ['Due date changed', iso(24), iso(30)]);
assert.deepStrictEqual([by['due:101:discussion-3'].label, by['due:101:discussion-3'].section, by['due:101:discussion-3'].item], ['Due date set', 'discussions', 3]);
// New work.
assert.deepStrictEqual([by['work:101:quiz-4'].label, by['work:101:quiz-4'].section, by['work:101:quiz-4'].item], ['New quiz', 'quizzes', 4]);
assert.strictEqual(by['work:101:assignment-5'].label, 'New assignment');
// Content: updated, new file (module viewer), module text; the module entry for the new
// assignment is left to the work list.
assert.deepStrictEqual([by['content:101:1003'].label, by['content:101:1003'].url, by['content:101:1003'].module], ['Updated in Modules', '/d2l/le/content/101/viewContent/1003/View', 'Week 1']);
assert.deepStrictEqual([by['content:101:1004'].label, by['content:101:1004'].section, by['content:101:1004'].item, by['content:101:1004'].url], ['New in Modules', 'modules', 1004, undefined]);
assert.strictEqual(by['content:101:1000000002'].section, 'modules');
assert.ok(!items.some((i) => i.ref === '1005'));

// step() lists the same and does not touch the snapshot (still unseen on the next visit).
const before = clone(state);
r = W.step(state, '101', now);
assert.deepStrictEqual(keys(r.items), keys(items));
assert.strictEqual(r.changed, false);
assert.deepStrictEqual(state, before);

// The same instant written differently is not a change; a removed due date is.
const fmt = course();
fmt.work[0].due_at = iso(24).replace('.000Z', 'Z');
assert.deepStrictEqual(W.diff('101', state.courses['101'], fmt), []);
fmt.work[1].due_at = null;
assert.deepStrictEqual(W.diff('101', state.courses['101'], fmt).map((i) => [i.key, i.label]), [['due:101:quiz-2', 'Due date removed']]);

// ---- unreadable parts never flood ----
const blank = { work: null, grades: null, news: null, modules: null };
assert.deepStrictEqual(W.diff('101', state.courses['101'], blank), []);
// An empty list where the snapshot had entries counts as unreadable, and keeps the old part.
const empty = { work: [], grades: [], news: [], modules: [] };
assert.deepStrictEqual(W.diff('101', state.courses['101'], empty), []);
assert.deepStrictEqual(W.snapshot(empty, state.courses['101']).news, { 11: 1 });

// A part first read later is recorded silently, then tracked.
const late = W.parseState({ courses: { 102: { at: T0, assignments: { 'assignment-1': '' }, grades: null, news: null, content: null } } }, T0);
const c102 = course();
c102.work = [{ id: 'assignment-1', source_id: 1, kind: 'assignment', name: 'Homework 1', due_at: null }];
r = W.step(late, '102', c102, T0 + 5);
assert.deepStrictEqual(r.items, []);
assert.strictEqual(r.changed, true);
assert.deepStrictEqual(late.courses['102'].news, { 11: 1 });
assert.strictEqual(late.courses['102'].at, T0, 'filling a part is not marking seen');
c102.news.push({ id: 13, title: 'Later', posted_at: iso(9) });
assert.deepStrictEqual(keys(W.step(late, '102', c102).items), ['news:102:13']);

// ---- mark seen: per course and all ----
const two = W.parseState({});
W.step(two, '101', course(), T0);
W.step(two, '102', course(), T0);
const n101 = course();
n101.news.push({ id: 14, title: 'A', posted_at: iso(1) });
const n102 = course();
n102.news.push({ id: 15, title: 'B', posted_at: iso(1) });
W.markSeen(two, new Map([['101', n101]]), T0 + 10);
assert.strictEqual(two.courses['101'].at, T0 + 10);
assert.deepStrictEqual(W.diff('101', two.courses['101'], n101), []);
assert.deepStrictEqual(keys(W.diff('102', two.courses['102'], n102)), ['news:102:15'], 'other course still unseen');
assert.strictEqual(two.courses['102'].at, T0);
W.markSeen(two, new Map([['101', n101], ['102', n102]]), T0 + 20);
assert.deepStrictEqual([...W.diff('101', two.courses['101'], n101), ...W.diff('102', two.courses['102'], n102)], []);
assert.strictEqual(two.courses['102'].at, T0 + 20);
// Marking seen while a part is unreadable keeps what was recorded for it.
W.markSeen(two, new Map([['101', { ...n101, news: null }]]), T0 + 30);
assert.deepStrictEqual(two.courses['101'].news, { 11: 1, 14: 1 });
// Mark seen on a course never seen before records it.
W.markSeen(two, new Map([['103', course()]]), T0 + 40);
assert.deepStrictEqual(W.diff('103', two.courses['103'], course()), []);

// ---- stored state is checked ----
assert.deepStrictEqual(W.parseState(null), { courses: {} });
assert.deepStrictEqual(W.parseState({ courses: [] }), { courses: {} });
assert.deepStrictEqual(
  W.parseState({ courses: { 1: { at: 'x' }, 2: 5, 3: { at: 7, quizzes: [1], news: { 4: 1 } } }, enabled: true }, 10),
  { courses: { 3: { at: 7, assignments: null, quizzes: null, discussions: null, grades: null, news: { 4: 1 }, content: null } } }
);

// ---- Recent Activity skips announcements and grades already listed above it ----
assert.deepStrictEqual([...W.listed(items)].sort(), ['grade:101:501', 'grade:101:502', 'grade:101:900', 'news:101:12']);

// ---- one kind of work unreadable: no flood of "New quiz" ----
{
  const s = W.parseState({});
  W.step(s, '101', course(), T0);
  // The quiz tool failed for a moment (data.js gives [] for it): only assignments and discussions come back.
  const noQuiz = course();
  noQuiz.work = noQuiz.work.filter((a) => a.kind !== 'quiz');
  noQuiz.work.push({ id: 'assignment-7', source_id: 7, kind: 'assignment', name: 'Lab 2', due_at: null });
  assert.deepStrictEqual(keys(W.diff('101', s.courses['101'], noQuiz)), ['work:101:assignment-7'], 'other kinds still tracked');
  W.markSeen(s, new Map([['101', noQuiz]]), T0 + 1);
  assert.deepStrictEqual(s.courses['101'].quizzes, { 'quiz-2': iso(48) }, 'unreadable kind keeps its snapshot');
  // Quizzes readable again: the old one is not new, a really new one is.
  const back = course();
  back.work.push({ id: 'assignment-7', source_id: 7, kind: 'assignment', name: 'Lab 2', due_at: null });
  assert.deepStrictEqual(W.diff('101', s.courses['101'], back), []);
  back.work.push({ id: 'quiz-8', source_id: 8, kind: 'quiz', name: 'Quiz 3', due_at: null });
  assert.deepStrictEqual(keys(W.diff('101', s.courses['101'], back)), ['work:101:quiz-8']);
  // A kind that really had none, then gets one, is new.
  const none = W.parseState({});
  const noDisc = course();
  noDisc.work = noDisc.work.filter((a) => a.kind !== 'discussion');
  W.step(none, '101', noDisc, T0);
  assert.deepStrictEqual(none.courses['101'].discussions, {});
  assert.deepStrictEqual(keys(W.diff('101', none.courses['101'], course())), ['work:101:discussion-3']);
}

// ---- the old single `work` map is split by kind ----
{
  const old = W.parseState({ courses: { 101: { at: T0, work: { 'assignment-1': iso(24), 'quiz-2': iso(48) }, grades: null, news: { 11: 1 }, content: null } } }, T0);
  const e = old.courses['101'];
  assert.deepStrictEqual([e.assignments, e.quizzes, e.discussions, 'work' in e], [{ 'assignment-1': iso(24) }, { 'quiz-2': iso(48) }, null, false]);
  // The kind it had no entries for is recorded silently on the next visit, then tracked.
  r = W.step(old, '101', course(), T0 + 1);
  assert.deepStrictEqual(r.items, []);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(e.discussions, { 'discussion-3': '' });
}

// ---- feedback comments are stored only as a hash ----
{
  const s = W.parseState({});
  const c = course();
  c.grades[0].grade.comment = 'Great work, see me about question 3';
  W.step(s, '101', c, T0);
  const json = JSON.stringify(s);
  assert.ok(!json.includes('Great work') && !json.includes('question'), 'no comment text stored');
  assert.strictEqual(s.courses['101'].grades['501'], `8|8 / 10|#${W.fnv('Great work, see me about question 3')}`);
  assert.match(W.fnv('x'), /^[0-9a-f]{8}$/);
  assert.notStrictEqual(W.fnv('a'), W.fnv('b'));
  assert.deepStrictEqual(W.diff('101', s.courses['101'], c), []);
  const edited = course();
  edited.grades[0].grade.comment = 'Great work, see me about question 4';
  assert.deepStrictEqual(W.diff('101', s.courses['101'], edited).map((i) => [i.key, i.label]), [['grade:101:501', 'New feedback']]);

  // Signatures stored before hashing hold the comment: parsing hashes it, so the first visit
  // after the update lists nothing and no text stays stored.
  const legacy = { courses: { 101: { at: T0, assignments: null, quizzes: null, discussions: null, grades: { 501: '8|8 / 10|Great work, see me about question 3', 900: '5|5 / 5|' }, news: null, content: null } } };
  const up = W.parseState(legacy, T0);
  assert.ok(!JSON.stringify(up).includes('Great work'));
  assert.strictEqual(up.courses['101'].grades['900'], '5|5 / 5|');
  assert.deepStrictEqual(W.diff('101', up.courses['101'], c), []);
  // And an old signature met unparsed is compared on the score alone.
  assert.deepStrictEqual(W.diff('101', legacy.courses['101'], edited), []);
  const regraded = course();
  regraded.grades[0].grade = { ...regraded.grades[0].grade, score: 9, displayed: '9 / 10' };
  assert.deepStrictEqual(W.diff('101', legacy.courses['101'], regraded).map((i) => i.label), ['Grade changed']);
}

// ---- two pages: merged per course by when it was marked seen ----
{
  const a = { courses: { 101: { at: 20, assignments: { x: '' }, quizzes: null, discussions: null, grades: {}, news: { 1: 1 }, content: {} }, 102: { at: 5, assignments: {}, quizzes: {}, discussions: {}, grades: {}, news: {}, content: {} } } };
  const b = { courses: { 101: { at: 10, assignments: { y: '' }, quizzes: { q: '' }, discussions: null, grades: {}, news: {}, content: {} }, 102: { at: 9, assignments: { z: '' }, quizzes: {}, discussions: {}, grades: {}, news: { 2: 1 }, content: {} }, 103: { at: 1, assignments: {}, quizzes: {}, discussions: {}, grades: {}, news: {}, content: {} } } };
  const m = W.merge(a, b);
  assert.deepStrictEqual(Object.keys(m.courses).sort(), ['101', '102', '103']);
  assert.strictEqual(m.courses['101'].at, 20);
  assert.deepStrictEqual(m.courses['101'].assignments, { x: '' }, 'newer entry wins');
  assert.deepStrictEqual(m.courses['101'].quizzes, { q: '' }, 'a part the newer one lacks comes from the other');
  assert.deepStrictEqual(m.courses['101'].news, { 1: 1 });
  assert.strictEqual(m.courses['102'].at, 9);
  assert.deepStrictEqual(m.courses['102'].news, { 2: 1 }, 'the other page marked it seen later');
  assert.deepStrictEqual(m.courses['103'], b.courses['103']);
  assert.deepStrictEqual(W.merge(a, { courses: {} }), a);
  assert.deepStrictEqual(W.merge({ courses: {} }, b), b);
  // Merging does not change its inputs.
  assert.strictEqual(a.courses['101'].quizzes, null);
}

// ---- mark seen marks what was shown, not what arrived since ----
{
  const s = W.parseState({});
  W.step(s, '101', course(), T0);
  const shown = course();
  shown.news.push({ id: 20, title: 'Shown', posted_at: iso(1) });
  assert.deepStrictEqual(keys(W.diff('101', s.courses['101'], shown)), ['news:101:20']);
  const later = clone(shown);
  later.news.push({ id: 21, title: 'Arrived after drawing', posted_at: iso(2) });
  W.markSeen(s, new Map([['101', shown]]), T0 + 1);
  assert.deepStrictEqual(keys(W.diff('101', s.courses['101'], later)), ['news:101:21']);
}

// ---- courses not marked seen for a year are dropped ----
{
  const year = 365 * 864e5;
  const raw = { courses: { 1: { at: T0 - year - 1, news: {} }, 2: { at: T0 - year + 1, news: {} } } };
  assert.deepStrictEqual(Object.keys(W.parseState(raw, T0).courses), ['2']);
}

// ---- a change stamp first given later is not an update ----
{
  const s = W.parseState({});
  const c = course();
  c.modules[0].items[0].updated_at = null;
  W.step(s, '101', c, T0);
  assert.strictEqual(s.courses['101'].content['1001'], '');
  const stamped = course(); // Slides 1 now has updated_at iso(-200)
  assert.deepStrictEqual(W.diff('101', s.courses['101'], stamped), []);
  r = W.step(s, '101', stamped, T0 + 1);
  assert.deepStrictEqual([r.items, r.changed], [[], true]);
  assert.strictEqual(s.courses['101'].content['1001'], iso(-200), 'stored silently');
  assert.strictEqual(s.courses['101'].at, T0);
  // From then on a later stamp is an update.
  const updated = course();
  updated.modules[0].items[0].updated_at = iso(10);
  assert.deepStrictEqual(W.diff('101', s.courses['101'], updated).map((i) => [i.key, i.label]), [['content:101:1001', 'Updated in Modules']]);
}

console.log('whatsnew tests ok');
