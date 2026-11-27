// Reading file text for search (src/filetext.js), with a stubbed reader frame and Brightspace.
// Usage: node tests/filetext.test.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const ext = process.argv[2] || path.join(__dirname, '..', 'extension');
const source = fs.readFileSync(path.join(ext, 'src', 'filetext.js'), 'utf8');

// A filetext with a reader frame that takes `readMs` per file. With `clock`, time is fake: the
// module's timers and Date.now follow clock.now, and each read moves it on by readMs.
function load({ readMs = 50, clock = null } = {}) {
  const on = {};
  const log = [];
  const writes = [];
  const timers = [];
  const fake = clock && {
    setTimeout: (fn, ms) => { const t = { fn, at: clock.now + ms }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    Date: { now: () => clock.now },
  };
  const advance = (ms) => {
    clock.now += ms;
    for (let t; (t = timers.filter((x) => x.at <= clock.now).sort((a, b) => a.at - b.at)[0]);) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  const reply = (data) => on.message({ source: frame.contentWindow, origin: 'https://ext.test', data });
  const frame = {
    style: {},
    setAttribute() {},
    contentWindow: {
      postMessage(m) {
        log.push(`read ${m.bytes.tag}`);
        if (clock) {
          advance(readMs);
          setImmediate(() => reply({ type: 'bsx-text', id: m.id, text: `text of ${m.bytes.tag}` }));
        } else setTimeout(() => reply({ type: 'bsx-text', id: m.id, text: `text of ${m.bytes.tag}` }), readMs);
      },
    },
  };
  const ctx = {
    BSX: {},
    location: { host: 'x', href: 'https://x/' },
    URL, console,
    setTimeout: fake ? fake.setTimeout : setTimeout,
    clearTimeout: fake ? fake.clearTimeout : clearTimeout,
    addEventListener: (type, fn) => (on[type] = fn),
    chrome: { runtime: { getURL: () => 'https://ext.test/ocr/ocr.html' }, storage: { local: { get: async () => ({}), set: (v) => writes.push({ at: clock ? clock.now : Date.now(), v }) } } },
    document: { createElement: () => { setImmediate(() => reply({ type: 'bsx-text-ready' })); return frame; }, documentElement: { append() {} } },
    fetch: async (url) => {
      log.push(`fetch ${url}`);
      await new Promise((r) => setImmediate(r));
      if (url === '/bad.pdf') return { ok: false, status: 404, headers: { get: () => null } };
      return { ok: true, headers: { get: (h) => (h === 'content-type' ? 'application/pdf' : null) }, arrayBuffer: async () => Object.assign(new ArrayBuffer(4), { tag: url }) };
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  if (fake) vm.runInContext('Date.now = () => globalThis.__now();', Object.assign(ctx, { __now: fake.Date.now }));
  vm.runInContext(source, ctx);
  return { ft: ctx.BSX.filetext, on, log, writes, advance };
}
const filesOf = (urls) => urls.map((u, i) => ({ course: 1, item: { id: i, url: u, file_url: u, updated_at: 't' } }));

(async () => {
  // Quick reads: every file read once, in order; the next download overlaps the current read.
  {
    const { ft, log, writes } = load();
    const files = filesOf(['/a.pdf', '/bad.pdf', '/b.pdf', '/c.pdf']);
    const each = [];
    await ft.index(files, { onEach: (c, item, text) => each.push(`${item.id}:${text}`) });
    assert.deepStrictEqual(each, ['0:text of /a.pdf', '1:', '2:text of /b.pdf', '3:text of /c.pdf']);
    assert.ok(log.indexOf('fetch /c.pdf') < log.indexOf('read /b.pdf'), 'the next file downloads while one is read');
    assert.strictEqual(log.filter((l) => l.startsWith('fetch')).length, 4, 'each file downloaded once');
    assert.strictEqual(ft.textOf(1, files[2].item), 'text of /b.pdf');
    await new Promise((r) => setTimeout(r, 1300));
    assert.strictEqual(writes.length, 1, `one storage write per run, got ${writes.length}`);
    log.length = 0;
    await ft.index(files);
    assert.strictEqual(log.length, 0, 'nothing left to read: no downloads');
  }

  // Slow reads (3 s each, fake clock): at most one write per 10 s while reading, plus one after.
  {
    const clock = { now: 1e6 };
    const { ft, writes, advance } = load({ readMs: 3000, clock });
    const files = filesOf(Array.from({ length: 10 }, (_, i) => `/f${i}.pdf`));
    await ft.index(files);
    const during = writes.length;
    assert.ok(during <= 3, `30 s of reading: at most 3 writes, got ${during}`);
    for (let i = 1; i < writes.length; i++) assert.ok(writes[i].at - writes[i - 1].at >= 10e3, 'writes 10 s apart');
    advance(1000);
    assert.strictEqual(writes.length, during + 1, 'the end of the run is saved within a second');
    assert.strictEqual(Object.keys(writes.at(-1).v['bsxText:x']).length, 10);
  }

  // Leaving the page writes what is waiting at once.
  {
    const clock = { now: 1e6 };
    const { ft, on, writes, advance } = load({ readMs: 3000, clock });
    await ft.index(filesOf(['/a.pdf', '/b.pdf']));
    assert.strictEqual(writes.length, 0, 'not written yet');
    on.pagehide();
    assert.strictEqual(writes.length, 1, 'written on pagehide');
    advance(20e3);
    assert.strictEqual(writes.length, 1, 'and not again');
  }
  console.log('filetext: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
