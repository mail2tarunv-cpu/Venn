// Runs figma-plugin/code.js against a fake Figma API and a fake GitHub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync(__dirname + '/../figma-plugin/code.js', 'utf8');
const SHA = 'a'.repeat(40);
const TOKENS = {
  radius: { button: { $type: 'number', $value: 12 } },
  spacing: { component: { $type: 'number', $value: 12 } },
  action: { primary: { $type: 'color', $value: '#008254' } },
  text: { primary: { $type: 'color', $value: '#202020' } },
  extra: { token: { $type: 'number', $value: 4 } },
};

function setup({ radius = 2, head = SHA, alias = false } = {}) {
  const messages = [];
  const writes = [];
  let headSha = head;
  const mk = (id, name, type, value) => ({
    id, name, resolvedType: type, variableCollectionId: 'coll', valuesByMode: { mode: value },
    setValueForMode(mode, v) { writes.push([name, v]); this.valuesByMode[mode] = v; },
  });
  const vars = [
    mk('v1', 'radius/button', 'FLOAT', radius),
    mk('v2', 'spacing/component', 'FLOAT', 12),
    mk('v3', 'action/primary', 'COLOR', { r: 0, g: 0x82 / 255, b: 0x54 / 255, a: 1 }),
    mk('v4', 'text/primary', 'COLOR', alias ? { type: 'VARIABLE_ALIAS', id: 'x' } : { r: 0, g: 0, b: 0, a: 1 }),
  ];
  const storage = {};
  const figma = {
    fileKey: 'FILE', root: { name: 'Test file' }, currentUser: { name: 'Test designer' },
    showUI() {}, ui: { postMessage: (m) => messages.push(m), onmessage: null },
    clientStorage: { getAsync: async (k) => storage[k], setAsync: async (k, v) => { storage[k] = v; } },
    variables: {
      getLocalVariableCollectionsAsync: async () => [{ id: 'coll', name: 'Tokens', defaultModeId: 'mode' }],
      getLocalVariablesAsync: async () => vars,
      getVariableByIdAsync: async (id) => vars.find((v) => v.id === id) || null,
    },
  };
  const fetch = async (url) => {
    if (url.startsWith('https://api.github.com/')) return { ok: true, status: 200, json: async () => [{ sha: headSha, commit: { message: 'Round buttons\n\nbody' } }] };
    if (url.startsWith('https://raw.githubusercontent.com/')) return { ok: true, status: 200, text: async () => JSON.stringify(TOKENS) };
    throw new Error('unexpected ' + url);
  };
  const ctx = { figma, __html__: '', fetch, console, Date, Error, Promise, Number, String, Array, Object, Math, JSON, parseInt, parseFloat, encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return {
    messages, writes, vars,
    moveHead: (s) => { headSha = s; },
    async send(m) { await figma.ui.onmessage(m); return messages.at(-1); },
  };
}

(async () => {
  // Opening and checking never writes; rows report every status honestly.
  const a = setup();
  const checked = await a.send({ type: 'init' });
  assert.equal(checked.type, 'checked');
  assert.equal(a.writes.length, 0, 'check must not write');
  const by = Object.fromEntries(checked.rows.map((r) => [r.name, r.status]));
  assert.deepEqual(by, { 'radius/button': 'differs', 'spacing/component': 'match', 'action/primary': 'match', 'text/primary': 'differs', 'extra/token': 'missing' });

  // Apply without consent is refused.
  assert.equal((await a.send({ type: 'apply', names: ['radius/button'], confirmed: false })).type, 'error');
  assert.equal(a.writes.length, 0);

  // Apply only the ticked row; the other difference is untouched; read-back receipt.
  await a.send({ type: 'apply', names: ['radius/button'], confirmed: true });
  const applied = a.messages.find((m) => m.type === 'applied');
  assert.ok(applied, 'applied message');
  assert.deepEqual(a.writes, [['radius/button', 12]]);
  const r = applied.receipt;
  assert.equal(r.schema, 'venn/receipt-v2');
  assert.equal(r.sourceSha, SHA);
  assert.equal(r.sourceRepo, 'mail2tarunv-cpu/penny-tokens');
  assert.deepEqual(JSON.parse(JSON.stringify(r.changes)), [{ name: 'radius/button', type: 'number', before: 2, after: 12, readBack: 12 }]);
  assert.equal(r.remainingDifferences, 1, 'text/primary was left unapplied');
  assert.equal(a.messages.at(-1).type, 'checked', 're-checks after apply');

  // Colours are converted and read back.
  await a.send({ type: 'apply', names: ['text/primary'], confirmed: true });
  assert.equal(a.messages.filter((m) => m.type === 'applied').at(-1).receipt.changes[0].readBack, '#202020');

  // A new commit after checking blocks the write.
  const b = setup();
  await b.send({ type: 'init' });
  b.moveHead('b'.repeat(40));
  const moved = await b.send({ type: 'apply', names: ['radius/button'], confirmed: true });
  assert.equal(moved.type, 'error'); assert.match(moved.message, /new commit/);
  assert.equal(b.writes.length, 0);

  // A designer edit after checking blocks the write.
  const c = setup();
  await c.send({ type: 'init' });
  c.vars[0].valuesByMode.mode = 7;
  const conflict = await c.send({ type: 'apply', names: ['radius/button'], confirmed: true });
  assert.equal(conflict.type, 'error'); assert.match(conflict.message, /changed in Figma/);
  assert.deepEqual(c.writes, []);

  // Aliases are reported, never overwritten; rows that match cannot be applied.
  const d = setup({ alias: true });
  const dc = await d.send({ type: 'init' });
  assert.equal(dc.rows.find((x) => x.name === 'text/primary').status, 'alias');
  assert.equal((await d.send({ type: 'apply', names: ['spacing/component'], confirmed: true })).type, 'error');
  assert.equal(d.writes.length, 0);

  // A failed read-back undoes every write from the run.
  const e = setup();
  await e.send({ type: 'init' });
  e.vars[3].setValueForMode = function (mode, v) { e.writes.push(['text/primary', v]); this.valuesByMode[mode] = { r: 1, g: 1, b: 1, a: 1 }; };
  const failed = await e.send({ type: 'apply', names: ['radius/button', 'text/primary'], confirmed: true });
  assert.equal(failed.type, 'error'); assert.match(failed.message, /undone/);
  assert.equal(e.vars[0].valuesByMode.mode, 2, 'radius restored');

  console.log('PASS plugin: read-only check, statuses, consent, selective apply, colour read-back, new-commit guard, conflict guard, alias guard, rollback');
})().catch((err) => { console.error(err); process.exit(1); });
