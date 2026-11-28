// Download a module, or a whole course, as one .zip, built in the browser.
// Each file is fetched with the student's own session (same origin, like every other request)
// and stored as is (no compression: course files are mostly PDFs, slides and images, which are
// compressed already). Links, tools and other entries that are not files are listed in
// links.txt; files that could not be fetched are listed in failed.txt. A whole course also gets a
// "Course summary" folder of offline HTML pages (announcements, grades, assignments and so on).
// Limits: a plain zip (no ZIP64), so at most 65,534 entries, and at most 2 GB of files: the
// whole zip is held in memory until it is saved, and browsers (Firefox especially) can run out
// well before the format's 4 GB. A download that would go past that stops adding files and lists
// the rest in failed.txt. It asks before going on past 500 MB, and again at every further 1 GB.
// The pure parts (crc32, names, the zip writer, the planning and fetching, the summary pages) are
// exported for tests/zip.test.js; the progress dialog needs BSX.ui.
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
  // cancels). Cancelling while a question is open settles at once. `reserve` entries are kept
  // free for the text files that go in after the files (links.txt, failed.txt, a course summary).
  async function fetchAll(files, { fetch: get = root.fetch, signal = null, concurrency = CONCURRENCY, onProgress = () => {}, ask = null, warnBytes = WARN_BYTES, askEvery = ASK_EVERY, maxBytes = MAX_DATA, reserve = 2 } = {}) {
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
        if (full || got.size + current.size + reserve >= MAX_ENTRIES) { // room kept for the text files
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
  // whatever order the files arrived in), then `extra` text files ({ name, data }, such as the
  // course summary), links.txt and failed.txt.
  function entriesFor(title, p, { got, failed }, extra = []) {
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
    for (const e of extra) text(e.name, e.data);
    if (p.links.length) text('links.txt', linksText(title, p.links));
    if (failed.length) text('failed.txt', failedText(title, failed));
    return entries;
  }

  // ---- the course summary ---------------------------------------------------------------
  // A whole course's zip also gets a "Course summary" folder: plain HTML pages (announcements,
  // grades, assignments, quizzes, discussions, syllabus) that read offline in any browser. The
  // pages are built here from what data.js returns, with no page access, so tests can check them.
  // Nothing about other students goes in: no class list, and no discussion posts.
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', colon: ':', tab: '\t', newline: '\n' };
  // Character references decoded, so a link such as "jav&#97;script:" is seen for what it is.
  const unentity = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (m, e) => {
    if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
    const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  });
  // An http(s) address, made absolute against Brightspace's own origin; anything else is null.
  function webUrl(raw, origin = '') {
    const s = unentity(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!s) return null;
    try {
      const u = new URL(s, origin || undefined);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch {
      return null;
    }
  }

  // Instructor-written HTML, rebuilt from an allowlist of plain formatting tags, as the
  // wrapper's own pages show it. No attributes survive except a checked link or image
  // address and an image's alt text; scripts, styles, frames, forms and media go with
  // everything inside them; every piece of text is escaped again.
  const KEEP_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'span', 'div', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'sub', 'sup', 'img']);
  const VOID_TAGS = new Set(['br', 'hr', 'img']);
  const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'head', 'title', 'svg', 'math', 'form', 'button', 'select', 'textarea', 'video', 'audio', 'frameset', 'frame', 'noembed', 'noframes', 'xmp', 'plaintext']);
  function attrsOf(s) {
    const out = {};
    const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
    let m;
    while ((m = re.exec(s || ''))) {
      const k = m[1].toLowerCase();
      if (!(k in out)) out[k] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    return out;
  }
  // Text between tags keeps its character references; a stray < or > is escaped.
  const cleanText = (s) => s.replace(/&(?!(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function cleanHtml(html, origin = '') {
    const src = String(html ?? '');
    const out = [];
    const open = [];
    const TAG = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[^>]*>?|<\/?([A-Za-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let at = 0;
    let m;
    while ((m = TAG.exec(src))) {
      out.push(cleanText(src.slice(at, m.index)));
      at = TAG.lastIndex;
      if (!m[1]) continue; // a comment, doctype or the like
      const name = m[1].toLowerCase();
      const closing = m[0][1] === '/';
      if (DROP_TAGS.has(name)) {
        if (closing) continue;
        const end = new RegExp(`</${name}\\s*>`, 'ig');
        end.lastIndex = at;
        at = end.exec(src) ? end.lastIndex : src.length;
        TAG.lastIndex = at;
        continue;
      }
      if (!KEEP_TAGS.has(name)) continue; // other tags go; the text inside them stays
      if (closing) {
        const i = open.lastIndexOf(name);
        if (i >= 0) while (open.length > i) out.push(`</${open.pop()}>`);
        continue;
      }
      const a = attrsOf(m[2]);
      if (name === 'img') {
        const url = webUrl(a.src, origin);
        const alt = unentity(a.alt || '');
        out.push(url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">` : escapeHtml(alt ? `[image: ${alt}]` : '[image]'));
        continue;
      }
      if (name === 'a') {
        const url = webUrl(a.href, origin);
        out.push(url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">` : '<a>');
      } else out.push(`<${name}>`);
      if (!VOID_TAGS.has(name)) open.push(name);
    }
    out.push(cleanText(src.slice(at)));
    while (open.length) out.push(`</${open.pop()}>`);
    return out.join('');
  }

  const SUMMARY_CSS = [
    'body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2328;background:#fff;max-width:920px;margin:0 auto;padding:24px 16px}',
    'a{color:#0b5cad}h1{font-size:24px;margin:0 0 2px}h2{font-size:18px;margin:28px 0 8px;padding-bottom:4px;border-bottom:1px solid #d8dee4}',
    'nav{font-size:14px;margin:0 0 18px;display:flex;flex-wrap:wrap;gap:4px 14px}.muted{color:#59636e;font-size:13.5px}.bad{color:#b42318}',
    '.item{border:1px solid #d8dee4;border-radius:6px;padding:12px 14px;margin:12px 0}.item h3{font-size:16px;margin:0 0 2px}',
    '.plain{white-space:pre-wrap}.fb{background:#f6f8fa;border-left:3px solid #d8dee4;padding:6px 10px;margin-top:8px}',
    'table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #d8dee4;padding:6px 8px;text-align:left;vertical-align:top}',
    'th{background:#f6f8fa}.num{text-align:right;white-space:nowrap}tr.total td{font-weight:600;background:#fbfbfc}',
    'img{max-width:100%;height:auto}.body table td,.body table th{border:1px solid #d8dee4}',
  ].join('');
  const SUMMARY_PAGES = [
    ['announcements', 'Announcements'],
    ['grades', 'Grades'],
    ['assignments', 'Assignments'],
    ['quizzes', 'Quizzes'],
    ['discussions', 'Discussions'],
    ['syllabus', 'Syllabus and overview'],
  ];

  // `sections` holds what data.js gave for each part, as { value } or { error } (why it failed):
  //   announcements: data.announcements(ou)   grades: data.grades(ou)   work: data.assignments(ou)
  //   discussions: data.discussions(ou)   syllabus: { overview: data.syllabus(ou), link: data.syllabusLink(ou) }
  // and `details`: Map(assignment source_id -> data.assignment(ou, id)), for submissions and feedback.
  // `taken` is the plan's set of names, so the folder never takes a module folder's name.
  // Returns { dir, entries: [{ name, data: HTML text }], failed: [{ where, title, reason }] } for entriesFor.
  function courseSummary({ course, origin = '', generated = new Date(), taken = new Set(), details = new Map(), ...sections }) {
    const dir = `${uniquePath('', 'Course summary', taken, { folder: true })}/`;
    const where = dir.slice(0, -1);
    const id = encodeURIComponent(course.id);
    const courseName = course.name || 'Course';
    const made = new Date(generated);
    const esc = escapeHtml;
    const when = (iso) => {
      const d = new Date(iso);
      return iso && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
    };
    const num = (n) => (n == null || n === '' || !Number.isFinite(Number(n)) ? '' : String(Math.round(Number(n) * 100) / 100));
    const link = (url, text) => {
      const href = webUrl(url, origin);
      return href ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text);
    };
    const rich = (html, text) => (html ? `<div class="body">${cleanHtml(html, origin)}</div>` : text ? `<div class="body plain">${esc(text)}</div>` : '');
    const score = (v, possible) => (v && v.score != null ? `${num(v.score)} / ${num(v.points_possible ?? possible) || '?'}` : v && v.displayed ? v.displayed : '-');
    const files = (list) => (list && list.length ? `<p class="muted">Attachments:</p><ul>${list.map((f) => `<li>${link(f.url, f.name || 'file')}</li>`).join('')}</ul>` : '');
    const back = (url, text) => `<p class="muted">${link(url, text)}</p>`;
    const failed = [];
    const written = new Map(); // page key -> null, or why it could not be loaded
    const entries = [];
    const shell = (title, body, sub = '') => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title === courseName ? '' : `${esc(title)} - `}${esc(courseName)}</title>
<style>${SUMMARY_CSS}</style>
</head>
<body>
<nav><a href="index.html">Course summary</a>${SUMMARY_PAGES.filter(([k]) => written.has(k)).map(([k, t]) => `<a href="${k}.html">${esc(t)}</a>`).join('')}</nav>
<h1>${esc(title)}</h1>
<p class="muted">${esc(sub || courseName)}</p>
${body}
</body>
</html>
`;
    const pages = []; // [key, title, body], written once every page is known (for the nav bar)
    const add = (key, build) => {
      const title = SUMMARY_PAGES.find(([k]) => k === key)[1];
      const part = build.section;
      if (part && part.error != null) {
        const reason = String(part.error || 'unknown error');
        written.set(key, reason);
        failed.push({ where, title: `${title} page`, reason: `Could not be loaded: ${reason}` });
        pages.push([key, title, `<p class="bad">This page could not be loaded from Brightspace: ${esc(reason)}</p>`]);
        return;
      }
      const body = build.body(part ? part.value : null);
      if (body == null) return; // nothing to show (a course with no quizzes)
      written.set(key, null);
      pages.push([key, title, body]);
    };

    add('announcements', {
      section: sections.announcements,
      body: (list) => {
        const items = [...(list || [])].sort((a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0));
        return `${items.length
          ? items.map((a) => `<div class="item"><h3>${esc(a.title || '(untitled)')}${a.pinned ? ' <span class="muted">(pinned)</span>' : ''}</h3><div class="muted">${a.posted_at ? `Posted ${esc(when(a.posted_at))}` : ''}</div>${rich(a.message_html, a.message)}${files(a.attachments)}</div>`).join('\n')
          : '<p>No announcements in this course.</p>'}\n${back(`/d2l/lms/news/main.d2l?ou=${id}`, 'Open Announcements in Brightspace')}`;
      },
    });

    add('grades', {
      section: sections.grades,
      body: (g) => {
        const out = [];
        const f = g && g.final;
        out.push(f && (f.score != null || f.displayed)
          ? `<p><strong>Final grade:</strong> ${esc(score(f))}${f.displayed && f.score != null ? ` (${esc(f.displayed)})` : ''}</p>`
          : '<p class="muted">Brightspace shows no final grade for this course yet.</p>');
        const e = g && g.estimate;
        if (e && e.points_possible > 0) out.push(`<p class="muted">Running total of graded work, worked out from the items below (unofficial): ${esc(num((e.score / e.points_possible) * 100))}%</p>`);
        const rows = [];
        for (const group of (g && g.groups) || []) {
          for (const i of group.items || []) {
            const v = i.value;
            const notes = [i.marked_dropped ? 'dropped' : null, i.excluded ? 'not counted' : null, i.bonus ? 'bonus' : null].filter(Boolean).join(', ');
            rows.push(`<tr><td>${esc(i.name)}${notes ? ` <span class="muted">(${esc(notes)})</span>` : ''}</td><td>${esc(group.name || '')}</td><td class="num">${esc(v && v.score != null ? num(v.score) : '-')}</td><td class="num">${esc(num(v && v.points_possible != null ? v.points_possible : i.points_possible))}</td><td>${esc((v && v.displayed) || '')}</td><td class="plain">${esc((v && v.comment) || '')}</td></tr>`);
          }
          if (group.name && group.value && (group.value.score != null || group.value.displayed)) {
            rows.push(`<tr class="total"><td>${esc(group.name)} total</td><td>${esc(group.name)}</td><td class="num">${esc(num(group.value.score))}</td><td class="num">${esc(num(group.value.points_possible))}</td><td>${esc(group.value.displayed || '')}</td><td></td></tr>`);
          }
        }
        out.push(rows.length
          ? `<table><thead><tr><th>Item</th><th>Category</th><th class="num">Score</th><th class="num">Points</th><th>Grade</th><th>Feedback</th></tr></thead><tbody>\n${rows.join('\n')}\n</tbody></table>`
          : '<p>No grade items in this course.</p>');
        out.push(back(`/d2l/lms/grades/my_grades/main.d2l?ou=${id}`, 'Open Grades in Brightspace'));
        return out.join('\n');
      },
    });

    const work = sections.work;
    add('assignments', {
      section: work,
      body: (list) => {
        const items = (list || []).filter((a) => a.kind === 'assignment');
        if (!items.length) return '<p>No assignments in this course.</p>';
        return items.map((a) => {
          const d = details.get(String(a.source_id));
          const due = a.due_at ? Date.parse(a.due_at) : null;
          let status = a.grade ? 'Graded' : 'Not known';
          if (d) {
            const late = d.submitted_at && due != null && Date.parse(d.submitted_at) > due;
            if (d.submitted) status = `${d.status === 'graded' ? 'Graded' : 'Submitted'}${late ? ' late' : ''}${d.submitted_at ? `, ${when(d.submitted_at)}` : ''}`;
            else if (d.status === 'draft') status = 'Draft saved, not submitted';
            else status = a.grade ? 'Graded' : due != null && due < made.getTime() ? 'Missing' : 'Not submitted';
          }
          const fb = d && d.feedback;
          const v = a.grade || (fb && fb.score != null ? { score: fb.score, points_possible: a.points_possible } : null);
          const feedback = fb && (fb.comment_html || fb.comment) ? rich(fb.comment_html, fb.comment) : a.grade && a.grade.comment ? rich('', a.grade.comment) : '';
          const meta = [a.due_at ? `Due ${when(a.due_at)}` : 'No due date', status, `Score: ${score(v, a.points_possible)}${!v && a.points_possible != null ? ` (out of ${num(a.points_possible)})` : ''}`];
          return `<div class="item"><h3>${link(a.html_url, a.name || '(untitled)')}</h3><div class="muted">${meta.map(esc).join(' &middot; ')}</div>${feedback ? `<div class="fb"><strong>Feedback</strong>${feedback}</div>` : ''}</div>`;
        }).join('\n');
      },
    });

    // A page only when the course has quizzes (a list that failed is reported on Assignments).
    const quizzes = work && work.value ? work.value.filter((a) => a.kind === 'quiz') : [];
    add('quizzes', {
      section: null,
      body: () => (quizzes.length
        ? quizzes.map((q) => {
            const meta = [q.due_at ? `Due ${when(q.due_at)}` : 'No due date', `Score: ${score(q.grade, q.points_possible)}`];
            const comment = q.grade && q.grade.comment ? `<div class="fb"><strong>Feedback</strong>${rich('', q.grade.comment)}</div>` : '';
            return `<div class="item"><h3>${link(q.html_url, q.name || '(untitled)')}</h3><div class="muted">${meta.map(esc).join(' &middot; ')}</div>${comment}</div>`;
          }).join('\n')
        : null),
    });

    add('discussions', {
      section: sections.discussions,
      body: (list) => {
        const items = list || [];
        const rows = items.map((t) => `<tr><td>${link(t.html_url, t.name || '(untitled)')}${t.locked ? ' <span class="muted">(locked)</span>' : ''}</td><td>${esc(t.forum || '')}</td><td>${esc(t.due_at ? when(t.due_at) : '')}</td><td class="num">${esc(num(t.points_possible))}</td></tr>`);
        return `${rows.length
          ? `<table><thead><tr><th>Topic</th><th>Forum</th><th>Due</th><th class="num">Points</th></tr></thead><tbody>\n${rows.join('\n')}\n</tbody></table>`
          : '<p>No discussion topics in this course.</p>'}\n<p class="muted">Posts are not included, since they hold other students' writing. Open a topic in Brightspace to read them.</p>`;
      },
    });

    add('syllabus', {
      section: sections.syllabus,
      body: (s) => {
        const o = s && s.overview;
        const tool = s && s.link;
        const parts = [];
        if (tool && tool.url) parts.push(`<p>Syllabus tool: ${link(tool.url, tool.title || 'Syllabus')}</p>`);
        parts.push(o && (o.html || o.text) ? rich(o.html, o.text) : '<p>This course has no overview text in Brightspace.</p>');
        if (o && o.has_attachment) parts.push('<p class="muted">The overview has an attachment; open the course in Brightspace to get it.</p>');
        return parts.join('\n');
      },
    });

    const list = SUMMARY_PAGES.filter(([k]) => written.has(k)).map(([k, t]) => {
      const why = written.get(k);
      return `<li><a href="${k}.html">${esc(t)}</a>${why != null ? ` <span class="bad">(could not be loaded: ${esc(why)})</span>` : ''}</li>`;
    });
    const index = shell(courseName, `<p>${[course.course_code, `Summary made ${when(made)}`].filter(Boolean).map(esc).join(' &middot; ')}</p>
<ul>
${list.join('\n')}
</ul>
<p class="muted">The course's files are in the module folders next to this one; links and tools that are not files are listed in links.txt.</p>
${back(`/d2l/home/${id}`, 'Open the course in Brightspace')}`, 'Course summary');
    const put = (name, data) => entries.push({ name: uniquePath(dir, name, taken), data });
    put('index.html', index);
    for (const [key, title, body] of pages) put(`${key}.html`, shell(title, body));
    return { dir, entries, failed };
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

  // Downloads `mods` (see plan) as `${title}.zip`, with a dialog showing progress. With `course`
  // (a whole course), a Course summary folder goes in too, so a course with no files still
  // makes a zip.
  async function download({ title, mods, flattenFirst = false, course = null }) {
    const ui = BSX.ui;
    const app = ui && ui.appEl();
    if (!app) return;
    if (running) {
      ui.flash('A download is already running.', 'bad');
      return;
    }
    const p = plan(mods, { flattenFirst, origin: location.origin });
    if (!p.files.length && !course) {
      ui.flash(`${title} has no files to download.`, 'bad');
      return;
    }
    const { h, ic, button } = ui;
    const ctl = new AbortController();
    const count = h('div', { class: 'zipcount', style: STYLE.count }, p.files.length ? `Starting: ${p.files.length} files` : 'No files in the course’s modules.');
    const bar = h('progress', { max: String(p.files.length), value: '0', style: STYLE.bar, 'aria-label': 'Files downloaded', hidden: !p.files.length });
    const now = h('div', { class: 'muted small zipnow', style: STYLE.now });
    const fails = h('ul', { class: 'zipfails small', style: STYLE.fails, hidden: true });
    const ask = h('div', { class: 'zipask', style: STYLE.ask, hidden: true });
    const cancel = button('Cancel', () => ctl.abort());
    const actions = h('div', { class: 'row', style: 'justify-content:flex-end' }, cancel);
    const close = () => overlay.remove();
    const overlay = h('div', { class: 'modal' },
      h('div', { class: 'dialog zipdlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Downloading ${title}` },
        h('div', { class: 'trayhead' }, h('h2', null, `Download ${title}`)),
        h('p', { class: 'muted small', style: 'margin:0' }, `${flattenFirst ? 'Every file in this module, as one .zip.' : 'Every file in this course, as one .zip, with a Course summary folder (announcements, grades, assignments and more).'} Links and tools are listed in links.txt.`),
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
      if (!s.total || (!force && Date.now() - lastDraw < 100)) return; // no files: the count says so already
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
        reserve: course ? 2 + SUMMARY_PAGES.length + 1 : 2, // room for links.txt, failed.txt and the summary pages
      });
      if (lastState) draw(lastState, true);
      showFails(result.failed);
      let summary = null;
      if (course) {
        now.textContent = 'Writing course summary…';
        const sections = await gatherSummary(course, ctl.signal);
        summary = courseSummary({ course, origin: location.origin, generated: new Date(), taken: p.taken, ...sections });
      }
      const failed = summary ? [...result.failed, ...summary.failed] : result.failed;
      showFails(failed);
      if (!result.got.size && !summary) {
        count.textContent = 'No files could be downloaded.';
        now.textContent = '';
        actions.replaceChildren(button('Close', close, 'primary'));
        actions.querySelector('.btn').focus();
        return;
      }
      now.textContent = 'Making the zip…';
      const blob = new Blob(zipParts(entriesFor(title, p, { got: result.got, failed }, summary ? summary.entries : [])), { type: 'application/zip' });
      const name = `${sanitize(title, { max: 80 })}.zip`;
      save(blob, name);
      const also = summary ? ' and the course summary' : '';
      if (!failed.length) {
        close();
        ui.flash(`Downloaded ${name} (${result.got.size} files${also}, ${fmtBytes(blob.size)}).`);
        return;
      }
      count.textContent = `Saved ${name}: ${result.got.size} of ${p.files.length} files${also}. ${failed.length} could not be downloaded (listed in failed.txt):`;
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

  const courseTitle = (course) => (BSX.ui.nameOf && BSX.ui.nameOf(course)) || course.name || 'Course files';

  // What the course summary shows, read with data.js as the course pages read it. Each part
  // is { value } or { error }, so one that fails still gets a page saying why. Cancel stops it.
  async function gatherSummary(course, signal) {
    const data = BSX.data;
    const ou = course.id;
    const stopped = new Promise((_, reject) => {
      if (signal.aborted) reject(abortError());
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
    stopped.catch(() => {});
    const get = (fn) => Promise.race([Promise.resolve().then(fn), stopped]).then((value) => ({ value }), (e) => {
      if (signal.aborted) throw abortError();
      return { error: String((e && e.message) || e).slice(0, 300) };
    });
    const [announcements, grades, work, discussions, syllabus] = await Promise.all([
      get(() => data.announcements(ou)),
      get(() => data.grades(ou)),
      get(() => data.assignments(ou)),
      get(() => data.discussions(ou)),
      get(async () => ({ overview: await data.syllabus(ou), link: await data.syllabusLink(ou).catch(() => null) })),
    ]);
    // Each assignment's submission and feedback, a few at a time, as the Assignments page asks.
    const details = new Map();
    const folders = (work.value || []).filter((a) => a.kind === 'assignment');
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, folders.length) }, async () => {
      while (next < folders.length) {
        const a = folders[next++];
        const d = await get(() => data.assignment(ou, a.source_id));
        if (d.value) details.set(String(a.source_id), d.value);
      }
    }));
    return { announcements, grades, work, discussions, syllabus, details };
  }

  // A whole course as one .zip: every module a folder, and the Course summary folder. Used by
  // the Dashboard card's folder icon and the Files page's button; `btn` (the one clicked) stays
  // disabled meanwhile, so a double click starts one download.
  async function downloadCourse(course, btn = null) {
    const ui = BSX.ui;
    if (btn && btn.disabled) return;
    if (running) {
      ui.flash('A download is already running.', 'bad');
      return;
    }
    if (btn) btn.disabled = true;
    try {
      let mods;
      try {
        mods = await BSX.data.modules(course.id);
      } catch (e) {
        ui.flash(`Could not list the course's files: ${e.message || e}`, 'bad');
        return;
      }
      await download({ title: courseTitle(course), mods, course });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // The course Files page's button.
  function courseButton(course) {
    const btn = BSX.ui.h('button', { class: 'btn', type: 'button', onclick: () => downloadCourse(course, btn) }, 'Download all (.zip)');
    return btn;
  }

  const api = { crc32, sanitize, uniquePath, splitExt, fileName, dispositionName, dosDateTime, zipParts, buildZip, plan, linksText, failedText, fetchAll, entriesFor, escapeHtml, cleanHtml, courseSummary, ZipLimitError, MAX_ENTRIES, MAX_DATA, WARN_BYTES, ASK_EVERY, FOLDER_MAX };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.BSX = root.BSX || {}).zip = { ...api, download, downloadCourse, courseButton };
})(typeof globalThis !== 'undefined' ? globalThis : this);
