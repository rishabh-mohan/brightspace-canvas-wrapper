// Into Gradescope through Brightspace (app/gradescope.py, via
// `hub-brightspace gradescope`).
//
// Purdue has no Gradescope password or SSO sign-in; a course's "Gradescope
// LTI 1.3" link in Brightspace Content signs you in (the student, 10/10: "go to MATH201,
// then gradescope, then click the link"). This follows that link in a
// headless Chromium carrying brightspace-mcp-server's saved Brightspace
// session, and hands back Gradescope's cookies for the read-only reader.
// Nothing is clicked or submitted on either site.
//
// stdin:  one JSON line, {"launch": "/d2l/common/dialogs/quickLink/quickLink.d2l?ou=…&type=lti&rcode=…"}
// stdout: one JSON line, {"ok": true, "cookies": [...]} or {"ok": false, "why": "..."}
import { createInterface } from "node:readline";

const B = "/opt/brightspace-mcp/build";
const { loadConfig } = await import(`${B}/utils/config.js`);
const { BrowserStateStore } = await import(`${B}/auth/browser-state-store.js`);
const { chromium } = await import("/opt/brightspace-mcp/node_modules/playwright/index.mjs");

const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const line = await new Promise((ok) => createInterface({ input: process.stdin }).once("line", ok));
const { launch } = JSON.parse(line || "{}");
if (!launch || !/^\/d2l\/[^\s]*type=lti/.test(launch)) {
  say({ ok: false, why: "no Gradescope link to follow" });
  process.exit(0);
}
const config = await loadConfig();
const state = await new BrowserStateStore(config.sessionDir).load();
if (!state) {
  say({ ok: false, why: "Brightspace hasn't signed in yet" });
  process.exit(0);
}
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ storageState: state });
  const page = await ctx.newPage();
  await page.goto(new URL(launch, config.baseUrl).href, { waitUntil: "domcontentloaded", timeout: 45000 });
  try {
    await page.waitForURL(/^https:\/\/www\.gradescope\.com\//, { timeout: 45000 });
  } catch {
    const at = new URL(page.url());
    say({ ok: false, why: /login|microsoftonline|idp\.purdue/.test(at.host + at.pathname)
      ? "Brightspace's saved sign-in has run out; the next Brightspace check renews it"
      : `the link stopped at ${at.host}` });
    process.exit(0);
  }
  const cookies = (await ctx.cookies("https://www.gradescope.com")).map(
    ({ name, value, domain, path, expires, secure }) => ({ name, value, domain, path, expires, secure }));
  say(cookies.some((c) => c.name === "_gradescope_session" || c.name === "signed_token")
    ? { ok: true, cookies } : { ok: false, why: "Gradescope didn't sign in" });
} finally {
  await browser.close();
}
