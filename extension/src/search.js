// Ranking for the search dialog (ui-dashboard.js), with Fuse.js: fuzzy, so "calclus homwork" still
// finds "Calculus · Homework 3". Titles count most. Each word may match a different field
// (the title, the course and module, the kind); every word has to match somewhere.
// Text inside files is too long for fuzzy matching on every keystroke, so it is searched plainly
// (every word must appear) and ranked below good title matches, with a snippet to show why.
// Plain functions, so tests can run them without a browser (tests/search.test.js).
(function (root) {
  const Fuse = root.Fuse || (typeof require === 'function' ? require('../vendor/fuse.min.js') : null);
  const FILE_SCORE = 0.45; // where a hit only inside a file ranks (Fuse scores: 0 is perfect, 1 is none)
  const TYPO_PENALTY = 0.5; // added to typo-only matches, so they come after FILE_SCORE hits

  const wordsOf = (query) => String(query || '').toLowerCase().split(/\s+/).filter(Boolean);

  // index: [{ title, where, kind, text, body? }]. Returns a searcher to call on each keystroke.
  function make(index) {
    const rows = index.map((r) => ({ r, title: r.title || '', all: `${r.title || ''} ${r.text || ''} ${r.where || ''} ${r.kind || ''}` }));
    // Lower-cased copies, made once rather than on every keystroke. A row's body is filled in
    // (or emptied) after the searcher is made, so its copy is redone when the body changes.
    const lows = new WeakMap(); // r -> { all, head, body, bodyLow }
    for (const row of rows) lows.set(row.r, { all: row.all.toLowerCase(), head: `${row.r.title} ${row.r.where}`.toLowerCase(), body: null, bodyLow: '' });
    const low = (r) => {
      const l = lows.get(r);
      if (l.body !== (r.body || '')) {
        l.body = r.body || '';
        l.bodyLow = l.body.toLowerCase();
      }
      return l;
    };
    const fuse = new Fuse(rows, {
      keys: [{ name: 'title', weight: 2 }, { name: 'all', weight: 1 }],
      includeScore: true,
      ignoreLocation: true, // a word late in a long title counts as much as an early one
      threshold: 0.34,
      useExtendedSearch: true, // space-separated words must all match
    });
    return (query, limit = 60) => {
      const words = wordsOf(query);
      if (!words.length) return [];
      // Fuse patterns longer than 32 characters fall back to exact matching; long words are rare.
      const hits = fuse.search(words.map((w) => w.replace(/[|!^=$'"]/g, '')).filter(Boolean).join(' '));
      const seen = new Set();
      // A match that only works by forgiving typos ("edge" in "allergen") ranks below every result
      // that has all the words as typed, the plain matches inside files included.
      const out = hits.map((h) => {
        seen.add(h.item.r);
        const l = low(h.item.r);
        const { all } = l;
        let item;
        if (words.every((w) => all.includes(w))) item = { ...h.item.r, score: h.score };
        else {
          // Typo-only on its name, but every word is in its text as typed: ranks as a text hit.
          const body = l.bodyLow;
          const inText = body && words.every((w) => body.includes(w) || all.includes(w));
          item = { ...h.item.r, score: inText ? Math.min(FILE_SCORE, h.score + TYPO_PENALTY) : h.score + TYPO_PENALTY };
        }
        // A file whose name matched may also say why from inside it.
        if (item.body && !item.snippet && words.some((w) => l.bodyLow.includes(w))) item.snippet = snippet(item.body, words, 140, l.bodyLow);
        return item;
      });
      for (const r of index) {
        if (seen.has(r) || !r.body) continue;
        const l = low(r);
        if (words.every((w) => l.bodyLow.includes(w) || l.head.includes(w))) out.push({ ...r, score: FILE_SCORE, snippet: snippet(r.body, words, 140, l.bodyLow) });
      }
      return out.sort((a, b) => a.score - b.score).slice(0, limit);
    };
  }

  // About `size` characters of `text` around the first word found, with … where cut.
  // `low` is text.toLowerCase(), when the caller already has it.
  function snippet(text, words, size = 140, low = text.toLowerCase()) {
    const at = Math.min(...words.map((w) => low.indexOf(w)).filter((n) => n >= 0));
    if (!Number.isFinite(at)) return '';
    let start = Math.max(0, at - Math.floor(size / 3));
    const space = start > 0 ? text.indexOf(' ', start) : -1;
    if (space >= 0 && space < at) start = space + 1; // begin at a whole word
    const end = Math.min(text.length, start + size);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
  }

  // Work due from now through `days` ahead, soonest first: what an empty search shows.
  function upcoming(index, now = Date.now(), days = 14) {
    const until = now + days * 864e5;
    // Each date is parsed once (the list is redrawn on every key press).
    return index
      .map((r) => [r, r.due ? Date.parse(r.due) : NaN])
      .filter(([, t]) => t >= now && t <= until)
      .sort((a, b) => a[1] - b[1])
      .map(([r]) => r);
  }

  const api = { make, snippet, upcoming };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.BSX = root.BSX || {}).search = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
