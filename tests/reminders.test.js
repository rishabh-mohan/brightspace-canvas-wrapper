// Reminder scheduling (extension/reminders-bg.js). Usage: node tests/reminders.test.js
const path = require('path');
const assert = require('assert');
const R = require(path.join(__dirname, '..', 'extension', 'reminders-bg.js'));

const MIN = 60e3;
const now = Date.UTC(2026, 10, 25, 12, 0);
const item = (key, inMin) => ({ key, title: key, course: 'CS 180', due: now + inMin * MIN, url: 'https://school.brightspace.com/d2l/home#/' });

// ---- settings ----
assert.deepStrictEqual(R.cleanRemind(undefined), { on: false, leads: [1440, 60], origin: null });
assert.deepStrictEqual(R.cleanRemind({ on: 1, leads: [60, 7, 60, 15], origin: 'https://x.brightspace.com' }), { on: true, leads: [60, 15], origin: 'https://x.brightspace.com' });
assert.strictEqual(R.cleanRemind({ origin: 'https://x.brightspace.com/path' }).origin, null);

// ---- plan ----
{
  const p = R.plan([item('a', 2 * 1440), item('b', 30), item('gone', -5)], [1440, 60], now);
  // a: both leads ahead; b: 1 hour passed 30 min ago (not within the 30-minute grace), 1 day long past
  assert.deepStrictEqual(p.map((x) => x.name), ['bsxr|a|1440', 'bsxr|a|60']);
  assert.strictEqual(p[0].when, now + 1440 * MIN);
}
{
  // a lead missed by 10 minutes (browser was closed) is shown right away (30 s), only the latest one
  const p = R.plan([item('c', 50)], [1440, 180, 60], now);
  assert.deepStrictEqual(p, [{ name: 'bsxr|c|60', when: now + 30000 }]);
  // ... unless it was shown already
  assert.deepStrictEqual(R.plan([item('c', 50)], [1440, 180, 60], now, { 'c|60': now - 1 }), []);
}
{
  const notified = { 'a|1440': 1 };
  assert.deepStrictEqual(R.plan([item('a', 2 * 1440)], [1440, 60], now, notified).map((x) => x.name), ['bsxr|a|60']);
}
{
  const many = Array.from({ length: 150 }, (_, i) => item(`k${i}`, 2000 + i));
  const p = R.plan(many, [1440, 60], now);
  assert.strictEqual(p.length, 200);
  assert.ok(p.every((x, i) => i === 0 || p[i - 1].when <= x.when));
}
assert.deepStrictEqual(R.parseAlarm(R.alarmName('external-5-ab|c', 60)), { key: 'external-5-ab|c', lead: 60 });

// ---- decide ----
{
  const remind = { on: true, leads: [1440, 60, 15] };
  const deadlines = { items: [item('a', 59)] };
  // woke up 59 minutes before: the 1-day and 1-hour alarms both fire; one notification, both marked
  const first = R.decide('a', 1440, now, remind, deadlines, {});
  assert.strictEqual(first.item.key, 'a');
  assert.deepStrictEqual(first.mark, ['a|1440', 'a|60']);
  const notified = Object.fromEntries(first.mark.map((m) => [m, now]));
  assert.deepStrictEqual(R.decide('a', 60, now, remind, deadlines, notified), { item: null, mark: [] });
  // the 15-minute one still comes later
  const later = R.decide('a', 15, now + 44 * MIN, remind, deadlines, notified);
  assert.strictEqual(later.item.key, 'a');
  assert.deepStrictEqual(later.mark, ['a|1440', 'a|60', 'a|15']);
  // off, a lead no longer chosen, an item no longer listed (handed in), past due
  assert.strictEqual(R.decide('a', 60, now, { ...remind, on: false }, deadlines, {}).item, null);
  assert.strictEqual(R.decide('a', 180, now, remind, deadlines, {}).item, null);
  assert.strictEqual(R.decide('zz', 60, now, remind, deadlines, {}).item, null);
  const past = R.decide('a', 60, now + 70 * MIN, remind, deadlines, {});
  assert.strictEqual(past.item, null);
  assert.ok(past.mark.length === 3);
}

// ---- text and housekeeping ----
assert.strictEqual(R.dueIn(1440 * MIN), 'Due in 1 day');
assert.strictEqual(R.dueIn(180 * MIN), 'Due in 3 hours');
assert.strictEqual(R.dueIn(60 * MIN), 'Due in 1 hour');
assert.strictEqual(R.dueIn(50 * MIN), 'Due in 50 minutes');
assert.strictEqual(R.dueIn(10e3), 'Due in 1 minute');
assert.deepStrictEqual(Object.keys(R.prune({ old: now - 11 * 1440 * MIN, recent: now - MIN, url: { url: 'x', at: now } }, now)), ['recent', 'url']);
assert.strictEqual(R.safeUrl('javascript:alert(1)'), null);
assert.strictEqual(R.safeUrl('https://school.brightspace.com/d2l/home#/calendar'), 'https://school.brightspace.com/d2l/home#/calendar');
console.log('reminders: all passed');
