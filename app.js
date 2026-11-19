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
function formatValue(type, value) {
  if (value === null) return '—';
  return type === 'color'
    ? `<span class="swatch" style="background:${esc(value)}"></span>${esc(value)}`
    : esc(value);
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
const live = { commits: [], head: null, synced: null, error: null, checkedAt: null, loading: true };
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
function render() {
  if (!workspace) return;
  const { changes, commits } = pending();
  $('workspaceName').textContent = workspace.repo.split('/')[1];
  $('workspaceFile').textContent = workspace.path;
  $('crumbRepo').textContent = workspace.repo;
  const count = changes.length;
  $('navCount').textContent = count;
  $('navCount').classList.toggle('hidden', !count);
  document.title = count ? `(${count}) Venn` : 'Venn';

  const watch = $('watch');
  watch.className = 'watch ' + (live.error ? 'error' : live.checkedAt ? 'live' : '');
  $('watchText').textContent = live.error ? 'Not connected' : live.checkedAt ? 'Watching for pushes' : 'Connecting…';

  renderChanges(changes, commits);
  renderHistory();
  renderConnections();
  const canNotify = 'Notification' in window && Notification.permission === 'default';
  $('notifyButton').classList.toggle('hidden', !canNotify);
}

function specimenFor(changes) {
  const relevant = changes.some((c) => /^(radius|action|text)\//.test(c.name));
  if (!relevant || !live.head || !live.synced) return '';
  const style = (t) => {
    const radius = t['radius/button']?.value ?? 8;
    const bg = t['action/primary']?.value ?? '#0A7A4B';
    const fg = t['text/on-brand']?.value ?? '#FFFFFF';
    return `border-radius:${radius}px;background:${esc(bg)};color:${esc(fg)}`;
  };
  return `<div class="specimens" aria-label="Before and after preview">
    <div class="specimen-cell"><label>At last sync · ${esc(short(workspace.syncedSha))}</label><button class="specimen" tabindex="-1" style="${style(live.synced)}">Continue</button></div>
    <div class="specimen-cell"><label>In code · ${esc(short(live.commits[0].sha))}</label><button class="specimen" tabindex="-1" style="${style(live.head)}">Continue</button></div>
  </div>`;
}

function renderChanges(changes, commits) {
  const body = $('changesBody');
  const sub = $('changesSub');
  if (live.loading) { sub.textContent = 'Checking GitHub…'; body.innerHTML = ''; return; }
  if (live.error) {
    sub.textContent = 'Could not check GitHub.';
    body.innerHTML = `<div class="notice" role="alert">${esc(live.error)}</div>`;
    return;
  }
  const head = live.commits[0];
  sub.textContent = live.checkedAt ? `Last checked ${ago(new Date(live.checkedAt).toISOString())}.` : '';
  if (!changes.length) {
    body.innerHTML = `<div class="panel empty">
      <div class="empty-mark" aria-hidden="true">✓</div>
      <h2>Figma matches your code</h2>
      <p>No token differences since the commit your Figma file was last synced to.</p>
      <span class="sha">${esc(short(workspace.syncedSha))}</span>
    </div>`;
    return;
  }
  const rows = changes.map((c) => `<div class="change">
      <div class="change-name">${esc(c.name)}<small>${c.kind === 'changed' ? 'Changed' : c.kind === 'added' ? 'New in code' : 'Removed from code'} · ${esc(c.type)}</small></div>
      <div class="values"><span class="old">${formatValue(c.type, c.before)}</span><span class="arrow">→</span><span>${formatValue(c.type, c.after)}</span></div>
    </div>`).join('');
  const commitRows = commits.map((c) => `<div class="commit-row">
      <div><strong>${esc(c.message)}</strong><small>${esc(c.author)} · ${c.date ? esc(ago(c.date)) : ''}</small></div>
      <a class="sha" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(short(c.sha))}</a>
    </div>`).join('');
  body.innerHTML = `<div class="panel">
      <div class="panel-top">
        <div><h2>${changes.length === 1 ? '1 token changed' : changes.length + ' tokens changed'} since Figma was last synced</h2><p>Latest commit ${esc(short(head.sha))} · ${esc(head.message)}</p></div>
        <span class="tag">Needs review</span>
      </div>
      ${rows}
      ${specimenFor(changes)}
      <div class="panel-actions"><span>Figma changes only after you review it in the plugin.</span><button class="button solid" id="applyButton" type="button">Apply with plugin</button></div>
    </div>
    <div class="section-label">Commits since last sync</div>
    <div class="panel">${commitRows}</div>`;
  $('applyButton').addEventListener('click', () => openModal());
}

function renderHistory() {
  const root = $('historyList');
  if (!receipts.length) {
    root.innerHTML = `<div class="panel empty"><h2>Nothing applied yet</h2><p>After you apply changes in Figma, import the plugin's receipt here. History is stored in this browser.</p></div>`;
    return;
  }
  root.innerHTML = `<div class="panel">${receipts.map((r) => `<div class="history-item">
      <header><strong>${r.changes.length} ${r.changes.length === 1 ? 'variable' : 'variables'} updated in Figma</strong><small>${esc(new Date(r.appliedAt).toLocaleString())}</small></header>
      <div>${r.changes.map((c) => `<div class="values"><span>${esc(c.name)}</span><span class="old">${formatValue(c.type, c.before)}</span><span class="arrow">→</span><span>${formatValue(c.type, c.readBack)}</span></div>`).join('')}</div>
      <small>${esc(r.actor || 'Figma plugin')} · commit ${esc(short(r.sourceSha))} · read back by the plugin, not independently verified</small>
    </div>`).join('')}</div>`;
}

function renderConnections() {
  const figma = workspace.figmaUrl
    ? `<a href="${esc(workspace.figmaUrl)}" target="_blank" rel="noopener noreferrer">${esc(workspace.figmaUrl)}</a>`
    : 'No file linked. Add one by disconnecting and starting over.';
  $('connectionRows').innerHTML = `
    <div class="row"><div><strong>GitHub</strong><p><a href="https://github.com/${esc(workspace.repo)}" target="_blank" rel="noopener noreferrer">${esc(workspace.repo)}</a> · ${esc(workspace.path)}</p></div><span class="tag ok">${live.error ? 'Problem' : 'Connected'}</span></div>
    <div class="row"><div><strong>Figma file</strong><p>${figma}</p></div></div>
    <div class="row"><div><strong>Last synced commit</strong><p>${esc(short(workspace.syncedSha))}</p></div></div>
    <div class="row"><div><strong>Figma plugin</strong><p>Reads this repository and updates the open file after you review it.</p></div><a class="button quiet" href="figma-plugin.zip" download>Download</a></div>`;
  $('openFigma').href = workspace.figmaUrl || 'https://www.figma.com';
}

/* ---------- navigation, modal ---------- */
const PAGE_NAMES = { changes: 'Changes', history: 'History', connections: 'Connections' };
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
async function importReceipt(file) {
  if (!file) return;
  if (file.size > 200000) throw new Error('Receipt file too large.');
  const receipt = validateReceipt(JSON.parse(await file.text()));
  receipts = [receipt, ...receipts.filter((r) => !(r.appliedAt === receipt.appliedAt && r.sourceSha === receipt.sourceSha))].slice(0, 50);
  save(KEYS.receipts, receipts);
  if (receipt.remainingDifferences > 0) {
    render();
    toast(`Receipt added. ${receipt.remainingDifferences} other ${receipt.remainingDifferences === 1 ? 'difference was' : 'differences were'} left unapplied, so the sync point did not move.`);
    return;
  }
  workspace.syncedSha = receipt.sourceSha;
  save(KEYS.workspace, workspace);
  live.synced = await fetchTokens(workspace.repo, workspace.syncedSha, workspace.path).catch(() => null);
  render();
  toast('Receipt added. Figma is now synced to ' + short(receipt.sourceSha) + '.');
}

/* ---------- onboarding ---------- */
const setup = { repo: '', path: '', commits: [], figmaUrl: '', baseline: null };
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
  renderBaselinePicker();
  setStep(3);
}
function renderBaselinePicker() {
  setup.baseline = setup.commits[Math.min(1, setup.commits.length - 1)].sha;
  const root = $('baselinePicker');
  root.innerHTML = setup.commits.map((c) => `<button type="button" class="commit-option" role="radio" aria-checked="${c.sha === setup.baseline}" data-sha="${esc(c.sha)}">
      <span class="radio"></span><span><strong>${esc(c.message)}</strong><small>${esc(c.author)} · ${c.date ? esc(ago(c.date)) : ''}</small></span><span class="sha">${esc(short(c.sha))}</span>
    </button>`).join('');
  root.querySelectorAll('.commit-option').forEach((b) => b.addEventListener('click', () => {
    setup.baseline = b.dataset.sha;
    root.querySelectorAll('.commit-option').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
  }));
}
function finishSetup() {
  workspace = { repo: setup.repo, path: setup.path, figmaUrl: setup.figmaUrl, syncedSha: setup.baseline };
  save(KEYS.workspace, workspace);
  boot();
}

/* ---------- boot ---------- */
let pollTimer = null;
function boot() {
  $('onboarding').classList.toggle('hidden', !!workspace);
  $('app').classList.toggle('hidden', !workspace);
  clearInterval(pollTimer);
  if (!workspace) {
    const params = new URLSearchParams(location.search);
    $('repoInput').value = params.get('repo') || '';
    $('pathInput').value = params.get('path') || 'tokens.json';
    setStep(1);
    return;
  }
  live.loading = true;
  render();
  showPage(PAGE_NAMES[location.hash.slice(1)] ? location.hash.slice(1) : 'changes');
  refresh({ manual: true });
  pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
}

/* ---------- events ---------- */
document.querySelectorAll('.nav-link').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page)));
$('workspaceButton').addEventListener('click', () => showPage('connections'));
$('menuButton').addEventListener('click', () => { $('app').classList.add('menu-open'); $('scrim').classList.remove('hidden'); });
$('scrim').addEventListener('click', closeMenu);
$('closeModal').addEventListener('click', closeModal);
$('applyModal').addEventListener('click', (e) => { if (e.target === $('applyModal')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeMenu(); } });
$('checkNow').addEventListener('click', async () => {
  const btn = $('checkNow'); btn.disabled = true;
  await refresh({ manual: true });
  btn.disabled = false;
  if (!live.error) toast('Up to date with GitHub.');
});
$('notifyButton').addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch { /* ignore */ }
  render();
});
$('receiptFile').addEventListener('change', async (e) => {
  try { await importReceipt(e.target.files[0]); } catch (err) { toast(err.message); } finally { e.target.value = ''; }
});
$('resetWorkspace').addEventListener('click', () => {
  if (!confirm('Disconnect this repository? Your imported receipts stay in this browser.')) return;
  workspace = null; save(KEYS.workspace, null); fileCache.clear(); commitsEtag = null;
  Object.assign(live, { commits: [], head: null, synced: null, error: null, checkedAt: null, loading: true });
  history.replaceState(null, '', location.pathname);
  boot();
});
$('repoNext').addEventListener('click', submitRepo);
$('useSample').addEventListener('click', () => { $('repoInput').value = SAMPLE.repo; $('pathInput').value = SAMPLE.path; submitRepo(); });
['repoInput', 'pathInput'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') submitRepo(); }));
$('figmaNext').addEventListener('click', () => submitFigma(false));
$('figmaSkip').addEventListener('click', () => submitFigma(true));
$('baselineBack').addEventListener('click', () => setStep(2));
$('finishSetup').addEventListener('click', finishSetup);
document.addEventListener('visibilitychange', () => { if (!document.hidden && workspace) refresh(); });

boot();
