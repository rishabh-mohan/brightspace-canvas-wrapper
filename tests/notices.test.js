// Notification mutes and the Alerts list (src/notices.js). Usage: node tests/notices.test.js
const assert = require('assert');
const path = require('path');
const ext = process.argv[2] || path.join(__dirname, '..', 'extension');
const N = require(path.join(ext, 'src', 'notices.js'));

const H = 36e5;
const now = Date.parse('2026-11-25T12:00:00Z');
const iso = (h) => new Date(now + h * H).toISOString();
const keyOf = (i) => (i.personal ? `todo-${i.source_id}` : `${i.kind}-${i.course_id}-${i.source_id}`);

// ---- mutes ----
assert.deepStrictEqual(N.cleanMute(undefined), { courses: [], types: [] });
assert.deepStrictEqual(N.cleanMute({ courses: [101, '101', null, '', 102], types: ['quiz', 'bogus', 'quiz', 'news'] }), { courses: ['101', '102'], types: ['quiz', 'news'] });
assert.deepStrictEqual(N.cleanMute({ courses: 'x', types: {} }), { courses: [], types: [] });
assert.ok(N.TYPES.every(([id, label]) => typeof id === 'string' && label));
assert.strictEqual(N.typeOfWork({ kind: 'assignment' }), 'assignment');
assert.strictEqual(N.typeOfWork({ kind: 'discussion' }), 'discussion');
assert.strictEqual(N.typeOfWork({ kind: 'external' }), 'other');
assert.strictEqual(N.typeOfWork({ kind: 'todo', personal: true }), 'other');
assert.strictEqual(N.typeOfNew({ type: 'news' }), 'news');
assert.strictEqual(N.typeOfNew({ type: 'grade', kind: undefined }), 'grade');
assert.strictEqual(N.typeOfNew({ type: 'content' }), 'content');
assert.strictEqual(N.typeOfNew({ type: 'work', kind: 'quiz' }), 'quiz');
assert.strictEqual(N.typeOfNew({ type: 'due', kind: 'discussion' }), 'discussion');
{
  const mute = N.cleanMute({ courses: ['102'], types: ['quiz'] });
  assert.strictEqual(N.isMuted(mute, 101, 'quiz'), true);
  assert.strictEqual(N.isMuted(mute, 102, 'assignment'), true);
  assert.strictEqual(N.isMuted(mute, 101, 'assignment'), false);
  assert.strictEqual(N.isMuted(mute, null, 'other'), false); // own items belong to no course
}

// ---- entries ----
assert.strictEqual(N.dueIn(3 * H), 'Due in 3 hours');
assert.strictEqual(N.dueIn(20 * 60e3), 'Due in 20 minutes');
assert.strictEqual(N.dueIn(23.9 * H), 'Due in 1 day');
const todo = [
  { kind: 'assignment', course_id: 101, source_id: 1, name: 'Homework 4', due_at: iso(3) },
  { kind: 'quiz', course_id: 102, source_id: 2, name: 'Quiz 2', due_at: iso(20) },
  { kind: 'assignment', course_id: 101, source_id: 3, name: 'Too far', due_at: iso(30) },
  { kind: 'assignment', course_id: 101, source_id: 4, name: 'Past', due_at: iso(-1) },
  { kind: 'assignment', course_id: 101, source_id: 1, name: 'Homework 4', due_at: iso(3) }, // listed twice
  { personal: true, kind: 'todo', course_id: null, source_id: 'p1', name: 'Read ch. 3', due_at: iso(5) },
];
const fresh = [
  { type: 'news', key: 'news:101:9', label: 'Announcement', title: 'Exam moved', course_id: 101, at: iso(-2) },
  { type: 'grade', key: 'grade:102:7', label: 'New grade', title: 'Quiz 1', course_id: 102, at: iso(-5) },
  { type: 'due', key: 'due:101:assignment-1', label: 'Due date changed', title: 'Homework 4', course_id: 101, kind: 'assignment', at: null, new_due: iso(3) },
];
const list = N.entries({ todo, fresh, now, keyOf });
assert.deepStrictEqual(list.map((e) => e.title), ['Homework 4', 'Quiz 2', 'Read ch. 3', 'Exam moved', 'Quiz 1', 'Homework 4']);
assert.deepStrictEqual(list.map((e) => e.group), ['due', 'due', 'due', 'new', 'new', 'new']);
assert.strictEqual(list[0].key, `remind:assignment-101-1|${iso(3)}`);
assert.strictEqual(list[0].label, 'Due in 3 hours');
assert.strictEqual(list[2].type, 'other');
assert.strictEqual(list[3].key, `new:news:101:9|Announcement|${iso(-2)}`);
assert.strictEqual(list[5].key, `new:due:101:assignment-1|Due date changed|${iso(3)}`);
// a moved due date is a new entry, so it is unread again
const moved = N.entries({ todo: [{ ...todo[0], due_at: iso(4) }], now, keyOf });
assert.notStrictEqual(moved[0].key, list[0].key);

// ---- view: mutes, hidden courses, read marks ----
{
  const all = N.view(list);
  assert.strictEqual(all.unread, 6);
  assert.deepStrictEqual(all.due.map((e) => e.title), ['Homework 4', 'Read ch. 3', 'Quiz 2']); // soonest first
  const v = N.view(list, { mute: N.cleanMute({ courses: ['102'], types: ['news'] }), read: { [list[0].key]: now } });
  assert.deepStrictEqual(v.due.map((e) => [e.title, e.unread]), [['Homework 4', false], ['Read ch. 3', true]]);
  assert.deepStrictEqual(v.fresh.map((e) => e.title), ['Homework 4']);
  assert.strictEqual(v.unread, 2);
  const h = N.view(list, { hidden: (id) => Number(id) === 101 });
  assert.deepStrictEqual(h.due.map((e) => e.title), ['Read ch. 3', 'Quiz 2']);
  assert.deepStrictEqual(h.fresh.map((e) => e.title), ['Quiz 1']);
  const types = N.view(list, { mute: N.cleanMute({ types: ['assignment', 'quiz', 'other', 'grade'] }) });
  assert.deepStrictEqual([...types.due, ...types.fresh].map((e) => e.title), ['Exam moved']);
}

// ---- read marks ----
{
  const read = N.markRead({}, ['a', 'b'], now);
  assert.deepStrictEqual(read, { a: now, b: now });
  assert.deepStrictEqual(N.parseRead({ a: now - 61 * 24 * H, b: now - H, c: 'x' }, now), { b: now - H });
  assert.deepStrictEqual(N.parseRead(null, now), {});
  assert.deepStrictEqual(N.mergeRead({ a: 5, b: 1 }, { b: 3, c: 2 }), { a: 5, b: 3, c: 2 });
}
console.log('notices: all passed');
