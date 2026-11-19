// Copies the shared token parser from tokens.js into figma-plugin/code.js (between the BEGIN/END TOKENS
// markers) so the plugin reads tokens exactly like the website, then rebuilds figma-plugin.zip.
// Run: npm run build:plugin   ·   Check only: node scripts/build-plugin.cjs --check
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const tokens = fs.readFileSync(path.join(root, 'tokens.js'), 'utf8');
const body = tokens.slice(tokens.indexOf("'use strict';") + "'use strict';".length, tokens.indexOf('  const api = {')).replace(/^\n+/, '');
const codePath = path.join(root, 'figma-plugin/code.js');
const code = fs.readFileSync(codePath, 'utf8');
const start = code.indexOf('/* BEGIN TOKENS (generated from tokens.js by scripts/build-plugin.cjs; do not edit) */');
const end = code.indexOf('/* END TOKENS */');
if (start === -1 || end === -1) throw new Error('Token markers missing in figma-plugin/code.js');
const header = code.slice(start, code.indexOf('\n', start) + 1);
const next = code.slice(0, start) + header + body + code.slice(end);

if (process.argv.includes('--check')) {
  if (next !== code) { console.error('figma-plugin/code.js is out of date. Run: npm run build:plugin'); process.exit(1); }
  console.log('PASS plugin build: token parser in sync with tokens.js');
} else {
  fs.writeFileSync(codePath, next);
  try { fs.unlinkSync(path.join(root, 'figma-plugin.zip')); } catch (e) { /* first build */ }
  execFileSync('zip', ['-qrX', 'figma-plugin.zip', 'figma-plugin'], { cwd: root });
  console.log('Built figma-plugin/code.js and figma-plugin.zip');
}
