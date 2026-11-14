// Makes a copy of the extension that also runs on the dev server (http://localhost), so the
// real extension - isolated content scripts, real storage, real background script - can be
// loaded into a browser and pointed at the made-up Brightspace.
//   node tools/dev-extension.js <output folder>
// Then open pages with ?bsxreal=1, e.g. http://localhost:8765/d2l/home?bsxreal=1
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) {
  console.error('Usage: node tools/dev-extension.js <output folder>');
  process.exit(1);
}
const src = path.join(__dirname, '..', 'extension');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
const file = path.join(out, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.name += ' (dev)';
manifest.host_permissions.push('http://localhost/*');
manifest.content_scripts[0].matches.push('http://localhost/d2l/*');
manifest.content_scripts[0].exclude_matches.push('http://localhost/d2l/api/*');
fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
console.log(`Dev copy written to ${out}`);
