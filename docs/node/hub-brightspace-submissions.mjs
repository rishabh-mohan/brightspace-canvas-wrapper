// Brightspace's own record of what the student turned in (app/d2l.py, via
// `hub-brightspace submissions`). Read-only.
//
// brightspace-mcp-server's get_assignments says "submitted" whenever the
// mysubmissions list has an entry: it reads that list one level too high
// (each entry is an EntityDropbox whose Submissions hold the dates and files),
// so it can't tell an Unsubmitted or Draft entry from real work, and never
// has the time or the files. This asks the same endpoint with the package's
// own API client and session and reports what is really there.
//
// stdin:  one JSON line, [{"ou": 999003, "folder": 999003}, ...]
// stdout: one JSON line, [{"ou", "folder", "ok", "status", "at", "files"}, ...]
//   status: 0 Unsubmitted, 1 Submitted, 2 Draft, 3 Published (feedback out);
//   404 is Brightspace's "nothing submitted" (status 0). ok:false = couldn't tell.
import { createInterface } from "node:readline";

const B = "/opt/brightspace-mcp/build";
const { loadConfig } = await import(`${B}/utils/config.js`);
const { TokenManager } = await import(`${B}/auth/index.js`);
const { D2LApiClient } = await import(`${B}/api/index.js`);

const line = await new Promise((ok) => createInterface({ input: process.stdin }).once("line", ok));
const wanted = JSON.parse(line || "[]");
const config = await loadConfig();
const tokenManager = new TokenManager({ sessionDir: config.sessionDir, baseUrl: config.baseUrl, tokenTtl: config.tokenTtl });
const api = new D2LApiClient({ baseUrl: config.baseUrl, tokenManager });

const out = [];
for (const { ou, folder } of wanted) {
  try {
    const raw = await api.get(api.le(ou, `/dropbox/folders/${folder}/submissions/mysubmissions/`));
    const entries = Array.isArray(raw) ? raw : raw?.Objects ?? [];
    const subs = entries.flatMap((e) => e.Submissions ?? []);
    const latest = subs.map((s) => s.SubmissionDate).filter(Boolean).sort().at(-1) ?? null;
    out.push({
      ou, folder, ok: true,
      status: Math.max(0, ...entries.map((e) => (typeof e.Status === "number" ? e.Status : 0))),
      at: latest,
      files: subs.flatMap((s) => (s.Files ?? []).map((f) => f.FileName)).slice(0, 20),
    });
  } catch (error) {
    out.push(error?.status === 404
      ? { ou, folder, ok: true, status: 0, at: null, files: [] }
      : { ou, folder, ok: false, why: error?.status ? `HTTP ${error.status}` : "no answer" });
  }
}
process.stdout.write(JSON.stringify(out) + "\n");
