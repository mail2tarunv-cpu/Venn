// Venn for Figma.
// Compares a design-token file on GitHub with this file's variables, mode by mode, and applies only the
// differences the user ticks: values, aliases between variables, and new variables. Nothing is written
// on open or on check. Every write is read back; if anything disagrees, the whole run is undone.
// Variables that exist in Figma but not in code are reported, never deleted.
figma.showUI(__html__, { width: 460, height: 680, themeColors: true });

const DEFAULTS = { repo: 'mail2tarunv-cpu/penny-tokens', path: 'penny.tokens.json', collection: '' };
const RECEIPT_SCHEMA = 'venn/receipt-v2';
const VENN_SITE = 'https://venn-peach-eight.vercel.app/';
let state = null;

const send = (type, data = {}) => figma.ui.postMessage(Object.assign({ type }, data));

/* ---------- tokens: same rules as tokens.js on the site ---------- */
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
const hex2 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
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
  const byName = new Map(variables.map((v) => [v.name, v]));
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
    const variable = byName.get(e.token);
    const modeId = modeIdFor(collection, e.mode);
    if (!modeId) { rows.push(Object.assign(base, { status: 'nomode' })); continue; }
    if (!variable) { rows.push(Object.assign(base, { status: 'missing' })); continue; }
    if (TYPE_MATCH[e.type] !== variable.resolvedType) { rows.push(Object.assign(base, { status: 'type' })); continue; }
    const now = await readMode(variable, modeId);
    if (now.unsupported) { rows.push(Object.assign(base, { status: 'unsupported', id: variable.id })); continue; }
    // Same alias target counts as a match; a changed target value is fixed on the target itself.
    const same = now.alias || e.alias ? (now.alias || null) === (e.alias || null) : now.value === e.value;
    rows.push(Object.assign(base, { id: variable.id, modeId, figma: now.value, figmaAlias: now.alias || null, status: same ? 'match' : 'differs' }));
  }
  // In Figma, not in code: reported only.
  // An implicit mode row rides along with its default row when both need fixing.
  const fixing = new Set(rows.filter((r) => !r.mode && (r.status === 'differs' || r.status === 'missing')).map((r) => r.name));
  for (const r of rows) if (r.implicit && fixing.has(r.name) && (r.status === 'differs' || r.status === 'missing')) r.follows = r.name;
  const tokenNames = new Set(Object.values(entries).map((e) => e.token));
  for (const v of variables) if (!tokenNames.has(v.name)) rows.push({ key: v.name, name: v.name, mode: null, type: v.resolvedType === 'COLOR' ? 'color' : 'number', status: 'extra' });
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
  const byName = new Map(local.map((v) => [v.name, v]));

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
      if (byName.has(row.name)) continue;
      const v = figma.variables.createVariable(row.name, collection, TYPE_MATCH[row.type]);
      byName.set(row.name, v);
      created.push(v);
    }
    // Plain values before aliases, so alias targets already hold their new values.
    const ordered = chosen.slice().sort((a, b) => (a.codeAlias ? 1 : 0) - (b.codeAlias ? 1 : 0));
    for (const row of ordered) {
      const variable = byName.get(row.name);
      const modeId = modeIdFor(collection, row.mode);
      written.push({ variable, modeId, original: variable.valuesByMode[modeId] });
      if (row.codeAlias) {
        const target = byName.get(row.codeAlias);
        if (!target) throw Error(`${row.name} points at ${row.codeAlias}, which is not in this collection. Tick it too, or add it in code.`);
        variable.setValueForMode(modeId, figma.variables.createVariableAlias(target));
      } else {
        variable.setValueForMode(modeId, toFigma(row.type, row.code));
      }
    }
    // Read every row back.
    const changes = [];
    for (const row of ordered) {
      const variable = byName.get(row.name);
      const back = await readMode(variable, modeIdFor(collection, row.mode));
      const okBack = row.codeAlias ? back.alias === row.codeAlias : back.value === row.code && !back.alias;
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
      const config = Object.assign({}, DEFAULTS, saved || {});
      send('config', { config, site: VENN_SITE });
      await check(config);
    } else if (msg.type === 'check') {
      const config = { repo: String(msg.config.repo).trim(), path: String(msg.config.path).trim(), collection: String(msg.config.collection || '') };
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
