// Reminders in Account: a browser notification before work in To Do is due. Off by default.
// The page hands the due dates to the background (reminders-bg.js), which shows the
// notifications even when no Brightspace tab is open. Settings are kept in their own entry
// (bsxRemind) so the background can read them.
(() => {
  const ui = BSX.ui;
  if (!ui) return;
  const api = globalThis.browser || globalThis.chrome;
  const store = api && api.storage && api.storage.local;
  if (!store) return;
  const { h } = ui;
  const KEY = 'bsxRemind';
  const LEADS = [[1440, '1 day'], [180, '3 hours'], [60, '1 hour'], [15, '15 min']];
  const WINDOW = 8 * ui.DAY; // due dates handed over: the next eight days
  const EVERY = 10 * 60 * 1000; // at most this often
  const BASE = `${location.origin}/d2l/home`;
  const ANDROID = /Android/i.test(navigator.userAgent || '');
  const NO_NOTIFY = 'Reminders need browser notifications, which this browser doesn’t give extensions (Firefox for Android). Use a desktop browser for them.';

  const clean = (v) => ({
    on: Boolean(v && v.on),
    leads: v && Array.isArray(v.leads) ? v.leads.filter((n) => LEADS.some(([m]) => m === n)) : [1440, 60],
  });
  let cfg = clean(null);
  const loaded = Promise.resolve(store.get(KEY)).then((v) => { cfg = clean(v && v[KEY]); }).catch(() => {});
  const save = () => Promise.resolve(store.set({ [KEY]: { ...cfg, origin: location.origin } })).catch(() => {});
  const ask = (msg) => {
    try {
      return Promise.resolve(api.runtime.sendMessage(msg)).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };

  // ---- the due dates handed to the background -----------------------------------
  // The same work To Do lists (data.todo, the student's own items, outside work not yet handed
  // in), less what was ticked off or dismissed. data.* answers are cached, so on the Dashboard
  // this asks Brightspace for nothing more.
  const urlOf = (i) => {
    if (i.kind === 'external') return /^https?:\/\//i.test(i.html_url || '') ? i.html_url : `${BASE}#/`;
    if (i.personal) return /^https?:\/\//i.test(i.link || '') ? i.link : `${BASE}#/`;
    return BASE + ui.itemHref(i.course_id, i);
  };
  let lastRun = 0;
  async function gather(force = false) {
    if (!cfg.on || !BSX.data) return;
    const now = Date.now();
    if (!force && now - lastRun < EVERY) return;
    lastRun = now;
    const prev = (await store.get('bsxDeadlines')).bsxDeadlines;
    if (!force && prev && prev.origin === location.origin && now - prev.at < EVERY) return; // another tab just did
    const data = BSX.data;
    const courses = ui.focusCourses(await data.courses());
    const names = new Map(courses.map((c) => [c.id, ui.nameOf(c)]));
    // The saved flags too, in case this page's preferences are still loading.
    const saved = (await store.get('bsx')).bsx || {};
    const off = (i) => ui.isDone(i) || ui.isDismissed(i) || Boolean((saved.done || {})[ui.keyOf(i)] || (saved.dismissed || {})[ui.keyOf(i)]);
    const [work, outside] = await Promise.all([data.todo(courses).catch(() => []), ui.externalWork(courses).catch(() => [])]);
    const mine = ui.personalItems(now, now + WINDOW, null);
    const seen = new Set();
    const items = [...work, ...outside.filter((i) => !i.submitted && !i.grade), ...mine]
      .filter((i) => {
        const t = Date.parse(i.due_at);
        return t > now && t <= now + WINDOW && !off(i);
      })
      .map((i) => ({ key: ui.keyOf(i), title: String(i.name || i.title || 'Untitled').slice(0, 200), course: i.course_id == null ? 'My To Do' : names.get(i.course_id) || '', due: Date.parse(i.due_at), url: urlOf(i) }))
      .filter((x) => !seen.has(x.key) && seen.add(x.key))
      .sort((a, b) => a.due - b.due)
      .slice(0, 300);
    if (!cfg.on) return; // switched off while reading
    if (prev && prev.origin === location.origin && JSON.stringify(prev.items) === JSON.stringify(items)) return;
    await store.set({ bsxDeadlines: { at: Date.now(), origin: location.origin, items } });
  }
  const onWorkPage = () => ['', '#/'].includes(location.hash) || /^#\/calendar/.test(location.hash);
  const tick = (force) => cfg.on && (force || onWorkPage()) && gather(force).catch(() => {});
  loaded.then(() => setTimeout(tick, 5000)); // after the page's own preferences and first draw
  window.addEventListener('hashchange', () => setTimeout(tick, 1500));

  // ---- Account ----------------------------------------------------------------
  let box = null;
  const paint = () => box && box.replaceChildren(...nodes().filter(Boolean)); // DOM would print a null
  const set = (patch) => {
    const was = cfg.on;
    cfg = { ...cfg, ...patch };
    save();
    if (cfg.on && !was) tick(true);
    // Off: the due dates, the record of what was shown, and the links behind it, go too.
    if (!cfg.on) {
      try {
        Promise.resolve(store.remove(['bsxDeadlines', 'bsxNotified', 'bsxNotifyUrls'])).catch(() => {});
      } catch {}
    }
    paint();
  };
  const seg = (value, onPick, labels) => h('div', { class: 'seg' }, [false, true].map((on) => h('button', { type: 'button', class: Boolean(value) === on ? 'on' : null, onclick: () => onPick(on) }, on ? labels[1] : labels[0])));
  const note = (text) => h('p', { class: 'muted small', style: 'margin:8px 4px 0' }, text);

  // Whether the browser lets the extension show notifications, with the way to allow it.
  function permissionLine() {
    const line = h('div', { class: 'muted small', role: 'status', style: 'margin:10px 4px 0' }, 'Checking notifications…');
    ask({ type: 'bsx-remind', op: 'has' }).then((r) => {
      if (r && r.supported === false) {
        line.replaceChildren(NO_NOTIFY);
      } else if (r && r.granted) {
        const test = h('button', { class: 'btn small', type: 'button', onclick: () => ask({ type: 'bsx-remind', op: 'test' }).then((x) => { if (!x || x.error) test.textContent = 'Could not send one'; }) }, 'Send a test');
        line.replaceChildren('Notifications allowed. ', test);
      } else {
        line.replaceChildren(h('div', { style: 'margin-bottom:6px' }, 'Notifications are not allowed yet.'), ui.button('Allow notifications', () => ask({ type: 'bsx-grant', site: 'notify' }), 'primary small'));
      }
    });
    return line;
  }

  function nodes() {
    // Firefox for Android has no notifications for extensions: say so instead of offering them.
    if (ANDROID) return [h('div', { class: 'traylabel' }, 'Reminders'), note(NO_NOTIFY)];
    const lead = ([m, label]) => h('label', { class: 'calrow', style: 'padding:3px 0' }, h('input', { type: 'checkbox', checked: cfg.leads.includes(m), onchange: (ev) => set({ leads: LEADS.map(([x]) => x).filter((x) => (x === m ? ev.target.checked : cfg.leads.includes(x))) }) }), label);
    return [
      h('div', { class: 'traylabel' }, 'Reminders'),
      seg(cfg.on, (on) => set({ on }), ['Off', 'Notify me']),
      cfg.on ? h('div', { class: 'row', style: 'margin:8px 4px 0;gap:4px 14px' }, LEADS.map(lead)) : null,
      note(cfg.on ? (cfg.leads.length ? 'A notification this long before work in To Do is due. Due dates are picked up when you open the Dashboard or Calendar; ticked-off work is skipped.' : 'Pick at least one time above.') : 'A browser notification before work in To Do is due, even with Brightspace closed (the browser must be running).'),
      cfg.on ? permissionLine() : null,
    ];
  }

  (ui.accountHooks ||= []).push(() => {
    box = h('div', { style: 'display:contents' });
    paint();
    loaded.then(paint);
    return box;
  });
  // Back from the page that allows notifications: show the new state.
  window.addEventListener('focus', () => box && box.isConnected && cfg.on && paint());
})();
