// Calendar export (src/ics.js): RFC 5545 text, escaping, folding, stable UIDs.
// Usage: node tests/ics.test.js
process.env.TZ = 'America/New_York'; // all-day dates are local dates
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ext = process.argv[2] || path.join(__dirname, '..', 'extension');
const file = path.join(ext, 'src', 'ics.js');
const I = require(file);

// It also loads like a content script (no `module`), without the wrapper, as BSX.ics.
const ctx = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
assert.strictEqual(typeof ctx.BSX.ics.build, 'function');
assert.strictEqual(ctx.BSX.ics.button, undefined, 'no UI parts without BSX.ui');

const now = Date.parse('2026-11-23T12:00:00Z');
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// ---- escaping -----------------------------------------------------------
assert.strictEqual(I.escape('a,b;c\\d'), 'a\\,b\\;c\\\\d');
assert.strictEqual(I.escape('one\r\ntwo\rthree\nfour'), 'one\\ntwo\\nthree\\nfour');
assert.strictEqual(I.escape('bell\u0007 tab\tok'), 'bell tab\tok');
assert.strictEqual(I.escape(null), '');

// ---- folding ------------------------------------------------------------
const long = `DESCRIPTION:${'x'.repeat(200)}`;
const folded = I.fold(long);
const lines = folded.split('\r\n');
assert.ok(lines.length > 2, 'long line folded');
for (const [n, l] of lines.entries()) {
  assert.ok(bytes(l) <= 75, `line ${n} is ${bytes(l)} octets`);
  if (n) assert.ok(l.startsWith(' ') && !l.startsWith('  '), 'continuation starts with one space');
}
assert.strictEqual(bytes(lines[0]), 75);
assert.strictEqual(I.unfold(folded), long);
assert.strictEqual(I.fold('SHORT:line'), 'SHORT:line');
assert.strictEqual(I.fold('X'.repeat(75)), 'X'.repeat(75));
// Multi-byte text (accents, CJK, emoji with surrogate pairs) never splits inside a character.
for (const unit of ['é', '日本', '🎓', 'a🎓', 'ab🎓é']) {
  const text = `SUMMARY:${unit.repeat(60)}`;
  const f = I.fold(text);
  for (const l of f.split('\r\n')) {
    assert.ok(bytes(l) <= 75, `${unit}: ${bytes(l)} octets`);
    assert.ok(!/[\ud800-\udbff]$/.test(l) && !/^ ?[\udc00-\udfff]/.test(l), `${unit}: surrogate pair split`);
    assert.ok(!l.includes('\ufffd'));
    assert.strictEqual(Buffer.from(l, 'utf8').toString('utf8'), l);
  }
  assert.strictEqual(I.unfold(f), text);
}

// ---- UIDs ---------------------------------------------------------------
assert.strictEqual(I.uid('assignment-123-456'), 'bsx-assignment-123-456@brightspace-canvas-wrapper');
assert.strictEqual(I.uid('cal-9-Review 1 (section 2)'), 'bsx-cal-9-Review_201_20_28section_202_29@brightspace-canvas-wrapper');
assert.ok(/^bsx-[A-Za-z0-9._-]+@brightspace-canvas-wrapper$/.test(I.uid('ext-gs-1/2?x=<y>;z')));
// Keys that differ only in characters outside [A-Za-z0-9.-] still give different UIDs.
const near = ['cal-9-a b', 'cal-9-a-b', 'cal-9-a_b', 'cal-9-a_20b', 'cal-9-a/b', 'cal-9-a(b', 'cal-9-a%20b'];
assert.strictEqual(new Set(near.map(I.uid)).size, near.length, 'no UID collisions');
// Brightspace items are keyed by the item, not the calendar event, title or time.
const hw = { id: 77, title: 'Homework 3', course_id: 123, associated: true, html_url: '/d2l/lms/dropbox/user/folder_submit_files.d2l?db=456&grpid=0&ou=123', start_at: '2026-12-01T05:59:00Z' };
const hwMoved = { ...hw, id: 78, title: 'Homework 3 (extended)', start_at: '2026-12-03T05:59:00Z' };
assert.strictEqual(I.calKey(hw), 'assignment-123-456');
assert.strictEqual(I.calKey(hwMoved), I.calKey(hw));
assert.strictEqual(I.calKey({ ...hw, html_url: '/d2l/lms/quizzing/user/quiz_summary.d2l?qi=9&ou=123' }), 'quiz-123-9');
assert.strictEqual(I.calKey({ ...hw, html_url: '/d2l/le/123/discussions/topics/55/View' }), 'discussion-123-55');
assert.strictEqual(I.calKey({ ...hw, html_url: '/d2l/le/123/other?b=2&a=1' }), I.calKey({ ...hw, html_url: '/d2l/le/123/other?a=1&b=2' }));
assert.strictEqual(I.calKey({ id: 5, course_id: 123, associated: false, html_url: '/d2l/le/calendar/123/event/5/detailsview' }), 'cal-123-5');
assert.notStrictEqual(I.calKey({ ...hw, html_url: '/d2l/lms/dropbox/user/folder_submit_files.d2l?db=457&ou=123' }), I.calKey(hw));
assert.notStrictEqual(I.calKey({ ...hw, html_url: '/d2l/lms/dropbox/user/folder_submit_files.d2l?db=456&ou=124' }), I.calKey(hw));

// ---- whole calendars ----------------------------------------------------
const events = [
  { key: I.calKey(hw), title: 'Homework 3, part 1; read §2', start: hw.start_at, courseName: 'CS 18000', description: 'Line one\nLine two', url: 'https://school.brightspace.com/d2l/lms/dropbox/user/folder_submit_files.d2l?db=456&ou=123' },
  { key: 'cal-123-8', title: 'Review session', start: '2026-12-02T01:00:00Z', end: '2026-12-02T02:00:00Z', location: 'Room 116', courseName: 'CS 18000' },
  { key: 'todo-3', title: 'Holiday', start: '2026-11-26', allDay: true },
  { key: 'todo-1', title: 'Pay fees', start: new Date(2026, 11, 5, 0, 0).getTime(), allDay: true }, // local midnight
  { key: 'cal-123-9', title: 'Field trip', start: new Date(2026, 11, 7, 9).toISOString(), end: new Date(2026, 11, 8, 17).toISOString(), allDay: true },
  { key: 'todo-2', title: 'Emoji 🎓 and accents é '.repeat(6), start: '2026-12-09T15:30:00Z', description: 'x'.repeat(300) },
  { key: 'todo-1', title: 'Duplicate key dropped', start: '2026-12-10T00:00:00Z' },
  { key: 'bad', title: 'No date', start: 'not a date' },
];
const text = I.build(events, { now, calName: 'My, deadlines' });

// CRLF everywhere, no bare LF or CR, ends with CRLF.
assert.ok(text.endsWith('\r\n'));
assert.ok(!/[^\r]\n/.test(text) && !/\r(?!\n)/.test(text), 'only CRLF line endings');
const phys = text.slice(0, -2).split('\r\n');
for (const l of phys) assert.ok(bytes(l) <= 75, `physical line over 75 octets: ${l}`);
const logical = I.unfold(text).slice(0, -2).split('\r\n');

// Header, and BEGIN/END balanced and nested.
assert.deepStrictEqual(logical.slice(0, 6), ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${I.PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:My\\, deadlines']);
assert.strictEqual(logical[logical.length - 1], 'END:VCALENDAR');
const stack = [];
for (const l of logical) {
  if (l.startsWith('BEGIN:')) stack.push(l.slice(6));
  if (l.startsWith('END:')) assert.strictEqual(stack.pop(), l.slice(4));
}
assert.strictEqual(stack.length, 0);

// One VEVENT per distinct, dated item.
const vevents = [];
let cur = null;
for (const l of logical) {
  if (l === 'BEGIN:VEVENT') cur = [];
  else if (l === 'END:VEVENT') (vevents.push(cur), (cur = null));
  else if (cur) cur.push(l);
}
assert.strictEqual(vevents.length, 6);
const prop = (ev, name) => ev.filter((l) => l.split(/[:;]/)[0] === name);
const one = (ev, name) => {
  const p = prop(ev, name);
  assert.strictEqual(p.length, 1, `${name}: ${p}`);
  return p[0];
};
for (const ev of vevents) {
  assert.ok(/^UID:bsx-[A-Za-z0-9._-]+@brightspace-canvas-wrapper$/.test(one(ev, 'UID')));
  assert.strictEqual(one(ev, 'DTSTAMP'), 'DTSTAMP:20261123T120000Z');
  one(ev, 'DTSTART');
  one(ev, 'SUMMARY');
}
assert.strictEqual(new Set(vevents.map((ev) => one(ev, 'UID'))).size, 6, 'distinct UIDs');

// A timed deadline: UTC, DTEND = DTSTART (zero length, as Canvas and D2L feeds write it); course in
// SUMMARY and CATEGORIES; text escaped; the link in URL and in the description.
const [d, meet, hol, fees, trip, emoji] = vevents;
assert.strictEqual(one(d, 'UID'), 'UID:bsx-assignment-123-456@brightspace-canvas-wrapper');
assert.strictEqual(one(d, 'DTSTART'), 'DTSTART:20261201T055900Z');
assert.strictEqual(one(d, 'DTEND'), 'DTEND:20261201T055900Z');
assert.strictEqual(one(d, 'SUMMARY'), 'SUMMARY:CS 18000: Homework 3\\, part 1\\; read §2');
assert.strictEqual(one(d, 'CATEGORIES'), 'CATEGORIES:CS 18000');
assert.strictEqual(one(d, 'DESCRIPTION'), 'DESCRIPTION:Line one\\nLine two\\n\\nhttps://school.brightspace.com/d2l/lms/dropbox/user/folder_submit_files.d2l?db=456&ou=123');
assert.strictEqual(one(d, 'URL'), 'URL:https://school.brightspace.com/d2l/lms/dropbox/user/folder_submit_files.d2l?db=456&ou=123');
// A timed event with an end.
assert.strictEqual(one(meet, 'DTSTART'), 'DTSTART:20261202T010000Z');
assert.strictEqual(one(meet, 'DTEND'), 'DTEND:20261202T020000Z');
assert.strictEqual(one(meet, 'LOCATION'), 'LOCATION:Room 116');
// Deadlines and all-day notes are free time; an event with a length is busy.
assert.strictEqual(one(d, 'TRANSP'), 'TRANSP:TRANSPARENT');
assert.strictEqual(prop(meet, 'TRANSP').length, 0);
// All-day: VALUE=DATE, ending the next day (exclusive); a bare date is taken as written.
assert.strictEqual(one(hol, 'DTSTART'), 'DTSTART;VALUE=DATE:20261126');
assert.strictEqual(one(hol, 'DTEND'), 'DTEND;VALUE=DATE:20261127');
assert.strictEqual(prop(hol, 'CATEGORIES').length, 0);
assert.strictEqual(one(fees, 'DTSTART'), 'DTSTART;VALUE=DATE:20261205');
assert.strictEqual(one(fees, 'DTEND'), 'DTEND;VALUE=DATE:20261206');
// An all-day event lasts its whole days, rounded: 9:00 one day to 17:00 the next is one day
// (not two); a day-long span ending at 23:59 or at midnight is one day too.
assert.strictEqual(one(trip, 'DTSTART'), 'DTSTART;VALUE=DATE:20261207');
assert.strictEqual(one(trip, 'DTEND'), 'DTEND;VALUE=DATE:20261208');
const allDay = (start, end) => I.unfold(I.build([{ key: 'k', title: 't', start, end, allDay: true }], { now })).split('\r\n').filter((l) => l.startsWith('DTEND'))[0];
assert.strictEqual(allDay(new Date(2026, 11, 7).getTime(), new Date(2026, 11, 7, 23, 59).getTime()), 'DTEND;VALUE=DATE:20261208');
assert.strictEqual(allDay(new Date(2026, 11, 7).getTime(), new Date(2026, 11, 8).getTime()), 'DTEND;VALUE=DATE:20261208');
assert.strictEqual(allDay(new Date(2026, 11, 7).getTime(), new Date(2026, 11, 10).getTime()), 'DTEND;VALUE=DATE:20261210');
assert.strictEqual(allDay('2026-11-26', '2026-11-28'), 'DTEND;VALUE=DATE:20261128');
// Across the end of daylight saving (Nov 1 2026): 25 hours is still one day.
assert.strictEqual(allDay(new Date(2026, 9, 31).getTime(), new Date(2026, 10, 1).getTime()), 'DTEND;VALUE=DATE:20261101');
// Long multi-byte summaries survive folding.
assert.ok(one(emoji, 'SUMMARY').includes('🎓 and accents é'));
assert.ok(text.split('\r\n').some((l) => l.startsWith(' ')), 'something was folded');

// Re-exporting the same items after edits gives the same UIDs.
const again = I.build([{ ...events[0], key: I.calKey(hwMoved), title: hwMoved.title, start: hwMoved.start_at }], { now: now + 864e5 });
assert.ok(again.includes('UID:bsx-assignment-123-456@brightspace-canvas-wrapper'));
assert.ok(again.includes('DTSTART:20261203T055900Z'));
assert.ok(again.includes('DTSTAMP:20261124T120000Z'));

// An empty export is still a valid calendar.
assert.strictEqual(I.build([], { now }).split('\r\n').filter(Boolean).pop(), 'END:VCALENDAR');

console.log('ics tests passed');
