const api = globalThis.browser || globalThis.chrome;
// Reminders (notifications). Firefox loads it from the manifest's scripts list; Chrome's service worker here.
if (typeof importScripts === 'function') importScripts('reminders-bg.js');

// Toolbar button: run the access probe in the current tab.
api.action.onClicked.addListener((tab) => {
  api.scripting.executeScript({ target: { tabId: tab.id }, files: ['probe.js'] });
});

// Gradescope pages for the optional Gradescope reader (src/gradescope.js). Content scripts
// cannot read another site, so they ask here. Only two kinds of page are ever fetched, with
// GET, using the student's own Gradescope session.
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Toolbar badge: how many new grades and announcements since the dashboard was last opened.
  if (msg && msg.type === 'bsx-badge' && sender.id === api.runtime.id) {
    const n = Math.max(0, Math.min(99, Number(msg.count) || 0));
    api.action.setBadgeText({ text: n ? String(n) : '' });
    api.action.setBadgeBackgroundColor({ color: '#0374b5' });
    api.action.setTitle({ title: n ? `${n} new grade${n === 1 ? '' : 's'} or announcement${n === 1 ? '' : 's'}. Click to run the Brightspace access probe` : 'Run Brightspace access probe' });
    return undefined;
  }
  // Firefox does not grant site access to a temporary add-on by itself: this opens a page
  // where one click asks for gradescope.com (a permission request needs a click on an
  // extension page, not on Brightspace).
  if (msg && msg.type === 'bsx-grant' && sender.id === api.runtime.id) {
    api.tabs.create({ url: api.runtime.getURL(`grant.html${['ed', 'notify', 'edfinity'].includes(msg.site) ? `?site=${msg.site}` : ''}`) });
    return undefined;
  }
  // Ed Discussion (edstem.org) for the optional Ed reader. Ed signs requests with a personal
  // API token the student pastes into the wrapper; it is read from extension storage here,
  // so it never passes through the page. Only these GET routes are allowed: the user's
  // courses, a course's lessons, a course's newest threads (for announcements), one
  // lesson's details, and a challenge's submissions (for scores).
  if (msg && msg.type === 'bsx-ed' && sender.id === api.runtime.id) {
    const path = String(msg.path || '');
    if (!/^\/api\/(user|courses\/\d+\/lessons|courses\/\d+\/threads\?limit=\d{1,3}&offset=0&sort=new|lessons\/\d+(\?view=1)?|challenges\/\d+\/submissions)$/.test(path)) {
      sendResponse({ error: 'Not allowed.' });
      return undefined;
    }
    (async () => {
      const ok = api.permissions && api.permissions.contains ? await api.permissions.contains({ origins: ['https://*.edstem.org/*'] }) : true;
      if (!ok) return sendResponse({ error: 'permission' });
      const saved = (await api.storage.local.get('bsx')).bsx || {};
      const token = saved.ed && saved.ed.token;
      const region = ['us', 'au', 'eu', 'ca'].includes(saved.ed && saved.ed.region) ? saved.ed.region : 'us';
      if (!token) return sendResponse({ error: 'no_token' });
      const res = await fetch(`https://${region}.edstem.org${path}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' });
      if (res.status === 401 || res.status === 403) return sendResponse({ error: 'bad_token' });
      if (!res.ok) return sendResponse({ error: `Ed returned ${res.status}` });
      sendResponse({ json: await res.json() });
    })().catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  // Edfinity (edfinity.com) for the optional Edfinity reader (src/edfinity.js): GET only, with
  // the student's own Edfinity session, and only these JSON routes: the course list, one
  // course, and a course's assignments. op 'check' only says whether access is allowed.
  if (msg && msg.type === 'bsx-edfinity' && sender.id === api.runtime.id) {
    const path = String(msg.path || '');
    if (msg.op !== 'check' && !/^\/registrations(\?[\w=&]*)?$|^\/registrations\/[0-9a-f]{24}(\/assignments)?$/.test(path)) {
      sendResponse({ error: 'Not allowed.' });
      return undefined;
    }
    (async () => {
      const ok = api.permissions && api.permissions.contains ? await api.permissions.contains({ origins: ['https://edfinity.com/*'] }) : true;
      if (!ok) return sendResponse({ error: 'permission' });
      if (msg.op === 'check') return sendResponse({ ok: true });
      const res = await fetch(`https://edfinity.com${path}`, { credentials: 'include', redirect: 'follow', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
      const json = /json/i.test(res.headers.get('content-type') || '') ? await res.json().catch(() => null) : null;
      sendResponse({ status: res.status, url: res.url, json });
    })().catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (!msg || msg.type !== 'bsx-gradescope') return undefined;
  const path = String(msg.path || '');
  if (sender.id !== api.runtime.id || !/^\/(account|courses\/\d+)$/.test(path)) {
    sendResponse({ error: 'Not allowed.' });
    return undefined;
  }
  const allowed = api.permissions && api.permissions.contains ? api.permissions.contains({ origins: ['https://www.gradescope.com/*'] }) : Promise.resolve(true);
  allowed
    .then((ok) => {
      if (!ok) return sendResponse({ error: 'permission' });
      return fetch(`https://www.gradescope.com${path}`, { credentials: 'include', redirect: 'follow' })
        .then(async (res) => sendResponse({ status: res.status, url: res.url, html: await res.text() }));
    })
    .catch((e) => sendResponse({ error: String(e) }));
  return true; // the answer is sent later
});
