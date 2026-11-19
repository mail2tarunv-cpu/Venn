const assert = require('node:assert/strict');
const { flatten, diff, matchKey } = require('../tokens.js');

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
// Other formats teams use.
const sd = flatten({ colors: { font: { base: { value: '#111111', type: 'color' }, inverse: { base: { value: '{colors.font.base}' } } } }, size: { padding: { value: '1rem', type: 'spacing' } } });
assert.equal(sd['colors/font/base'].value, '#111111', 'Style Dictionary value/type');
assert.equal(sd['colors/font/inverse/base'].alias, 'colors/font/base');
assert.equal(sd['size/padding'].value, 16, 'rem becomes px');
const w3c25 = flatten({ c: { $type: 'color', g: { $value: { colorSpace: 'srgb', components: [0, 0.5, 1] } }, shadow: { $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5 } } }, r: { $type: 'dimension', $value: { value: 0.5, unit: 'rem' } } });
assert.equal(w3c25['c/g'].value, '#0080FF', 'W3C 2025.10 colour objects');
assert.ok(!w3c25['c/shadow'], 'transparent colours are skipped, not misread');
assert.equal(w3c25.r.value, 8);
const misc = flatten({ a: { $value: 'rgb(255, 0, 0)' }, b: { $value: '#00ff00ff' }, c: { $value: '#00000026' }, d: { $value: '12' }, e: { $type: 'fontFamily', $value: 'Inter' }, t: { $type: 'typography', $value: { fontSize: '16px' } } });
assert.equal(misc.a.value, '#FF0000'); assert.equal(misc.b.value, '#00FF00'); assert.ok(!misc.c); assert.equal(misc.d.value, 12, 'type guessed when missing');
assert.ok(!misc.e && !misc.t, 'non-colour, non-number types are skipped');
const studio = flatten({ $metadata: { tokenSetOrder: ['global', 'brand'] }, $themes: [], global: { blue: { value: '#0000ff', type: 'color' } }, brand: { primary: { value: '{blue}', type: 'color' } } });
assert.deepEqual(Object.keys(studio).sort(), ['blue', 'primary'], 'Tokens Studio sets merged');
assert.equal(studio.primary.value, '#0000FF');
const themed = flatten({
  $metadata: { tokenSetOrder: ['Primitives', 'Semantic/Dark', 'Semantic/Light'] },
  $themes: [{ name: 'Dark', selectedTokenSets: { Primitives: 'source', 'Semantic/Dark': 'enabled' } }, { name: 'Light', selectedTokenSets: { Primitives: 'source', 'Semantic/Light': 'enabled' } }],
  Primitives: { n: { 0: { $type: 'color', $value: '#ffffff' }, 9: { $type: 'color', $value: '#111111' } } },
  'Semantic/Dark': { surface: { $type: 'color', $value: '{n.9}' } },
  'Semantic/Light': { surface: { $type: 'color', $value: '{n.0}' } },
});
assert.equal(themed.surface.value, '#FFFFFF', 'Light theme is the default mode');
assert.equal(themed['surface@Dark'].value, '#111111', 'other themes become modes');
assert.equal(themed['surface@Dark'].alias, 'n/9');
const nested = flatten({ $metadata: { tokenSetOrder: ['Primitives'] }, values: { Primitives: { white: { value: '#fff', type: 'color' } } } });
assert.equal(nested.white.value, '#FFFFFF', 'sets nested under "values"');
const vendor = flatten({ bg: { $type: 'color', $value: '#ffffff', $extensions: { 'com.example': { modes: { dark: '#000000' } } } } });
assert.equal(vendor['bg@dark'].value, '#000000', 'modes under a vendor key');
assert.equal(matchKey('Color / Brand.Primary'), 'color/brand/primary');
console.log('PASS tokens: Tokens Studio themes as modes, sets under values, Style Dictionary, rem, W3C 2025 colours, rgb(), 8-digit hex, guessed types, Tokens Studio sets, vendor modes, name matching');
console.log('PASS tokens: colours, dimensions, inherited types, aliases and chains, cycles, modes, alias-aware diff');
