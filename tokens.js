/* Venn token helpers: parse a design-token JSON file into flat entries and diff two versions.
   Loaded by the site as a plain script (window.VennTokens), by tests via require(), and copied into the
   Figma plugin by scripts/build-plugin.cjs so both sides read tokens identically.

   Reads, so it works with the files teams already have:
   - W3C design tokens ($value, $type), including 2025.10 colour objects { colorSpace: "srgb", components }
   - Style Dictionary and Tokens Studio (value, type), including Tokens Studio type names
   - colours as #rgb, #rrggbb, #rrggbbff, rgb() and rgba(..., 1); dimensions as 16, "16px", "1rem"
   - aliases "{color.blue.600}", resolved through chains, with cycles dropped
   - modes from $extensions.modes, or any $extensions.<vendor>.modes object
   - Tokens Studio multi-set files ($metadata.tokenSetOrder): sets are merged in order
   Colour and number tokens are compared; other types (typography, shadow, font family) are skipped.
   Keys are "radius/button" for the default mode and "action/primary@Dark" for other modes. */
(function (root) {
  'use strict';

  const NUMBER_TYPES = new Set(['number', 'dimension', 'spacing', 'sizing', 'borderradius', 'borderwidth', 'fontsizes', 'fontsize', 'lineheights', 'lineheight', 'opacity', 'fontweights', 'fontweight', 'letterspacing', 'paragraphspacing', 'duration']);
  const COLOR_TYPES = new Set(['color']);

  function hex2(n) { return Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0'); }

  function normalizeColor(value) {
    if (value && typeof value === 'object') {
      // W3C 2025.10: { colorSpace: 'srgb', components: [r, g, b], alpha?, hex? }
      if (typeof value.alpha === 'number' && value.alpha < 1) return null;
      if (typeof value.hex === 'string') return normalizeColor(value.hex);
      if ((value.colorSpace === 'srgb' || !value.colorSpace) && Array.isArray(value.components) && value.components.length === 3 && value.components.every((c) => typeof c === 'number')) {
        return ('#' + value.components.map(hex2).join('')).toUpperCase();
      }
      return null;
    }
    if (typeof value !== 'string') return null;
    const v = value.trim();
    const rgb = v.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (rgb) {
      if (rgb[4] !== undefined && parseFloat(rgb[4]) !== (rgb[4].endsWith('%') ? 100 : 1)) return null;
      return ('#' + [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')).toUpperCase();
    }
    let hex = v.replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map((c) => c + c).join('');
    if (/^[0-9a-f]{8}$/i.test(hex)) { if (hex.slice(6).toLowerCase() !== 'ff') return null; hex = hex.slice(0, 6); }
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return '#' + hex.toUpperCase();
  }

  function normalizeNumber(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (raw && typeof raw === 'object' && typeof raw.value === 'number') {
      // W3C 2025.10 dimension object { value, unit }
      return raw.unit === 'rem' ? raw.value * 16 : raw.value;
    }
    const m = String(raw).trim().match(/^(-?\d+(?:\.\d+)?)(px|rem)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return m[2] === 'rem' ? n * 16 : n;
  }

  const kindOf = (type) => {
    const t = String(type || '').toLowerCase();
    return COLOR_TYPES.has(t) ? 'color' : NUMBER_TYPES.has(t) ? 'number' : t ? 'other' : null;
  };
  function guessKind(value) {
    if (normalizeColor(value)) return 'color';
    if (normalizeNumber(value) !== null) return 'number';
    return null;
  }
  function normalizeValue(kind, raw) { return kind === 'color' ? normalizeColor(raw) : kind === 'number' ? normalizeNumber(raw) : null; }

  const ALIAS = /^\{([^{}]+)\}$/;
  const aliasName = (raw) => (typeof raw === 'string' && ALIAS.test(raw.trim()) ? raw.trim().match(ALIAS)[1].replace(/\./g, '/') : null);

  function isToken(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    if ('$value' in node) return true;
    return 'value' in node && (typeof node.value !== 'object' || node.value === null || Array.isArray(node.value) === false && ('colorSpace' in node.value || 'unit' in node.value));
  }
  function modesOf(node) {
    const ext = node.$extensions || node.extensions;
    if (!ext || typeof ext !== 'object') return {};
    if (ext.modes && typeof ext.modes === 'object' && !Array.isArray(ext.modes)) return ext.modes;
    for (const key of Object.keys(ext)) {
      const m = ext[key] && ext[key].modes;
      if (m && typeof m === 'object' && !Array.isArray(m)) return m;
    }
    return {};
  }

  function collect(source, path, inheritedType, raw) {
    (function walk(node, p, inherited) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const type = node.$type || (isToken(node) ? node.type : undefined) || inherited;
      if (isToken(node)) {
        const value = '$value' in node ? node.$value : node.value;
        raw[p.join('/')] = { type, value, modes: Object.assign({}, modesOf(node)) };
        return;
      }
      for (const key of Object.keys(node)) if (!key.startsWith('$')) walk(node[key], p.concat(key), node.$type || inherited);
    })(source, path, inheritedType);
    return raw;
  }

  /* Tokens Studio files hold named sets (sometimes under "values") and optional $themes.
     With two or more themes, sets shared by every theme are the base, and the sets a single theme
     switches on become that theme's mode (Light, Dark, ...). Otherwise sets are merged in order. */
  function readSets(tree) {
    const order = tree.$metadata && Array.isArray(tree.$metadata.tokenSetOrder) ? tree.$metadata.tokenSetOrder : null;
    if (!order) return collect(tree, [], undefined, {});
    const holder = order.every((n) => !tree[n]) && tree.values && typeof tree.values === 'object' ? tree.values : tree;
    const sets = order.filter((n) => holder[n] && typeof holder[n] === 'object');
    const themes = (Array.isArray(tree.$themes) ? tree.$themes : [])
      .map((t) => ({ name: String(t.name || '').trim(), on: Object.keys(t.selectedTokenSets || {}).filter((k) => t.selectedTokenSets[k] === 'enabled') }))
      .filter((t) => t.name && t.on.length);
    if (themes.length < 2) {
      const raw = {};
      const use = themes.length === 1 ? sets.filter((n) => themes[0].on.includes(n) || (tree.$themes[0].selectedTokenSets || {})[n] === 'source') : sets;
      for (const n of use) collect(holder[n], [], undefined, raw);
      return raw;
    }
    const everywhere = (n) => themes.every((t) => t.on.includes(n));
    const themed = new Set(themes.flatMap((t) => t.on.filter((n) => !everywhere(n))));
    const raw = {};
    for (const n of sets) if (!themed.has(n)) collect(holder[n], [], undefined, raw);
    const def = themes.find((t) => /^light/i.test(t.name)) || themes[0];
    for (const n of sets) if (def.on.includes(n) && themed.has(n)) collect(holder[n], [], undefined, raw);
    for (const t of themes) {
      if (t === def) continue;
      for (const n of sets) {
        if (!t.on.includes(n) || !themed.has(n)) continue;
        const theirs = collect(holder[n], [], undefined, {});
        for (const name of Object.keys(theirs)) {
          if (raw[name]) raw[name].modes[t.name] = theirs[name].value;
          else raw[name] = Object.assign(theirs[name], { modes: {} });
        }
      }
    }
    return raw;
  }

  /** Flatten a token tree into { key: { token, mode, type, value, alias } }. */
  function flatten(tree) {
    if (!tree || typeof tree !== 'object') return {};
    const raw = readSets(tree);

    function resolve(value, seen) {
      const target = aliasName(value);
      if (!target) return { value };
      if (seen.has(target) || !raw[target]) return null;
      seen.add(target);
      const inner = resolve(raw[target].value, seen);
      return inner && { value: inner.value, type: inner.type || raw[target].type };
    }

    const out = {};
    for (const name of Object.keys(raw)) {
      const t = raw[name];
      const add = (mode, value) => {
        const r = resolve(value, new Set([name]));
        if (!r) return;
        const kind = kindOf(t.type) || kindOf(r.type) || guessKind(r.value);
        if (kind !== 'color' && kind !== 'number') return;
        const resolved = normalizeValue(kind, r.value);
        if (resolved === null) return;
        const key = mode ? `${name}@${mode}` : name;
        const entry = { token: name, mode: mode || null, type: kind, value: resolved };
        const alias = aliasName(value);
        if (alias) entry.alias = alias;
        out[key] = entry;
      };
      add(null, t.value);
      for (const mode of Object.keys(t.modes)) add(mode, t.modes[mode]);
    }
    return out;
  }

  // Two entries agree when they point at the same token, or hold the same plain value. If an alias target's
  // own value changes, that change is reported on the target, not on everything that points at it.
  const same = (a, b) => a.type === b.type && (a.alias || b.alias ? (a.alias || null) === (b.alias || null) : a.value === b.value);

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

  /** How Figma variable names are matched to token names: case, spaces and "." vs "/" do not matter. */
  const matchKey = (name) => String(name).trim().toLowerCase().replace(/\s*[./]\s*/g, '/').replace(/\s+/g, '-');

  const api = { flatten, diff, normalizeColor, normalizeNumber, aliasName, matchKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VennTokens = api;
})(typeof window !== 'undefined' ? window : globalThis);
