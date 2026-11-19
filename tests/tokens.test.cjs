const assert = require('node:assert/strict');
const { flatten, diff } = require('../tokens.js');
const a = flatten({ radius: { button: { $type: 'number', $value: 2 } }, c: { x: { $type: 'color', $value: '#abc' } }, d: { $type: 'dimension', $value: '8px' }, skip: { $type: 'fontFamily', $value: 'Inter' } });
assert.deepEqual(a, { 'radius/button': { type: 'number', value: 2 }, 'c/x': { type: 'color', value: '#AABBCC' }, d: { type: 'number', value: 8 } });
const b = flatten({ radius: { button: { $type: 'number', $value: 12 } }, c: { x: { $type: 'color', $value: '#AABBCC' } }, e: { $type: 'number', $value: 1 } });
assert.deepEqual(diff(a, b), [
  { name: 'd', type: 'number', kind: 'removed', before: 8, after: null },
  { name: 'e', type: 'number', kind: 'added', before: null, after: 1 },
  { name: 'radius/button', type: 'number', kind: 'changed', before: 2, after: 12 },
]);
console.log('PASS tokens: flatten, colour normalising, dimensions, unsupported types skipped, diff');
