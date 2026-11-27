// Semester GPA calculator maths: letter points, credit weighting, skipped rows, cumulative GPA,
// input checks, saved credit hours and letters from course totals. Usage: node tests/gpa.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
globalThis.BSX = {};
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', f), 'utf8');
vm.runInThisContext(src('gpa.js'));
const G = BSX.gpa;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// Letter points on the standard US 4.0 scale; A+ counts as 4.0.
assert.strictEqual(G.points('A+'), 4);
assert.strictEqual(G.points('A'), 4);
assert.strictEqual(G.points('A-'), 3.7);
assert.strictEqual(G.points('B+'), 3.3);
assert.strictEqual(G.points('C-'), 1.7);
assert.strictEqual(G.points('D-'), 0.7);
assert.strictEqual(G.points('F'), 0);
assert.strictEqual(G.points(' b + '), 3.3);
assert.strictEqual(G.points('B\u2212'), 2.7); // typographic minus
assert.strictEqual(G.points('E'), null);
assert.strictEqual(G.points(''), null);
assert.strictEqual(G.points(null), null);
assert.strictEqual(G.LETTERS.length, 13);

// Percent -> letter with the common cut-offs: each letter starts at its cut-off.
const cuts = [['A+', 97], ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80], ['C+', 77], ['C', 73], ['C-', 70], ['D+', 67], ['D', 63], ['D-', 60]];
for (const [l, c] of cuts) {
  assert.strictEqual(G.letterOfPercent(c), l, `at ${c}`);
  assert.notStrictEqual(G.letterOfPercent(c - 0.01), l, `below ${c}`);
}
assert.strictEqual(G.letterOfPercent(100), 'A+');
assert.strictEqual(G.letterOfPercent(105), 'A+');
assert.strictEqual(G.letterOfPercent(96.99), 'A');
assert.strictEqual(G.letterOfPercent(85), 'B');
assert.strictEqual(G.letterOfPercent(59.9), 'F');
assert.strictEqual(G.letterOfPercent(0), 'F');
assert.strictEqual(G.letterOfPercent(NaN), null);
assert.strictEqual(G.letterOfPercent('90'), null);

// Letters from course totals: a displayed letter wins, else the final percent, else the estimate.
assert.deepStrictEqual(G.letterOfTotal({ final: { score: 50, points_possible: 100, displayed: 'A-' } }), { letter: 'A-', percent: 50, from: 'final' });
assert.strictEqual(G.letterOfTotal({ final: { score: 88, points_possible: 100, displayed: '88 %' } }).letter, 'B+');
assert.strictEqual(G.letterOfTotal({ final: { score: 9.3, points_possible: 10 } }).letter, 'A');
assert.deepStrictEqual(G.letterOfTotal({ final: null, estimate: { score: 71, points_possible: 100 } }), { letter: 'C-', percent: 71, from: 'estimate' });
assert.strictEqual(G.letterOfTotal({ final: { score: 0, points_possible: 0 }, estimate: { score: 4, points_possible: 5 } }).letter, 'B-');
assert.strictEqual(G.letterOfTotal({ final: null, estimate: null }), null);
assert.strictEqual(G.letterOfTotal({ final: { score: null, points_possible: 100 } }), null);
assert.strictEqual(G.letterOfTotal(null), null);

// A displayed grade with more after the letter ("A- (91 %)") gives its leading letter.
assert.strictEqual(G.leadingLetter('A- (91 %)'), 'A-');
assert.strictEqual(G.leadingLetter('B+ 88%'), 'B+');
assert.strictEqual(G.leadingLetter('C − (72%)'), 'C-');
assert.strictEqual(G.leadingLetter('A (93 %)'), 'A');
assert.strictEqual(G.leadingLetter('Fail'), null);
assert.strictEqual(G.leadingLetter('Pass'), null);
assert.strictEqual(G.leadingLetter('88 %'), null);
assert.strictEqual(G.leadingLetter('E'), null);
assert.strictEqual(G.leadingLetter(null), null);
assert.deepStrictEqual(G.letterOfTotal({ final: { score: 91, points_possible: 100, displayed: 'A- (91 %)' } }), { letter: 'A-', percent: 91, from: 'final' });

// A course's own letter scheme replaces the common cut-offs (here: A from 90).
const own = [{ symbol: 'A', start: 90 }, { symbol: 'B+', start: 87 }, { symbol: 'B', start: 80 }, { symbol: 'C+', start: 77 }, { symbol: 'C', start: 70 }, { symbol: 'D', start: 60 }, { symbol: 'F', start: 0 }];
assert.strictEqual(G.letterOfPercent(90, own), 'A');
assert.strictEqual(G.letterOfPercent(90), 'A-');
assert.strictEqual(G.letterOfPercent(85, own), 'B');
assert.strictEqual(G.letterOfPercent(10, own), 'F');
assert.strictEqual(G.letterOfPercent(85, []), 'B');
assert.strictEqual(G.letterOfTotal({ final: null, estimate: { score: 90, points_possible: 100 } }, own).letter, 'A');
assert.strictEqual(G.letterOfTotal({ final: null, estimate: { score: 90, points_possible: 100 } }).letter, 'A-');

// Credit hours typed in.
assert.strictEqual(G.credits('3'), 3);
assert.strictEqual(G.credits(0), 0);
assert.strictEqual(G.credits(''), null);
assert.strictEqual(G.credits('  '), null);
assert.strictEqual(G.credits(-1), null);
assert.strictEqual(G.credits('abc'), null);
assert.strictEqual(G.credits(31), null);

// Credit hours default to 3 per course; typed ones are saved (blank as 0, which leaves the course
// out), the default isn't stored, and a bad value changes nothing.
assert.strictEqual(G.DEFAULT_CREDITS, 3);
const prefs = G.clean(null);
assert.strictEqual(G.creditsFor(prefs, 101), 3);
assert.strictEqual(G.creditsFor(null, 101), 3);
assert.strictEqual(G.setCredits(prefs, 101, '4'), 4);
assert.deepStrictEqual(prefs.credits, { 101: 4 });
assert.strictEqual(G.creditsFor(prefs, 101), 4);
assert.strictEqual(G.setCredits(prefs, 102, ''), 0);
assert.strictEqual(G.creditsFor(prefs, 102), 0);
assert.strictEqual(G.setCredits(prefs, 101, '99'), null);
assert.strictEqual(prefs.credits[101], 4);
assert.strictEqual(G.setCredits(prefs, 101, '3'), 3);
assert.deepStrictEqual(prefs.credits, { 102: 0 });
G.setCredits(prefs, 103, '1.5');
// What is saved survives a save/load round trip (settings are JSON).
const back = G.clean(JSON.parse(JSON.stringify(prefs)));
assert.deepStrictEqual(back.credits, { 102: 0, 103: 1.5 });
assert.strictEqual(G.creditsFor(back, 103), 1.5);
assert.strictEqual(G.creditsFor(back, 104), 3);

// Term GPA, weighted by credits: A (4) × 4 + B (3) × 3 + C+ (2.3) × 1 = 27.3 over 8.
const t = G.term([{ letter: 'A', credits: 4 }, { letter: 'B', credits: 3 }, { letter: 'C+', credits: 1 }]);
close(t.points, 27.3);
assert.strictEqual(t.credits, 8);
close(t.gpa, 27.3 / 8);
assert.strictEqual(t.skipped.length, 0);
// A+ is 4.0, not 4.3.
close(G.term([{ letter: 'A+', credits: 3 }, { letter: 'A', credits: 3 }]).gpa, 4);
// Rows without a letter or with 0 / blank / bad credits are left out, with the reason.
const s = G.term([{ letter: 'B', credits: 3, name: 'x' }, { letter: null, credits: 4, name: 'nl' }, { letter: 'A', credits: 0, name: 'zero' }, { letter: 'A', credits: '', name: 'blank' }, { letter: 'Q', credits: 3, name: 'bad' }, { letter: 'A', credits: -2, name: 'neg' }]);
close(s.gpa, 3);
assert.strictEqual(s.credits, 3);
assert.deepStrictEqual(s.skipped.map((r) => [r.name, r.why]), [['nl', 'letter'], ['zero', 'credits'], ['blank', 'credits'], ['bad', 'letter'], ['neg', 'credits']]);
// Nothing counted: no GPA.
const none = G.term([{ letter: null, credits: 3 }]);
assert.strictEqual(none.gpa, null);
assert.strictEqual(none.credits, 0);
assert.strictEqual(G.term([]).gpa, null);
assert.strictEqual(G.term(null).gpa, null);
// An F counts (0 points) and pulls the GPA down.
close(G.term([{ letter: 'F', credits: 3 }, { letter: 'A', credits: 3 }]).gpa, 2);

// Prior GPA input checks.
assert.deepStrictEqual(G.prior('3.5', '60'), { gpa: 3.5, credits: 60, errors: {} });
assert.deepStrictEqual(G.prior('', ''), { gpa: null, credits: null, errors: {} });
assert.deepStrictEqual(G.prior('4.2', '-3').errors, { gpa: 'GPA must be between 0 and 4.', credits: 'Credit hours must be 0 or more.' });
assert.strictEqual(G.prior('abc', '10').gpa, null);
assert.ok(G.prior('abc', '10').errors.gpa);
assert.strictEqual(G.prior('0', '0').gpa, 0);
assert.strictEqual(G.prior(4, 0).gpa, 4);

// Cumulative: (3.5 × 60 + 27.3) / (60 + 8).
close(G.cumulative(t, { gpa: 3.5, credits: 60 }), (3.5 * 60 + 27.3) / 68);
// Without a prior (or with a bad one, or 0 prior credits), the term GPA.
close(G.cumulative(t, null), t.gpa);
close(G.cumulative(t, { gpa: 5, credits: 60 }), t.gpa);
close(G.cumulative(t, { gpa: 3, credits: -1 }), t.gpa);
close(G.cumulative(t, { gpa: null, credits: 60 }), t.gpa);
close(G.cumulative(t, { gpa: 2, credits: 0 }), t.gpa);
// Nothing this term: the prior GPA; nothing at all: null.
close(G.cumulative(none, { gpa: 3.2, credits: 30 }), 3.2);
assert.strictEqual(G.cumulative(none, null), null);
assert.strictEqual(G.cumulative(null, null), null);

// Saved preferences are cleaned.
assert.deepStrictEqual(G.clean({ credits: { 1: 3, 2: -1, 3: 'x', 4: 0, 5: 99 }, prior: { gpa: 3.1, credits: 45 } }), { credits: { 1: 3, 4: 0 }, prior: { gpa: 3.1, credits: 45 } });
assert.deepStrictEqual(G.clean({ prior: { gpa: 9, credits: 'x' } }), { credits: {}, prior: { gpa: null, credits: null } });
assert.deepStrictEqual(G.clean(null), { credits: {}, prior: { gpa: null, credits: null } });
assert.deepStrictEqual(G.clean({ credits: [3, 4], prior: 'x' }), { credits: {}, prior: { gpa: null, credits: null } });

// No Purdue or BoilerClasses parts in the generic build.
assert.ok(!/boiler|purdue/i.test(src('gpa.js')));

console.log('gpa tests ok');
