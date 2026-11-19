/* Venn token helpers: parse a W3C design-token JSON file into a flat map and diff two versions.
   Loaded by the site as a plain script (window.VennTokens) and by tests via require(). */
(function (root) {
  'use strict';

  function normalizeColor(value) {
    if (typeof value !== 'string') return null;
    let hex = value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return '#' + hex.toUpperCase();
  }

  function normalizeValue(type, raw) {
    if (type === 'color') return normalizeColor(raw);
    if (type === 'number' || type === 'dimension') {
      const n = typeof raw === 'number' ? raw : /^-?\d+(\.\d+)?(px)?$/.test(String(raw).trim()) ? parseFloat(raw) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  /** Flatten a token tree into { "radius/button": { type: "number", value: 12 } }. Unsupported types are skipped. */
  function flatten(tree) {
    const out = {};
    (function walk(node, path) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      if ('$value' in node) {
        const declared = node.$type;
        const type = declared === 'dimension' ? 'number' : declared;
        const value = normalizeValue(declared, node.$value);
        if ((type === 'color' || type === 'number') && value !== null) out[path.join('/')] = { type, value };
        return;
      }
      for (const key of Object.keys(node)) if (!key.startsWith('$')) walk(node[key], path.concat(key));
    })(tree, []);
    return out;
  }

  /** Differences between two flat maps, sorted by name. */
  function diff(before, after) {
    const names = Array.from(new Set(Object.keys(before).concat(Object.keys(after)))).sort();
    const changes = [];
    for (const name of names) {
      const a = before[name];
      const b = after[name];
      if (a && b && a.type === b.type && a.value === b.value) continue;
      if (a && b) changes.push({ name, type: b.type, kind: 'changed', before: a.value, after: b.value });
      else if (b) changes.push({ name, type: b.type, kind: 'added', before: null, after: b.value });
      else changes.push({ name, type: a.type, kind: 'removed', before: a.value, after: null });
    }
    return changes;
  }

  const api = { flatten, diff, normalizeColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VennTokens = api;
})(typeof window !== 'undefined' ? window : globalThis);
