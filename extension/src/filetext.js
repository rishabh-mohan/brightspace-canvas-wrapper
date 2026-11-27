// Text inside course files, for search: PDFs (their text, or OCR when scanned) and images (OCR).
// The reading happens in a hidden extension page (ocr/ocr.html), where pdf.js and Tesseract can
// run; this side downloads each file with the student's own session and posts the bytes there.
// Text is kept in extension storage on this computer, keyed by the file's last change, so each
// file is read once. Nothing is sent anywhere else.
BSX.filetext = (() => {
  const api = globalThis.browser || globalThis.chrome;
  const store = api?.storage?.local;
  const KEY = `bsxText:${globalThis.location?.host || ''}`;
  const MAX_BYTES = 30e6; // larger files are skipped: too slow to download and read
  const MAX_CHARS = 100e3; // text kept per file
  const MAX_TOTAL = 20e6; // characters kept in all; the least recently read files go first
  const TIMEOUT = 3 * 60e3; // one file, OCR included
  const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

  // 'pdf', 'image' or null, from the file's path (module File items carry it in `url`).
  function kindOf(item) {
    const ext = (String(item.url || item.title || '').split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (ext === 'pdf') return { kind: 'pdf', mime: 'application/pdf' };
    if (IMAGE[ext]) return { kind: 'image', mime: IMAGE[ext] };
    return null;
  }
  // A changed file gets a new key, so it is read again.
  const keyOf = (course, item) => `${course}:${item.id}:${item.updated_at || ''}`;

  let saved = new Map(); // key -> { at, text, ocr }
  const ready = (async () => {
    try {
      const v = (await store.get(KEY))?.[KEY];
      if (v && typeof v === 'object') for (const [k, e] of Object.entries(v)) if (e && typeof e.text === 'string') saved.set(k, e);
    } catch {}
  })();
  let saveTimer = null;
  let saveAt = 0;
  function write() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const out = {};
    let total = 0;
    for (const [k, e] of [...saved.entries()].sort((a, b) => b[1].at - a[1].at)) {
      if ((total += e.text.length) > MAX_TOTAL) break;
      out[k] = e;
    }
    try {
      store.set({ [KEY]: out });
    } catch {}
  }
  // Writes all kept text (up to MAX_TOTAL characters) in one go, so while files are being read
  // a write happens at most every `delay` ms instead of after each file.
  function persist(delay = 1000) {
    if (saveTimer && saveAt <= Date.now() + delay) return; // a write due sooner saves this change too
    clearTimeout(saveTimer);
    saveAt = Date.now() + delay;
    saveTimer = setTimeout(write, delay);
  }
  // Leaving the page: write what is waiting now, so text read in the last few seconds is kept.
  addEventListener('pagehide', () => saveTimer && write());
  function remember(course, item, entry) {
    const prefix = `${course}:${item.id}:`;
    for (const k of saved.keys()) if (k.startsWith(prefix)) saved.delete(k); // older versions of the file
    saved.set(keyOf(course, item), { at: Date.now(), ...entry });
    persist(10e3);
  }

  // ---- the reader frame ----------------------------------------------------------
  const src = api?.runtime?.getURL ? api.runtime.getURL('ocr/ocr.html') : '/ext/ocr/ocr.html';
  const origin = new URL(src, location.href).origin;
  let frame = null;
  let frameReady = null;
  const waiting = new Map(); // id -> { done, fail, timer }
  let nextId = 1;
  addEventListener('message', (ev) => {
    if (!frame || ev.source !== frame.contentWindow || ev.origin !== origin || !ev.data) return;
    const m = ev.data;
    if (m.type === 'bsx-text-ready') frameReady.resolve();
    if (m.type !== 'bsx-text' || !waiting.has(m.id)) return;
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    clearTimeout(w.timer);
    if (m.error) w.fail(new Error(m.error));
    else w.done({ text: String(m.text || ''), ocr: Boolean(m.ocr), partial: Boolean(m.partial) });
  });
  function reader() {
    if (!frame) {
      let resolve;
      frameReady = Object.assign(new Promise((r) => (resolve = r)), { resolve: () => resolve() });
      frame = document.createElement('iframe');
      frame.src = src;
      frame.title = 'File text reader';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none';
      document.documentElement.append(frame);
    }
    return frameReady;
  }
  async function read(bytes, kind, mime) {
    await reader();
    const id = nextId++;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        fail(new Error('Reading the file took too long.'));
      }, TIMEOUT);
      waiting.set(id, { done, fail, timer });
      frame.contentWindow.postMessage({ type: 'bsx-text', id, kind, mime, bytes }, origin, [bytes]);
    });
  }

  async function download(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Brightspace answered ${res.status}.`);
    const type = res.headers.get('content-type') || '';
    if (/text\/html/i.test(type)) throw new Error('Brightspace sent a page instead of the file (signed out?).');
    const size = Number(res.headers.get('content-length'));
    if (size > MAX_BYTES) throw new Error('Too large to read.');
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new Error('Too large to read.');
    return bytes;
  }

  // ---- for search ------------------------------------------------------------------
  // The kept text of a file, or null when it has not been read (yet).
  const textOf = (course, item) => saved.get(keyOf(course, item))?.text ?? null;

  // Reads every listed file that has no kept text yet, one at a time. `files` is
  // [{ course, item }]; onEach(course, item, text) is called as each one is done (text is '' for
  // a file that could not be read; it is not tried again until it changes).
  let running = null;
  async function index(files, { onEach = () => {}, onProgress = () => {} } = {}) {
    await ready;
    const todo = files.filter(({ course, item }) => kindOf(item) && item.file_url && !saved.has(keyOf(course, item)));
    if (running) await running.catch(() => {}); // one indexing run at a time
    running = (async () => {
      let n = 0;
      // The next file downloads while this one is read (OCR is slow), so the two overlap.
      let ahead = null; // { item, bytes: Promise }
      const fetchAhead = (i) => {
        const next = todo[i];
        if (!next || saved.has(keyOf(next.course, next.item))) return null;
        const bytes = download(next.item.file_url);
        bytes.catch(() => {}); // handled when its turn comes (or dropped if the run stops)
        return { item: next.item, bytes };
      };
      try {
        for (const [i, { course, item }] of todo.entries()) {
          onProgress(n++, todo.length, item);
          const pending = ahead && ahead.item === item ? ahead.bytes : null;
          ahead = null;
          if (saved.has(keyOf(course, item))) continue; // read meanwhile by another run
          const { kind, mime } = kindOf(item);
          let entry;
          try {
            const bytes = pending || download(item.file_url);
            ahead = fetchAhead(i + 1);
            const r = await read(await bytes, kind, mime);
            entry = { text: r.text.slice(0, MAX_CHARS), ocr: r.ocr };
          } catch (e) {
            if (/signed out/i.test(e.message)) throw e;
            entry = { text: '', failed: String(e.message || e).slice(0, 200) };
          }
          remember(course, item, entry);
          onEach(course, item, entry.text);
        }
      } finally {
        if (todo.length) persist(); // save what was read soon after the run, not up to 10 s later
      }
      onProgress(todo.length, todo.length, null);
    })();
    return running;
  }

  // How many of these files can be read, and how many still need reading.
  async function status(files) {
    await ready;
    const readable = files.filter(({ item }) => kindOf(item) && item.file_url);
    return { readable: readable.length, todo: readable.filter(({ course, item }) => !saved.has(keyOf(course, item))).length };
  }

  // Signed out, or the student turned the feature off: drop all kept text.
  function forget() {
    saved = new Map();
    persist();
  }

  return { kindOf, textOf, index, status, forget, ready };
})();
