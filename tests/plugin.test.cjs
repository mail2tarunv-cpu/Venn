// Runs figma-plugin/code.js against a fake Figma file (two modes, aliases) and a fake GitHub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Tokens = require('../tokens.js');

const code = fs.readFileSync(__dirname + '/../figma-plugin/code.js', 'utf8');
const SHA = 'a'.repeat(40);
const TOKENS = {
  color: { $type: 'color', blue: { 600: { $value: '#1F5FD0' } }, neutral: { 0: { $value: '#FFFFFF' }, 900: { $value: '#18181B' }, 950: { $value: '#0B0B0C' } } },
  action: { primary: { $type: 'color', $value: '{color.blue.600}' } },
  background: { page: { $type: 'color', $value: '{color.neutral.0}', $extensions: { modes: { Dark: '{color.neutral.950}' } } } },
  radius: { button: { $type: 'number', $value: 12 }, card: { $type: 'number', $value: 16 } },
};
const rgb = (hex) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255, a: 1 });

function setup({ head = SHA } = {}) {
  const messages = [];
  const writes = [];
  let headSha = head;
  let nextId = 1;
  const vars = [];
  const collection = { id: 'coll', name: 'Penny 2.0', defaultModeId: 'light', modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }] };
  const mk = (name, type, light, dark) => {
    const v = {
      id: 'v' + nextId++, name, resolvedType: type, variableCollectionId: 'coll', valuesByMode: { light, dark: dark === undefined ? light : dark },
      setValueForMode(mode, value) { writes.push([name, mode, value]); this.valuesByMode[mode] = value; },
      remove() { vars.splice(vars.indexOf(this), 1); },
    };
    vars.push(v);
    return v;
  };
  // The "older version" in Figma, with the kinds of mistakes Venn should find.
  const blue = mk('color/blue/600', 'COLOR', rgb('#1F5FD0'));
  const n0 = mk('color/neutral/0', 'COLOR', rgb('#FFFFFF'));
  mk('color/neutral/900', 'COLOR', rgb('#202020'));                      // stale value: code says #18181B
  // color/neutral/950 is missing: Venn should offer to create it
  mk('action/primary', 'COLOR', rgb('#008254'));                         // hardcoded old green: code aliases blue
  mk('background/page', 'COLOR', { type: 'VARIABLE_ALIAS', id: n0.id }, rgb('#FFFFFF')); // Light right, Dark wrong
  mk('radius/button', 'FLOAT', 2);                                       // stale
  // radius/card missing
  mk('shadow/opacity', 'FLOAT', 0.12);                                   // in Figma, not in code
  void blue;

  const figma = {
    fileKey: 'FILE', root: { name: 'Test file' }, currentUser: { name: 'Test designer' },
    opened: [], openExternal(u) { this.opened.push(u); },
    showUI() {}, ui: { postMessage: (m) => messages.push(m), onmessage: null },
    clientStorage: { getAsync: async () => ({ collection: 'Penny 2.0' }), setAsync: async () => {} },
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getVariableCollectionByIdAsync: async (id) => (id === 'coll' ? collection : null),
      getLocalVariablesAsync: async () => vars.slice(),
      getVariableByIdAsync: async (id) => vars.find((v) => v.id === id) || null,
      createVariable(name, coll, type) { const v = mk(name, type, undefined); v.valuesByMode = {}; return v; },
      createVariableAlias(v) { return { type: 'VARIABLE_ALIAS', id: v.id }; },
    },
  };
  const fetch = async (url) => {
    if (url.startsWith('https://api.github.com/')) return { ok: true, status: 200, json: async () => [{ sha: headSha, commit: { message: 'Penny 2.0\n\nbody' } }] };
    if (url.startsWith('https://raw.githubusercontent.com/')) return { ok: true, status: 200, text: async () => JSON.stringify(TOKENS) };
    throw new Error('unexpected ' + url);
  };
  const ctx = { figma, __html__: '', fetch, console, Date, Error, Promise, Number, String, Array, Object, Math, JSON, Map, Set, parseInt, parseFloat, encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return {
    messages, writes, vars, figma, ctx,
    get: (name) => vars.find((v) => v.name === name),
    moveHead: (s) => { headSha = s; },
    async send(m) { await figma.ui.onmessage(m); return messages.at(-1); },
  };
}
const statusOf = (rows) => Object.fromEntries(rows.filter((r) => !r.implicit).map((r) => [r.key, r.status]));

(async () => {
  // The plugin's token rules are the same as the site's.
  const p = setup();
  assert.deepEqual(JSON.parse(JSON.stringify(p.ctx.flatten(TOKENS))), Tokens.flatten(TOKENS), 'plugin and site parse tokens identically');

  // Checking reads every mode and finds every kind of mistake, without writing.
  const a = setup();
  const checked = await a.send({ type: 'init' });
  assert.equal(checked.type, 'checked', JSON.stringify(checked));
  assert.equal(a.writes.length, 0, 'check must not write');
  assert.deepEqual(statusOf(checked.rows), {
    'action/primary': 'differs',            // hardcoded value where code uses an alias
    'background/page': 'match',             // Light already aliased correctly
    'background/page@Dark': 'differs',      // Dark mode wrong
    'color/blue/600': 'match',
    'color/neutral/0': 'match',
    'color/neutral/900': 'differs',         // stale value
    'color/neutral/950': 'missing',
    'radius/button': 'differs',
    'radius/card': 'missing',
    'shadow/opacity': 'extra',              // reported, never deleted
  });
  assert.equal(checked.modes.join(','), 'Light,Dark');

  // An alias to a variable that does not exist yet must be ticked together with it.
  const lonely = await a.send({ type: 'apply', names: ['background/page@Dark'], confirmed: true });
  assert.equal(lonely.type, 'error'); assert.match(lonely.message, /color\/neutral\/950/);
  assert.equal(a.get('color/neutral/950'), undefined, 'the half-made run was undone');
  assert.deepEqual(a.get('background/page').valuesByMode.dark, rgb('#FFFFFF'));

  // Fix everything in one run: create, re-point aliases, update values, Dark mode included.
  const all = checked.rows.filter((r) => (r.status === 'differs' || r.status === 'missing') && !r.follows).map((r) => r.key);
  assert.ok(checked.rows.some((r) => r.follows === 'color/neutral/950'), 'Dark mode of a new primitive rides along');
  await a.send({ type: 'apply', names: all, confirmed: true });
  const applied = a.messages.find((m) => m.type === 'applied');
  assert.ok(applied, 'applied: ' + JSON.stringify(a.messages.at(-1)));
  const r = applied.receipt;
  assert.equal(r.remainingDifferences, 0);
  assert.equal(r.changes.length, 6);
  for (const c of r.changes) assert.equal(c.readBack, c.after, c.name);
  const by = Object.fromEntries(r.changes.map((c) => [c.name + (c.mode ? '@' + c.mode : ''), c]));
  assert.equal(by['action/primary'].after, '{color/blue/600}');
  assert.equal(by['action/primary'].before, '#008254');
  assert.equal(by['color/neutral/950'].kind, 'created');
  assert.equal(by['background/page@Dark'].after, '{color/neutral/950}');
  assert.equal(a.get('action/primary').valuesByMode.light.type, 'VARIABLE_ALIAS', 'written as a real alias');
  assert.equal(a.get('radius/card').valuesByMode.light, 16);
  assert.equal(a.get('radius/card').valuesByMode.dark, 16, 'every mode gets the value');
  assert.equal(a.get('radius/button').valuesByMode.dark, 12);
  assert.ok(a.get('shadow/opacity'), 'extra variables are never deleted');
  const after = a.messages.at(-1);
  assert.equal(after.type, 'checked');
  assert.ok(after.rows.every((x) => x.status === 'match' || x.status === 'extra'), 'everything matches after the run');

  // Consent is required; a new commit or a designer edit after the check blocks the write.
  const b = setup();
  await b.send({ type: 'init' });
  assert.equal((await b.send({ type: 'apply', names: ['radius/button'], confirmed: false })).type, 'error');
  b.moveHead('b'.repeat(40));
  const moved = await b.send({ type: 'apply', names: ['radius/button'], confirmed: true });
  assert.match(moved.message, /new commit/);
  const c = setup();
  await c.send({ type: 'init' });
  c.get('radius/button').valuesByMode.light = 7;
  assert.match((await c.send({ type: 'apply', names: ['radius/button'], confirmed: true })).message, /changed in Figma/);
  assert.equal(b.writes.length + c.writes.length, 0);

  // A failed read-back undoes the whole run, including created variables.
  const e = setup();
  await e.send({ type: 'init' });
  e.get('radius/button').setValueForMode = function (mode) { this.valuesByMode[mode] = 99; };
  const failed = await e.send({ type: 'apply', names: ['radius/card', 'radius/button'], confirmed: true });
  assert.match(failed.message, /undone/);
  assert.equal(e.get('radius/card'), undefined, 'created variable removed');

  // Record in Venn only opens the Venn site with a receipt.
  const f = setup();
  await f.send({ type: 'open', url: 'https://venn-peach-eight.vercel.app/#receipt=abc' });
  assert.deepEqual(f.figma.opened, ['https://venn-peach-eight.vercel.app/#receipt=abc']);
  assert.equal((await f.send({ type: 'open', url: 'https://evil.example/#receipt=abc' })).type, 'error');

  console.log('PASS plugin: same token rules as site, read-only check, modes, aliases, missing and extra variables, fix-everything run with read-back, consent, new-commit and conflict guards, full rollback, record-link guard');
})().catch((err) => { console.error(err); process.exit(1); });
