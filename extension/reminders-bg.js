// Due-soon reminders as browser notifications (src/reminders.js has the settings and hands over
// the due dates). Off by default: switched off, no alarm is made and nothing is written.
//
// Storage (extension storage, this browser only):
//   bsxRemind     { on, leads: [minutes before], origin }
//   bsxDeadlines  { at, origin, items: [{ key, title, course, due (ms), url }] }, from the page
//   bsxNotified   { '<key>|<lead>': when }, so nothing is shown twice
//   bsxNotifyUrls { '<notification id>': { url, at } }, what a click opens
//
// A service worker (Chrome) or event page (Firefox) is stopped when idle, so everything lives in
// storage and alarms, and every listener is added at the top, as the script starts. Chrome loads
// this with importScripts from background.js, Firefox from the manifest's scripts list; both share
// background.js's top level, so nothing here is declared outside this function.
(() => {
  const R = globalThis.browser || globalThis.chrome;
  const PREFIX = 'bsxr|';
  const MIN = 60e3;
  const DAY = 1440 * MIN;
  const MAX_ALARMS = 200;
  const GRACE = 30 * MIN; // a reminder missed by less than this (browser closed) is still shown
  // Chrome raises alarms under 30 s to 30 s, so "right away" is 30 s, and an alarm within 30 s of
  // the wanted time is left alone (else every reschedule would push the catch-up one back).
  const SOON = 30 * 1000;
  const KEEP = 10 * DAY; // how long "already shown" is remembered
  const LEADS = [1440, 180, 60, 15];

  // ---- plain functions (tests/reminders.test.js) ----------------------------------
  const cleanRemind = (v) => ({
    on: Boolean(v && v.on),
    leads: v && Array.isArray(v.leads) ? [...new Set(v.leads.filter((n) => LEADS.includes(n)))] : [1440, 60],
    origin: v && /^https?:\/\/[^/]+$/.test(v.origin) ? v.origin : null,
  });
  const alarmName = (key, lead) => `${PREFIX}${key}|${lead}`;
  const parseAlarm = (name) => {
    const cut = name.lastIndexOf('|');
    return { key: name.slice(PREFIX.length, cut), lead: Number(name.slice(cut + 1)) };
  };

  // The alarms wanted for these items: one per item and lead still ahead and not yet shown,
  // plus one right away for the latest lead missed by less than GRACE. Soonest first, capped.
  function plan(items, leads, now, notified = {}) {
    const out = [];
    const ls = [...new Set(leads)].filter((n) => n > 0).sort((a, b) => b - a); // longest first
    for (const it of items || []) {
      if (!it || typeof it.key !== 'string' || !(it.due > now)) continue;
      let missed = null;
      for (const lead of ls) {
        const at = it.due - lead * MIN;
        if (at > now) {
          if (!notified[`${it.key}|${lead}`]) out.push({ name: alarmName(it.key, lead), when: at });
        } else missed = lead; // ends on the shortest lead already passed
      }
      if (missed != null && it.due - missed * MIN > now - GRACE && !notified[`${it.key}|${missed}`]) out.push({ name: alarmName(it.key, missed), when: now + SOON });
    }
    out.sort((a, b) => a.when - b.when);
    return out.slice(0, MAX_ALARMS);
  }

  // What to do when alarm (key, lead) fires: the item to show (or null) and the
  // '<key>|<lead>' entries to mark shown. Every lead already passed is marked, so a browser
  // that slept through several shows one notification, not a burst, and the other alarms for
  // the item, firing together on waking, find nothing left to show.
  function decide(key, lead, now, remind, deadlines, notified = {}) {
    const none = { item: null, mark: [] };
    const r = cleanRemind(remind);
    if (!r.on || !r.leads.includes(lead)) return none;
    const it = ((deadlines && deadlines.items) || []).find((i) => i && i.key === key);
    if (!it) return none;
    const mark = r.leads.filter((l) => it.due - l * MIN <= now + MIN).map((l) => `${key}|${l}`);
    if (!mark.length || mark.every((id) => notified[id])) return none;
    return { item: it.due > now ? it : null, mark }; // already past due: just marked
  }

  function dueIn(ms) {
    const m = Math.max(1, Math.round(ms / MIN));
    const unit = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (m < 60) return `Due in ${unit(m, 'minute')}`;
    const hrs = Math.round(m / 60);
    if (hrs < 24) return `Due in ${unit(hrs, 'hour')}`;
    return `Due in ${unit(Math.round(hrs / 24), 'day')}`;
  }

  const prune = (bag, now) => Object.fromEntries(Object.entries(bag || {}).filter(([, v]) => now - (typeof v === 'number' ? v : v && v.at) < KEEP));
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) ? u : null);

  const helpers = { cleanRemind, plan, decide, dueIn, prune, safeUrl, alarmName, parseAlarm };
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  if (!R || !R.alarms || !R.storage) return;

  // ---- browser side ----------------------------------------------------------------
  const local = R.storage.local;
  const get = async (k) => (await local.get(k))[k];
  // Alarms firing together are handled one at a time, each reading what the last one wrote.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };
  const canNotify = async () => {
    try {
      return Boolean(R.notifications && R.notifications.create && (await R.permissions.contains({ permissions: ['notifications'] })));
    } catch {
      return false;
    }
  };

  async function reschedule() {
    const now = Date.now();
    const remind = cleanRemind(await get('bsxRemind'));
    const mine = (await R.alarms.getAll()).filter((a) => a.name.startsWith(PREFIX));
    const want = remind.on ? plan(((await get('bsxDeadlines')) || {}).items, remind.leads, now, (await get('bsxNotified')) || {}) : [];
    const names = new Set(want.map((w) => w.name));
    await Promise.all(mine.filter((a) => !names.has(a.name)).map((a) => R.alarms.clear(a.name)));
    for (const w of want) {
      const a = mine.find((x) => x.name === w.name);
      if (!a || Math.abs(a.scheduledTime - w.when) > SOON) R.alarms.create(w.name, { when: w.when });
    }
  }

  async function remember(marks, id, url) {
    const now = Date.now();
    const notified = prune(await get('bsxNotified'), now);
    for (const m of marks) notified[m] = now;
    const out = { bsxNotified: notified };
    if (id && url) out.bsxNotifyUrls = { ...prune(await get('bsxNotifyUrls'), now), [id]: { url, at: now } };
    await local.set(out);
  }

  async function show(id, title, message, url) {
    await R.notifications.create(id, { type: 'basic', iconUrl: R.runtime.getURL('icons/icon-128.png'), title, message });
    return url;
  }

  async function onDue(name) {
    const { key, lead } = parseAlarm(name);
    const now = Date.now();
    const [remind, deadlines, notified] = await Promise.all([get('bsxRemind'), get('bsxDeadlines'), get('bsxNotified')]);
    const { item, mark } = decide(key, lead, now, remind, deadlines, notified || {});
    if (!mark.length) return;
    if (item && !(await canNotify())) return; // not marked: shown if allowed before a later lead
    let id = null;
    let url = null;
    if (item) {
      id = `bsxr|${now}|${Math.random().toString(36).slice(2, 8)}`;
      const at = new Date(item.due).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      url = safeUrl(item.url);
      await show(id, dueIn(item.due - now), `${item.title}${item.course ? ` · ${item.course}` : ''}\nDue ${at}`, url);
    }
    await remember(mark, id, url);
  }

  async function onClick(id) {
    if (!String(id).startsWith('bsxr')) return;
    const urls = (await get('bsxNotifyUrls')) || {};
    const url = safeUrl(urls[id] && urls[id].url);
    if (url) await R.tabs.create({ url });
    if (R.notifications) R.notifications.clear(id);
    if (urls[id]) {
      delete urls[id];
      await local.set({ bsxNotifyUrls: urls });
    }
  }
  // Chrome has no notifications object until the permission is granted, so the click listener
  // is added now if it can be, and again when the permission arrives.
  let clickHooked = false;
  const hookClicks = () => {
    if (clickHooked || !R.notifications || !R.notifications.onClicked) return;
    clickHooked = true;
    R.notifications.onClicked.addListener((id) => serial(() => onClick(id)).catch(() => {}));
  };
  hookClicks();

  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => serial(reschedule).catch(() => {}), 500);
  };
  R.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(PREFIX)) serial(() => onDue(alarm.name)).catch(() => {});
  });
  R.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.bsxDeadlines || changes.bsxRemind)) later();
  });
  if (R.permissions && R.permissions.onAdded) {
    R.permissions.onAdded.addListener(() => {
      hookClicks();
      later();
    });
  }
  R.runtime.onInstalled.addListener(later);
  R.runtime.onStartup.addListener(later);

  // The settings in Account: whether notifications are allowed, and a test notification.
  R.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'bsx-remind' || sender.id !== R.runtime.id) return undefined;
    (async () => {
      const granted = await canNotify();
      if (msg.op === 'has') {
        // Firefox for Android has no notifications API for extensions.
        const os = R.runtime.getPlatformInfo ? await Promise.resolve(R.runtime.getPlatformInfo()).then((p) => p && p.os, () => '') : '';
        return sendResponse({ granted, supported: os !== 'android' });
      }
      if (msg.op === 'test') {
        if (!granted) return sendResponse({ error: 'permission' });
        hookClicks();
        await show(`bsxr-test|${Date.now()}`, 'Reminders are on', 'Work due soon will show up like this.', null);
        return sendResponse({ ok: true });
      }
      sendResponse({ error: 'Not allowed.' });
    })().catch((e) => sendResponse({ error: String(e && e.message ? e.message : e) }));
    return true;
  });
})();
