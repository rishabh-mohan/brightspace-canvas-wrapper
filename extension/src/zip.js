// Download a module, or a whole course, as one .zip, built in the browser.
// Each file is fetched with the student's own session (same origin, like every other request)
// and stored as is (no compression: course files are mostly PDFs, slides and images, which are
// compressed already). Links, tools and other entries that are not files are listed in
// links.txt; files that could not be fetched are listed in failed.txt.
// Limits: a plain zip (no ZIP64), so at most 65,534 entries, and at most 2 GB of files: the
// whole zip is held in memory until it is saved, and browsers (Firefox especially) can run out
// well before the format's 4 GB. A download that would go past that stops adding files and lists
// the rest in failed.txt. It asks before going on past 500 MB, and again at every further 1 GB.
// The pure parts (crc32, names, the zip writer, the planning and fetching) are exported for
// tests/zip.test.js; the progress dialog needs BSX.ui.
(function (root) {
  const MAX_ENTRIES = 65534; // 0xFFFF in the end record means ZIP64 to readers
  const MAX_DATA = 2e9; // bytes of file data in one zip (held in memory; the format allows < 4 GiB)
  const WARN_BYTES = 500e6; // ask before going on past this...
  const ASK_EVERY = 1e9; // ...and again past every further 1 GB
  const CONCURRENCY = 3;
  const SEGMENT_MAX = 100; // characters in one file name
  const FOLDER_MAX = 40; // characters in one folder name, so deep module trees stay under Windows' 260
  const SEGMENT_BYTES = 240; // UTF-8 bytes in one name (most file systems allow 255)

  class ZipLimitError extends Error {}

  // ---- CRC-32 (IEEE 802.3, as zip uses) --------------------------------------------
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const enc = new TextEncoder();
  // `crc` is the result so far, so a file can be checked a piece at a time as it arrives.
  function crc32(data, crc = 0) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    let c = (crc ^ 0xffffffff) >>> 0;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ---- names -----------------------------------------------------------------------
  const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;
  const utf8Length = (s) => enc.encode(s).length;
  // "notes.pdf" -> ["notes", ".pdf"]; a leading dot or a long "extension" is part of the name.
  function splitExt(name) {
    const m = /^(.+?)(\.[A-Za-z0-9]{1,10})$/.exec(name);
    return m ? [m[1], m[2]] : [name, ''];
  }
  // One file or folder name that Windows, macOS and Linux all accept.
  function sanitize(name, { max = SEGMENT_MAX, fallback = 'untitled', folder = false } = {}) {
    let s = String(name ?? '').normalize('NFC')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
      .replace(/ {2,}/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');
    if (!s) s = fallback;
    if (RESERVED.test(s)) s = `_${s}`;
    if (Array.from(s).length > max || utf8Length(s) > SEGMENT_BYTES) {
      const [base, ext] = folder ? [s, ''] : splitExt(s);
      let chars = Array.from(base); // whole characters, so an emoji is never cut in half
      const room = max - ext.length;
      if (chars.length > room) chars = chars.slice(0, room);
      while (chars.length > 1 && utf8Length(chars.join('') + ext) > SEGMENT_BYTES) chars.pop();
      s = chars.join('').replace(/[. ]+$/, '') + ext;
      if (!s || s === ext) s = fallback + ext;
    }
    return s;
  }
  // A path no other entry has (case aside, as on Windows): "notes (2).pdf", "Week 1 (2)".
  // `taken` holds every path given out so far, lower-cased, folders without the slash.
  function uniquePath(dir, name, taken, { folder = false } = {}) {
    const [base, ext] = folder ? [name, ''] : splitExt(name);
    let path = dir + name;
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${dir}${base} (${n})${ext}`;
    taken.add(path.toLowerCase());
    return path;
  }

  const MIME_EXT = {
    'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
    'text/plain': 'txt', 'text/csv': 'csv', 'text/html': 'html', 'application/zip': 'zip', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3',
    'application/msword': 'doc', 'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  const extOf = (s) => (/\.([A-Za-z0-9]{1,10})$/.exec(String(s || '').split(/[?#]/)[0]) || [])[1] || '';
  function decode(s) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }
  // The file name in a Content-Disposition header, if any.
  function dispositionName(header) {
    const h = String(header || '');
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?'[^']*'([^;]+)/.exec(h);
    if (star) return decode(star[1].trim().replace(/^"|"$/g, ''));
    const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(h);
    return plain ? (plain[1] ?? plain[2]).trim() : '';
  }
  // A module File entry's name in the zip: its title, with the file's own extension (taken from
  // its path in Content, else from the download's headers) when the title lacks it.
  function fileName(item, { disposition = '', type = '' } = {}) {
    const title = String(item.title || '').trim() || 'file';
    const ext = extOf(decode(item.url || '')) || extOf(dispositionName(disposition)) || MIME_EXT[String(type).split(';')[0].trim().toLowerCase()] || '';
    if (!ext || extOf(title).toLowerCase() === ext.toLowerCase()) return title;
    return `${title}.${ext.toLowerCase()}`;
  }

  // ---- the zip writer ---------------------------------------------------------------
  // Zip dates are local time, in two-second steps, from 1980 on.
  function dosDateTime(when) {
    let d = when instanceof Date ? when : new Date(when ?? Date.now());
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 1980) d = new Date(1980, 0, 1);
    if (d.getFullYear() > 2107) d = new Date(2107, 11, 31, 23, 59, 58);
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }
  const sizeOf = (data) => (data instanceof Blob ? data.size : data.byteLength);

  // entries: [{ name, data: Uint8Array | ArrayBuffer | Blob, crc, size?, date? }], crc already
  // worked out. Returns the zip as parts for a Blob: small headers and the files' own data, so
  // nothing is copied into one big buffer here.
  function zipParts(entries) {
    if (entries.length > MAX_ENTRIES) throw new ZipLimitError(`A zip holds at most ${MAX_ENTRIES} files.`);
    const parts = [];
    const central = [];
    let offset = 0;
    let centralSize = 0;
    for (const e of entries) {
      const name = enc.encode(e.name);
      const size = e.size ?? sizeOf(e.data);
      if (name.length > 0xffff) throw new ZipLimitError(`The name ${e.name} is too long.`);
      if (offset + 30 + name.length + size >= 0xffffffff) throw new ZipLimitError('A zip without ZIP64 must stay under 4 GB.');
      const { time, date } = dosDateTime(e.date);
      const local = new Uint8Array(30 + name.length);
      const l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true); // local file header
      l.setUint16(4, 20, true); // version needed: 2.0
      l.setUint16(6, 0x0800, true); // bit 11: the name is UTF-8
      l.setUint16(8, 0, true); // stored, not compressed
      l.setUint16(10, time, true);
      l.setUint16(12, date, true);
      l.setUint32(14, e.crc >>> 0, true);
      l.setUint32(18, size, true);
      l.setUint32(22, size, true);
      l.setUint16(26, name.length, true);
      l.setUint16(28, 0, true); // no extra field
      local.set(name, 30);
      const head = new Uint8Array(46 + name.length);
      const c = new DataView(head.buffer);
      c.setUint32(0, 0x02014b50, true); // central directory header
      c.setUint16(4, 20, true); // made by: MS-DOS attributes, version 2.0
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, time, true);
      c.setUint16(14, date, true);
      c.setUint32(16, e.crc >>> 0, true);
      c.setUint32(20, size, true);
      c.setUint32(24, size, true);
      c.setUint16(28, name.length, true);
      // extra length, comment length, disk number, internal and external attributes: 0
      c.setUint32(42, offset, true);
      head.set(name, 46);
      parts.push(local, e.data);
      central.push(head);
      offset += local.length + size;
      centralSize += head.length;
    }
    if (offset + centralSize + 22 >= 0xffffffff) throw new ZipLimitError('A zip without ZIP64 must stay under 4 GB.');
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true); // end of central directory
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
    return [...parts, ...central, end];
  }

  // Like zipParts, but works out what is missing (data given as text, CRCs), and returns a Blob.
  async function buildZip(entries) {
    const ready = [];
    for (const e of entries) {
      let data = typeof e.data === 'string' ? enc.encode(e.data) : e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data;
      let crc = e.crc;
      if (crc == null) crc = crc32(data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data); // one file at a time
      ready.push({ ...e, data, crc, size: sizeOf(data) });
    }
    return new Blob(zipParts(ready), { type: 'application/zip' });
  }

  // ---- what goes in ------------------------------------------------------------------
  // `mods` is a run of modules as data.modules lists them (each with `depth`), such as one
  // module and the sub-modules after it. With `flattenFirst`, the first module's own entries go
  // at the top of the zip (downloading one module); otherwise every module is a folder.
  // Returns { files: [{ item, dir, where }], links: [{ where, title, url }], taken }.
  function plan(mods, { flattenFirst = false, origin = '' } = {}) {
    const taken = new Set(['links.txt', 'failed.txt']);
    const files = [];
    const links = [];
    const stack = []; // { depth, dir, where }
    mods.forEach((m, at) => {
      while (stack.length && stack[stack.length - 1].depth >= m.depth) stack.pop();
      const parent = stack[stack.length - 1] || { dir: '', where: [] };
      const top = flattenFirst && at === 0;
      const dir = top ? '' : `${uniquePath(parent.dir, sanitize(m.name, { max: FOLDER_MAX, folder: true }), taken, { folder: true })}/`;
      const where = top ? [m.name] : [...parent.where, m.name];
      stack.push({ depth: m.depth, dir, where });
      for (const i of m.items || []) {
        if (i.external || i.type === 'Module overview') continue;
        if (i.type === 'File' && i.file_url) files.push({ item: i, dir, where: where.join(' / ') });
        else {
          let url = i.url || i.html_url || '';
          if (url.startsWith('/')) url = origin + url;
          links.push({ where: where.join(' / '), title: i.title || '(untitled)', type: i.type, url });
        }
      }
    });
    return { files, links, taken };
  }

  // links.txt, grouped by module; CRLF so Notepad shows it properly.
  function linksText(title, links) {
    const out = [`Links and tools in ${title} that are not files (not downloaded):`, ''];
    let last = null;
    for (const l of links) {
      if (l.where !== last) out.push('', `[${l.where}]`);
      last = l.where;
      out.push(`${l.title}${l.type && l.type !== 'Link' ? ` (${l.type})` : ''}`, `  ${l.url || '(no address)'}`);
    }
    return `${out.join('\r\n')}\r\n`;
  }
  function failedText(title, failed) {
    const out = [`Files in ${title} that could not be downloaded:`, ''];
    for (const f of failed) out.push(`${f.where} / ${f.title}`, `  ${f.reason}`);
    return `${out.join('\r\n')}\r\n`;
  }

  const abortError = () => Object.assign(new Error('Download cancelled.'), { name: 'AbortError' });

  // Fetches every planned file, `concurrency` at a time. Each file's CRC is worked out as its
  // pieces arrive. A file that fails is reported and the rest go on. Returns
  // { got: Map(index -> { data, crc, size, type, disposition }), failed: [{ index, where, title, reason }], bytes }.
  // onProgress({ done, total, bytes, failed, current }); ask(bytes) -> Promise<boolean> is asked
  // when more than `warnBytes` have arrived, then again past every further `askEvery` (false
  // cancels). Cancelling while a question is open settles at once.
  async function fetchAll(files, { fetch: get = root.fetch, signal = null, concurrency = CONCURRENCY, onProgress = () => {}, ask = null, warnBytes = WARN_BYTES, askEvery = ASK_EVERY, maxBytes = MAX_DATA } = {}) {
    const ctl = new AbortController();
    if (signal) {
      if (signal.aborted) throw abortError();
      signal.addEventListener('abort', () => ctl.abort(), { once: true });
    }
    const aborted = new Promise((resolve) => ctl.signal.addEventListener('abort', resolve, { once: true }));
    const got = new Map();
    const failed = [];
    let next = 0;
    let done = 0;
    let bytes = 0;
    let full = false; // the zip limit was reached: the rest are listed, not fetched
    let gate = null;
    let askAt = warnBytes; // the next total that asks
    const LEFT_OUT = `Left out: the zip would pass ${maxBytes >= 1e9 ? `${+(maxBytes / 1e9).toFixed(1)} GB` : fmtBytes(maxBytes)}.`;
    const current = new Set();
    const report = () => onProgress({ done, total: files.length, bytes, failed: failed.length, current: [...current] });
    const fail = (index, reason) => failed.push({ index, where: files[index].where, title: files[index].item.title, reason });
    const checkWarn = () => {
      if (gate || !ask || bytes <= askAt || next >= files.length) return; // nothing left to ask about
      askAt = (Math.floor(bytes / askEvery) + 1) * askEvery;
      gate = Promise.resolve()
        .then(() => ask(bytes))
        .then((ok) => {
          if (!ok) ctl.abort();
        }, () => ctl.abort())
        .finally(() => {
          gate = null;
        });
    };

    async function one(index) {
      const { item } = files[index];
      const res = await get(item.file_url, { credentials: 'same-origin', signal: ctl.signal });
      if (!res.ok) throw new Error(res.status === 403 || res.status === 404 ? `Not available to you (Brightspace answered ${res.status}).` : `Brightspace answered ${res.status}.`);
      const head = (h) => (res.headers && res.headers.get ? res.headers.get(h) : null) || '';
      const type = head('content-type');
      if (/text\/html/i.test(type) && !/\.html?$/i.test(item.url || '')) throw new Error('Brightspace sent a page instead of the file (signed out?).');
      const length = Number(head('content-length')) || 0;
      const tooBig = () => Object.assign(new Error(LEFT_OUT), { full: true });
      if (bytes + length > maxBytes) throw tooBig();
      let crc = 0;
      let size = 0;
      // Each piece counts towards the total as it arrives; a file that fails gives its back.
      const take = (piece) => {
        crc = crc32(piece, crc);
        size += piece.length;
        bytes += piece.length;
        if (bytes > maxBytes) throw tooBig();
      };
      let data;
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      try {
        if (reader) {
          const chunks = [];
          for (;;) {
            const { done: end, value } = await reader.read();
            if (end) break;
            take(value);
            chunks.push(value);
            report();
          }
          data = new Blob(chunks);
        } else {
          data = new Uint8Array(await res.arrayBuffer());
          take(data);
        }
      } catch (e) {
        bytes -= size;
        if (reader) reader.cancel().catch(() => {});
        throw e;
      }
      got.set(index, { data, crc, size, type, disposition: head('content-disposition') });
    }

    async function worker() {
      for (;;) {
        if (gate) await Promise.race([gate, aborted]);
        if (ctl.signal.aborted) return;
        const index = next++;
        if (index >= files.length) return;
        if (full || got.size + current.size + 2 >= MAX_ENTRIES) { // room kept for links.txt and failed.txt
          fail(index, full ? LEFT_OUT : 'Left out: too many files for one zip.');
          done++;
          continue;
        }
        current.add(files[index].item.title);
        report();
        try {
          await one(index);
        } catch (e) {
          if (ctl.signal.aborted) return;
          if (e.full) full = true;
          fail(index, String(e.message || e).slice(0, 300));
        } finally {
          current.delete(files[index].item.title);
        }
        done++;
        report();
        checkWarn();
      }
    }
    report();
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
    if (ctl.signal.aborted) throw abortError();
    failed.sort((a, b) => a.index - b.index);
    return { got, failed, bytes };
  }

  // The zip's entries from a plan and what was fetched, in plan order (so names are the same
  // whatever order the files arrived in), with links.txt and failed.txt.
  function entriesFor(title, p, { got, failed }) {
    const entries = [];
    p.files.forEach((f, index) => {
      const g = got.get(index);
      if (!g) return;
      const name = sanitize(fileName(f.item, g));
      entries.push({ name: uniquePath(f.dir, name, p.taken), data: g.data, crc: g.crc, size: g.size, date: f.item.updated_at || undefined });
    });
    const text = (name, body) => {
      const data = enc.encode(body);
      entries.push({ name, data, crc: crc32(data), size: data.length });
    };
    if (p.links.length) text('links.txt', linksText(title, p.links));
    if (failed.length) text('failed.txt', failedText(title, failed));
    return entries;
  }

  // ---- in the page: the progress dialog --------------------------------------------
  let running = false;
  // Inline styles rather than a style element, which a page's content security policy can block.
  const STYLE = {
    count: 'font-weight:700',
    bar: 'width:100%;height:10px;accent-color:var(--primary)',
    now: 'min-height:1.4em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
    fails: 'max-height:160px;overflow:auto;margin:0;padding-left:18px',
    ask: 'border:1px solid var(--line);border-radius:4px;padding:10px 12px;background:var(--soft);display:grid;gap:8px',
  };

  function fmtBytes(n) {
    return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
  }

  // Starts the zip download through a temporary link, then lets the data go.
  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    (document.body || document.documentElement).append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60e3); // long enough for the browser to start saving
  }

  // Downloads `mods` (see plan) as `${title}.zip`, with a dialog showing progress.
  async function download({ title, mods, flattenFirst = false }) {
    const ui = BSX.ui;
    const app = ui && ui.appEl();
    if (!app) return;
    if (running) {
      ui.flash('A download is already running.', 'bad');
      return;
    }
    const p = plan(mods, { flattenFirst, origin: location.origin });
    if (!p.files.length) {
      ui.flash(`${title} has no files to download.`, 'bad');
      return;
    }
    const { h, ic, button } = ui;
    const ctl = new AbortController();
    const count = h('div', { class: 'zipcount', style: STYLE.count }, `Starting: ${p.files.length} files`);
    const bar = h('progress', { max: String(p.files.length), value: '0', style: STYLE.bar, 'aria-label': 'Files downloaded' });
    const now = h('div', { class: 'muted small zipnow', style: STYLE.now });
    const fails = h('ul', { class: 'zipfails small', style: STYLE.fails, hidden: true });
    const ask = h('div', { class: 'zipask', style: STYLE.ask, hidden: true });
    const cancel = button('Cancel', () => ctl.abort());
    const actions = h('div', { class: 'row', style: 'justify-content:flex-end' }, cancel);
    const close = () => overlay.remove();
    const overlay = h('div', { class: 'modal' },
      h('div', { class: 'dialog zipdlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Downloading ${title}` },
        h('div', { class: 'trayhead' }, h('h2', null, `Download ${title}`)),
        h('p', { class: 'muted small', style: 'margin:0' }, `Every file in ${flattenFirst ? 'this module' : 'this course'}, as one .zip. Links and tools are listed in links.txt.`),
        count, bar, now, ask, fails, actions));
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      if (running) ctl.abort();
      else close();
    });
    let shownFails = 0;
    let lastDraw = 0;
    let lastState = null;
    const draw = (s, force = false) => {
      lastState = s;
      if (!force && Date.now() - lastDraw < 100) return;
      lastDraw = Date.now();
      count.textContent = `${s.done} of ${s.total} files · ${fmtBytes(s.bytes)}${s.failed ? ` · ${s.failed} failed` : ''}`;
      bar.value = s.done;
      now.textContent = s.current.length ? `Downloading ${s.current.join(', ')}` : '';
    };
    const showFails = (failed) => {
      for (const f of failed.slice(shownFails)) fails.append(h('li', null, h('strong', null, f.title), ` (${f.where}): ${f.reason}`));
      shownFails = failed.length;
      fails.hidden = !failed.length;
    };
    const confirmBig = (bytes) => new Promise((resolve) => {
      let settled = false;
      const answer = (ok) => {
        if (settled) return;
        settled = true;
        ctl.signal.removeEventListener('abort', onAbort);
        ask.hidden = true;
        ask.replaceChildren();
        resolve(ok);
      };
      const onAbort = () => answer(false); // Cancel or Escape while asking
      if (ctl.signal.aborted) return answer(false);
      ctl.signal.addEventListener('abort', onAbort, { once: true });
      ask.replaceChildren(
        h('div', null, `This download is already ${fmtBytes(bytes)}. Keep going?`),
        h('div', { class: 'row', style: 'justify-content:flex-end' }, button('Stop', () => answer(false)), button('Keep going', () => answer(true), 'primary')));
      ask.hidden = false;
      ask.querySelector('.btn.primary').focus();
    });
    // Sizes are known before starting only when Brightspace listed them.
    const known = p.files.reduce((n, f) => n + (Number(f.item.size) || 0), 0);
    running = true;
    app.append(overlay);
    cancel.focus();
    try {
      if (known > WARN_BYTES && !(await confirmBig(known))) throw abortError();
      const result = await fetchAll(p.files, {
        signal: ctl.signal,
        onProgress: (s) => draw(s),
        ask: known > WARN_BYTES ? null : confirmBig,
      });
      if (lastState) draw(lastState, true);
      showFails(result.failed);
      if (!result.got.size) {
        count.textContent = 'No files could be downloaded.';
        now.textContent = '';
        actions.replaceChildren(button('Close', close, 'primary'));
        actions.querySelector('.btn').focus();
        return;
      }
      now.textContent = 'Making the zip…';
      const blob = new Blob(zipParts(entriesFor(title, p, result)), { type: 'application/zip' });
      const name = `${sanitize(title, { max: 80 })}.zip`;
      save(blob, name);
      if (!result.failed.length) {
        close();
        ui.flash(`Downloaded ${name} (${result.got.size} files, ${fmtBytes(blob.size)}).`);
        return;
      }
      count.textContent = `Saved ${name}: ${result.got.size} of ${p.files.length} files. ${result.failed.length} could not be downloaded (listed in failed.txt):`;
      now.textContent = '';
      actions.replaceChildren(button('Close', close, 'primary'));
      actions.querySelector('.btn').focus();
    } catch (e) {
      if (e.name === 'AbortError') {
        close();
        ui.flash('Download cancelled.');
        return;
      }
      count.textContent = e instanceof ZipLimitError ? `Too big for one zip: ${e.message}` : `The download failed: ${e.message || e}`;
      now.textContent = '';
      actions.replaceChildren(button('Close', close, 'primary'));
    } finally {
      running = false;
    }
  }

  // Whether a course's modules hold any file to download (links and tools alone make no zip).
  const hasFiles = (mods) => mods.some((x) => (x.items || []).some((i) => i.type === 'File' && i.file_url && !i.external));
  const courseTitle = (course) => (BSX.ui.nameOf && BSX.ui.nameOf(course)) || course.name || 'Course files';

  // The course Files page's button: every module of the course, each a folder.
  function courseButton(course) {
    const ui = BSX.ui;
    return ui.h('button', {
      class: 'btn',
      type: 'button',
      onclick: async () => {
        try {
          const mods = await BSX.data.modules(course.id);
          if (!hasFiles(mods)) return ui.flash('This course has no files to download.', 'bad');
          await download({ title: courseTitle(course), mods });
        } catch (e) {
          ui.flash(`Could not list the course's files: ${e.message || e}`, 'bad');
        }
      },
    }, 'Download all (.zip)');
  }

  // The Dashboard's "Download course as .zip…": pick one of `courses`, then the progress dialog.
  function courseDialog(courses) {
    const ui = BSX.ui;
    const app = ui && ui.appEl();
    if (!app) return;
    const { h, ic, button } = ui;
    const radios = courses.map((c, at) => [c, h('input', { type: 'radio', name: 'bsxzipcourse', checked: at === 0 })]);
    const note = h('p', { class: 'small', role: 'status', style: 'margin:0;min-height:1.4em' });
    const close = () => overlay.remove();
    const go = button('Download', async () => {
      const picked = radios.find(([, r]) => r.checked);
      if (!picked) return;
      const course = picked[0];
      go.disabled = true;
      go.textContent = 'Listing files…';
      note.textContent = '';
      try {
        const mods = await BSX.data.modules(course.id);
        if (hasFiles(mods)) {
          close(); // the progress dialog takes over
          download({ title: courseTitle(course), mods });
          return;
        }
        note.className = 'small bad';
        note.textContent = `${courseTitle(course)} has no files to download (only links, tools or nothing at all).`;
      } catch (e) {
        note.className = 'small bad';
        note.textContent = `Could not list the course's files: ${e.message || e}`;
      }
      go.disabled = false;
      go.textContent = 'Download';
    }, 'primary');
    const overlay = h('div', { class: 'modal', onclick: (ev) => ev.target === overlay && close(), onkeydown: (ev) => ev.key === 'Escape' && (ev.stopPropagation(), close()) },
      h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Download course as .zip' },
        h('div', { class: 'trayhead' }, h('h2', null, 'Download course as .zip'), h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: close }, ic('close'))),
        h('p', { class: 'muted small', style: 'margin:0' }, 'Every file in the course’s modules, as one .zip with a folder per module. Links and tools are listed in links.txt.'),
        courses.length
          ? h('div', { role: 'radiogroup', 'aria-label': 'Course', style: 'max-height:50vh;overflow:auto' },
              radios.map(([c, r]) => h('label', { class: 'calrow', style: 'display:flex;font-weight:400;font-size:14.5px' }, r, h('span', { class: 'dot', style: `background:${ui.colorOf ? ui.colorOf(c.id) : 'var(--muted)'}` }), h('span', null, courseTitle(c)))))
          : h('p', { class: 'muted' }, 'No courses to show.'),
        note,
        h('div', { class: 'row', style: 'justify-content:flex-end' }, button('Cancel', close), courses.length ? go : null)));
    app.append(overlay);
    (courses.length ? go : overlay.querySelector('.btn')).focus();
  }

  const api = { crc32, sanitize, uniquePath, splitExt, fileName, dispositionName, dosDateTime, zipParts, buildZip, plan, linksText, failedText, fetchAll, entriesFor, hasFiles, ZipLimitError, MAX_ENTRIES, MAX_DATA, WARN_BYTES, ASK_EVERY, FOLDER_MAX };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.BSX = root.BSX || {}).zip = { ...api, download, courseButton, courseDialog };
})(typeof globalThis !== 'undefined' ? globalThis : this);
