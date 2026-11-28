// Unread discussion posts: data.unreadPosts, and the made-up site (tools/fake-brightspace.js)
// agreeing with itself, read through client.js and data.js. Usage: node tests/discussions.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ext = process.argv[2] || path.join(__dirname, '..', 'extension');
const { handle, submit } = require(path.join(__dirname, '..', 'tools', 'fake-brightspace.js'));

const ctx = {
  console, URL, Date, Math, JSON, Promise, Map, Set, encodeURIComponent, setTimeout, clearTimeout, Blob,
  localStorage: { getItem: (k) => (k === 'XSRF.Token' ? 'x1' : null) },
  location: { origin: 'https://x.brightspace.com', host: 'x.brightspace.com' },
  sessionStorage: { getItem: () => null, setItem() {} },
  fetch: async (p, opts = {}) => {
    const url = new URL(p, 'https://x.brightspace.com');
    if (opts.method === 'POST') {
      if (url.pathname === '/d2l/lp/auth/oauth2/token') return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
      const r = submit(url.pathname, Buffer.from(String(opts.body)), opts.headers['Content-Type']);
      return { ok: r.status === 200, status: r.status, text: async () => r.body };
    }
    const r = handle(url.pathname, url.searchParams) || { status: 404, body: 'null' };
    return { ok: r.status === 200, status: r.status, url: p, json: async () => JSON.parse(r.body), text: async () => r.body };
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['src/client.js', 'src/data.js']) vm.runInContext(fs.readFileSync(path.join(ext, f), 'utf8'), ctx, { filename: f });

(async () => {
  const { data } = ctx.BSX;
  // Unread and not the student's own; nothing given counts as none.
  const u = data.unreadPosts;
  assert.strictEqual(u([{ unread: true, mine: false }, { unread: false, mine: false }, { unread: true, mine: true }, { unread: true }]), 2);
  assert.strictEqual(u([]), 0);
  assert.strictEqual(u(undefined), 0);

  // The made-up site: each topic's unread posts add up to the card's count (myUpdates).
  const counts = async (ou) => {
    const topics = await data.discussions(ou);
    return Promise.all(topics.map(async (t) => u((await data.discussion(ou, t.source_id)).posts)));
  };
  const cs = await counts(101);
  assert.deepStrictEqual(cs, [2, 0, 1], 'CS 25100: topics with and without unread posts');
  assert.strictEqual((await data.updates(101)).discussions, 3, 'card count matches the topics');
  for (const ou of [102, 103, 104, 105, 201]) {
    const sum = (await counts(ou)).reduce((s, n) => s + n, 0);
    assert.strictEqual((await data.updates(ou)).discussions, sum, `course ${ou}: card count matches the topics`);
  }
  assert.strictEqual((await data.updates(102)).discussions, 0, 'some course has none');
  // Topics have their own posts, not one shared list.
  const [a, b] = await data.discussions(101);
  const ids = async (t) => (await data.discussion(101, t.source_id)).posts.map((p) => p.id);
  assert.notDeepStrictEqual(await ids(a), await ids(b));

  // The student's own new post is read and leaves the counts alone.
  const before = (await data.discussion(101, a.source_id)).posts.length;
  await data.post(101, a.forum_id, a.source_id, { message: 'Me too.' });
  const after = await data.discussion(101, a.source_id);
  assert.strictEqual(after.posts.length, before + 1);
  assert.strictEqual(after.posts.at(-1).mine, true);
  assert.strictEqual(u(after.posts), 2);
  assert.strictEqual((await data.updates(101)).discussions, 3);
  console.log('discussions tests ok');
})().catch((e) => { console.error('DISCUSSIONS TESTS FAILED', e); process.exit(1); });
