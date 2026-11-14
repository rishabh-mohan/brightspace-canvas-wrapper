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
    api.tabs.create({ url: api.runtime.getURL('grant.html') });
    return undefined;
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
