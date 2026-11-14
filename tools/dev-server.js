// Development server: runs the extension's content scripts against a made-up Brightspace,
// so the interface can be opened in any browser without signing in.
//   node tools/dev-server.js [port]      then open http://localhost:8765/d2l/home
// Any /d2l/... page address works (course homes, grades, and so on). Add ?bsxtheme=dark
// to preset the theme, or ?bsxdash=list|activity to preset the dashboard view.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle } = require('./fake-brightspace');

const ext = path.join(__dirname, '..', 'extension');
const port = Number(process.argv[2]) || 8765;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function page() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts[0].js.map((f) => `<script src="/ext/${f}"></script>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fake Brightspace</title>
<style>body{margin:0;font:16px sans-serif;background:#eee}.banner{position:fixed;top:0;left:20%;right:20%;z-index:1000;background:#444;color:#fff;padding:24px;font-size:28px}</style>
</head><body><div class="banner">Original Brightspace page</div><p style="padding:120px 40px">This stands in for the page the wrapper covers.</p>
<script>
// Stand-in for extension storage, backed by localStorage.
(() => {
  const q = new URLSearchParams(location.search);
  const preset = { theme: q.get('bsxtheme'), dash: q.get('bsxdash') };
  const any = preset.theme || preset.dash;
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  window.chrome = { storage: { local: {
    get: async (k) => { const v = read(k) || (any ? {} : null); if (v && preset.theme) v.theme = preset.theme; if (v && preset.dash) v.dash = preset.dash; return { [k]: v }; },
    set: async (o) => { for (const k of Object.keys(o)) localStorage.setItem(k, JSON.stringify(o[k])); },
  } } };
  // Scripted steps inside the wrapper once it has loaded, for screenshots and checks:
  //   ?bsxclick=<selector>                       one click
  //   ?bsxdo=click:<sel>|type:<sel>=<text>|...   several steps in order
  const root = () => document.getElementById('bsx-root')?.shadowRoot;
  const steps = (q.get('bsxdo') || '').split('|').filter(Boolean);
  if (q.get('bsxclick')) steps.unshift('click:' + q.get('bsxclick'));
  steps.forEach((step, i) => setTimeout(() => {
    const verb = step.slice(0, step.indexOf(':'));
    const rest = step.slice(step.indexOf(':') + 1);
    if (verb === 'click') root()?.querySelector(rest)?.click();
    if (verb === 'type') {
      const el = root()?.querySelector(rest.slice(0, rest.lastIndexOf('=')));
      if (el) { el.value = rest.slice(rest.lastIndexOf('=') + 1); el.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  }, 2500 + i * 400));
  // After everything settles, record on <html> whether the page rendered, so a headless
  // --dump-dom run can check it (the wrapper itself lives in a shadow root).
  setTimeout(() => {
    const r = root();
    const err = r?.querySelector('.error');
    const content = r?.querySelector('.content');
    document.documentElement.setAttribute('data-bsx-status', !r ? 'missing' : err ? 'error: ' + err.textContent : content && content.textContent.trim().length > 20 ? 'ok' : r.querySelector('.pill') ? 'off' : 'empty');
    document.documentElement.setAttribute('data-bsx-text', (r?.querySelector('.app')?.textContent || '').replace(/\\s+/g, ' ').slice(0, 20000));
  }, 2500 + steps.length * 400 + 1500);
})();
</script>
${scripts}
</body></html>`;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    const api = handle(url.pathname, url.searchParams);
    if (api) return send(api.status, api.type, api.body);
    if (url.pathname.startsWith('/ext/')) {
      const file = path.normalize(path.join(ext, url.pathname.slice(5)));
      if (!file.startsWith(ext) || !fs.existsSync(file)) return send(404, 'text/plain', 'Not found');
      return send(200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
    }
    if (url.pathname.startsWith('/d2l/')) return send(200, 'text/html; charset=utf-8', page());
    return send(302, 'text/plain', '', res.setHeader('Location', '/d2l/home'));
  })
  .listen(port, () => console.log(`Fake Brightspace on http://localhost:${port}/d2l/home`));
