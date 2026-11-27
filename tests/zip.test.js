// The zip download (src/zip.js): CRC-32, names, the zip writer, planning and fetching.
// Each zip made here is parsed byte by byte, and one is also expanded with PowerShell's
// Expand-Archive when PowerShell is there.
// Usage: node tests/zip.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ext = process.argv[2] || path.join(__dirname, '..', 'extension');
const Z = require(path.join(ext, 'src', 'zip.js'));

const enc = new TextEncoder();
const dec = new TextDecoder();

// Reads a zip the way an unzipper does: the end record, then the central directory, then each
// local header it points to. Checks that the two headers agree and that each CRC is right.
function parseZip(buf) {
  const b = new Uint8Array(buf);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const eocd = b.length - 22; // no comment
  assert.strictEqual(v.getUint32(eocd, true), 0x06054b50, 'end of central directory signature');
  const count = v.getUint16(eocd + 10, true);
  assert.strictEqual(v.getUint16(eocd + 8, true), count, 'entries on this disk = total entries');
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  assert.strictEqual(cdOffset + cdSize, eocd, 'central directory ends where the end record starts');
  const entries = [];
  let p = cdOffset;
  let expectedLocal = 0;
  for (let i = 0; i < count; i++) {
    assert.strictEqual(v.getUint32(p, true), 0x02014b50, 'central header signature');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const nameBytes = b.subarray(p + 46, p + 46 + nlen);
    const name = dec.decode(nameBytes);
    assert.strictEqual(flags & 0x0800, 0x0800, `UTF-8 flag on ${name}`);
    assert.strictEqual(method, 0, 'stored');
    assert.strictEqual(csize, size, 'stored: compressed size = size');
    assert.strictEqual(off, expectedLocal, 'local headers follow each other in order');
    // the local header
    assert.strictEqual(v.getUint32(off, true), 0x04034b50, 'local header signature');
    assert.strictEqual(v.getUint16(off + 6, true), flags, 'same flags');
    assert.strictEqual(v.getUint16(off + 8, true), 0, 'local: stored');
    assert.strictEqual(v.getUint32(off + 14, true), crc, 'same CRC');
    assert.strictEqual(v.getUint32(off + 18, true), size, 'same compressed size');
    assert.strictEqual(v.getUint32(off + 22, true), size, 'same size');
    const lnlen = v.getUint16(off + 26, true);
    const lxlen = v.getUint16(off + 28, true);
    assert.deepStrictEqual(b.subarray(off + 30, off + 30 + lnlen), nameBytes, 'same name');
    const dataStart = off + 30 + lnlen + lxlen;
    const data = b.slice(dataStart, dataStart + size);
    assert.strictEqual(Z.crc32(data), crc, `CRC of ${name}`);
    entries.push({ name, data, crc, time: v.getUint16(off + 10, true), date: v.getUint16(off + 12, true) });
    expectedLocal = dataStart + size;
    p += 46 + nlen + xlen + clen;
  }
  assert.strictEqual(p, eocd, 'central directory size matches its headers');
  assert.strictEqual(expectedLocal, cdOffset, 'central directory follows the last file');
  return entries;
}

(async () => {
  // ---- CRC-32 ----
  assert.strictEqual(Z.crc32('123456789'), 0xcbf43926);
  assert.strictEqual(Z.crc32(''), 0);
  assert.strictEqual(Z.crc32('The quick brown fox jumps over the lazy dog'), 0x414fa339);
  assert.strictEqual(Z.crc32(new Uint8Array([0])), 0xd202ef8d);
  // A piece at a time gives the same answer.
  assert.strictEqual(Z.crc32(enc.encode('6789'), Z.crc32(enc.encode('12345'))), 0xcbf43926);
  assert.strictEqual(Z.crc32(enc.encode('123456789').buffer), 0xcbf43926, 'ArrayBuffer too');

  // ---- names ----
  assert.strictEqual(Z.sanitize('a<b>c:d"e/f\\g|h?i*j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.strictEqual(Z.sanitize('notes. . '), 'notes', 'no trailing dots or spaces');
  assert.strictEqual(Z.sanitize('  padded  '), 'padded');
  assert.strictEqual(Z.sanitize('line\none\ttab'), 'line one tab');
  assert.strictEqual(Z.sanitize('bell\u0007'), 'bell_');
  assert.strictEqual(Z.sanitize('CON'), '_CON');
  assert.strictEqual(Z.sanitize('con.txt'), '_con.txt');
  assert.strictEqual(Z.sanitize('LPT9.pdf'), '_LPT9.pdf');
  assert.strictEqual(Z.sanitize('Console.pdf'), 'Console.pdf', 'only the exact reserved names');
  assert.strictEqual(Z.sanitize(''), 'untitled');
  assert.strictEqual(Z.sanitize('...'), 'untitled');
  assert.strictEqual(Z.sanitize(null, { fallback: 'file' }), 'file');
  const long = Z.sanitize(`${'x'.repeat(300)}.pdf`);
  assert.strictEqual(long.length, 100);
  assert.ok(long.endsWith('.pdf'), 'the extension survives shortening');
  const emoji = Z.sanitize('📄'.repeat(120));
  assert.ok(enc.encode(emoji).length <= 240, 'at most 240 UTF-8 bytes');
  assert.ok(!/[\ud800-\udbff]$/.test(emoji), 'never half an emoji');
  assert.strictEqual(Z.sanitize('Cafe\u0301'), 'Caf\u00e9', 'NFC');
  assert.strictEqual(Z.sanitize('Week 1.5', { folder: true }), 'Week 1.5');

  const taken = new Set();
  assert.strictEqual(Z.uniquePath('', 'notes.pdf', taken), 'notes.pdf');
  assert.strictEqual(Z.uniquePath('', 'notes.pdf', taken), 'notes (2).pdf');
  assert.strictEqual(Z.uniquePath('', 'NOTES.pdf', taken), 'NOTES (3).pdf', 'case-insensitive, as on Windows');
  assert.strictEqual(Z.uniquePath('Week 1/', 'notes.pdf', taken), 'Week 1/notes.pdf', 'other folders are separate');
  assert.strictEqual(Z.uniquePath('', 'Week 1', taken, { folder: true }), 'Week 1');
  assert.strictEqual(Z.uniquePath('', 'Week 1', taken, { folder: true }), 'Week 1 (2)');
  assert.strictEqual(Z.uniquePath('', 'Week 1', taken), 'Week 1 (3)', 'a file cannot take a folder\'s name');
  assert.strictEqual(Z.uniquePath('', 'v1.5', taken, { folder: true }), 'v1.5');
  assert.strictEqual(Z.uniquePath('', 'v1.5', taken, { folder: true }), 'v1.5 (2)', 'folders keep dots in their names');

  assert.strictEqual(Z.fileName({ title: 'Lecture 1 slides', url: '/content/enforced/1-CS/Lecture%201.pdf' }), 'Lecture 1 slides.pdf');
  assert.strictEqual(Z.fileName({ title: 'Syllabus.pdf', url: '/content/syllabus.pdf' }), 'Syllabus.pdf');
  assert.strictEqual(Z.fileName({ title: 'Chapter 1.2', url: '/x/c.PPTX' }), 'Chapter 1.2.pptx');
  assert.strictEqual(Z.fileName({ title: 'Notes', url: '' }, { disposition: 'attachment; filename="notes.docx"' }), 'Notes.docx');
  assert.strictEqual(Z.fileName({ title: 'Notes', url: '' }, { disposition: "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.txt" }), 'Notes.txt');
  assert.strictEqual(Z.fileName({ title: 'Picture', url: '' }, { type: 'image/jpeg; charset=binary' }), 'Picture.jpg');
  assert.strictEqual(Z.fileName({ title: 'Mystery', url: '' }), 'Mystery');
  assert.strictEqual(Z.dispositionName("inline; filename*=UTF-8''%E6%97%A5%E6%9C%AC.pdf"), '日本.pdf');

  // ---- the zip writer ----
  const unicode = 'Résumé – 日本語 📄.txt';
  const sample = [
    { name: 'hello.txt', data: 'Hello, zip!\r\n', date: new Date(2026, 10, 24, 13, 45, 30) },
    { name: `Week 1/${unicode}`, data: enc.encode('unicode name') },
    { name: 'Week 1/Extra practice/blob.bin', data: new Blob([new Uint8Array([0, 1, 2, 255]), 'tail']) },
    { name: 'empty.txt', data: new Uint8Array(0) },
    { name: 'buffer.dat', data: enc.encode('123456789').buffer },
  ];
  const zip = await Z.buildZip(sample);
  assert.strictEqual(zip.type, 'application/zip');
  const parsed = parseZip(await zip.arrayBuffer());
  assert.deepStrictEqual(parsed.map((e) => e.name), sample.map((e) => e.name), 'unicode names round-trip');
  assert.strictEqual(dec.decode(parsed[0].data), 'Hello, zip!\r\n');
  assert.deepStrictEqual([...parsed[2].data], [0, 1, 2, 255, ...enc.encode('tail')]);
  assert.strictEqual(parsed[3].data.length, 0);
  assert.strictEqual(parsed[4].crc, 0xcbf43926, 'known CRC stored in the zip');
  // 13:45:30 on 24 Nov 2026, in DOS form.
  assert.strictEqual(parsed[0].time, (13 << 11) | (45 << 5) | 15);
  assert.strictEqual(parsed[0].date, ((2026 - 1980) << 9) | (11 << 5) | 24);
  assert.deepStrictEqual(Z.dosDateTime(new Date(1975, 0, 1)), { time: 0, date: (1 << 5) | 1 }, 'before 1980 becomes 1980');
  assert.deepStrictEqual(parseZip(await new Blob(Z.zipParts([])).arrayBuffer()), [], 'an empty zip is valid');
  // The parts are the headers and the file data itself, not a copy.
  const blobData = new Blob(['x'.repeat(1000)]);
  const parts = Z.zipParts([{ name: 'a.txt', data: blobData, crc: Z.crc32('x'.repeat(1000)) }]);
  assert.strictEqual(parts[1], blobData, 'file data is passed through');
  // Limits: no ZIP64.
  const none = new Uint8Array(0);
  assert.throws(() => Z.zipParts(Array.from({ length: Z.MAX_ENTRIES + 1 }, (_, i) => ({ name: `${i}`, data: none, crc: 0 }))), Z.ZipLimitError);
  assert.throws(() => Z.zipParts([{ name: 'huge', data: none, size: 0xffffffff, crc: 0 }]), Z.ZipLimitError);

  // ---- planning a download ----
  const item = (id, title, type, url) => ({ id, title, type, url, file_url: `/d2l/api/le/1.0/7/content/topics/${id}/file?stream=true`, html_url: `/d2l/le/content/7/viewContent/${id}/View`, updated_at: '2026-11-01T10:00:00Z' });
  const mods = [
    { id: 1, name: 'Week 1', depth: 0, items: [
      { id: 1e9 + 1, title: 'Week 1', type: 'Module overview', url: '' },
      item(11, 'Lecture 1', 'File', '/content/l1.pdf'),
      item(12, 'Lecture 1', 'File', '/content/l1b.pdf'), // same title: gets "(2)"
      item(13, 'Reading', 'Link', 'https://example.edu/reading'),
      item(14, 'Homework 1', 'Assignment', '/d2l/common/dialogs/quickLink/quickLink.d2l?ou=7&type=dropbox'),
      item(15, 'links', 'File', '/content/links.txt'), // may not take links.txt
    ] },
    { id: 2, name: 'Extra: practice?', depth: 1, items: [item(21, 'Practice', 'File', '/content/p.pdf'), item(22, 'Locked one', 'File', '/content/locked.pdf'), item(23, 'Signed out', 'File', '/content/so.pdf')] },
    { id: 3, name: 'Week 2', depth: 0, items: [item(31, 'Gone', 'File', '/content/gone.pdf'), item(32, 'Tool', 'External tool', '/d2l/lti?type=lti')] },
    { id: 4, name: 'week 2', depth: 0, items: [item(41, '日本語 notes', 'File', '/content/jp.pdf')] },
  ];
  const whole = Z.plan(mods, { origin: 'https://school.brightspace.com' });
  assert.deepStrictEqual(whole.files.map((f) => `${f.dir}|${f.where}`), [
    'Week 1/|Week 1', 'Week 1/|Week 1', 'Week 1/|Week 1',
    'Week 1/Extra_ practice_/|Week 1 / Extra: practice?', 'Week 1/Extra_ practice_/|Week 1 / Extra: practice?', 'Week 1/Extra_ practice_/|Week 1 / Extra: practice?',
    'Week 2/|Week 2',
    'week 2 (2)/|week 2',
  ]);
  assert.deepStrictEqual(whole.links.map((l) => [l.where, l.title, l.url]), [
    ['Week 1', 'Reading', 'https://example.edu/reading'],
    ['Week 1', 'Homework 1', 'https://school.brightspace.com/d2l/common/dialogs/quickLink/quickLink.d2l?ou=7&type=dropbox'],
    ['Week 2', 'Tool', 'https://school.brightspace.com/d2l/lti?type=lti'],
  ]);
  const one = Z.plan(mods.slice(0, 2), { flattenFirst: true });
  assert.deepStrictEqual([...new Set(one.files.map((f) => f.dir))], ['', 'Extra_ practice_/'], 'one module: its files at the top');
  // A course is offered for download only when it has files (the Dashboard's course dialog).
  assert.strictEqual(Z.hasFiles(mods), true);
  assert.strictEqual(Z.hasFiles([{ id: 5, name: 'Links only', depth: 0, items: [item(51, 'Reading', 'Link', 'https://example.edu/r'), item(52, 'Tool', 'External tool', '/d2l/lti')] }]), false);
  assert.strictEqual(Z.hasFiles([{ id: 6, name: 'Outside', depth: 0, items: [{ ...item(61, 'Ed file', 'File', ''), external: {} }] }, { id: 7, name: 'Empty', depth: 0 }]), false);
  assert.strictEqual(Z.hasFiles([]), false);
  // Folder names are kept short, so deep module trees stay under Windows' 260-character paths.
  assert.strictEqual(Z.FOLDER_MAX, 40);
  const longName = 'Unit 4: An unreasonably long module title about graph algorithms and more';
  const deep = Z.plan([0, 1, 2, 3, 4].map((d) => ({ id: 90 + d, name: `${longName} ${d}`, depth: d, items: [item(900 + d, 'Notes', 'File', '/content/n.pdf')] })));
  const deepest = deep.files[4].dir;
  assert.ok(deepest.split('/').filter(Boolean).every((s) => s.length <= 40), deepest);
  assert.strictEqual(deepest.split('/')[0], 'Unit 4_ An unreasonably long module titl');
  assert.ok(deepest.length <= 5 * 41, `deep path stays short (${deepest.length})`);
  assert.strictEqual(deep.files[0].where, `${longName} 0`, 'failed.txt and links.txt keep the full names');

  // ---- fetching, with a stubbed Brightspace ----
  const body = (id) => enc.encode(`file ${id} `.repeat(id));
  let active = 0;
  let most = 0;
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    const id = Number(/topics\/(\d+)\//.exec(url)[1]);
    active++;
    most = Math.max(most, active);
    await new Promise((r) => setTimeout(r, 5 + (id % 4) * 3));
    active--;
    if (id === 22) return { ok: false, status: 403, headers: { get: () => null } };
    if (id === 31) return { ok: false, status: 404, headers: { get: () => null } };
    if (id === 23) return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) }, arrayBuffer: async () => enc.encode('<html>sign in</html>').buffer };
    const bytes = body(id);
    const headers = { get: (h) => (h === 'content-type' ? 'application/pdf' : h === 'content-length' ? String(bytes.length) : null) };
    if (id % 2) {
      // streamed in pieces, as fetch does
      let at = 0;
      return { ok: true, status: 200, headers, body: { getReader: () => ({ read: async () => (at < bytes.length ? { done: false, value: bytes.slice(at, (at += 7)) } : { done: true }), cancel: async () => {} }) } };
    }
    return { ok: true, status: 200, headers, arrayBuffer: async () => bytes.slice().buffer };
  };
  const progress = [];
  const result = await Z.fetchAll(whole.files, { fetch: fakeFetch, onProgress: (s) => progress.push(s) });
  assert.ok(most <= 3 && most >= 2, `at most 3 at a time (saw ${most})`);
  assert.ok(calls.every((c) => c.opts.credentials === 'same-origin' && c.opts.signal), 'with the session and a signal');
  assert.strictEqual(result.got.size, 5);
  assert.deepStrictEqual(result.failed.map((f) => [f.title, f.reason]), [
    ['Locked one', 'Not available to you (Brightspace answered 403).'],
    ['Signed out', 'Brightspace sent a page instead of the file (signed out?).'],
    ['Gone', 'Not available to you (Brightspace answered 404).'],
  ]);
  const last = progress[progress.length - 1];
  assert.strictEqual(last.done, 8);
  assert.strictEqual(last.total, 8);
  assert.strictEqual(last.failed, 3);
  assert.strictEqual(last.bytes, [11, 12, 15, 21, 41].reduce((n, id) => n + body(id).length, 0), 'bytes counted');
  assert.ok(progress.some((s) => s.current.length), 'which files are downloading');

  const entries = Z.entriesFor('CS 101', whole, result);
  const built = parseZip(await new Blob(Z.zipParts(entries)).arrayBuffer());
  assert.deepStrictEqual(built.map((e) => e.name), [
    'Week 1/Lecture 1.pdf',
    'Week 1/Lecture 1 (2).pdf',
    'Week 1/links.txt',
    'Week 1/Extra_ practice_/Practice.pdf',
    'week 2 (2)/日本語 notes.pdf',
    'links.txt',
    'failed.txt',
  ]);
  assert.deepStrictEqual(built[1].data, body(12));
  assert.deepStrictEqual(built[0].data, body(11), 'streamed file intact');
  const linksTxt = dec.decode(built[5].data);
  assert.ok(linksTxt.includes('[Week 1]\r\nReading\r\n  https://example.edu/reading'), linksTxt);
  assert.ok(linksTxt.includes('Homework 1 (Assignment)'));
  assert.ok(linksTxt.includes('[Week 2]\r\nTool (External tool)\r\n  https://school.brightspace.com/d2l/lti?type=lti'));
  const failedTxt = dec.decode(built[6].data);
  assert.ok(failedTxt.includes('Week 1 / Extra: practice? / Locked one\r\n  Not available to you (Brightspace answered 403).'), failedTxt);
  assert.ok(failedTxt.includes('Week 2 / Gone'));
  // The same names whatever order the files arrive in.
  const again = Z.plan(mods, { origin: 'https://school.brightspace.com' });
  const reversed = { got: new Map([...result.got.entries()].reverse()), failed: result.failed };
  assert.deepStrictEqual(Z.entriesFor('CS 101', again, reversed).map((e) => e.name), built.map((e) => e.name));

  // Cancel: stops at once and says so.
  const ctl = new AbortController();
  const cancelled = Z.fetchAll(whole.files, { fetch: async (url, opts) => { setTimeout(() => ctl.abort(), 1); return fakeFetch(url, opts); }, signal: ctl.signal });
  await assert.rejects(cancelled, (e) => e.name === 'AbortError');
  // Past the warning size, it asks once; "Stop" cancels, "Keep going" goes on.
  let asked = 0;
  await assert.rejects(Z.fetchAll(whole.files, { fetch: fakeFetch, warnBytes: 10, ask: async () => (asked++, false) }), (e) => e.name === 'AbortError');
  assert.strictEqual(asked, 1);
  asked = 0;
  const kept = await Z.fetchAll(whole.files, { fetch: fakeFetch, warnBytes: 10, ask: async () => (asked++, true) });
  assert.strictEqual(asked, 1);
  assert.strictEqual(kept.got.size, 5);
  // ...and again past every further `askEvery` while files are left (default: every 1 GB).
  assert.strictEqual(Z.ASK_EVERY, 1e9);
  const askedAt = [];
  const often = await Z.fetchAll(whole.files, { fetch: fakeFetch, concurrency: 1, warnBytes: 10, askEvery: 100, ask: async (b) => (askedAt.push(b), true) });
  assert.strictEqual(often.got.size, 5);
  assert.ok(askedAt.length >= 2, `asks more than once (${askedAt})`);
  assert.deepStrictEqual(askedAt, [88, 184, 304, 472], 'past 10, then past 100, 200, 400; not after the last file');
  // Cancel or Escape while the question is open settles at once, even if it is never answered.
  const ctl2 = new AbortController();
  const t0 = Date.now();
  const hung = Z.fetchAll(whole.files, { fetch: fakeFetch, signal: ctl2.signal, warnBytes: 10, ask: () => (setTimeout(() => ctl2.abort(), 5), new Promise(() => {})) });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('fetchAll hung after cancel')), 2000));
  await assert.rejects(Promise.race([hung, timeout]), (e) => e.name === 'AbortError');
  assert.ok(Date.now() - t0 < 1000, 'promptly');
  // Past the zip's size limit: the rest are left out and listed, not fetched.
  const capped = await Z.fetchAll(whole.files, { fetch: fakeFetch, maxBytes: 200, concurrency: 1 });
  assert.ok(capped.got.size >= 1 && capped.got.size < 5, `some fit (${capped.got.size})`);
  assert.ok(capped.failed.some((f) => f.reason === 'Left out: the zip would pass 200 B.'), JSON.stringify(capped.failed));
  assert.ok([...capped.got.values()].reduce((n, g) => n + g.size, 0) <= 200);
  // The default limit is 2 GB (the whole zip is held in memory).
  assert.strictEqual(Z.MAX_DATA, 2e9);
  const huge = await Z.fetchAll(whole.files.slice(0, 2), { fetch: async () => ({ ok: true, status: 200, headers: { get: (h) => (h === 'content-length' ? '3000000000' : null) }, arrayBuffer: async () => new ArrayBuffer(0) }), concurrency: 1 });
  assert.deepStrictEqual(huge.failed.map((f) => f.reason), ['Left out: the zip would pass 2 GB.', 'Left out: the zip would pass 2 GB.']);

  // ---- a real unzipper: PowerShell's Expand-Archive ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsx-zip-'));
  try {
    const file = path.join(dir, 'sample.zip');
    fs.writeFileSync(file, Buffer.from(await new Blob(Z.zipParts(entries)).arrayBuffer()));
    const out = path.join(dir, 'out');
    const ps = process.platform === 'win32' ? 'powershell' : 'pwsh';
    const run = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${file.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`], { encoding: 'utf8', timeout: 60e3 });
    if (run.error) console.log(`skipped Expand-Archive: ${run.error.code || run.error.message}`);
    else {
      assert.strictEqual(run.status, 0, `Expand-Archive failed: ${run.stderr}`);
      for (const e of built) {
        const got = fs.readFileSync(path.join(out, ...e.name.split('/')));
        assert.deepStrictEqual(new Uint8Array(got), e.data, `Expand-Archive gave back ${e.name}`);
      }
      console.log(`Expand-Archive: ${built.length} files match`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('zip tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
