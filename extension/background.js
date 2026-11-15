const api = globalThis.browser || globalThis.chrome;

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
    api.tabs.create({ url: api.runtime.getURL(`grant.html${msg.site === 'ed' ? '?site=ed' : ''}`) });
    return undefined;
  }
  // Ed Discussion (edstem.org) for the optional Ed reader. Ed signs requests with a personal
  // API token the student pastes into the wrapper; it is read from extension storage here,
  // so it never passes through the page. Only two GET routes are allowed.
  if (msg && msg.type === 'bsx-ed' && sender.id === api.runtime.id) {
    const path = String(msg.path || '');
    if (!/^\/api\/(user|courses\/\d+\/lessons)$/.test(path)) {
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
