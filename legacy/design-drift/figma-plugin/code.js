/* Design Drift Sync: opt-in, variable-only GitHub -> Figma sync.
   The plugin only changes tokens in a collection named Penny / Test tokens.
   It does not edit the original Penny library or arbitrary components. */
figma.showUI(__html__, {width: 420, height: 480, themeColors: true});
const DEFAULT_URL='https://raw.githubusercontent.com/mail2tarunv-cpu/tarun-portfolio/experiment/design-drift/experiments/design-drift/sync/penny.tokens.json';
function hexToColor(hex){if(!/^#[0-9a-fA-F]{6}$/.test(hex))throw new Error('Invalid hex color: '+hex);return {r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255};}
function toHex(c){return '#'+[c.r,c.g,c.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('').toUpperCase()}
const ALLOWED=['action/primary','text/on-brand','text/primary','background/page','radius/button','spacing/component'];
function validateUrl(u){const url=new URL(u);if(url.protocol!=='https:'||url.hostname!=='raw.githubusercontent.com'||!url.pathname.includes('/experiments/design-drift/sync/'))throw new Error('Use a public Design Drift token JSON URL on raw.githubusercontent.com.');return url.toString();}
async function findCollection(){const collections=await figma.variables.getLocalVariableCollectionsAsync();const collection=collections.find(c=>c.name==='Penny / Test tokens');if(!collection)throw new Error('Penny / Test tokens collection not found. Open the Design Drift test file.');return collection;}
async function collect(){const col=await findCollection();const all=await figma.variables.getLocalVariablesAsync();const out={};for(const v of all.filter(v=>v.variableCollectionId===col.id && ALLOWED.includes(v.name))){let val=v.valuesByMode[col.defaultModeId];out[v.name]={type:v.resolvedType==='COLOR'?'color':'number',value:v.resolvedType==='COLOR'?toHex(val):val};}return {collection:col,tokens:out};}
// GitHub updates use an explicit pull request on a new branch. Never change the base branch directly.
const GITHUB_REPO='mail2tarunv-cpu/tarun-portfolio';
const GITHUB_BASE='experiment/design-drift';
const GITHUB_PATH='experiments/design-drift/sync/penny.tokens.json';
async function githubJson(path, token, options={}){
 const response=await fetch('https://api.github.com/repos/'+GITHUB_REPO+path,{
   ...options,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token,...(options.headers||{})}
 });
 if(!response.ok)throw new Error('GitHub request failed (HTTP '+response.status+'). Check the token permissions and repository access.');
 return response.json();
}
async function proposeFigmaTokens(token){
 if(typeof token!=='string'||token.length<10)throw new Error('Enter a GitHub fine-grained token with Contents: Read and write and Pull requests: Read and write for this repository.');
 const snapshot=await collect();
 const current=await githubJson('/contents/'+GITHUB_PATH+'?ref='+encodeURIComponent(GITHUB_BASE),token);
 const baseText=decodeURIComponent(Array.from(atob(current.content.replace(/\s/g,'')),ch=>'%'+ch.charCodeAt(0).toString(16).padStart(2,'0')).join(''));
 const data=JSON.parse(baseText);
 if(!data.tokens || typeof data.tokens!=='object')throw new Error('Unexpected token file.');
 const changed=[];
 for(const name of ALLOWED){if(!snapshot.tokens[name]||!data.tokens[name])continue;const value=snapshot.tokens[name].value;
 if(String(data.tokens[name].value).toUpperCase()!==String(value).toUpperCase()){
  changed.push({name,from:data.tokens[name].value,to:value});data.tokens[name].value=value;
 }}
 if(!changed.length)return {unchanged:true,changes:[]};
 const base=await githubJson('/git/ref/heads/'+GITHUB_BASE,token);
 const branch='design-drift/figma-'+Date.now().toString(36);
 await githubJson('/git/refs',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:'refs/heads/'+branch,sha:base.object.sha})});
 const payload=JSON.stringify(data,null,2)+'\n';
 await githubJson('/contents/'+GITHUB_PATH,token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Sync Penny token changes from Figma',content:btoa(unescape(encodeURIComponent(payload))),sha:current.sha,branch})});
 const pr=await githubJson('/pulls',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Sync Penny design tokens from Figma',head:branch,base:GITHUB_BASE,body:'Updates from the isolated Design Drift Penny Figma test file.\n\nChanges:\n'+changed.map(c=>'- '+c.name+': '+c.from+' → '+c.to).join('\n')+'\n\nReview before merging.'})});
 return {unchanged:false,changes:changed,url:pr.html_url};
}
figma.ui.onmessage=async(msg)=>{
 if(msg.type==='snapshot')try{const c=await collect();figma.ui.postMessage({type:'snapshot',tokens:c.tokens});}catch(e){figma.ui.postMessage({type:'error',message:e.message})}
 if(msg.type==='preview'||msg.type==='apply')try{
   const url=validateUrl(msg.url||DEFAULT_URL);const r=await fetch(url);if(!r.ok)throw new Error('GitHub token file returned HTTP '+r.status);const data=await r.json();const c=await collect();let changes=[];
   for(const name of ALLOWED){const entry=data.tokens?.[name];if(!entry)continue;if(entry.type!=='color'&&entry.type!=='number')continue;const existing=c.tokens[name];if(!existing)continue;const to=entry.value;const changed=String(existing.value).toUpperCase()!==String(to).toUpperCase();if(changed)changes.push({name,from:existing.value,to});}
   if(msg.type==='preview'){figma.ui.postMessage({type:'preview',changes,version:data.version});return;}
   if(!msg.confirmed){throw new Error('Review and confirm the changes before applying.');}
   const vars=await figma.variables.getLocalVariablesAsync();for(const change of changes){const variable=vars.find(v=>v.variableCollectionId===c.collection.id&&v.name===change.name);if(!variable)continue;const entry=data.tokens[change.name];const val=entry.type==='color'?hexToColor(entry.value):Number(entry.value);if(typeof val==='number'&&!Number.isFinite(val))throw new Error('Invalid numeric value for '+change.name);variable.setValueForMode(c.collection.defaultModeId,val);}
   figma.ui.postMessage({type:'applied',changes,version:data.version});figma.notify(changes.length+' Penny token'+(changes.length===1?'':'s')+' updated');
 }catch(e){figma.ui.postMessage({type:'error',message:e.message||String(e)})}
 if(msg.type==='export')try{const c=await collect();figma.ui.postMessage({type:'export',tokens:c.tokens});}catch(e){figma.ui.postMessage({type:'error',message:e.message})}
 if(msg.type==='propose')try{const result=await proposeFigmaTokens(msg.token);figma.ui.postMessage({type:'proposed',...result});}catch(e){figma.ui.postMessage({type:'error',message:e.message})}
};