// ==UserScript==
// @name         Hub: Purdue 2FA code
// @namespace    assignhub
// @version      1
// @description  Types the 6-digit code into Purdue's Microsoft sign-in from your own authenticator key, so signing in to Brightspace, Pearson or Wiley doesn't wait on your phone.
// @match        https://login.microsoftonline.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

// the student, 11/13: "make an extension that auto fills the Purdue 2FA". The Hub's own sign-in does this inside its container
// (brightspace-mcp-server's purdue-sso.js, totp mode); this is the same step for their own browser. The page's ids and
// rules are that file's, live-verified on Purdue's tenant: switch to "Use a verification code", tick "Don't ask
// again", never send a code with under 5 s left.
//
// The key: they pastes their authenticator setup key once (Tampermonkey menu → "Set my Purdue authenticator key"). It stays
// in Tampermonkey's storage on this computer; the Hub never hands out a code or a secret. Anything running as them on
// this computer can read it, the way it could read a password manager's: never set it on a shared computer.
// Only Purdue accounts (the page shows "@purdue.edu"), only the second factor (the browser's own password manager does
// the password), and at most 2 tries on a page, so it never spends all of Microsoft's attempts.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The bare key Microsoft shows behind "Can't scan image?", or its otpauth:// link -> {bytes, digits, period}. */
function parseKey(input) {
  let s = String(input || "").trim(), digits = 6, period = 30;
  if (/^otpauth:/i.test(s)) {
    const u = new URL(s);
    if (u.hostname !== "totp" || (u.searchParams.get("algorithm") || "SHA1").toUpperCase() !== "SHA1") {
      throw new Error("That isn't a Microsoft authenticator link.");
    }
    digits = Number(u.searchParams.get("digits") || 6);
    period = Number(u.searchParams.get("period") || 30);
    s = u.searchParams.get("secret") || "";
  }
  const key = s.toUpperCase().replace(/[\s=-]/g, "");
  if (!/^[A-Z2-7]{16,}$/.test(key) || ![6, 7, 8].includes(digits) || !(period > 0)) {
    throw new Error("That isn't an authenticator key: it's the letters and digits 2-7 behind “Can't scan image?”.");
  }
  const bytes = [];
  let bits = 0, buf = 0;
  for (const c of key) {
    buf = (buf << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buf >>> bits) & 255); buf &= (1 << bits) - 1; }
  }
  return { bytes: new Uint8Array(bytes), digits, period };
}

/** RFC 6238: the code for `now` (ms). */
async function totp(k, now = Date.now()) {
  const counter = new Uint8Array(8);
  for (let i = 7, t = Math.floor(now / 1000 / k.period); i >= 0; i--, t = Math.floor(t / 256)) counter[i] = t % 256;
  const key = await crypto.subtle.importKey("raw", k.bytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const o = h[h.length - 1] & 15;
  const n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 10 ** k.digits;
  return String(n).padStart(k.digits, "0");
}

if (typeof GM_getValue === "function") {
  GM_registerMenuCommand("Set my Purdue authenticator key", () => {
    const v = prompt("Paste your authenticator setup key (the letters Microsoft shows behind “Can't scan image?”) " +
                     "or its otpauth:// link. It stays in Tampermonkey on this computer.");
    if (v === null) return;
    try { parseKey(v); GM_setValue("key", v.trim()); alert("Saved. Purdue's next code page fills itself."); }
    catch (e) { alert(e.message); }
  });
  GM_registerMenuCommand("Forget my Purdue authenticator key", () => { GM_deleteValue("key"); alert("Forgotten."); });

  const CODE = ["#idTxtBx_SAOTCC_OTC", 'input[name="otc"]'];
  const SUBMIT = ["#idSubmit_SAOTCC_Continue", "#idSIButton9"];
  const ERROR = "#idSpan_SAOTCC_Error_OTC";
  const REMEMBER = ["#idChkBx_SAOTCAS_TD", "#idChkBx_SAOTCC_TD"];          // "Don't ask again for N days"
  const STEPS = [/^use a verification code$/i,                             // the exact one first; the others open the list
                 /^(I can.t use my .+ right now|sign in another way|use a different verification option)$/i];
  const shown = (e) => !!e && e.getClientRects().length > 0;
  const first = (sels) => sels.map((s) => document.querySelector(s)).find(shown);
  const clicked = new Set();
  let tries = 0, lastCounter = -1, busy = false;

  const tick = async () => {
    const raw = GM_getValue("key");
    if (busy || !raw || !/@purdue\.edu\b/i.test(document.body.innerText)) return;
    const k = parseKey(raw);
    for (const id of REMEMBER) { const b = document.querySelector(id); if (shown(b) && !b.checked) b.click(); }
    const field = first(CODE);
    if (!field) {
      // the phone was offered first: go to the code, each link once on this page, never on the email/password pages
      if (first(['input[type="password"]', 'input[type="email"]'])) return;
      for (const re of STEPS) {
        const el = [...document.querySelectorAll('a, button, [role="button"], [role="link"], div, span')]
          .find((e) => shown(e) && re.test(e.innerText.trim()));
        if (el && !clicked.has(re)) { clicked.add(re); (el.closest('a, button, [role="button"], [role="link"]') || el).click(); return; }
      }
      return;
    }
    // once; a second time only when Microsoft said no and a new code has come round; never a third
    const counter = Math.floor(Date.now() / 1000 / k.period);
    if (tries >= 2 || (tries === 1 && !(shown(document.querySelector(ERROR)) && counter !== lastCounter))) return;
    busy = true;
    try {
      const left = k.period - (Date.now() / 1000) % k.period;     // under 5 s left, it can roll over before Microsoft checks it
      if (left < 5) await new Promise((ok) => setTimeout(ok, left * 1000 + 300));
      if (!document.contains(field)) return;
      const code = await totp(k);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, code);   // the page's own bindings see it
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      tries++;
      lastCounter = Math.floor(Date.now() / 1000 / k.period);
      const go = first(SUBMIT);
      if (go) go.click();
    } finally {
      busy = false;
    }
  };
  setInterval(() => { tick().catch(() => {}); }, 500);
}
