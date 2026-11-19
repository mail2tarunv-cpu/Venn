// Venn for Figma.
// Compares a design-token file on GitHub with this file's variables, mode by mode, and applies only the
// differences the user ticks: values, aliases between variables, and new variables. Nothing is written
// on open or on check. Every write is read back; if anything disagrees, the whole run is undone.
// Variables that exist in Figma but not in code are reported, never deleted.
figma.showUI(__html__, { width: 360, height: 520, themeColors: true });

const DEFAULTS = { repo: 'mail2tarunv-cpu/penny-tokens', path: 'penny.tokens.json', collection: '' };
const RECEIPT_SCHEMA = 'venn/receipt-v2';
const VENN_SITE = 'https://venn-peach-eight.vercel.app/';
let state = null;

const send = (type, data = {}) => figma.ui.postMessage(Object.assign({ type }, data));

/* BEGIN TOKENS (generated from tokens.js by scripts/build-plugin.cjs; do not edit) */
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

/* END TOKENS */

/* ---------- GitHub ---------- */
async function headCommit(repo, path) {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) throw Error('Repository or file not found. Is the repository public?');
  if (res.status === 403 || res.status === 429) throw Error('GitHub is rate limiting requests. Try again in a few minutes.');
  if (!res.ok) throw Error('Could not reach GitHub.');
  const list = await res.json();
  if (!list.length) throw Error('No commits touch that token file.');
  return { sha: list[0].sha, message: String(list[0].commit.message).split('\n')[0] };
}
async function tokensAt(repo, sha, path) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path}`);
  if (!res.ok) throw Error('Could not read the token file.');
  let tree;
  try { tree = JSON.parse(await res.text()); } catch (e) { throw Error('The token file is not valid JSON.'); }
  return flatten(tree);
}

/* ---------- Figma values ---------- */
const TYPE_MATCH = { number: 'FLOAT', color: 'COLOR' };
function toFigma(type, value) {
  if (type === 'number') return value;
  const h = value.slice(1);
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: 1 };
}
/** What a variable holds in one mode: { value } or { alias: name, value: resolved } or { unsupported }. */
async function readMode(variable, modeId, depth) {
  const raw = variable.valuesByMode[modeId];
  if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
    const target = await figma.variables.getVariableByIdAsync(raw.id);
    if (!target) return { unsupported: 'Alias to a missing variable' };
    if ((depth || 0) > 8) return { unsupported: 'Alias loop' };
    const tc = await figma.variables.getVariableCollectionByIdAsync(target.variableCollectionId);
    const targetMode = tc && (tc.modes.find((m) => m.modeId === modeId) ? modeId : tc.defaultModeId);
    const inner = await readMode(target, targetMode, (depth || 0) + 1);
    return { alias: target.name, aliasId: target.id, value: inner.value, unsupported: inner.unsupported };
  }
  if (variable.resolvedType === 'FLOAT' && typeof raw === 'number') return { value: Math.round(raw * 1000) / 1000 };
  if (variable.resolvedType === 'COLOR' && raw && typeof raw.r === 'number') {
    if (raw.a !== undefined && raw.a < 1) return { unsupported: 'Has transparency' };
    return { value: ('#' + hex2(raw.r) + hex2(raw.g) + hex2(raw.b)).toUpperCase() };
  }
  return { unsupported: 'Unsupported value' };
}

async function collectionFor(name) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  if (!collections.length) throw Error('This file has no local variable collections.');
  const collection = name ? collections.find((c) => c.name === name) : collections[0];
  if (!collection) throw Error(`No collection named "${name}" in this file.`);
  return { collection, names: collections.map((c) => c.name) };
}
function modeIdFor(collection, mode) {
  if (!mode) return collection.defaultModeId;
  const hit = collection.modes.find((m) => m.name.toLowerCase() === mode.toLowerCase());
  return hit ? hit.modeId : null;
}

/* ---------- check: read only ---------- */
async function check(config) {
  const { collection, names } = await collectionFor(config.collection);
  const head = await headCommit(config.repo, config.path);
  const entries = await tokensAt(config.repo, head.sha, config.path);
  const variables = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === collection.id);
  const byName = new Map(variables.map((v) => [matchKey(v.name), v]));
  // A token without a value for a mode holds its default value in that mode too.
  for (const key of Object.keys(entries)) {
    const e = entries[key];
    if (e.mode) continue;
    for (const m of collection.modes) {
      if (m.modeId === collection.defaultModeId || entries[`${e.token}@${m.name}`]) continue;
      entries[`${e.token}@${m.name}`] = Object.assign({}, e, { mode: m.name, implicit: true });
    }
  }
  const rows = [];
  for (const key of Object.keys(entries).sort()) {
    const e = entries[key];
    const base = { key, name: e.token, mode: e.mode, type: e.type, code: e.value, codeAlias: e.alias || null, implicit: !!e.implicit };
    const variable = byName.get(matchKey(e.token));
    const modeId = modeIdFor(collection, e.mode);
    if (!modeId) { rows.push(Object.assign(base, { status: 'nomode' })); continue; }
    if (!variable) { rows.push(Object.assign(base, { status: 'missing' })); continue; }
    if (TYPE_MATCH[e.type] !== variable.resolvedType) { rows.push(Object.assign(base, { status: 'type' })); continue; }
    const now = await readMode(variable, modeId);
    if (now.unsupported) { rows.push(Object.assign(base, { status: 'unsupported', id: variable.id })); continue; }
    // Same alias target counts as a match; a changed target value is fixed on the target itself.
    const same = now.alias || e.alias ? matchKey(now.alias || '') === matchKey(e.alias || '') && !!now.alias === !!e.alias : now.value === e.value;
    rows.push(Object.assign(base, { id: variable.id, modeId, figma: now.value, figmaAlias: now.alias || null, status: same ? 'match' : 'differs' }));
  }
  // In Figma, not in code: reported only.
  // An implicit mode row rides along with its default row when both need fixing.
  const fixing = new Set(rows.filter((r) => !r.mode && (r.status === 'differs' || r.status === 'missing')).map((r) => r.name));
  for (const r of rows) if (r.implicit && fixing.has(r.name) && (r.status === 'differs' || r.status === 'missing')) r.follows = r.name;
  const tokenNames = new Set(Object.values(entries).map((e) => matchKey(e.token)));
  for (const v of variables) if (!tokenNames.has(matchKey(v.name))) rows.push({ key: v.name, name: v.name, mode: null, type: v.resolvedType === 'COLOR' ? 'color' : 'number', status: 'extra' });
  state = { config, sha: head.sha, message: head.message, collectionId: collection.id, collection: collection.name, rows };
  send('checked', { sha: head.sha, message: head.message, collection: collection.name, collections: names, modes: collection.modes.map((m) => m.name), rows });
}

/* ---------- apply: only reviewed rows, verified, all-or-nothing ---------- */
async function apply(keys, confirmed) {
  if (!confirmed) throw Error('Tick the review box before applying.');
  if (!state) throw Error('Check the file before applying.');
  const picked = state.rows.filter((r) => (r.status === 'differs' || r.status === 'missing') && keys.includes(r.key));
  if (!picked.length || picked.length !== keys.length) throw Error('Select at least one difference to apply.');
  const pickedNames = new Set(picked.filter((r) => !r.mode).map((r) => r.name));
  const chosen = picked.concat(state.rows.filter((r) => r.follows && pickedNames.has(r.follows) && !keys.includes(r.key)));

  const head = await headCommit(state.config.repo, state.config.path);
  if (head.sha !== state.sha) throw Error('A new commit arrived since you checked. Check again before applying.');

  const collection = await figma.variables.getVariableCollectionByIdAsync(state.collectionId);
  if (!collection) throw Error('The collection no longer exists. Nothing was changed.');
  const local = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === collection.id);
  const byName = new Map(local.map((v) => [matchKey(v.name), v]));

  // Nothing may have changed in Figma since the check.
  for (const row of chosen.filter((r) => r.status === 'differs')) {
    const variable = await figma.variables.getVariableByIdAsync(row.id);
    if (!variable) throw Error(`${row.name} no longer exists. Nothing was changed.`);
    const now = await readMode(variable, row.modeId);
    if (now.value !== row.figma || (now.alias || null) !== row.figmaAlias) throw Error(`${row.name} changed in Figma since you checked. Nothing was changed.`);
  }

  const created = [];
  const written = [];
  try {
    // Create missing variables first, so aliases in this run can point at them.
    for (const row of chosen.filter((r) => r.status === 'missing')) {
      if (byName.has(matchKey(row.name))) continue;
      const v = figma.variables.createVariable(row.name, collection, TYPE_MATCH[row.type]);
      byName.set(matchKey(row.name), v);
      created.push(v);
    }
    // Plain values before aliases, so alias targets already hold their new values.
    const ordered = chosen.slice().sort((a, b) => (a.codeAlias ? 1 : 0) - (b.codeAlias ? 1 : 0));
    for (const row of ordered) {
      const variable = byName.get(matchKey(row.name));
      const modeId = modeIdFor(collection, row.mode);
      written.push({ variable, modeId, original: variable.valuesByMode[modeId] });
      if (row.codeAlias) {
        const target = byName.get(matchKey(row.codeAlias));
        if (!target) throw Error(`${row.name} points at ${row.codeAlias}, which is not in this collection. Tick it too, or add it in code.`);
        variable.setValueForMode(modeId, figma.variables.createVariableAlias(target));
      } else {
        variable.setValueForMode(modeId, toFigma(row.type, row.code));
      }
    }
    // Read every row back.
    const changes = [];
    for (const row of ordered) {
      const variable = byName.get(matchKey(row.name));
      const back = await readMode(variable, modeIdFor(collection, row.mode));
      const okBack = row.codeAlias ? !!back.alias && matchKey(back.alias) === matchKey(row.codeAlias) : back.value === row.code && !back.alias;
      if (!okBack) throw Error(`Figma did not confirm ${row.name}${row.mode ? ' (' + row.mode + ')' : ''}.`);
      const shown = (alias, value) => (alias ? `{${alias}}` : value);
      if (row.follows) continue;
      changes.push({ name: row.name, mode: row.mode, type: row.type, kind: row.status === 'missing' ? 'created' : 'updated',
        before: row.status === 'missing' ? null : shown(row.figmaAlias, row.figma), after: shown(row.codeAlias, row.code), readBack: shown(back.alias, back.value), value: back.value });
    }
    const receipt = {
      schema: RECEIPT_SCHEMA,
      sourceRepo: state.config.repo,
      sourcePath: state.config.path,
      sourceSha: state.sha,
      sourceMessage: state.message,
      fileKey: figma.fileKey || null,
      fileName: figma.root.name,
      collection: state.collection,
      actor: (figma.currentUser && figma.currentUser.name) || 'Figma user',
      appliedAt: new Date().toISOString(),
      changes,
      remainingDifferences: state.rows.filter((r) => (r.status === 'differs' || r.status === 'missing') && !chosen.includes(r)).length,
      verification: 'plugin-readback-only',
    };
    send('applied', { receipt });
    await check(state.config);
  } catch (err) {
    for (const w of written.reverse()) { try { if (w.original !== undefined) w.variable.setValueForMode(w.modeId, w.original); } catch (e) { /* best effort */ } }
    for (const v of created) { try { v.remove(); } catch (e) { /* best effort */ } }
    throw Error(err.message + ' All changes from this run were undone.');
  }
}

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'init') {
      let saved = null;
      try { saved = await figma.clientStorage.getAsync('venn.config'); } catch (e) { /* no saved settings */ }
      if (!saved || !saved.repo) {
        // First run: ask which repository to compare with, instead of quietly checking the sample.
        const collections = (await figma.variables.getLocalVariableCollectionsAsync()).map((c) => c.name);
        send('config', { config: { repo: '', path: '', collection: '' }, sample: DEFAULTS, collections, setup: true, site: VENN_SITE });
        return;
      }
      const config = Object.assign({}, DEFAULTS, saved);
      send('config', { config, site: VENN_SITE });
      await check(config);
    } else if (msg.type === 'check') {
      const config = { repo: String(msg.config.repo).trim(), path: String(msg.config.path).trim(), collection: String(msg.config.collection || '') };
      if (!/^[\w.-]+\/[\w.-]+$/.test(config.repo) || !config.path) throw Error('Enter the repository as owner/name and the path to its token file.');
      try { await figma.clientStorage.setAsync('venn.config', config); } catch (e) { /* settings just won't persist */ }
      await check(config);
    } else if (msg.type === 'open') {
      // "Record in Venn": only ever opens the Venn site, with the receipt in the link.
      const url = String(msg.url || '');
      if (!url.startsWith(VENN_SITE + '#receipt=')) throw Error('Venn could not open that link.');
      figma.openExternal(url);
    } else if (msg.type === 'apply') {
      await apply(Array.isArray(msg.names) ? msg.names : [], msg.confirmed === true);
    }
  } catch (err) {
    send('error', { message: err.message || String(err) });
  }
};
