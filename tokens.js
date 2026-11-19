/* Venn token helpers: parse a W3C design-token JSON file into flat entries and diff two versions.
   Loaded by the site as a plain script (window.VennTokens) and by tests via require().

   Supported:
   - colour and number tokens ($type color | number | dimension)
   - aliases: "$value": "{color.blue.600}" points at another token
   - modes: "$extensions": { "modes": { "Dark": "#0B0B0C" } } adds values for other Figma modes;
     $value is the default (first) mode
   Entries are keyed "radius/button" for the default mode and "action/primary@Dark" for other modes. */
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

  const ALIAS = /^\{([^{}]+)\}$/;
  const aliasName = (raw) => (typeof raw === 'string' && ALIAS.test(raw.trim()) ? raw.trim().match(ALIAS)[1].replace(/\./g, '/') : null);

  /** Flatten a token tree into { key: { token, mode, type, value, alias } }. */
  function flatten(tree) {
    const raw = {};
    (function walk(node, path, inheritedType) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const type = node.$type || inheritedType;
      if ('$value' in node) {
        const t = type === 'dimension' ? 'number' : type;
        if (t === 'color' || t === 'number') {
          raw[path.join('/')] = { type: t, declared: type, value: node.$value, modes: (node.$extensions && node.$extensions.modes) || {} };
        }
        return;
      }
      for (const key of Object.keys(node)) if (!key.startsWith('$')) walk(node[key], path.concat(key), type);
    })(tree, [], undefined);

    function resolve(value, declared, seen) {
      const target = aliasName(value);
      if (!target) return normalizeValue(declared, value);
      if (seen.has(target) || !raw[target]) return null;
      seen.add(target);
      return resolve(raw[target].value, raw[target].declared, seen);
    }

    const out = {};
    for (const name of Object.keys(raw)) {
      const t = raw[name];
      const add = (mode, value) => {
        const resolved = resolve(value, t.declared, new Set([name]));
        if (resolved === null) return;
        const key = mode ? `${name}@${mode}` : name;
        const entry = { token: name, mode: mode || null, type: t.type, value: resolved };
        const alias = aliasName(value);
        if (alias) entry.alias = alias;
        out[key] = entry;
      };
      add(null, t.value);
      for (const mode of Object.keys(t.modes)) add(mode, t.modes[mode]);
    }
    return out;
  }

  const same = (a, b) => a.type === b.type && a.value === b.value && (a.alias || null) === (b.alias || null);

  /** Differences between two flat maps, sorted by key. */
  function diff(before, after) {
    const keys = Array.from(new Set(Object.keys(before).concat(Object.keys(after)))).sort();
    const changes = [];
    for (const key of keys) {
      const a = before[key];
      const b = after[key];
      if (a && b && same(a, b)) continue;
      const base = b || a;
      const change = { name: key, token: base.token || key, mode: base.mode || null, type: base.type };
      if (a && b) Object.assign(change, { kind: 'changed', before: a.value, after: b.value, beforeAlias: a.alias || null, afterAlias: b.alias || null });
      else if (b) Object.assign(change, { kind: 'added', before: null, after: b.value, beforeAlias: null, afterAlias: b.alias || null });
      else Object.assign(change, { kind: 'removed', before: a.value, after: null, beforeAlias: a.alias || null, afterAlias: null });
      changes.push(change);
    }
    return changes;
  }

  const api = { flatten, diff, normalizeColor, aliasName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VennTokens = api;
})(typeof window !== 'undefined' ? window : globalThis);
