// Colours are variables on .app so the theme can switch. data-theme is auto, light or dark.
(() => {
  const DARK = `
  --bg: #1b1f23; --fg: #e6e9eb; --muted: #9aa5ad; --link: #5bb3e4; --line: #3a4249; --line2: #2c3338;
  --soft: #252b30; --soft2: #2f373d; --bad: #ff8a80; --ok: #5fd08f; --hi: #17384a;
  --rail: #12161a; --rail-hover: #0b0e11; --rail-on-bg: #1b1f23; --rail-on-fg: #5bb3e4; color-scheme: dark;`;

  BSX.styles = `
:host { all: initial; }
* { box-sizing: border-box; }
.app {
  --bg: #fff; --fg: #2d3b45; --muted: #6b7780; --link: #0374b5; --line: #c7cdd1; --line2: #e8eaec;
  --soft: #f5f5f5; --soft2: #e8eaec; --bad: #b3261e; --ok: #0b874b; --hi: #e5f2f8;
  --rail: #2d3b45; --rail-hover: #243038; --rail-on-bg: #fff; --rail-on-fg: #0374b5; color-scheme: light;
  position: fixed; top: 0; left: 0; width: 100vw; max-width: 100%; height: 100vh; overflow: hidden; z-index: 2147483647;
  display: flex; background: var(--bg); color: var(--fg);
  font: 15px/1.45 Lato, "Helvetica Neue", Helvetica, Arial, sans-serif; }
.app[data-theme="dark"] {${DARK} }
@media (prefers-color-scheme: dark) { .app[data-theme="auto"] {${DARK} } }

a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
button { font: inherit; cursor: pointer; }
.ok { color: var(--ok); }
.bad { color: var(--bad); }
.linkc { color: var(--link); }

.rail { width: 84px; flex: none; background: var(--rail); display: flex; flex-direction: column; align-items: stretch; padding-top: 10px; }
.rail a, .rail button { display: block; padding: 12px 4px; text-align: center; color: #fff; font-size: 12.5px;
  background: none; border: 0; border-left: 3px solid transparent; }
.rail a:hover, .rail button:hover { background: var(--rail-hover); text-decoration: none; }
.rail a.on { background: var(--rail-on-bg); color: var(--rail-on-fg); }
.rail .glyph { display: block; font-size: 20px; line-height: 1.2; }
.rail .gap { flex: 1; }

.main { flex: 1; overflow: auto; min-width: 0; }
.head { display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-bottom: 1px solid var(--line); }
.head h1 { font-size: 22px; font-weight: 400; margin: 0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head .stamp { color: var(--muted); font-size: 13px; white-space: nowrap; }
.btn { padding: 6px 12px; border: 1px solid var(--line); border-radius: 4px; background: var(--soft); color: var(--fg); }
.btn:hover { background: var(--soft2); }
.body { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
.grow { flex: 1; min-width: 0; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 24px; }
.card { border: 1px solid var(--line); border-radius: 4px; overflow: hidden; background: var(--bg); box-shadow: 0 1px 3px rgba(0,0,0,.12); position: relative; }
.card .hero { display: block; height: 130px; position: relative; overflow: hidden; }
.card .hero img { width: 100%; height: 100%; object-fit: cover; opacity: .45; display: block; }
.card .more { position: absolute; top: 6px; right: 6px; width: 30px; height: 30px; border-radius: 15px; border: 0;
  background: rgba(0,0,0,.35); color: #fff; font-size: 18px; line-height: 1; }
.card .more:hover { background: rgba(0,0,0,.6); }
.card .text { padding: 12px 14px 4px; }
.card .name { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--c); color: color-mix(in srgb, var(--c) 60%, var(--fg)); }
.card .code { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .links { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 8px 14px 12px; font-size: 13.5px; }
.card .edit { padding: 12px 14px; display: grid; gap: 10px; }
.card .edit label { font-size: 13px; color: var(--muted); display: grid; gap: 4px; }
input.txt { width: 100%; padding: 5px 8px; font: inherit; border: 1px solid var(--line); border-radius: 4px; color: var(--fg); background: var(--bg); }
.swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.sw { width: 24px; height: 24px; border-radius: 12px; border: 2px solid transparent; padding: 0; }
.sw.on { border-color: var(--fg); box-shadow: inset 0 0 0 2px var(--bg); }
.row { display: flex; gap: 8px; }

.side { width: 300px; flex: none; }
.side h2 { font-size: 15px; font-weight: 700; margin: 0 0 6px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.side section { margin-bottom: 24px; }
.todo { padding: 8px 0; border-bottom: 1px solid var(--line2); }
.todo .t { display: block; font-weight: 700; }
.todo .m { color: var(--muted); font-size: 13px; }
.todo.late .m b { color: var(--bad); font-weight: 400; }
.muted { color: var(--muted); }
.small { font-size: 13px; }

.cnav { width: 190px; flex: none; }
.cnav a { display: block; padding: 7px 10px; border-left: 2px solid transparent; }
.cnav a.on { color: var(--fg); border-left-color: var(--fg); font-weight: 700; }
.cnav .sep { margin: 10px 0 4px; padding: 0 10px; color: var(--muted); font-size: 12.5px; text-transform: uppercase; letter-spacing: .04em; }

table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line2); vertical-align: top; }
th { font-size: 13px; color: var(--muted); font-weight: 700; border-bottom-color: var(--line); }
td.num, th.num { text-align: right; white-space: nowrap; }
tr.group td { background: var(--soft); font-weight: 700; }
.note { color: var(--muted); font-size: 13px; margin-top: 2px; white-space: pre-wrap; }
.total { border: 1px solid var(--line); border-radius: 4px; padding: 12px 16px; margin-bottom: 20px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.total .big { font-size: 22px; font-weight: 700; }
.tag { display: inline-block; font-size: 12px; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--line); color: var(--muted); margin-left: 6px; font-weight: 400; }

.list h2 { font-size: 15px; font-weight: 700; margin: 0; padding: 10px 12px; background: var(--soft); border: 1px solid var(--line); }
.list { margin-bottom: 20px; }
.item { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-top: 0; }
.item .mid { flex: 1; min-width: 0; }
.item .mid a { font-weight: 700; }

input.wi { width: 84px; padding: 3px 6px; font: inherit; text-align: right; border: 1px solid var(--line); border-radius: 4px; color: var(--fg); background: var(--bg); }
input.wi.changed { border-color: var(--link); background: var(--hi); }

.post { border: 1px solid var(--line); border-radius: 4px; padding: 14px 18px; margin-bottom: 16px; }
.post h2 { font-size: 17px; font-weight: 700; margin: 0 0 2px; }
.prose { margin-top: 10px; overflow-wrap: anywhere; }
.prose p { margin: 0 0 10px; }
.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 { font-size: 15px; font-weight: 700; margin: 12px 0 6px; }
.prose table { width: auto; }
.prose pre { white-space: pre-wrap; }

.module { margin-bottom: 14px; }
.module summary { cursor: pointer; font-weight: 700; padding: 10px 12px; background: var(--soft); border: 1px solid var(--line); }

.calnav { display: flex; gap: 6px; }
.calnav a { text-decoration: none; }
.cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-left: 1px solid var(--line); border-top: 1px solid var(--line); }
.cal .dow { padding: 6px 8px; font-size: 13px; font-weight: 700; color: var(--muted); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.cal .day { min-height: 104px; padding: 4px 5px 6px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.cal .day.other { background: var(--soft); }
.cal .dnum { font-size: 13px; color: var(--muted); margin-bottom: 3px; }
.cal .day.today .dnum { color: #fff; background: #0374b5; display: inline-block; min-width: 22px; text-align: center; border-radius: 11px; padding: 0 5px; }
.cal .event { display: block; font-size: 12.5px; line-height: 1.3; margin-bottom: 3px; padding: 1px 4px; border-left: 3px solid var(--muted); color: var(--fg);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal .etime { color: var(--muted); }

.msg { padding: 24px; color: var(--muted); }
.error { margin: 24px; padding: 14px 16px; border: 1px solid var(--bad); border-radius: 4px; color: var(--bad); }
.pill { position: fixed; z-index: 2147483647; left: 12px; bottom: 12px; padding: 7px 14px; border-radius: 18px; border: 1px solid #2d3b45;
  background: #2d3b45; color: #fff; font: 13px/1.2 Lato, "Helvetica Neue", Helvetica, Arial, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.3); }

@media (max-width: 900px) {
  .body { flex-direction: column; }
  .side, .cnav { width: 100%; }
}
`;
})();
