// Layer 1: the only file that knows how to talk to Brightspace.
// Read-only (GET), same-origin, authenticated by the signed-in session.
globalThis.BSX = globalThis.BSX || {};

BSX.client = (() => {
  const TTL = 2 * 60 * 1000;
  const MAX_CONCURRENT = 4;
  const MAX_PAGES = 20;
  const cache = new Map();
  // Requests waiting for a slot. Checks of an answer already shown from storage go last, so
  // a request with nothing to show yet never waits behind hundreds of them (deep search).
  const urgent = [];
  const later = [];
  let active = 0;
  let versions = null;

  class ApiError extends Error {
    constructor(status, path) {
      super(`Brightspace returned ${status} for ${path}`);
      this.status = status;
    }
  }

  function slot(low = false) {
    return new Promise((resolve) => {
      const go = () => {
        active++;
        resolve();
      };
      if (active < MAX_CONCURRENT) go();
      else (low ? later : urgent).push(go);
    });
  }
  function release() {
    active--;
    const next = urgent.shift() || later.shift();
    if (next) next();
  }

  async function raw(path, { low = false } = {}) {
    await slot(low);
    try {
      const res = await fetch(path, { credentials: 'same-origin' });
      if (!res.ok) throw new ApiError(res.status, path);
      // An expired session answers with a sign-in page instead of data.
      const type = res.headers ? res.headers.get('content-type') : null;
      if (type != null && !/json/i.test(type)) throw new ApiError(401, path);
      return await res.json();
    } finally {
      release();
    }
  }

  // ---- saved answers ---------------------------------------------------------
  // The last answer for each address is kept in extension storage (this browser only), so
  // a freshly opened page shows at once from the previous visit while the real request
  // runs; when the real answer differs, listeners are told and the page redraws.
  const store = (globalThis.browser || globalThis.chrome)?.storage?.local;
  const KEY = `bsxCache:${globalThis.location?.host || ''}`;
  const KEEP = 7 * 864e5;
  const MAX_ENTRY = 400e3; // characters; very long answers (big classlists) are not kept
  const MAX_TOTAL = 4e6;
  const RESAVE = 60 * 60 * 1000; // an unchanged answer's date is written again at most this often
  const listeners = new Set();
  let saved = new Map(); // path -> { at, json }
  let bypass = false; // after Refresh, this page always waits for Brightspace
  let saveTimer = null;
  let changeTimer = null;

  const ready = (async () => {
    try {
      const v = (await store.get(KEY))?.[KEY];
      if (v && typeof v.entries === 'object') {
        for (const [p, e] of Object.entries(v.entries)) if (e && typeof e.json === 'string' && Date.now() - e.at < KEEP) saved.set(p, e);
      }
    } catch {}
  })();

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const newest = [...saved.entries()].sort((a, b) => b[1].at - a[1].at);
      const entries = {};
      let total = 0;
      for (const [p, e] of newest) {
        if ((total += e.json.length) > MAX_TOTAL) break;
        entries[p] = e;
      }
      try {
        store.set({ [KEY]: { entries } });
      } catch {}
    }, 1000);
  }

  // Returns the answer as JSON, for the caller to compare with the saved copy.
  function remember(path, data) {
    const json = JSON.stringify(data);
    const had = saved.get(path);
    if (json.length > MAX_ENTRY) {
      if (!saved.delete(path)) return json;
    } else if (had && had.json === json && Date.now() - had.at < RESAVE) {
      had.at = Date.now(); // written with the next change; no storage write for an unchanged answer
      return json;
    } else saved.set(path, { at: Date.now(), json });
    persist();
    return json;
  }

  // Signed out, or a different person may sign in next: drop everything kept.
  function forget() {
    saved = new Map();
    persist();
    if (BSX.filetext) BSX.filetext.forget(); // text read from course files, too
    if (BSX.whatsnew) BSX.whatsnew.forget(); // and the What's New snapshot held by this page
    if (BSX.notices) BSX.notices.forget(); // and the Alerts list and read marks
    try {
      // What's New snapshots (whatsnew.js), the due dates handed to reminders (reminders.js) and
      // the reminders already shown, what the Edfinity reader kept (edfinity.js) and the Alerts
      // read marks (notices.js)
      Promise.resolve(store.remove([`bsxSeen:${globalThis.location?.host || ''}`, 'bsxDeadlines', 'bsxNotified', 'bsxNotifyUrls', 'bsxEdfinity', `bsxRead:${globalThis.location?.host || ''}`])).catch(() => {});
    } catch {}
  }

  function changed() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => listeners.forEach((fn) => fn()), 300);
  }

  // A tool that is switched off or not permitted (403, 404) stays refused like any answer
  // until the cache expires or Refresh; other failures (signed out, throttled, network) are
  // tried again on the next call.
  const lasting = (e) => e instanceof ApiError && (e.status === 403 || e.status === 404);

  // `path` is an API address; `fetcher` (optional) produces the answer some other way, for
  // facts worked out from a page (see keep).
  function get(path, fetcher = raw) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.promise;
    const entry = { at: Date.now(), promise: null };
    entry.promise = (async () => {
      await ready;
      const old = hit || bypass ? null : saved.get(path);
      let data = null;
      if (old) {
        try {
          data = JSON.parse(old.json);
        } catch {
          data = null;
        }
      }
      // With a saved answer to show, the check with Brightspace waits behind requests that have none.
      const fresh = fetcher(path, { low: data != null });
      let json = null; // set by the first handler, which runs before the second
      fresh.then(
        (d) => (json = remember(path, d)),
        (e) => e instanceof ApiError && e.status === 401 && forget()
      );
      if (data == null) return fresh;
      fresh.then(
        (d) => {
          entry.promise = Promise.resolve(d);
          if (json !== old.json) changed();
        },
        (e) => {
          // The saved answer no longer holds; redraw so the page shows the real outcome.
          saved.delete(path);
          persist(); // so the next visit does not show it again
          if (lasting(e)) entry.promise = fresh;
          else cache.delete(path);
          changed();
        }
      );
      return data;
    })();
    cache.set(path, entry);
    entry.promise.catch((e) => lasting(e) || cache.delete(path));
    return entry.promise;
  }

  function getVersions() {
    if (!versions) {
      versions = (async () => {
        try {
          const saved = JSON.parse(sessionStorage.getItem('bsx.versions'));
          if (saved && saved.lp && saved.le) return saved;
        } catch {}
        const list = await get('/d2l/api/versions/');
        const latest = (code) => list.find((p) => p.ProductCode === code)?.LatestVersion;
        const found = { lp: latest('lp'), le: latest('le') };
        if (!found.lp || !found.le) throw new Error('Brightspace did not report its lp and le API versions');
        try {
          sessionStorage.setItem('bsx.versions', JSON.stringify(found));
        } catch {}
        return found;
      })();
      versions.catch(() => (versions = null));
    }
    return versions;
  }

  const lpPath = async (tail) => `/d2l/api/lp/${(await getVersions()).lp}/${tail}`;
  const lePath = async (tail) => `/d2l/api/le/${(await getVersions()).le}/${tail}`;
  const lp = async (tail) => get(await lpPath(tail));
  const le = async (tail) => get(await lePath(tail));

  // { PagingInfo: { Bookmark, HasMoreItems }, Items: [] }
  async function lpBookmarked(tail) {
    const items = [];
    let bookmark = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const sep = tail.includes('?') ? '&' : '?';
      const r = await lp(bookmark ? `${tail}${sep}bookmark=${encodeURIComponent(bookmark)}` : tail);
      items.push(...(r.Items || []));
      if (!r.PagingInfo?.HasMoreItems) break;
      bookmark = r.PagingInfo.Bookmark;
    }
    return items;
  }

  // { Objects: [], Next: url | null }
  async function leObjects(tail) {
    let page = await le(tail);
    const items = [...(page.Objects || [])];
    for (let i = 1; i < MAX_PAGES && page.Next; i++) {
      const next = new URL(page.Next, location.origin);
      if (next.origin !== location.origin) break;
      page = await get(next.pathname + next.search);
      items.push(...(page.Objects || []));
    }
    return items;
  }

  // A Brightspace page's HTML (same origin, GET), for facts the API refuses students.
  const pages = new Map();
  function page(path) {
    const hit = pages.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.promise;
    const promise = (async () => {
      await slot();
      try {
        const res = await fetch(path, { credentials: 'same-origin' });
        if (!res.ok) throw new ApiError(res.status, path);
        if (/\/d2l\/login/i.test(res.url || '')) throw new ApiError(401, path);
        return await res.text();
      } finally {
        release();
      }
    })();
    pages.set(path, { at: Date.now(), promise });
    promise.catch(() => pages.delete(path));
    return promise;
  }

  // The one write the wrapper makes: handing in an assignment, at the student's request.
  // Brightspace's own pages authorise writes with a short-lived token fetched with the
  // page's anti-forgery token; the session cookie alone is the fallback.
  async function token() {
    let xsrf = null;
    try {
      xsrf = localStorage.getItem('XSRF.Token');
    } catch {}
    if (!xsrf) return { xsrf: null, bearer: null };
    try {
      const res = await fetch('/d2l/lp/auth/oauth2/token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Csrf-Token': xsrf },
        body: 'scope=*:*:*',
      });
      return { xsrf, bearer: res.ok ? (await res.json()).access_token || null : null };
    } catch {
      return { xsrf, bearer: null };
    }
  }

  async function send(tail, { body, type }) {
    const path = await lePath(tail);
    const t = await token();
    const headers = { 'Content-Type': type };
    if (t.bearer) headers.Authorization = `Bearer ${t.bearer}`;
    else if (t.xsrf) headers['X-Csrf-Token'] = t.xsrf;
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers, body });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      } catch {}
      const e = new ApiError(res.status, path);
      e.detail = detail;
      throw e;
    }
    return res;
  }

  const clear = () => {
    pages.clear();
    cache.clear();
    bypass = true;
  };
  const onChange = (fn) => listeners.add(fn);

  // A small fact worked out from a Brightspace page (such as the links on a course's home
  // page), kept like an API answer: shown at once from the last visit, then refreshed.
  const keep = (key, fetcher) => get(`keep:${key}`, () => fetcher());

  return { ApiError, lp, le, lpPath, lePath, lpBookmarked, leObjects, page, send, keep, clear, forget, onChange };
})();
