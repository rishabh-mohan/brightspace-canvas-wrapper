// Grade tools: last-grade-posted dates and the final-grade solver. Usage: node tests/gradetools.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
globalThis.BSX = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'gradetools.js'), 'utf8'));
const T = BSX.gradetools;

// ---- postedAgo ----
const now = new Date(2026, 10, 20, 9, 0);
assert.strictEqual(T.postedAgo(null, now), null);
assert.strictEqual(T.postedAgo('not a date', now), null);
assert.strictEqual(T.postedAgo(new Date(2026, 10, 20, 1, 0).toISOString(), now).text, 'Last grade posted today');
assert.strictEqual(T.postedAgo(new Date(2026, 10, 19, 23, 0).toISOString(), now).text, 'Last grade posted yesterday');
const old = T.postedAgo(new Date(2026, 10, 1, 12, 0).toISOString(), now);
assert.strictEqual(old.days, 19);
assert.strictEqual(old.stale, true);
assert.strictEqual(T.postedAgo(new Date(2026, 10, 6, 12, 0).toISOString(), now).stale, false, '14 days is not yet stale');
assert.strictEqual(T.postedAgo(new Date(2026, 10, 5, 12, 0).toISOString(), now).stale, true, '15 days is stale');

// ---- solver ----
// Solved against the real What-If engine: data.js's estimate()/tally() are pure.
BSX.client = { ApiError: class extends Error {} };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'data.js'), 'utf8'));
const data = BSX.data;
const near = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${msg}: got ${a}, want ${b}`);
const percent = (e) => (e.score / e.points_possible) * 100;
// Runs the solver for `ids` and checks the answer against data.estimate: the solved score meets
// the goal, and (when something is needed) a little less does not.
function run(g, ids, goal, { allItems = false, base = new Map() } = {}) {
  const pool = T.solverTargets(g, { estimable: data.estimable, filled: base });
  const targets = ids.map((id) => pool.byId.get(id));
  assert.ok(targets.every(Boolean), `targets ${ids} are all solvable`);
  const res = T.solve({ estimate: (m) => data.estimate(g, m, { allItems }), targets, goal, base });
  const at = (f) => {
    const m = new Map(base);
    for (const t of targets) m.set(t.id, f * t.pp);
    return percent(data.estimate(g, m, { allItems }));
  };
  const f = res.status === 'reachable' ? res.fraction : res.status === 'unreachable' ? res.over : null;
  if (f != null) {
    assert.ok(at(f) >= goal - 1e-9, `solved ${f} reaches ${goal}: ${at(f)}`);
    if (f > 0.001) assert.ok(at(f - 0.001) < goal, `a little less than ${f} misses ${goal}: ${at(f - 0.001)}`);
    // The shown (rounded up) need also reaches the goal.
    assert.ok(at(T.up1(f * 100) / 100) >= goal - 1e-9, 'the shown percent suffices');
  }
  return { res, targets, pool };
}
const item = (id, name, pp, score, extra = {}) => ({ id, name, type: 'Numeric', points_possible: pp, value: score == null ? null : { score, points_possible: pp }, ...extra });

// Points gradebook: 80/100 graded, Final out of 100. A B (83%) takes 86 on the Final.
const pts = { system: 'Points', groups: [{ id: 0, name: null, items: [item(1, 'Homework', 100, 80), item(2, 'Final Exam', 100, null)] }] };
let r = run(pts, [2], 83);
assert.strictEqual(r.res.status, 'reachable');
near(r.res.fraction, 0.86, 'points: 86% on the final');
near(r.res.points[0].needed, 86, 'points: 86 points');
let d = T.describeSolve(r.res, { goalText: 'B (83%)', what: 'Final Exam', targets: r.targets });
assert.strictEqual(d.head, '86 / 100 (86%)');
assert.strictEqual(d.lines[0], 'needed on Final Exam for B (83%).');
// Unreachable: 100% on the final gives 90%; an A+ (97%) would take 114%.
r = run(pts, [2], 97);
assert.strictEqual(r.res.status, 'unreachable');
near(r.res.atFull, 90, 'unreachable: best is 90%');
near(r.res.over, 1.14, 'unreachable: 114% would do');
d = T.describeSolve(r.res, { goalText: 'A+ (97%)', what: 'Final Exam', targets: r.targets });
assert.strictEqual(d.head, 'Not reachable');
assert.strictEqual(d.lines[0], 'Even 100% on Final Exam gives 90%, short of A+ (97%).');
assert.strictEqual(d.lines[1], 'It would take 114% of full marks (114 / 100).');
// Far out of reach: no "it would take" figure past 200%.
r = run({ system: 'Points', groups: [{ items: [item(1, 'HW', 100, 0), item(2, 'Quiz', 10, null)] }] }, [2], 90);
assert.strictEqual(r.res.status, 'unreachable');
assert.strictEqual(r.res.over, null);
assert.strictEqual(T.describeSolve(r.res, { goalText: '90%', what: 'Quiz', targets: r.targets }).lines.length, 1);
// Already guaranteed: 0 on the final still gives 40%, which reaches a 40% goal.
r = run(pts, [2], 40);
assert.strictEqual(r.res.status, 'guaranteed');
near(r.res.atZero, 40, 'guaranteed at zero');
d = T.describeSolve(r.res, { goalText: '40%', what: 'Final Exam', targets: r.targets });
assert.strictEqual(d.head, 'Already guaranteed');
assert.strictEqual(d.lines[0], 'Even with 0 on Final Exam, you’d have 40%, which reaches 40%.');

// Weighted gradebook with categories: Homework (40%) at 90% from Brightspace's figure, Exams
// (60%) with a 70% midterm worth 30 and the Final worth the other 30. 80% overall needs
// 36 + 21 + 30f = 80, so f = 23/30.
const wtd = { system: 'Weighted', groups: [
  { id: 1, name: 'Homework', weight: 40, value: { score: 18, points_possible: 20, weighted_score: 36, weighted_possible: 40 }, items: [
    item(11, 'HW 1', 10, 9, { weight: 50, group_weight: 40, distribution: 0, value: { score: 9, points_possible: 10, weighted_score: 18, weighted_possible: 20 } }),
    item(12, 'HW 2', 10, 9, { weight: 50, group_weight: 40, distribution: 0, value: { score: 9, points_possible: 10, weighted_score: 18, weighted_possible: 20 } })] },
  { id: 2, name: 'Exams', weight: 60, value: { score: 70, points_possible: 100, weighted_score: 21, weighted_possible: 30 }, items: [
    item(21, 'Midterm', 100, 70, { weight: 50, group_weight: 60, distribution: 0, value: { score: 70, points_possible: 100, weighted_score: 21, weighted_possible: 30 } }),
    item(22, 'Final', 100, null, { weight: 50, group_weight: 60, distribution: 0 })] }] };
r = run(wtd, [22], 80);
assert.strictEqual(r.res.status, 'reachable');
near(r.res.fraction, 23 / 30, 'weighted: 76.7% on the final');
assert.strictEqual(T.describeSolve(r.res, { goalText: 'B- (80%)', what: 'Final', targets: r.targets }).head, '76.7 / 100 (76.7%)');
// Matches the What-If total exactly: the solved final in data.results gives the goal.
near(percent(data.results(wtd, new Map([[22, r.res.points[0].needed]]), {}).estimate), 80, 'weighted: same as What-If');

// Drop-lowest in the target's group: quizzes drop their lowest; 4/10, 8/10 and the target.
// Past 40% the 4/10 is dropped: (8 + 10f + 80) / 120 = 80% gives f = 0.8.
const drop = { system: 'Points', groups: [
  { id: 1, name: 'Quizzes', drop_lowest: 1, items: [item(1, 'Quiz 1', 10, 4), item(2, 'Quiz 2', 10, 8), item(3, 'Quiz 3', 10, null)] },
  { id: 2, name: 'Exams', items: [item(4, 'Midterm', 100, 80)] }] };
r = run(drop, [3], 80);
assert.strictEqual(r.res.status, 'reachable');
near(r.res.fraction, 0.8, 'drop-lowest: 8/10 on the last quiz');
// 0 on the last quiz is dropped itself: (4 + 8 + 80) / 120 = 76.7%, already a C (73%).
r = run(drop, [3], 73);
assert.strictEqual(r.res.status, 'guaranteed');
near(r.res.atZero, (92 / 120) * 100, 'drop-lowest: the 0 is dropped');

// "Graded only" on vs off: another ungraded homework is left out, or counts as 0.
const two = { system: 'Points', groups: [{ items: [item(1, 'HW 1', 100, 80), item(2, 'HW 2', 100, null), item(3, 'Final', 100, null)] }] };
r = run(two, [3], 80);
near(r.res.fraction, 0.8, 'graded only: HW 2 left out');
r = run(two, [3], 80, { allItems: true });
assert.strictEqual(r.res.status, 'unreachable');
near(r.res.over, 1.6, 'all items: HW 2 counts as 0, so 160% would be needed');
r = run(two, [3], 50, { allItems: true });
near(r.res.fraction, 0.7, 'all items: (80 + 0 + 100f) / 300 = 50%');
// An outside score (Gradescope) fills HW 2: not a target, and counted at its score.
const filled = new Map([[2, 90]]);
assert.deepStrictEqual(T.solverTargets(two, { estimable: data.estimable, filled }).items.map((t) => t.id), [3]);
r = run(two, [3], 80, { allItems: true, base: filled });
near(r.res.fraction, 0.7, 'outside score: (80 + 90 + 100f) / 300 = 80%');

// "Not counted" items: a target only when the student counts them (g.count_excluded).
const exc = { system: 'Points', groups: [{ items: [item(1, 'HW', 100, 80), item(2, 'Extra', 50, null, { excluded: true }), item(3, 'Final', 100, null)] }] };
assert.deepStrictEqual(T.solverTargets(exc, { estimable: data.estimable }).items.map((t) => t.id), [3]);
r = run(exc, [3], 80, { allItems: true });
near(r.res.fraction, 0.8, 'not counted, left out: (80 + 100f) / 200');
exc.count_excluded = true;
assert.deepStrictEqual(T.solverTargets(exc, { estimable: data.estimable }).items.map((t) => t.id), [2, 3]);
r = run(exc, [3], 80, { allItems: true });
assert.strictEqual(r.res.status, 'unreachable');
near(r.res.over, 1.2, 'not counted, counted: Extra as 0 in (80 + 0 + 100f) / 250');
r = run(exc, [2, 3], 80, { allItems: true });
near(r.res.fraction, 120 / 150, 'not counted, counted: both as targets');

// Group and all-remaining targets; bonus and category total rows are never targets.
const book = { system: 'Points', groups: [
  { id: 1, name: 'Homework', items: [item(1, 'HW 1', 20, 18), item(2, 'HW 2', 20, null), item(3, 'HW 3', 20, null), item(9, 'Bonus', 5, null, { bonus: true })] },
  { id: 2, name: 'Exams', items: [item(4, 'Midterm', 100, 70), item(5, 'Final Exam', 100, null)] },
  { id: 3, name: 'Projects', items: [{ ...item('category-3', 'Projects (group grade)', 10, null), total: true }] }] };
const pool = T.solverTargets(book, { estimable: data.estimable });
assert.deepStrictEqual(pool.choices.map((c) => c.key), ['all', 'group:1', 'item:2', 'item:3', 'item:5']);
assert.strictEqual(pool.choices[0].label, 'All remaining ungraded items (3)');
assert.strictEqual(pool.choices[1].label, 'All remaining in Homework (2)');
assert.strictEqual(pool.choices[1].what, 'the 2 remaining items in Homework');
assert.strictEqual(T.defaultChoice(pool.choices).key, 'all', 'every remaining item is picked first');
assert.strictEqual(T.defaultChoice(T.solverTargets({ system: 'Points', groups: [book.groups[0]] }, { estimable: data.estimable }).choices).key, 'group:1', 'one category: all of it');
// Homework: (18 + 40f + 70) / 160 = 75% gives f = 0.8.
r = run(book, [2, 3], 75);
near(r.res.fraction, 0.8, 'group: 80% on both homeworks');
d = T.describeSolve(r.res, { goalText: '75%', what: pool.choices[1].what, targets: r.targets });
assert.strictEqual(d.head, 'An average of 80%');
assert.deepStrictEqual(d.lines, ['on the 2 remaining items in Homework for 75%.', 'HW 2: 16 / 20', 'HW 3: 16 / 20']);
// All three: (88 + 140f) / 260 = 80% gives f = 6/7, shown rounded up as 85.8%.
r = run(book, [2, 3, 5], 80);
near(r.res.fraction, 6 / 7, 'all remaining');
assert.strictEqual(T.describeSolve(r.res, { goalText: '80%', what: pool.choices[0].what, targets: r.targets }).head, 'An average of 85.8%');
// Nothing to aim at: not solvable.
assert.strictEqual(T.solve({ estimate: () => null, targets: [{ id: 1, pp: 10 }], goal: 80 }).status, 'none');

// What-If works as in Canvas: switching it on does not count blank grades as 0. Only the
// "based only on graded assignments" option, or the course's own setting, does.
assert.strictEqual(T.countsBlanks({ option: undefined, nullIsZero: false, canEstimate: true }), false);
assert.strictEqual(T.countsBlanks({ option: undefined, nullIsZero: true, canEstimate: true }), true);
assert.strictEqual(T.countsBlanks({ option: false, nullIsZero: true, canEstimate: true }), false);
assert.strictEqual(T.countsBlanks({ option: true, nullIsZero: false, canEstimate: true }), true);
assert.strictEqual(T.countsBlanks({ option: true, nullIsZero: true, canEstimate: false }), false);
const wiAll = T.countsBlanks({ option: undefined, nullIsZero: false, canEstimate: true });
// What-If on with nothing typed: the same total as before, from Brightspace's own category
// figures (Homework 36/40; Exams 21/30, i.e. 70% of its 60) = 78%, not the blank Final as 0.
near(percent(data.estimate(wtd, new Map(), { allItems: wiAll })), percent(data.estimate(wtd)), 'What-If on, nothing typed: total unchanged');
near(percent(data.estimate(wtd, new Map(), { allItems: wiAll })), 78, 'What-If on, nothing typed: 78%');
assert.ok(percent(data.estimate(wtd, new Map(), { allItems: true })) < 78, 'blanks as 0 would lower it');
// One typed ungraded score counts, even with graded-only: 36 + (70 + 90) / 200 × 60 = 84.
near(percent(data.estimate(wtd, new Map([[22, 90]]), { allItems: wiAll })), 84, 'a typed ungraded score counts');
// Drop rules: the blank quiz is dropped first, as Brightspace does: (4 + 8 + 80) / 120.
near(percent(data.estimate(drop, new Map(), { allItems: wiAll })), (92 / 120) * 100, 'blank quiz dropped first');
assert.deepStrictEqual([...data.dropped(drop, new Map(), { allItems: wiAll })], [3]);
// Typed in at 10 it counts, and the 4/10 is dropped instead: (8 + 10 + 80) / 120.
near(percent(data.estimate(drop, new Map([[3, 10]]), { allItems: wiAll })), (98 / 120) * 100, 'typed quiz counts');
assert.deepStrictEqual([...data.dropped(drop, new Map([[3, 10]]), { allItems: wiAll })], [1]);
// The solver over What-If scores: HW 2 typed as 20, HW 3 still blank (left out), solving the
// Final: (18 + 20 + 70 + 100f) / 240 = 80% gives f = 0.84.
r = run(book, [5], 80, { base: new Map([[2, 20]]) });
near(r.res.fraction, 0.84, 'solver with a typed What-If score');

// Bonus items: what they earn goes on top of the total, adding nothing to what is possible.
// Points: a group of only a bonus item (Brightspace's ungrouped Participation).
const bonusBook = (score) => ({ system: 'Points', groups: [
  { id: 1, name: 'Work', items: [item(1, 'HW', 100, 80), item(2, 'Final', 100, null)] },
  { id: 0, name: null, items: [item(3, 'Participation', 10, score, { bonus: true })] }] });
near(percent(data.estimate(bonusBook(null))), 80, 'points: a blank bonus adds nothing');
near(percent(data.estimate(bonusBook(null), new Map(), { allItems: true })), 40, 'points: a blank bonus is not a 0 out of 10');
near(percent(data.estimate(bonusBook(4))), 84, 'points: a graded bonus 4/10 adds 4 points: 84 / 100');
near(percent(data.estimate(bonusBook(null), new Map([[3, 5]]))), 85, 'points: What-If bonus 5 adds 5 points: 85 / 100');
// The solver agrees, and never aims at a bonus: (80 + 5 + 100f) / 200 = 80% gives f = 0.75.
assert.deepStrictEqual(T.solverTargets(bonusBook(null), { estimable: data.estimable }).items.map((t) => t.id), [2]);
r = run(bonusBook(null), [2], 80, { base: new Map([[3, 5]]) });
near(r.res.fraction, 0.75, 'solver with a What-If bonus');
r = run(bonusBook(4), [2], 80);
near(r.res.fraction, 0.76, 'solver with a graded bonus: (80 + 4 + 100f) / 200');
// Weighted: an item outside any category adds up to its weight (2) on top.
const exams = (extra = []) => ({ id: 1, name: 'Exams', weight: 100, value: { score: 80, points_possible: 100, weighted_score: 80, weighted_possible: 100 }, items: [
  item(11, 'Midterm', 100, 80, { weight: 100, group_weight: 100, distribution: 0, value: { score: 80, points_possible: 100, weighted_score: 80, weighted_possible: 100 } }), ...extra] });
const wBonus = { system: 'Weighted', groups: [exams(), { id: 0, name: null, items: [item(5, 'Extra credit', 10, null, { bonus: true, weight: 2 })] }] };
near(percent(data.estimate(wBonus)), 80, 'weighted: a blank bonus item adds nothing');
near(percent(data.estimate(wBonus, new Map([[5, 5]]))), 81, 'weighted: What-If bonus 5/10 adds half its weight of 2');
near(percent(data.estimate(wBonus, new Map([[5, 10]]))), 82, 'weighted: full marks add its whole weight');
// Weighted: a bonus item inside a category (10% of it) raises that category (unchanged by this fix).
const wInside = { system: 'Weighted', groups: [exams([item(12, 'Bonus quiz', 10, null, { bonus: true, weight: 10, group_weight: 100, distribution: 0 })])] };
near(percent(data.estimate(wInside)), 80, 'weighted, bonus in a category: blank adds nothing');
near(percent(data.estimate(wInside, new Map([[12, 10]]))), 90, 'weighted, bonus in a category: full marks add 10% of the category');
// A weighted category of only bonus items is still left out (how its weight applies is unknown).
const wCat = { system: 'Weighted', groups: [exams(), { id: 2, name: 'Extra', weight: 5, items: [item(6, 'EC', 10, null, { bonus: true, weight: 100, group_weight: 5, distribution: 0 })] }] };
near(percent(data.estimate(wCat, new Map([[6, 10]]))), 80, 'weighted bonus-only category: left out');

// Scales: the course's letter scheme when readable, else the common cut-offs.
const stat = T.gradeScale({ name: 'STAT 350 letter grades', ranges: [{ symbol: 'A', start: 90 }, { symbol: 'B+', start: 87 }, { symbol: 'B', start: 80 }, { symbol: 'C+', start: 77 }, { symbol: 'C', start: 70 }, { symbol: 'D', start: 60 }, { symbol: 'F', start: 0 }] });
assert.strictEqual(stat.fromCourse, true);
assert.strictEqual(stat.note, 'Using the course’s grade scheme “STAT 350 letter grades”.');
assert.strictEqual(T.letterFor(88, stat.ranges), 'B+');
for (const s of [null, { name: 'Levels', ranges: [{ symbol: 'Excellent', start: 90 }, { symbol: 'Good', start: 0 }] }, { name: 'PF', ranges: [{ symbol: 'P', start: 70 }, { symbol: 'F', start: 0 }] }]) {
  const sc = T.gradeScale(s);
  assert.strictEqual(sc.fromCourse, false);
  assert.strictEqual(sc.note, 'Using common cut-offs (A 93, A- 90, …); check your syllabus.');
  assert.strictEqual(sc.ranges.length, 13);
}
const common = T.gradeScale(null).ranges;
assert.strictEqual(T.letterFor(85, common), 'B');
assert.strictEqual(T.letterFor(59.9, common), 'F');
assert.strictEqual(T.letterFor(93, common), 'A');
assert.strictEqual(T.defaultGoal(common).symbol, 'A', 'an A is the default goal');
assert.strictEqual(T.defaultGoal(stat.ranges).symbol, 'A');
assert.strictEqual(T.defaultGoal([{ symbol: 'A+', start: 97 }, { symbol: 'A-', start: 90 }, { symbol: 'B', start: 80 }]).symbol, 'A+', 'no plain A: the highest A');
assert.strictEqual(T.defaultGoal([{ symbol: 'B', start: 80 }, { symbol: 'C', start: 70 }]).symbol, 'B', 'no A at all: the top cut-off');

console.log('gradetools tests ok');
