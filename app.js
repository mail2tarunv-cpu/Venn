'use strict';
const $ = id => document.getElementById(id);
let source = null;
let page = 'changes';
const KEY = 'venn-penny-mvp-receipts-v1';
const pageNames = {changes:'Changes',history:'History',setup:'Connections'};
const escapeHTML = input => String(input).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(message){const t=$('toast');t.textContent=message;t.classList.remove('hidden');clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.classList.add('hidden'),4200);}
function switchPage(next){if(!pageNames[next])return;page=next;for(const view of document.querySelectorAll('.page'))view.classList.toggle('hidden',view.id!=='page-'+next);for(const b of document.querySelectorAll('[data-page]'))b.classList.toggle('active',b.dataset.page===next);$('pageCrumb').textContent=pageNames[next];$('shell').classList.remove('menu-open');$('scrim').classList.add('hidden');history.replaceState({},'',next==='changes'?location.pathname:'#'+next);window.scrollTo({top:0,behavior:'instant'});if(next==='history')renderHistory();}
function showModal(){ $('syncModal').classList.remove('hidden');$('closeModal').focus();}
function hideModal(){ $('syncModal').classList.add('hidden');}
function readHistory(){try{return JSON.parse(localStorage.getItem(KEY))||[]}catch{return[]}}
function renderHistory(){const items=readHistory();const root=$('historyList');if(!items.length){root.innerHTML='<div class="empty-history"><h2>No update recorded yet</h2><p>After applying the change in Figma, import the plugin\'s receipt here. This history is stored in this browser.</p></div>';return;}
root.innerHTML=items.map(r=>`<div class="history-item"><span class="history-icon material-symbols-rounded">check_circle</span><div class="history-copy"><strong>Button radius updated in Figma</strong><p>${escapeHTML(r.tokenName)} · ${escapeHTML(r.before)}px → ${escapeHTML(r.after)}px · Read back: ${escapeHTML(r.readBack)}px</p><small>${escapeHTML(r.actor||'Figma plugin')} · ${escapeHTML(new Date(r.appliedAt).toLocaleString())} · Local plugin receipt (not independently verified)</small></div><span class="state-tag">Applied</span></div>`).join('');}
function validateReceipt(data){if(!source||data?.schema!=='design-drift/penny-receipt-v1')throw Error('This is not a Venn Penny receipt.');const c=source.changes[0];if(data.fileKey!==source.target.figmaFileKey||data.collection!==source.target.collection||data.tokenName!==c.name||data.after!==c.proposed||data.readBack!==c.proposed||typeof data.before!=='number'||typeof data.appliedAt!=='string'||isNaN(Date.parse(data.appliedAt)))throw Error('The receipt does not match the current Penny test.');return {tokenName:data.tokenName,before:data.before,after:data.after,readBack:data.readBack,appliedAt:data.appliedAt,actor:typeof data.actor==='string'?data.actor:'Figma plugin',fileKey:data.fileKey};}
async function importReceipt(file){if(!file)return;if(file.size>100000)throw Error('Receipt file too large.');const data=validateReceipt(JSON.parse(await file.text()));const previous=readHistory().filter(r=>!(r.tokenName===data.tokenName&&r.appliedAt===data.appliedAt));localStorage.setItem(KEY,JSON.stringify([data,...previous].slice(0,20)));renderHistory();notify('Plugin receipt added to local history.');}
async function loadSource(){const r=await fetch('./source.json',{cache:'no-store'});if(!r.ok)throw Error('Published source is unavailable');const d=await r.json();if(d.schema!=='design-drift/source-v1'||d.target?.figmaFileKey!=='nfPIHqVPJv4OJ5yOavc1ha'||!Array.isArray(d.changes)||d.changes.length!==1)throw Error('Unexpected source format');source=d;const c=d.changes[0];if(c.name!=='radius/button'||c.expectedBaseline!==2||c.proposed!==12)throw Error('Expected demo token is missing');$('sourceCheck').textContent='Published';$('sourceLocation').textContent=`${d.source.repository} · ${d.source.branch} · ${d.source.file}`;}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>switchPage(b.dataset.page)));
document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>switchPage(b.dataset.jump)));
$('openSyncInstructions').addEventListener('click',showModal);
$('closeModal').addEventListener('click',hideModal);
$('syncModal').addEventListener('click',e=>{if(e.target===$('syncModal'))hideModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideModal();$('shell').classList.remove('menu-open');$('scrim').classList.add('hidden')}});
$('menuButton').addEventListener('click',()=>{$('shell').classList.toggle('menu-open');$('scrim').classList.toggle('hidden',!$('shell').classList.contains('menu-open'))});
$('scrim').addEventListener('click',()=>{$('shell').classList.remove('menu-open');$('scrim').classList.add('hidden')});
$('receiptFile').addEventListener('change',async e=>{try{await importReceipt(e.target.files[0])}catch(err){notify(err.message)}finally{e.target.value=''}});
(async()=>{try{await loadSource()}catch(err){$('sourceCheck').textContent='Unavailable';$('openSyncInstructions').disabled=true;notify(err.message)}renderHistory();let initial=(location.hash||'').slice(1);switchPage(pageNames[initial]?initial:'changes');})();
