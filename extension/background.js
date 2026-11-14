const api = globalThis.browser || globalThis.chrome;

// Toolbar button: run the access probe in the current tab.
api.action.onClicked.addListener((tab) => {
  api.scripting.executeScript({ target: { tabId: tab.id }, files: ['probe.js'] });
});

// Gradescope pages for the optional Gradescope reader (src/gradescope.js). Content scripts
// cannot read another site, so they ask here. Only two kinds of page are ever fetched, with
// GET, using the student's own Gradescope session.
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'bsx-gradescope') return undefined;
  const path = String(msg.path || '');
  if (sender.id !== api.runtime.id || !/^\/(account|courses\/\d+)$/.test(path)) {
    sendResponse({ error: 'Not allowed.' });
    return undefined;
  }
  fetch(`https://www.gradescope.com${path}`, { credentials: 'include', redirect: 'follow' })
    .then(async (res) => sendResponse({ status: res.status, url: res.url, html: await res.text() }))
    .catch((e) => sendResponse({ error: String(e) }));
  return true; // the answer is sent later
});
