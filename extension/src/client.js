// Layer 1: the only file that knows how to talk to Brightspace.
// Read-only (GET), same-origin, authenticated by the signed-in session.
globalThis.BSX = globalThis.BSX || {};

BSX.client = (() => {
  const TTL = 2 * 60 * 1000;
  const MAX_CONCURRENT = 4;
  const MAX_PAGES = 20;
  const cache = new Map();
  const waiting = [];
  let active = 0;
  let versions = null;

  class ApiError extends Error {
    constructor(status, path) {
      super(`Brightspace returned ${status} for ${path}`);
      this.status = status;
    }
  }

  function slot() {
    return new Promise((resolve) => {
      const go = () => {
        active++;
        resolve();
      };
      if (active < MAX_CONCURRENT) go();
      else waiting.push(go);
    });
  }

  async function raw(path) {
    await slot();
    try {
      const res = await fetch(path, { credentials: 'same-origin' });
      if (!res.ok) throw new ApiError(res.status, path);
      // An expired session answers with a sign-in page instead of data.
      const type = res.headers ? res.headers.get('content-type') : null;
      if (type != null && !/json/i.test(type)) throw new ApiError(401, path);
      return await res.json();
    } finally {
      active--;
      const next = waiting.shift();
      if (next) next();
    }
  }

  function get(path) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL) return hit.promise;
    const promise = raw(path);
    cache.set(path, { at: Date.now(), promise });
    promise.catch(() => cache.delete(path));
    return promise;
  }

  function getVersions() {
    if (!versions) {
      versions = (async () => {
        try {
          const saved = JSON.parse(sessionStorage.getItem('bsx.versions'));
          if (saved && saved.lp && saved.le) return saved;
        } catch {}
        const list = await raw('/d2l/api/versions/');
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

  return { ApiError, lp, le, lpPath, lpBookmarked, leObjects, clear: () => cache.clear() };
})();
