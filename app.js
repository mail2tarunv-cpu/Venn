'use strict';

/* Venn web app.
   Reads one design-token file from a public GitHub repository, shows what changed since the commit Figma
   last matched, and records plugin receipts. Everything is stored in this browser; there is no server. */

const $ = (id) => document.getElementById(id);
const Tokens = window.VennTokens;

const KEYS = { workspace: 'venn.workspace.v2', receipts: 'venn.receipts.v2' };
const POLL_MS = 45000;
const RECEIPT_SCHEMA = 'venn/receipt-v2';
const SAMPLE = { repo: 'mail2tarunv-cpu/penny-tokens', path: 'penny.tokens.json' };

/* ---------- storage ---------- */
function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable; state lasts for this tab */ }
}
let workspace = load(KEYS.workspace, null);
let receipts = load(KEYS.receipts, []);

/* ---------- small helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (sha) => String(sha).slice(0, 7);
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}
let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4600);
}
/* ---------- GitHub (public repositories, no sign-in) ---------- */
const fileCache = new Map();
class GitHubError extends Error {}

async function ghFetch(url, headers = {}) {
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', ...headers } }); }
  catch { throw new GitHubError('Could not reach GitHub. Check your connection.'); }
  if (res.status === 404) throw new GitHubError('Repository or file not found. Is the repository public?');
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const when = reset ? new Date(reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'later';
    throw new GitHubError(`GitHub is rate limiting this browser. Venn will retry around ${when}.`);
  }
  return res;
}

let commitsEtag = null;
async function fetchCommits(repo, path, { useEtag = false } = {}) {
  const url = `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=30`;
  const res = await ghFetch(url, useEtag && commitsEtag ? { 'If-None-Match': commitsEtag } : {});
  if (res.status === 304) return null;
  if (!res.ok) throw new GitHubError('GitHub returned an unexpected response.');
  if (useEtag) commitsEtag = res.headers.get('etag');
  const list = await res.json();
  return list.map((c) => ({
    sha: c.sha,
    message: String(c.commit.message).split('\n')[0],
    author: c.commit.author?.name || c.author?.login || 'Unknown',
    date: c.commit.author?.date,
    url: c.html_url,
  }));
}

async function fetchTokens(repo, sha, path) {
  const key = `${repo}@${sha}:${path}`;
  if (fileCache.has(key)) return fileCache.get(key);
  let res;
  try { res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`); }
  catch { throw new GitHubError('Could not reach GitHub. Check your connection.'); }
  if (!res.ok) throw new GitHubError('Could not read the token file at that commit.');
  let tree;
  try { tree = JSON.parse(await res.text()); } catch { throw new GitHubError('The token file is not valid JSON.'); }
  const flat = Tokens.flatten(tree);
  fileCache.set(key, flat);
  return flat;
}

/* ---------- state derived from GitHub ---------- */
const live = { commits: [], head: null, synced: null, timeline: [], error: null, checkedAt: null, loading: true };
let newPushHandled = null;

async function refresh({ manual = false } = {}) {
  if (!workspace) return;
  try {
    const commits = await fetchCommits(workspace.repo, workspace.path, { useEtag: !manual });
    if (commits) {
      const previousHead = live.commits[0]?.sha;
      live.commits = commits;
      if (!commits.length) throw new GitHubError('No commits found for that token file.');
      const headSha = commits[0].sha;
      live.head = await fetchTokens(workspace.repo, headSha, workspace.path);
      live.synced = await fetchTokens(workspace.repo, workspace.syncedSha, workspace.path).catch(() => null);
      // Token values at each recent commit, oldest first, for the change map.
      const recent = commits.slice(0, 12).reverse();
      const files = await Promise.all(recent.map((c) => fetchTokens(workspace.repo, c.sha, workspace.path).catch(() => null)));
      live.timeline = recent.map((commit, i) => {
        const prev = i > 0 ? files[i - 1] : null;
        const changed = prev && files[i] ? new Set(Tokens.diff(prev, files[i]).map((d) => d.name)) : new Set();
        return { commit, tokens: files[i], changed, first: i === 0 };
      });
      if (previousHead && previousHead !== headSha && newPushHandled !== headSha && headSha !== workspace.syncedSha) announcePush(commits[0]);
      newPushHandled = headSha;
    }
    live.error = null;
    live.checkedAt = Date.now();
  } catch (err) {
    live.error = err instanceof GitHubError ? err.message : 'Something went wrong while checking GitHub.';
  }
  live.loading = false;
  render();
}

function pending() {
  if (!live.commits.length || !live.head) return { changes: [], commits: [] };
  const headSha = live.commits[0].sha;
  if (headSha === workspace.syncedSha) return { changes: [], commits: [] };
  const idx = live.commits.findIndex((c) => c.sha === workspace.syncedSha);
  const commits = idx === -1 ? live.commits : live.commits.slice(0, idx);
  const changes = live.synced ? Tokens.diff(live.synced, live.head) : [];
  return { changes, commits };
}

function announcePush(commit) {
  toast(`New push: ${commit.message}`);
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { new Notification('Venn: design tokens changed', { body: commit.message }); } catch { /* ignore */ }
  }
}

/* ---------- rendering ---------- */
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}" /></svg>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function render() {
  if (!workspace) return;
  const { changes, commits } = pending();
  const [owner, name] = workspace.repo.split('/');
  const avatar = `https://github.com/${encodeURIComponent(owner)}.png?size=80`;
  for (const id of ['ownerAvatar', 'topAvatar']) { const img = $(id); if (img.getAttribute('src') !== avatar) { img.src = avatar; img.alt = owner; } }
  $('workspaceName').textContent = name;
  $('workspaceFile').textContent = workspace.path;
  $('crumbRepo').textContent = name;
  $('navCount').textContent = changes.length;
  $('navCount').classList.toggle('hidden', !changes.length);
  $('historyCount').textContent = receipts.length;
  $('historyCount').classList.toggle('hidden', !receipts.length);
  document.title = changes.length ? `(${changes.length}) Venn` : 'Venn';

  const watch = $('watch');
  watch.className = 'watch ' + (live.error ? 'error' : live.checkedAt ? 'live' : '');
  $('watchText').textContent = live.error ? 'Not connected' : live.checkedAt ? `Watching · checked ${ago(new Date(live.checkedAt).toISOString())}` : 'Connecting';

  renderDashboard(changes, commits);
  renderHistory();
  renderConnections();
  const canNotify = 'Notification' in window && Notification.permission === 'default';
  $('notifyButton').classList.toggle('hidden', !canNotify);
}

/* The moment: Figma's value (dashed grey) drawn over code's value (cobalt). */
function vennFor(c) {
  if (c.type === 'color') {
    const a = c.before ? `<circle class="swatch-figma" cx="15" cy="16" r="11" fill="${esc(c.before)}" />` : `<circle class="figma-stroke" cx="15" cy="16" r="11" />`;
    const b = c.after ? `<circle class="swatch-code" cx="29" cy="16" r="11" fill="${esc(c.after)}" />` : `<circle class="figma-stroke" cx="29" cy="16" r="11" />`;
    return `<svg class="venn" viewBox="0 0 44 32" aria-hidden="true">${a}${b}</svg>`;
  }
  const before = c.before ?? 0;
  const after = c.after ?? 0;
  if (/radius/.test(c.name)) {
    const r = (v) => Math.max(0, Math.min(13, v));
    const shape = (v, cls) => `<rect class="${cls}" x="4" y="4" width="36" height="24" rx="${r(v)}" />`;
    return `<svg class="venn" viewBox="0 0 44 32" aria-hidden="true">${shape(after, 'code-stroke')}${shape(before, 'figma-stroke')}</svg>`;
  }
  const max = Math.max(before, after, 1);
  const w = (v) => Math.max(2, Math.round((v / max) * 36));
  return `<svg class="venn" viewBox="0 0 44 32" aria-hidden="true">
    <line class="tick" x1="4" y1="6" x2="4" y2="26" />
    <rect class="figma-stroke" x="4" y="8" width="${w(before)}" height="6" rx="2" />
    <rect class="code-stroke" x="4" y="18" width="${w(after)}" height="6" rx="2" />
  </svg>`;
}

function formatCell(type, value, alias) {
  if (typeof value === 'string' && /^\{.+\}$/.test(value)) { alias = value.slice(1, -1); value = null; }
  const swatch = type === 'color' && value ? `<span class="chip" style="background:${esc(value)}"></span>` : '';
  if (alias) return `<span class="cell-val">${swatch}<span class="alias">{${esc(alias)}}</span></span>`;
  if (value === null || value === undefined) return '<span class="none">—</span>';
  return `<span class="cell-val">${swatch}${esc(value)}</span>`;
}
const modeTag = (mode) => (mode ? `<span class="mode-tag">${esc(mode)}</span>` : '');
const entryLabel = (key) => { const [name, mode] = key.split('@'); return `${esc(name)}${modeTag(mode)}`; };

/* Hero: every token across recent commits, as a dot matrix, with the Figma sync point marked. */
function renderMap() {
  const t = live.timeline;
  if (!t.length || !live.head) return '';
  const names = Object.keys(live.head).sort();
  const syncIdx = t.findIndex((x) => x.commit.sha === workspace.syncedSha);
  const cols = t.map((x, i) => {
    const after = syncIdx !== -1 && i > syncIdx;
    const cells = names.map((n) => {
      const type = live.head[n].type;
      const changed = x.changed.has(n);
      const before = i > 0 && t[i - 1].tokens ? t[i - 1].tokens[n]?.value : null;
      const now = x.tokens?.[n]?.value;
      const tip = changed ? `${n}: ${before ?? '—'} → ${now ?? '—'} in ${short(x.commit.sha)}` : `${n}: ${now ?? '—'}`;
      return `<div class="cell ${changed ? 'on ' + type : ''}" title="${esc(tip)}"></div>`;
    }).join('');
    const label = x.commit.date ? new Date(x.commit.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    return `<div class="map-col ${after ? 'ahead' : ''} ${i === syncIdx ? 'synced' : ''} ${i === t.length - 1 ? 'last' : ''}">
      ${i === syncIdx ? `<span class="sync-flag">Figma synced</span>` : ''}
      ${cells}
      <div class="map-x"><span class="mono">${esc(short(x.commit.sha))}</span><small>${esc(label)}</small></div>
    </div>`;
  }).join('');
  const shown = t.length < live.commits.length ? `Last ${t.length} of ${live.commits.length} commits` : `All ${plural(t.length, 'commit', 'commits')}`;
  return `<div class="card map-card">
    <div class="card-head">
      <div><h2>Change map</h2><p>${shown} to <span class="mono">${esc(workspace.path)}</span>, oldest on the left</p></div>
      <div class="legend"><span><i class="lg color"></i>Colour changed</span><span><i class="lg number"></i>Number changed</span><span><i class="lg off"></i>Unchanged</span></div>
    </div>
    <div class="map-scroll"><div class="map">
      <div class="map-names">${names.map((n) => `<div class="map-name mono">${entryLabel(n)}</div>`).join('')}<div class="map-x"></div></div>
      ${cols}
    </div></div>
  </div>`;
}

function renderInventory(changes) {
  const entries = Object.entries(live.head || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const colors = entries.filter(([, t]) => t.type === 'color').length;
  const total = entries.length || 1;
  const drifted = new Set(changes.map((c) => c.name));
  return `<div class="card inventory">
    <div class="card-head"><div><h2>Tokens</h2><p>Current values in code</p></div></div>
    <div class="inv-figure"><span class="big">${entries.length}</span><span class="pill ${changes.length ? 'warn' : 'good'}">${changes.length ? `${changes.length} drifted` : 'All in Figma'}</span></div>
    <div class="split-bar" aria-hidden="true"><span class="seg color" style="flex:${colors / total}"></span><span class="seg number" style="flex:${(total - colors) / total}"></span></div>
    <div class="split-legend"><span><i class="lg color"></i>Colours ${colors}</span><span><i class="lg number"></i>Numbers ${entries.length - colors}</span></div>
    <ul class="inv-list">${entries.map(([n, t]) => `<li><span class="mono">${entryLabel(n)}</span>${drifted.has(n) ? '<span class="dot warn" title="Drifted from Figma"></span>' : ''}<span class="inv-val">${formatCell(t.type, t.value, t.alias)}</span></li>`).join('')}</ul>
  </div>`;
}

function previewCard() {
  if (!live.head || !live.synced) return '';
  const style = (t) => {
    const radius = t['radius/button']?.value ?? 8;
    const bg = t['action/primary']?.value ?? '#171717';
    const fg = t['text/on-brand']?.value ?? '#FFFFFF';
    const pad = t['spacing/component']?.value ?? 16;
    return `border-radius:${radius}px;background:${esc(bg)};color:${esc(fg)};padding:0 ${pad * 1.5}px`;
  };
  return `<div class="card preview-card">
    <div class="card-head"><div><h2>Component preview</h2><p>Primary button built from your tokens</p></div></div>
    <div class="preview-stage">
      <div class="preview-cell"><label>Figma · <span class="mono">${esc(short(workspace.syncedSha))}</span></label><button class="specimen" tabindex="-1" style="${style(live.synced)}">Continue</button></div>
      <div class="preview-cell"><label>Code · <span class="mono">${esc(short(live.commits[0].sha))}</span></label><button class="specimen" tabindex="-1" style="${style(live.head)}">Continue</button></div>
    </div>
  </div>`;
}

/* The Venn mark. Figma (hatched) and code (cobalt) as two discs; their overlap is drawn as a solid
   lens that carries the state: amber with the number of drifted tokens, or green with a check.
   The lens is the code disc clipped by the Figma disc, so it stays exact at any distance. */
let vennId = 0;
function vennMark({ drift = 0, animate = false } = {}) {
  const id = 'vm' + (++vennId);
  const r = 44, cx = 120, cy = 60;
  const d = drift ? 18 + Math.min(drift, 5) * 3 : 8;      // half the distance between centres
  const state = drift ? 'drift' : 'sync';
  const label = animate ? '' : drift
    ? `<text class="vm-count" x="${cx}" y="${cy + 6}" text-anchor="middle">${drift}</text>`
    : `<path class="vm-check" d="M${cx - 9} ${cy} l6 6 l12 -13" />`;
  return `<svg class="venn-mark ${state} ${animate ? 'animate' : ''}" viewBox="0 0 240 120" style="--d:${d}px" role="img" aria-label="${drift ? `${drift} drifted` : 'Figma and code in step'}">
    <defs>
      <pattern id="${id}h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="vm-hatch" /></pattern>
      <clipPath id="${id}c"><circle class="vm-left" cx="${cx}" cy="${cy}" r="${r + 1}" /></clipPath>
    </defs>
    <g class="vm-left"><circle class="vm-figma-fill" cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}h)" /><circle class="vm-figma" cx="${cx}" cy="${cy}" r="${r}" /></g>
    <g class="vm-right"><circle class="vm-code" cx="${cx}" cy="${cy}" r="${r}" /></g>
    <g clip-path="url(#${id}c)"><circle class="vm-right vm-lens" cx="${cx}" cy="${cy}" r="${r + 1}" /></g>
    <circle class="vm-right vm-code-edge" cx="${cx}" cy="${cy}" r="${r}" />
    ${label}
    <text class="vm-label vm-left" x="${cx - r - 12}" y="${cy + 4}" text-anchor="end">Figma</text>
    <text class="vm-label code vm-right" x="${cx + r + 12}" y="${cy + 4}">Code</text>
  </svg>`;
}

function renderDashboard(changes, commits) {
  const body = $('changesBody');
  const sub = $('changesSub');
  const actions = $('headActions');
  $('dashboard').innerHTML = '';
  actions.innerHTML = '';
  if (live.loading) { sub.textContent = 'Checking GitHub'; body.innerHTML = '<div class="skeleton"></div>'; renderTokensPage([]); return; }
  if (live.error) {
    sub.textContent = 'Could not check GitHub';
    body.innerHTML = `<div class="notice" role="alert">${esc(live.error)}</div>`;
    renderTokensPage([]);
    return;
  }
  const head = live.commits[0];
  sub.innerHTML = `Watching <span class="mono">${esc(workspace.path)}</span> in ${esc(workspace.repo)}`;

  const banner = changes.length
    ? `<div class="card banner drift">
        ${vennMark({ drift: changes.length })}
        <div class="banner-copy">
          <span class="pill warn">Needs review</span>
          <h2>${changes.length === 1 ? '1 token changed' : changes.length + ' tokens changed'} in code since Figma was last updated</h2>
          <p>${plural(commits.length, 'push', 'pushes')} since then, latest <span class="mono">${esc(short(head.sha))}</span> “${esc(head.message)}” ${head.date ? esc(ago(head.date)) : ''}</p>
        </div>
        <div class="banner-actions"><button class="button primary" id="applyButton" type="button">${icon('figma')}Apply in Figma</button></div>
      </div>`
    : `<div class="card banner sync">
        ${vennMark({ drift: 0 })}
        <div class="banner-copy">
          <span class="pill good">In step</span>
          <h2>Figma matches your code</h2>
          <p>Every token matches <span class="mono">${esc(short(workspace.syncedSha))}</span>. Venn checks GitHub every minute while this page is open.</p>
        </div>
      </div>`;

  const kindLabel = (c) => (c.kind === 'changed' ? 'Changed' : c.kind === 'added' ? 'New in code' : 'Removed');
  const lastTouch = (n) => { const hit = live.commits.find((c) => live.timeline.find((x) => x.commit.sha === c.sha)?.changed.has(n)); return hit ? `<span class="commit-ref"><span class="mono">${esc(short(hit.sha))}</span><span class="msg">${esc(hit.message)}</span></span>` : '—'; };
  const driftTable = changes.length
    ? `<div class="card">
        <div class="card-head"><div><h2>What changed</h2><p>Figma's value next to the value in code. Nothing in Figma moves until you apply it.</p></div></div>
        <div class="table-scroll"><table class="table">
          <thead><tr><th>Token</th><th>Figma</th><th>Code</th><th>Changed in</th></tr></thead>
          <tbody>${changes.map((c) => `<tr class="change">
            <td><div class="token-cell">${vennFor(c)}<span><span class="mono">${esc(c.token || c.name)}</span>${modeTag(c.mode)}<small>${kindLabel(c)}${c.beforeAlias !== c.afterAlias && c.before === c.after ? ' · same colour, new alias' : ''}</small></span></div></td>
            <td class="num from">${formatCell(c.type, c.before, c.beforeAlias)}</td>
            <td class="num to">${formatCell(c.type, c.after, c.afterAlias)}</td>
            <td>${lastTouch(c.name)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`
    : '';

  const pendingSet = new Set(commits.map((c) => c.sha));
  const statusFor = (c) => pendingSet.has(c.sha) ? '<span class="pill warn">Not in Figma</span>' : c.sha === workspace.syncedSha ? '<span class="pill good">Figma is here</span>' : '<span class="pill neutral">Earlier</span>';
  const changedCount = (sha) => { const x = live.timeline.find((y) => y.commit.sha === sha); return x ? (x.first ? '—' : x.changed.size) : '—'; };
  const pushes = `<div class="card">
      <div class="card-head"><div><h2>Recent pushes</h2><p>Every commit that touched the token file</p></div><a class="button" href="https://github.com/${esc(workspace.repo)}/commits" target="_blank" rel="noopener noreferrer">GitHub${icon('external')}</a></div>
      <div class="table-scroll"><table class="table">
        <thead><tr><th>Commit</th><th>Author</th><th>Pushed</th><th class="num">Tokens</th><th>Status</th></tr></thead>
        <tbody>${live.commits.slice(0, 8).map((c) => `<tr class="${pendingSet.has(c.sha) ? 'commit-row' : 'commit-row-synced'}">
          <td><div class="commit-cell"><a class="mono sha" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(short(c.sha))}</a><span class="msg">${esc(c.message)}</span></div></td>
          <td>${esc(c.author)}</td>
          <td class="muted">${c.date ? esc(ago(c.date)) : '—'}</td>
          <td class="num">${changedCount(c.sha)}</td>
          <td>${statusFor(c)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  body.innerHTML = `${banner}${driftTable}${pushes}`;
  if (changes.length) $('applyButton').addEventListener('click', () => openModal());
  renderTokensPage(changes);
}

function hasPreviewTokens() {
  return !!(live.head && live.synced && (live.head['radius/button'] || live.head['action/primary']));
}

function renderTokensPage(changes) {
  const root = $('tokensBody');
  if (live.loading || live.error || !live.head) { root.innerHTML = live.error ? `<div class="notice">${esc(live.error)}</div>` : '<div class="skeleton"></div>'; return; }
  root.innerHTML = `${renderMap()}<div class="grid-2 tokens-grid">${renderInventory(changes)}${hasPreviewTokens() ? previewCard() : ''}</div>`;
}

function renderHistory() {
  const root = $('historyList');
  if (!receipts.length) {
    root.innerHTML = `<div class="card empty"><svg class="mark" aria-hidden="true"><use href="#i-mark" /></svg><h2>Nothing applied yet</h2><p>After you apply changes in Figma, import the plugin's receipt here</p></div>`;
    return;
  }
  root.innerHTML = `<div class="card"><div class="table-scroll"><table class="table">
    <thead><tr><th>Applied</th><th>Token</th><th>Before</th><th>Read back</th><th>Commit</th><th>By</th></tr></thead>
    <tbody>${receipts.flatMap((r) => r.changes.map((c, i) => `<tr class="history-item">
      <td class="muted">${i === 0 ? esc(new Date(r.appliedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : ''}</td>
      <td><div class="token-cell">${vennFor({ ...c, before: /^\{/.test(c.before) ? null : c.before, after: c.value ?? c.readBack })}<span><span class="mono">${esc(c.name)}</span>${modeTag(c.mode)}${c.kind === 'created' ? '<small>Created</small>' : ''}</span></div></td>
      <td class="num from">${formatCell(c.type, c.before)}</td>
      <td class="num to">${formatCell(c.type, c.readBack)}</td>
      <td><span class="mono">${esc(short(r.sourceSha))}</span></td>
      <td>${esc(r.actor || 'Figma plugin')}</td>
    </tr>`)).join('')}</tbody>
  </table></div><div class="card-foot"><p>Values are read back by the plugin after writing, not independently verified</p></div></div>`;
}

function renderConnections() {
  const figma = workspace.figmaUrl
    ? `<a href="${esc(workspace.figmaUrl)}" target="_blank" rel="noopener noreferrer">${esc(workspace.figmaUrl.replace(/^https:\/\/(www\.)?/, ''))}</a>`
    : 'No file linked';
  $('connectionRows').innerHTML = `
    <div class="row"><span class="chip-icon neutral">${icon('github')}</span><div><strong>GitHub</strong><p><a href="https://github.com/${esc(workspace.repo)}" target="_blank" rel="noopener noreferrer">${esc(workspace.repo)}</a> · <span class="mono">${esc(workspace.path)}</span></p></div><span class="pill ${live.error ? 'warn' : 'good'}">${live.error ? 'Problem' : 'Connected'}</span></div>
    <div class="row"><span class="chip-icon violet">${icon('figma')}</span><div><strong>Figma file</strong><p>${figma}</p></div></div>
    <div class="row"><span class="chip-icon blue">${icon('commit')}</span><div><strong>Figma is up to date with</strong><p>Change this if your Figma file matches a different commit</p></div>
      <select class="select" id="baselineSelect" aria-label="Commit Figma matches">${live.commits.map((c) => `<option value="${esc(c.sha)}" ${c.sha === workspace.syncedSha ? 'selected' : ''}>${esc(short(c.sha))} · ${esc(c.message.slice(0, 40))}</option>`).join('')}${live.commits.some((c) => c.sha === workspace.syncedSha) ? '' : `<option selected>${esc(short(workspace.syncedSha))}</option>`}</select></div>
    <div class="row"><span class="chip-icon green">${icon('plug')}</span><div><strong>Figma plugin</strong><p>Reads this repository and updates the open file after you review it</p></div><a class="button" href="figma-plugin.zip" download>${icon('download')}Download</a></div>`;
  $('openFigma').href = workspace.figmaUrl || 'https://www.figma.com';
  const sel = $('baselineSelect');
  if (sel) sel.addEventListener('change', async () => {
    workspace.syncedSha = sel.value;
    save(KEYS.workspace, workspace);
    live.synced = await fetchTokens(workspace.repo, workspace.syncedSha, workspace.path).catch(() => null);
    render();
    toast('Venn now compares code with ' + short(sel.value));
  });
}

/* ---------- navigation, modal ---------- */
const PAGE_NAMES = { changes: 'Overview', tokens: 'Tokens', history: 'History', connections: 'Connections' };
function showPage(name) {
  if (!PAGE_NAMES[name]) return;
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('hidden', p.id !== 'page-' + name));
  document.querySelectorAll('.nav-link').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  $('pageCrumb').textContent = PAGE_NAMES[name];
  closeMenu();
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
}
function closeMenu() { $('app').classList.remove('menu-open'); $('scrim').classList.add('hidden'); }
function openModal() { $('applyModal').classList.remove('hidden'); $('closeModal').focus(); }
function closeModal() { $('applyModal').classList.add('hidden'); }

/* ---------- receipts ---------- */
function validateReceipt(data) {
  if (!data || data.schema !== RECEIPT_SCHEMA) throw new Error('This is not a Venn receipt.');
  if (data.sourceRepo !== workspace.repo || data.sourcePath !== workspace.path) throw new Error('This receipt is for a different repository.');
  if (!/^[0-9a-f]{40}$/.test(String(data.sourceSha))) throw new Error('The receipt has no valid commit.');
  if (!Array.isArray(data.changes) || !data.changes.length) throw new Error('The receipt lists no changes.');
  for (const c of data.changes) {
    if (typeof c.name !== 'string' || c.readBack !== c.after) throw new Error('A change in the receipt was not confirmed by Figma.');
  }
  if (Number.isNaN(new Date(data.appliedAt).getTime())) throw new Error('The receipt has no valid date.');
  return data;
}
async function recordReceipt(data) {
  const receipt = validateReceipt(data);
  receipts = [receipt, ...receipts.filter((r) => !(r.appliedAt === receipt.appliedAt && r.sourceSha === receipt.sourceSha))].slice(0, 50);
  save(KEYS.receipts, receipts);
  if (receipt.remainingDifferences > 0) {
    render();
    toast(`Update recorded. ${receipt.remainingDifferences} other ${receipt.remainingDifferences === 1 ? 'difference was' : 'differences were'} left for later, so Figma still needs review.`);
    return;
  }
  workspace.syncedSha = receipt.sourceSha;
  save(KEYS.workspace, workspace);
  live.synced = await fetchTokens(workspace.repo, workspace.syncedSha, workspace.path).catch(() => null);
  render();
  toast(`Update recorded. Figma is in step with ${short(receipt.sourceSha)}`);
}
async function importReceipt(file) {
  if (!file) return;
  if (file.size > 200000) throw new Error('Receipt file too large.');
  await recordReceipt(JSON.parse(await file.text()));
}
/* The plugin's "Record in Venn" opens this page with the receipt in the link: #receipt=<base64url JSON>. */
async function receiptFromLink() {
  if (!location.hash.startsWith('#receipt=')) return;
  const encoded = location.hash.slice('#receipt='.length);
  history.replaceState(null, '', location.pathname + location.search + '#changes');
  if (!workspace) { toast('Connect your repository first, then record the update again from the plugin.'); return; }
  try {
    const json = decodeURIComponent(escape(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))));
    await recordReceipt(JSON.parse(json));
    showPage('changes');
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That link did not contain a readable update.' : err.message);
  }
}

/* ---------- intro ---------- */
const INTRO_KEY = 'venn.intro.v1';
let slide = 0;
function showSlide(n) {
  if (!$('introMark').innerHTML) $('introMark').innerHTML = vennMark({ drift: 2, animate: true });
  slide = Math.max(0, Math.min(2, n));
  document.querySelectorAll('.slide').forEach((s) => s.classList.toggle('hidden', Number(s.dataset.slide) !== slide));
  document.querySelectorAll('#introDots button').forEach((d) => d.classList.toggle('active', Number(d.dataset.to) === slide));
  $('introBack').classList.toggle('hidden', slide === 0);
  $('introNext').textContent = slide === 2 ? 'Connect GitHub' : 'Next';
  $('intro').dataset.slide = String(slide);
}
function leaveIntro() {
  save(INTRO_KEY, true);
  $('intro').classList.add('hidden');
  $('onboarding').classList.remove('hidden');
  setStep(1);
  $('repoInput').focus();
}

/* ---------- onboarding: GitHub, then Figma ---------- */
const setup = { repo: '', path: '', commits: [], figmaUrl: '' };
function setStep(n) {
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('hidden', Number(s.dataset.step) !== n));
  document.querySelectorAll('#stepper li').forEach((li) => {
    const i = Number(li.dataset.step);
    li.classList.toggle('current', i === n);
    li.classList.toggle('done', i < n);
  });
}
function fieldError(id, message) {
  const el = $(id);
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}
async function submitRepo() {
  const repo = $('repoInput').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  const path = $('pathInput').value.trim().replace(/^\//, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return fieldError('repoError', 'Enter the repository as owner/name.');
  if (!path) return fieldError('repoError', 'Enter the path of your token file.');
  fieldError('repoError', '');
  const btn = $('repoNext');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const commits = await fetchCommits(repo, path);
    if (!commits.length) throw new GitHubError('No commits touch that file. Check the path.');
    const tokens = await fetchTokens(repo, commits[0].sha, path);
    if (!Object.keys(tokens).length) throw new GitHubError('No colour or number tokens found in that file. Venn reads W3C design-token JSON.');
    Object.assign(setup, { repo, path, commits });
    setStep(2);
  } catch (err) {
    fieldError('repoError', err instanceof GitHubError ? err.message : 'Something went wrong. Try again.');
  } finally { btn.disabled = false; btn.textContent = 'Continue'; }
}
function submitFigma(skip) {
  const url = $('figmaInput').value.trim();
  if (!skip && url && !/^https:\/\/(www\.)?figma\.com\/(design|file|board)\/[A-Za-z0-9]+/.test(url)) {
    return fieldError('figmaError', 'That does not look like a Figma file link.');
  }
  fieldError('figmaError', '');
  setup.figmaUrl = skip ? '' : url;
  // Start from the commit before the latest, so the latest push shows up as something to review.
  // It can be changed later on Connections.
  const start = setup.commits[Math.min(1, setup.commits.length - 1)].sha;
  workspace = { repo: setup.repo, path: setup.path, figmaUrl: setup.figmaUrl, syncedSha: start };
  save(KEYS.workspace, workspace);
  boot();
}

/* ---------- boot ---------- */
let pollTimer = null;
function boot() {
  const params = new URLSearchParams(location.search);
  const showIntro = !workspace && !load(INTRO_KEY, false) && !params.get('repo');
  $('intro').classList.toggle('hidden', !showIntro);
  $('onboarding').classList.toggle('hidden', !!workspace || showIntro);
  $('app').classList.toggle('hidden', !workspace);
  clearInterval(pollTimer);
  if (!workspace) {
    $('repoInput').value = params.get('repo') || '';
    $('pathInput').value = params.get('path') || 'tokens.json';
    if (showIntro) showSlide(0); else setStep(1);
    if (location.hash.startsWith('#receipt=')) receiptFromLink();
    return;
  }
  live.loading = true;
  render();
  const hash = location.hash.slice(1);
  showPage(PAGE_NAMES[hash] ? hash : 'changes');
  refresh({ manual: true }).then(receiptFromLink);
  pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
}

/* ---------- events ---------- */
document.querySelectorAll('.nav-link').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page)));
$('workspaceButton').addEventListener('click', () => showPage('connections'));
$('menuButton').addEventListener('click', () => { $('app').classList.add('menu-open'); $('scrim').classList.remove('hidden'); });
$('scrim').addEventListener('click', closeMenu);
$('closeModal').addEventListener('click', closeModal);
$('applyModal').addEventListener('click', (e) => { if (e.target === $('applyModal')) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closeMenu(); }
  if (!$('intro').classList.contains('hidden')) {
    if (e.key === 'ArrowRight') { if (slide === 2) leaveIntro(); else showSlide(slide + 1); }
    if (e.key === 'ArrowLeft') showSlide(slide - 1);
  }
});
$('checkNow').addEventListener('click', async () => {
  const btn = $('checkNow'); btn.disabled = true;
  await refresh({ manual: true });
  btn.disabled = false;
  if (!live.error) toast('Up to date with GitHub');
});
$('notifyButton').addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch { /* ignore */ }
  render();
});
$('receiptFile').addEventListener('change', async (e) => {
  try { await importReceipt(e.target.files[0]); } catch (err) { toast(err.message); } finally { e.target.value = ''; }
});
$('resetWorkspace').addEventListener('click', () => {
  if (!confirm('Disconnect this repository? Your recorded updates stay in this browser.')) return;
  workspace = null; save(KEYS.workspace, null); fileCache.clear(); commitsEtag = null;
  Object.assign(live, { commits: [], head: null, synced: null, timeline: [], error: null, checkedAt: null, loading: true });
  history.replaceState(null, '', location.pathname);
  boot();
});
$('skipIntro').addEventListener('click', leaveIntro);
$('introNext').addEventListener('click', () => { if (slide === 2) leaveIntro(); else showSlide(slide + 1); });
$('introBack').addEventListener('click', () => showSlide(slide - 1));
document.querySelectorAll('#introDots button').forEach((d) => d.addEventListener('click', () => showSlide(Number(d.dataset.to))));
$('repoNext').addEventListener('click', submitRepo);
$('useSample').addEventListener('click', () => { $('repoInput').value = SAMPLE.repo; $('pathInput').value = SAMPLE.path; submitRepo(); });
['repoInput', 'pathInput'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') submitRepo(); }));
$('figmaNext').addEventListener('click', () => submitFigma(false));
$('figmaSkip').addEventListener('click', () => submitFigma(true));
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#receipt=')) receiptFromLink(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && workspace) refresh(); });

boot();
