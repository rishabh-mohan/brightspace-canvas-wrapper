// Search ranking (src/search.js, Fuse.js) and which files can be read for text (src/filetext.js).
// Usage: node tests/search.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ext = process.argv[2] || path.join(__dirname, '..', 'extension');
const S = require(path.join(ext, 'src', 'search.js'));

const now = Date.parse('2026-11-23T12:00:00Z');
const day = 864e5;
const index = [
  { title: 'Homework 3', where: 'MA 26100 Calculus', kind: 'Assignment', text: 'Homework 3', due: new Date(now + 3 * day).toISOString() },
  { title: 'Quiz 2', where: 'CS 18000', kind: 'Quiz', text: 'Quiz 2', due: new Date(now + 1 * day).toISOString() },
  { title: 'Old lab', where: 'CS 18000', kind: 'Assignment', text: 'Old lab', due: new Date(now - day).toISOString() },
  { title: 'Final project', where: 'CS 18000', kind: 'Assignment', text: 'Final project', due: new Date(now + 30 * day).toISOString() },
  { title: 'Lecture 4 notes.pdf', where: 'CS 18000 · Week 2', kind: 'File', text: 'Lecture 4 notes.pdf', body: 'Today we cover recursion and the call stack. '.repeat(3) },
  { title: 'Recursion practice', where: 'CS 18000 · Week 2', kind: 'Link', text: 'Recursion practice' },
];
const search = S.make(index);
const titles = (q) => search(q).map((r) => r.title);

// Typos are forgiven; every word must match, each in any field.
assert.deepStrictEqual(titles('homewrk'), ['Homework 3']);
assert.deepStrictEqual(titles('homework calculus'), ['Homework 3']);
assert.deepStrictEqual(titles('quiz calculus'), []);
assert.deepStrictEqual(titles(''), []);
assert.deepStrictEqual(titles('zzzz'), []);
// A title match ranks above a match only inside a file, which comes with a snippet.
const rec = search('recursion');
assert.deepStrictEqual(rec.map((r) => r.title), ['Recursion practice', 'Lecture 4 notes.pdf']);
assert.ok(rec[1].snippet.includes('recursion'), rec[1].snippet);
// Inside a file, words are matched plainly, and may be split between the file name and its text.
assert.deepStrictEqual(titles('lecture stack'), ['Lecture 4 notes.pdf']);
assert.deepStrictEqual(titles('call stack'), ['Lecture 4 notes.pdf']);
// Words found as typed inside a file beat a title that only matches by forgiving typos.
const noisy = S.make([
  { title: 'Allergen Free Pancakes', where: 'Hillenbrand', kind: 'Menu', text: 'Allergen Free Pancakes' },
  { title: 'Project 1', where: 'CS 25100', kind: 'Assignment', text: 'Project 1', body: 'Feedback: watch the edge cases in part 2.' },
]);
assert.deepStrictEqual(noisy('edge cases').map((r) => r.title)[0], 'Project 1');
// Extended-search operators typed by accident do not break the search.
assert.doesNotThrow(() => search('!quiz | "2'));

// Snippets: cut around the first match, with … where text was left out.
const long = `${'a '.repeat(200)}the needle is here${' b'.repeat(200)}`;
const sn = S.snippet(long, ['needle']);
assert.ok(sn.startsWith('…') && sn.endsWith('…') && sn.includes('needle'), sn);
assert.strictEqual(S.snippet('short text', ['short']), 'short text');
assert.strictEqual(S.snippet('nothing', ['absent']), '');

// Empty search: work due in the next two weeks, soonest first.
assert.deepStrictEqual(S.upcoming(index, now).map((r) => r.title), ['Quiz 2', 'Homework 3']);

// Which module files are read: PDFs and images, by the file's path.
const ctx = { BSX: {}, location: { host: 'x', href: 'https://x/' }, addEventListener() {}, URL, setTimeout, clearTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ext, 'src', 'filetext.js'), 'utf8'), ctx);
const kind = (url) => (ctx.BSX.filetext.kindOf({ url }) || {}).kind || null;
assert.strictEqual(kind('/content/enforced/1-CS/notes.PDF'), 'pdf');
assert.strictEqual(kind('/content/scan.jpeg?x=1'), 'image');
assert.strictEqual(kind('/content/slides.pptx'), null);
assert.strictEqual(kind(''), null);

console.log('search: all passed');
