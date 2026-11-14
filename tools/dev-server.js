// Development server: runs the extension's content scripts against a made-up Brightspace,
// so the interface can be opened in any browser without signing in.
//   node tools/dev-server.js [port]      then open http://localhost:8765/d2l/home
// Any /d2l/... page address works (course homes, grades, and so on). Add ?bsxtheme=dark
// to preset the theme, or ?bsxdash=list|activity to preset the dashboard view.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle, gradescope } = require('./fake-brightspace');
const statuses = []; // what pages reported back about themselves (see the page script below)

const ext = path.join(__dirname, '..', 'extension');
const port = Number(process.argv[2]) || 8765;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// `real` is for a browser that has the extension itself loaded (tools/dev-extension.js):
// the page then leaves the scripts to the extension.
function page(real) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  const scripts = real ? '' : manifest.content_scripts[0].js.map((f) => `<script src="/ext/${f}"></script>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fake Brightspace</title>
<style>body{margin:0;font:16px sans-serif;background:#eee}.banner{position:fixed;top:0;left:20%;right:20%;z-index:1000;background:#444;color:#fff;padding:24px;font-size:28px}</style>
</head><body><div class="banner">Original Brightspace page</div><p style="padding:120px 40px">This stands in for the page the wrapper covers.</p>
<script>
// Stand-in for extension storage, backed by localStorage.
(() => {
  const q = new URLSearchParams(location.search);
  if (q.get('bsxframe')) window.BSX_DEV_FRAME = true; // phone-width preview, see /__phone
  const preset = { theme: q.get('bsxtheme'), dash: q.get('bsxdash'), gradescope: q.get('bsxgs') ? true : null };
  const any = preset.theme || preset.dash || preset.gradescope;
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  // When the real extension is loaded (tools/dev-extension.js) it has its own storage and
  // background script; these stand-ins are only for the plain page.
  if (!q.get('bsxreal')) window.chrome = {
    storage: { local: {
      get: async (k) => { const v = read(k) || (any ? {} : null); if (v) for (const p of Object.keys(preset)) if (preset[p]) v[p] = preset[p]; return { [k]: v }; },
      set: async (o) => { for (const k of Object.keys(o)) localStorage.setItem(k, JSON.stringify(o[k])); },
    } },
    // Stand-in for the background script's Gradescope fetch.
    runtime: { sendMessage: async (msg) => {
      const res = await fetch('/__gradescope' + msg.path);
      return res.ok ? { status: 200, url: 'https://www.gradescope.com' + msg.path, html: await res.text() } : { status: 200, url: 'https://www.gradescope.com/login', html: '' };
    } },
  };
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
    // Also tell the server, so browsers that cannot dump the page (Firefox) can be checked.
    navigator.sendBeacon('/__status', JSON.stringify({ page: location.pathname + location.search + location.hash, status: document.documentElement.getAttribute('data-bsx-status'), styled: r ? getComputedStyle(r.querySelector('.rail') || document.body).display : '', browser: navigator.userAgent }));
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
    if (url.pathname === '/__status') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            statuses.push(JSON.parse(body));
          } catch {}
          send(204, 'text/plain', '');
        });
        return undefined;
      }
      const out = JSON.stringify(statuses, null, 2);
      if (url.searchParams.get('clear')) statuses.length = 0;
      return send(200, 'application/json', out);
    }
    // Phone-width preview: /__phone?w=390&to=<page address>. Headless browsers will not make a
    // window that narrow, so the page is shown in a frame of that width instead.
    if (url.pathname === '/__phone') {
      const to = url.searchParams.get('to') || '/d2l/home#/';
      const [before, hash] = to.split('#');
      const src = `${before}${before.includes('?') ? '&' : '?'}bsxframe=1${hash != null ? `#${hash}` : ''}`;
      const w = Number(url.searchParams.get('w')) || 390;
      return send(200, 'text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888"><iframe src="${src.replace(/"/g, '&quot;')}" style="width:${w}px;height:100vh;border:0;display:block;background:#fff"></iframe></body>`);
    }
    if (url.pathname.startsWith('/__gradescope/')) {
      const html = url.searchParams.get('signedout') ? null : gradescope(url.pathname.slice('/__gradescope'.length));
      return html ? send(200, 'text/html; charset=utf-8', html) : send(404, 'text/plain', 'Not found');
    }
    const api = handle(url.pathname, url.searchParams);
    if (api) return send(api.status, api.type, api.body);
    if (url.pathname.startsWith('/ext/')) {
      const file = path.normalize(path.join(ext, url.pathname.slice(5)));
      if (!file.startsWith(ext) || !fs.existsSync(file)) return send(404, 'text/plain', 'Not found');
      return send(200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
    }
    if (url.pathname.startsWith('/d2l/')) return send(200, 'text/html; charset=utf-8', page(url.searchParams.has('bsxreal')));
    return send(302, 'text/plain', '', res.setHeader('Location', '/d2l/home'));
  })
  .listen(port, () => console.log(`Fake Brightspace on http://localhost:${port}/d2l/home`));
