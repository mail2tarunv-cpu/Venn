// Venn for Figma.
// Compares a design-token file on GitHub with this file's local variables and applies only the
// differences the user ticks. Nothing is written on open or on check. Every write is read back;
// if any read-back disagrees, all writes from that run are restored.
figma.showUI(__html__, { width: 460, height: 640, themeColors: true });

const DEFAULTS = { repo: 'mail2tarunv-cpu/penny-tokens', path: 'penny.tokens.json', collection: '' };
const RECEIPT_SCHEMA = 'venn/receipt-v2';
let state = null;

const send = (type, data = {}) => figma.ui.postMessage({ type, ...data });

/* ---------- tokens (same rules as tokens.js on the site) ---------- */
function normalizeColor(value) {
  if (typeof value !== 'string') return null;
  let hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex.toUpperCase() : null;
}
function flatten(tree) {
  const out = {};
  (function walk(node, path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if ('$value' in node) {
      const t = node.$type;
      if (t === 'color') { const v = normalizeColor(node.$value); if (v) out[path.join('/')] = { type: 'color', value: v }; }
      else if (t === 'number' || t === 'dimension') {
        const raw = node.$value;
        const n = typeof raw === 'number' ? raw : /^-?\d+(\.\d+)?(px)?$/.test(String(raw).trim()) ? parseFloat(raw) : NaN;
        if (Number.isFinite(n)) out[path.join('/')] = { type: 'number', value: n };
      }
      return;
    }
    for (const key of Object.keys(node)) if (!key.startsWith('$')) walk(node[key], path.concat(key));
  })(tree, []);
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
const hex2 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
function readValue(variable, raw) {
  if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') return { alias: true };
  if (variable.resolvedType === 'FLOAT' && typeof raw === 'number') return { value: raw };
  if (variable.resolvedType === 'COLOR' && raw && typeof raw.r === 'number') {
    if (raw.a !== undefined && raw.a < 1) return { unsupported: 'Has transparency' };
    return { value: ('#' + hex2(raw.r) + hex2(raw.g) + hex2(raw.b)).toUpperCase() };
  }
  return { unsupported: 'Unsupported value' };
}
function toFigma(type, value) {
  if (type === 'number') return value;
  const h = value.slice(1);
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: 1 };
}
const TYPE_MATCH = { number: 'FLOAT', color: 'COLOR' };

async function collectionFor(name) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  if (!collections.length) throw Error('This file has no local variable collections.');
  const collection = name ? collections.find((c) => c.name === name) : collections[0];
  if (!collection) throw Error(`No collection named "${name}" in this file.`);
  return { collection, names: collections.map((c) => c.name) };
}

/* ---------- check: read only ---------- */
async function check(config) {
  const { collection, names } = await collectionFor(config.collection);
  const head = await headCommit(config.repo, config.path);
  const tokens = await tokensAt(config.repo, head.sha, config.path);
  const variables = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === collection.id);
  const modeId = collection.defaultModeId;
  const rows = Object.keys(tokens).sort().map((name) => {
    const token = tokens[name];
    const variable = variables.find((v) => v.name === name);
    if (!variable) return { name, type: token.type, code: token.value, status: 'missing' };
    if (TYPE_MATCH[token.type] !== variable.resolvedType) return { name, type: token.type, code: token.value, status: 'type' };
    const current = readValue(variable, variable.valuesByMode[modeId]);
    if (current.alias) return { name, type: token.type, code: token.value, status: 'alias' };
    if (current.unsupported) return { name, type: token.type, code: token.value, status: 'unsupported' };
    return { name, type: token.type, code: token.value, figma: current.value, id: variable.id, status: current.value === token.value ? 'match' : 'differs' };
  });
  state = { config, sha: head.sha, message: head.message, collection: collection.name, modeId, rows };
  send('checked', { sha: head.sha, message: head.message, collection: collection.name, collections: names, rows });
}

/* ---------- apply: only reviewed rows, verified, all-or-nothing ---------- */
async function apply(names, confirmed) {
  if (!confirmed) throw Error('Tick the review box before applying.');
  if (!state) throw Error('Check the file before applying.');
  const chosen = state.rows.filter((r) => r.status === 'differs' && names.includes(r.name));
  if (!chosen.length || chosen.length !== names.length) throw Error('Select at least one difference to apply.');

  const head = await headCommit(state.config.repo, state.config.path);
  if (head.sha !== state.sha) throw Error('A new commit arrived since you checked. Check again before applying.');

  const targets = [];
  for (const row of chosen) {
    const variable = await figma.variables.getVariableByIdAsync(row.id);
    if (!variable) throw Error(`${row.name} no longer exists. Nothing was changed.`);
    const now = readValue(variable, variable.valuesByMode[state.modeId]);
    if (now.value !== row.figma) throw Error(`${row.name} changed in Figma since you checked. Nothing was changed.`);
    targets.push({ row, variable, original: variable.valuesByMode[state.modeId] });
  }

  const written = [];
  try {
    for (const t of targets) { t.variable.setValueForMode(state.modeId, toFigma(t.row.type, t.row.code)); written.push(t); }
    const changes = targets.map((t) => {
      const back = readValue(t.variable, t.variable.valuesByMode[state.modeId]).value;
      if (back !== t.row.code) throw Error(`Figma did not confirm ${t.row.name}.`);
      return { name: t.row.name, type: t.row.type, before: t.row.figma, after: t.row.code, readBack: back };
    });
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
      verification: 'plugin-readback-only',
    };
    send('applied', { receipt });
    await check(state.config);
  } catch (err) {
    for (const t of written) { try { t.variable.setValueForMode(state.modeId, t.original); } catch (e) { /* best effort */ } }
    throw Error(err.message + ' All changes from this run were undone.');
  }
}

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'init') {
      const saved = await figma.clientStorage.getAsync('venn.config');
      const config = Object.assign({}, DEFAULTS, saved || {});
      send('config', { config });
      await check(config);
    } else if (msg.type === 'check') {
      const config = { repo: String(msg.config.repo).trim(), path: String(msg.config.path).trim(), collection: String(msg.config.collection || '') };
      await figma.clientStorage.setAsync('venn.config', config);
      await check(config);
    } else if (msg.type === 'apply') {
      await apply(Array.isArray(msg.names) ? msg.names : [], msg.confirmed === true);
    }
  } catch (err) {
    send('error', { message: err.message || String(err) });
  }
};
