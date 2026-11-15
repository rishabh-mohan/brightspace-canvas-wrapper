// Sets the extension's version: node tools/version.js 1.3.2
// Writes manifest.json as plain UTF-8 (no byte-order mark), which browsers require.
const fs = require('fs');
const path = require('path');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node tools/version.js <major.minor.patch>');
  process.exit(1);
}
const file = path.join(__dirname, '..', 'extension', 'manifest.json');
const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
const next = text.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
JSON.parse(next);
fs.writeFileSync(file, next);
console.log(`manifest version ${version}`);
