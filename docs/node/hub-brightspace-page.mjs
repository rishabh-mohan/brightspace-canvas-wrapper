// Read a page a Brightspace Content link opens (app/d2l.py, via
// `hub-brightspace page`): a course's "Simple Syllabus" is a tool link, not a
// file, so the syllabus reader never saw its schedule (10/14, the student: "SEM and
// ENG 120 PRO was shown cancelled in the syllabus"). This follows the link
// in a headless Chromium carrying brightspace-mcp-server's saved Brightspace
// session and hands back the text of where it lands, the way clicking it
// shows it. Nothing is clicked or submitted.
//
// stdin:  one JSON line, {"launch": "/d2l/common/dialogs/quickLink/quickLink.d2l?ou=…&type=lti&rcode=…"}
// stdout: one JSON line, {"ok": true, "url": "...", "text": "..."} or {"ok": false, "why": "..."}
import { createInterface } from "node:readline";

const B = "/opt/brightspace-mcp/build";
const { loadConfig } = await import(`${B}/utils/config.js`);
const { BrowserStateStore } = await import(`${B}/auth/browser-state-store.js`);
const { chromium } = await import("/opt/brightspace-mcp/node_modules/playwright/index.mjs");

const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const line = await new Promise((ok) => createInterface({ input: process.stdin }).once("line", ok));
const { launch } = JSON.parse(line || "{}");
if (!launch || !/^\/d2l\/[^\s]*type=lti/.test(launch)) {
  say({ ok: false, why: "no link to follow" });
  process.exit(0);
}
const config = await loadConfig();
const state = await new BrowserStateStore(config.sessionDir).load();
if (!state) {
  say({ ok: false, why: "Brightspace hasn't signed in yet" });
  process.exit(0);
}
const home = new URL(config.baseUrl).host;
const MAX = 80000;
const browser = await chromium.launch({ headless: true });
try {
  // A desktop browser's name: Simple Syllabus's app sat on its spinner for a
  // headless one (10/14). It draws ~20 s after loading; wait for real text.
  const ctx = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
  const page = await ctx.newPage();
  await page.goto(new URL(launch, config.baseUrl).href, { waitUntil: "domcontentloaded", timeout: 45000 });
  // the tool opens in this window, or inside a frame on a Brightspace page
  try {
    await page.waitForURL((u) => u.host !== home, { timeout: 20000 });
  } catch { /* framed: read the frame below */ }
  const at = new URL(page.url());
  if (/login|microsoftonline|idp\.purdue/.test(at.host + at.pathname)) {
    say({ ok: false, why: "Brightspace's saved sign-in has run out; the next Brightspace check renews it" });
    process.exit(0);
  }
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  let target = page;
  if (at.host === home) {
    const outside = page.frames().find((f) => { try { return new URL(f.url()).host !== home && f.url().startsWith("http"); } catch { return false; } });
    if (outside) {
      await outside.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      target = outside;
    }
  }
  await target.waitForFunction(() => document.body && document.body.innerText.trim().length > 1000,
    null, { timeout: 60000, polling: 1000 }).catch(() => {});
  const text = (await target.evaluate(() => document.body ? document.body.innerText : "")).trim();
  say(text.length > 200
    ? { ok: true, url: target.url(), text: text.slice(0, MAX) }
    : { ok: false, why: `the page at ${new URL(target.url()).host} had no text` });
} catch (e) {
  say({ ok: false, why: `the page didn't load: ${String(e && e.message || e).split("\n")[0].slice(0, 160)}` });
} finally {
  await browser.close();
}
