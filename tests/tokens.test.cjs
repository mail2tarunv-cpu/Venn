const assert = require('node:assert/strict');
const { flatten, diff } = require('../tokens.js');

// Basics: colours, dimensions, unsupported types skipped, group-level $type inherited.
const a = flatten({ radius: { button: { $type: 'number', $value: 2 } }, c: { x: { $type: 'color', $value: '#abc' } }, d: { $type: 'dimension', $value: '8px' }, skip: { $type: 'fontFamily', $value: 'Inter' }, g: { $type: 'number', inner: { $value: 4 } } });
assert.deepEqual(a['radius/button'], { token: 'radius/button', mode: null, type: 'number', value: 2 });
assert.equal(a['c/x'].value, '#AABBCC');
assert.equal(a.d.value, 8);
assert.equal(a['g/inner'].value, 4, 'group $type is inherited');
assert.ok(!a.skip);

// Aliases resolve through chains, and keep what they point at.
const tree = {
  color: { $type: 'color', blue: { 600: { $value: '#1f5fd0' } }, neutral: { 0: { $value: '#fff' }, 950: { $value: '#0b0b0c' } } },
  brand: { $type: 'color', $value: '{color.blue.600}' },
  action: { primary: { $type: 'color', $value: '{brand}', $extensions: { modes: { Dark: '{color.neutral.0}' } } } },
  loop: { $type: 'color', $value: '{loop}' },
};
const f = flatten(tree);
assert.deepEqual(f['action/primary'], { token: 'action/primary', mode: null, type: 'color', value: '#1F5FD0', alias: 'brand' });
assert.deepEqual(f['action/primary@Dark'], { token: 'action/primary', mode: 'Dark', type: 'color', value: '#FFFFFF', alias: 'color/neutral/0' });
assert.ok(!f.loop, 'alias cycles are dropped, not crashed on');

// Diff: value changes, alias-only changes, added, removed, per mode.
const b = flatten({ ...tree, action: { primary: { $type: 'color', $value: '{color.blue.600}', $extensions: { modes: { Dark: '{color.neutral.950}' } } } }, extra: { $type: 'number', $value: 1 } });
const changes = diff(f, b);
const by = Object.fromEntries(changes.map((c) => [c.name, c]));
assert.equal(by['action/primary'].kind, 'changed', 'same value through a different alias still counts');
assert.equal(by['action/primary'].afterAlias, 'color/blue/600');
assert.equal(by['action/primary@Dark'].after, '#0B0B0C');
assert.equal(by['action/primary@Dark'].mode, 'Dark');
assert.equal(by.extra.kind, 'added');
assert.equal(changes.length, 3);
// Pointing at the same token is not a change, even if that token's own value moved.
const p1 = flatten({ c: { $type: 'color', n: { $value: '#202020' } }, t: { $type: 'color', $value: '{c.n}' } });
const p2 = flatten({ c: { $type: 'color', n: { $value: '#18181b' } }, t: { $type: 'color', $value: '{c.n}' } });
assert.deepEqual(diff(p1, p2).map((x) => x.name), ['c/n']);
console.log('PASS tokens: colours, dimensions, inherited types, aliases and chains, cycles, modes, alias-aware diff');
