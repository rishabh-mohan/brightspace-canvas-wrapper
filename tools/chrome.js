// Chrome (and Edge) build: the same extension with a manifest Chrome accepts without warnings.
//   node tools/chrome.js <output folder> [--dev]
// --dev also runs it on the dev server (http://localhost), like tools/dev-extension.js.
const fs = require('fs');
const path = require('path');

function chromeManifest(m) {
  const out = { ...m };
  delete out.browser_specific_settings; // Firefox only
  out.background = { service_worker: 'background.js' }; // Chrome takes no background.scripts
  // Chrome caps extension storage at 10 MB without this; the saved page cache can grow past it.
  out.permissions = [...new Set([...(m.permissions || []), 'unlimitedStorage'])];
  out.minimum_chrome_version = '121';
  return out;
}

function build(out, { dev = false } = {}) {
  const src = path.join(__dirname, '..', 'extension');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(src, out, { recursive: true });
  const file = path.join(out, 'manifest.json');
  const m = chromeManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (dev) {
    m.name += ' (dev)';
    m.host_permissions.push('http://localhost/*');
    m.content_scripts[0].matches.push('http://localhost/d2l/*');
    m.content_scripts[0].exclude_matches.push('http://localhost/d2l/api/*');
  }
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  return out;
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: node tools/chrome.js <output folder> [--dev]');
    process.exit(1);
  }
  console.log(`Chrome build written to ${build(out, { dev: process.argv.includes('--dev') })}`);
}
module.exports = { build, chromeManifest };
