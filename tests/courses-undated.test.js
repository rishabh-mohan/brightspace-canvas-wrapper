// Hidden courses (data.pickCourses) and To Do's "No due date" group (data.undatedFrom,
// data.undated). Usage: node tests/courses-undated.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ext = path.join(__dirname, '..', 'extension');

const soon = new Date(Date.now() + 2 * 864e5).toISOString();
const topic = (id, title, type, extra = {}) => ({ TopicId: id, Title: title, TypeIdentifier: type, Url: type === 'Link' ? 'https://example.edu/r' : '/content/x.pdf', Unread: true, ...extra });
const routes = {
  '/d2l/api/versions/': [{ ProductCode: 'lp', LatestVersion: '1.64' }, { ProductCode: 'le', LatestVersion: '1.100' }],
  '/d2l/api/le/1.100/10/content/toc': { Modules: [
    { ModuleId: 1, Title: 'Week 1', Description: { Text: 'Read this first', Html: '<p>Read this first</p>' }, Topics: [
      topic(11, 'Chapter 1', 'File'),
      topic(12, 'Seen already', 'File', { Unread: false }),
      topic(13, 'Article', 'Link'),
      topic(14, 'Dated reading', 'File', { DueDate: soon }),
      topic(15, 'HW 1', 'Link', { Url: '/d2l/common/dialogs/quickLink/quickLink.d2l?ou=10&type=dropbox&rcode=x' }),
      topic(16, 'Quiz 1', 'Link', { Url: '/d2l/common/dialogs/quickLink/quickLink.d2l?ou=10&type=quiz&rcode=y' }),
      topic(17, 'Tool', 'Link', { Url: '/d2l/common/dialogs/quickLink/quickLink.d2l?ou=10&type=lti&rcode=z' }),
      topic(18, 'Locked', 'File', { IsLocked: true }),
      topic(19, 'Exempt', 'File', { IsExempt: true }),
      topic(20, 'Hidden', 'File', { IsHidden: true })],
      Modules: [{ ModuleId: 2, Title: 'Extra', Topics: [topic(21, 'Practice', 'File')], Modules: [] },
        { ModuleId: 3, Title: 'Later', IsLocked: true, Topics: [topic(22, 'Not yet', 'File')], Modules: [] }] }] },
  '/d2l/api/le/1.100/11/content/toc': { Modules: [{ ModuleId: 4, Title: 'Start', Topics: [topic(41, 'Syllabus', 'File')], Modules: [] }] },
};
const calls = [];
const ctx = {
  console, URL, Date, Math, JSON, Promise, Map, Set, encodeURIComponent, setTimeout, clearTimeout, Blob,
  localStorage: { getItem: (k) => (k === 'XSRF.Token' ? 'x1' : null) },
  location: { origin: 'https://x.brightspace.com', host: 'x.brightspace.com' },
  sessionStorage: { getItem: () => null, setItem() {} },
  fetch: async (p, opts = {}) => {
    calls.push(p);
    if (opts.method === 'POST') return { ok: true, json: async () => ({ access_token: 'tok' }) };
    if (!(p in routes)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[p] };
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['src/client.js', 'src/data.js']) vm.runInContext(fs.readFileSync(path.join(ext, f), 'utf8'), ctx, { filename: f });
const { data } = ctx.BSX;
const ids = (list) => Array.from(list, (x) => x.id);

// ---- pickCourses: this term's, else pinned, else all; hidden courses never count ----
{
  const cs = [
    { id: 10, current_term: true, pinned: false },
    { id: 11, current_term: true, pinned: true },
    { id: 12, current_term: false, pinned: true },
    { id: 13, current_term: false, pinned: false },
  ];
  assert.deepStrictEqual(ids(data.pickCourses(cs)), [10, 11]);
  assert.deepStrictEqual(ids(data.pickCourses(cs, { hidden: [10] })), [11]);
  assert.deepStrictEqual(ids(data.pickCourses(cs, { hidden: [10, 11] })), [12], 'no current course left: pinned ones');
  assert.deepStrictEqual(ids(data.pickCourses(cs, { hidden: [10, 11, 12] })), [13], 'nothing pinned left: everything');
  assert.deepStrictEqual(ids(data.pickCourses(cs, { all: true })), [10, 11, 12, 13]);
  assert.deepStrictEqual(ids(data.pickCourses(cs, { all: true, hidden: ['12', 13] })), [10, 11], 'ids compared as text');
  assert.deepStrictEqual(ids(data.pickCourses(cs, { all: true, hidden: [10, 11, 12, 13] })), []);
  assert.deepStrictEqual(ids(data.pickCourses([], { hidden: [1] })), []);
}

// ---- undatedFrom: unread, undated readings and pages only ----
{
  const mods = [
    { name: 'A', locked: false, items: [
      { id: 1, title: 'R', type: 'File', unread: true, due_at: null, html_url: '/v/1' },
      { id: 2, title: 'Read', type: 'File', unread: false, due_at: null },
      { id: 3, title: 'Due', type: 'Link', unread: true, due_at: soon },
      { id: 4, title: 'Overview', type: 'Module overview', unread: true },
      { id: 5, title: 'Disc', type: 'Discussion', unread: true }] },
    { name: 'B', locked: true, items: [{ id: 6, title: 'L', type: 'File', unread: true }] },
  ];
  const out = data.undatedFrom(mods);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), [{ kind: 'content', source_id: 1, name: 'R', type: 'File', module: 'A', html_url: '/v/1', due_at: null }]);
  assert.deepStrictEqual(Array.from(data.undatedFrom(undefined)), []);
}

(async () => {
  // ---- undated: from each course's content tree, one request per course ----
  const courses = [{ id: 10, name: 'A' }, { id: 11, name: 'B' }];
  const list = await data.undated(courses);
  assert.deepStrictEqual(Array.from(list, (i) => `${i.course_id}:${i.source_id}:${i.name}:${i.module}`), ['10:11:Chapter 1:Week 1', '10:13:Article:Week 1', '10:21:Practice:Extra', '11:41:Syllabus:Start']);
  assert.strictEqual(list[0].kind, 'content');
  assert.strictEqual(list[0].context_name, 'A');
  assert.strictEqual(list[0].html_url, '/d2l/le/content/10/viewContent/11/View');
  assert.strictEqual(list[1].type, 'Link');
  // modules() now carries each topic's due date and exemption.
  const mods = await data.modules(10);
  assert.strictEqual(mods[0].items.find((i) => i.id === 14).due_at, soon);
  assert.strictEqual(mods[0].items.find((i) => i.id === 19).exempt, true);
  // Asked again: the cached content trees, no new requests.
  const before = calls.filter((p) => p.includes('/content/toc')).length;
  await data.undated(courses);
  assert.strictEqual(calls.filter((p) => p.includes('/content/toc')).length, before, 'no extra requests');
  assert.strictEqual(before, 2, 'one content tree per course');
  console.log('courses-undated tests ok');
})().catch((e) => { console.error('COURSES-UNDATED TESTS FAILED', e); process.exit(1); });
