// What kind of row each of the student's grades is (app/d2l.py, via
// `hub-brightspace gradetypes`). Read-only.
//
// brightspace-mcp-server's get_my_grades lists category totals ("Homeworks
// 57.5 / 120"), calculated and final grades next to real items, with nothing
// to tell them apart, so the syllabus math counted totals as assignments
// (GEO 105 showed a wrong percent on 10/10). Brightspace's GradeObjectType says which is
// which: 1 numeric, 2 pass/fail, 3 select box, 4 text, 5 calculated,
// 6 formula, 7 final calculated, 8 final adjusted, 9 category.
//
// stdin:  one JSON line, [999003, 999003, ...] (course org units)
// stdout: one JSON line, [{"ou", "ok", "items": [{"id", "type"}]}, ...]
import { createInterface } from "node:readline";

const B = "/opt/brightspace-mcp/build";
const { loadConfig } = await import(`${B}/utils/config.js`);
const { TokenManager } = await import(`${B}/auth/index.js`);
const { D2LApiClient } = await import(`${B}/api/index.js`);

const line = await new Promise((ok) => createInterface({ input: process.stdin }).once("line", ok));
const courses = JSON.parse(line || "[]");
const config = await loadConfig();
const tokenManager = new TokenManager({ sessionDir: config.sessionDir, baseUrl: config.baseUrl, tokenTtl: config.tokenTtl });
const api = new D2LApiClient({ baseUrl: config.baseUrl, tokenManager });

const out = [];
for (const ou of courses) {
  try {
    const raw = await api.get(api.le(ou, "/grades/values/myGradeValues/"));
    const values = Array.isArray(raw) ? raw : raw?.Objects ?? [];
    out.push({ ou, ok: true, items: values.map((v) => ({ id: String(v.GradeObjectIdentifier), type: v.GradeObjectType })) });
  } catch (error) {
    out.push({ ou, ok: false, why: error?.status ? `HTTP ${error.status}` : "no answer" });
  }
}
process.stdout.write(JSON.stringify(out) + "\n");
