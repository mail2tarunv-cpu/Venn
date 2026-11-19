/* Venn Sync — development plugin.
   Reads/writes explicit mappings in the currently open Figma file.
   No background execution and no credentials stored. */
figma.showUI(__html__,{width:480,height:620,themeColors:true});
const DEFAULT_COLLECTION='Penny / Test tokens';
const status={manifest:null,receipt:null,preview:null};
const rawRepo='mail2tarunv-cpu/Venn',defaultBase='automation-prototype';
const toHex=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('').toUpperCase();
const toColor=hex=>{if(!/^#[0-9a-fA-F]{6}$/.test(hex))throw Error('Expected a six-digit hex color.');return {r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255,a:1}};
const eq=(a,b)=>typeof a==='number'&&typeof b==='number'?Math.abs(a-b)<1e-7:String(a).toLowerCase()===String(b).toLowerCase();
const emit=(type,data)=>figma.ui.postMessage({type,...data});
const owner=()=>figma.currentUser?{name:figma.currentUser.name||'Figma user',id:figma.currentUser.id||null}:{name:'Unidentified Figma user',id:null};
async function getCollection(name){const list=await figma.variables.getLocalVariableCollectionsAsync();const c=list.find(x=>x.name===name);if(!c)throw Error(`Variable collection not found: ${name}`);return c}
async function snapshot(collectionName=DEFAULT_COLLECTION){const c=await getCollection(collectionName),all=await figma.variables.getLocalVariablesAsync();const tokens={};for(const v of all.filter(x=>x.variableCollectionId===c.id)){const raw=v.valuesByMode[c.defaultModeId];if(raw==null||raw.type==='VARIABLE_ALIAS')continue;const type=({COLOR:'color',FLOAT:'number',STRING:'string',BOOLEAN:'boolean'})[v.resolvedType];if(!type)continue;tokens[v.name]={type,value:type==='color'?toHex(raw):raw};}return {schema:'design-drift/snapshot-v1',fileKey:figma.fileKey||null,fileName:figma.root.name,collection:c.name,capturedAt:new Date().toISOString(),source:'Exported from Venn Figma plugin',actor:owner(),tokens};}
const isNum=x=>typeof x==='number'&&Number.isFinite(x);
function validManifest(m){if(!m||m.schema!=='design-drift/manifest-v1'||!m.id||!m.target||!m.source||!Array.isArray(m.operations)||!m.operations.length)throw Error('Choose a valid Venn update manifest.');if(m.operations.length>250)throw Error('Too many operations in a single update.');if(!m.target.collectionName)throw Error('Manifest has no variable collection.');if(m.target.figmaFileKey&&figma.fileKey&&m.target.figmaFileKey!==figma.fileKey)throw Error('This update targets a different Figma file.');for(const o of m.operations){if(o.kind!=='variable'&&o.kind!=='node')throw Error('Unsupported operation kind.');if(!o.name||!['color','number','string','boolean'].includes(o.type))throw Error('Unsupported operation type.');if(o.kind==='node'&&(!o.nodeId||!['cornerRadius','paddingTop','paddingRight','paddingBottom','paddingLeft','itemSpacing','characters'].includes(o.property)))throw Error('Unsupported component property.');}return m}
function typeOfVariable(v){return ({COLOR:'color',FLOAT:'number',STRING:'string',BOOLEAN:'boolean'})[v.resolvedType]}
function getValue(raw,type){return type==='color'?toHex(raw):raw}
function rawValue(value,type){if(type==='color')return toColor(value);if(type==='number'&&!isNum(value))throw Error('Expected numeric value.');if(type==='boolean'&&typeof value!=='boolean')throw Error('Expected boolean.');if(type==='string'&&typeof value!=='string')throw Error('Expected text.');return value}
async function getNodeChange(o){const node=await figma.getNodeByIdAsync(o.nodeId);if(!node)throw Error(`Component node not found: ${o.nodeId}`);if(o.property==='characters'&&node.type!=='TEXT')throw Error('Text operations require a text node.');if(!(o.property in node))throw Error(`Property ${o.property} is not supported on this node.`);if(o.property==='characters')await figma.loadFontAsync(node.fontName);return {node,current:node[o.property]};}
async function plan(m){validManifest(m);const c=await getCollection(m.target.collectionName),vars=await figma.variables.getLocalVariablesAsync();const checks=[];for(const o of m.operations){let current,ref;
 if(o.kind==='variable'){const variable=vars.find(v=>v.variableCollectionId===c.id&&v.name===o.name);if(!variable)throw Error('Mapped variable not found: '+o.name);if(typeOfVariable(variable)!==o.type)throw Error('Type mismatch for '+o.name);const raw=variable.valuesByMode[c.defaultModeId];if(raw==null||raw.type==='VARIABLE_ALIAS')throw Error('Alias values must be updated in their source variable.');current=getValue(raw,o.type);ref={variable,mode:c.defaultModeId};}
 else{const result=await getNodeChange(o);current=result.current;ref={node:result.node,property:o.property};}
 checks.push({name:o.name,kind:o.kind,expected:o.expected,actual:current,to:o.value,status:eq(current,o.expected)?'ready':'conflict',reference:ref});}
 return checks;
}
async function apply(m){const checks=await plan(m);const conflicts=checks.filter(c=>c.status==='conflict');if(conflicts.length)throw Error(`${conflicts.length} stale value${conflicts.length===1?'':'s'} detected. Export a new Figma snapshot and review the differences again; nothing was applied.`);const performed=[];try{for(let i=0;i<checks.length;i++){const c=checks[i],o=m.operations[i];const raw=rawValue(o.value,o.type);if(o.kind==='variable'){c.reference.variable.setValueForMode(c.reference.mode,raw)}else{c.reference.node[c.reference.property]=raw}performed.push({c,from:c.actual,after:o.value});}}catch(e){for(let i=performed.length-1;i>=0;i--){const {c,from}=performed[i];try{const old=rawValue(from,m.operations[checks.indexOf(c)].type);if(c.kind==='variable')c.reference.variable.setValueForMode(c.reference.mode,old);else c.reference.node[c.reference.property]=old}catch{}}throw Error('Figma could not apply all changes. The plugin attempted to restore previous values. '+e.message)}
 const receipt={schema:'design-drift/receipt-v1',manifestId:m.id,fileKey:figma.fileKey||m.target.figmaFileKey||null,figmaFileName:figma.root.name,actor:owner(),appliedAt:new Date().toISOString(),source:m.source,operations:performed.map(({c,from,after})=>({kind:c.kind,name:c.name,before:from,after}))};status.receipt=receipt;return receipt;
}
// A development-only reverse path; GitHub token is accepted for a single request and never stored.
async function github(path,token,opts={}){const r=await fetch('https://api.github.com/repos/'+rawRepo+path,{...opts,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token,...(opts.headers||{})}});if(!r.ok)throw Error('GitHub HTTP '+r.status+'; check repository permissions.');return r.json()}
async function propose(token,collectionName=DEFAULT_COLLECTION){if(typeof token!=='string'||token.length<20)throw Error('Use a fine-grained GitHub token scoped to this test repository.');const snap=await snapshot(collectionName),path='sync/penny.tokens.json';const file=await github('/contents/'+path+'?ref='+encodeURIComponent(defaultBase),token);const text=new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')),x=>x.charCodeAt(0)));const d=JSON.parse(text);const changes=[];for(const [name,entry]of Object.entries(d.tokens||{})){const local=snap.tokens[name];if(!local||local.type!==entry.type||eq(local.value,entry.value))continue;changes.push({name,before:entry.value,after:local.value});entry.value=local.value;}if(!changes.length)return {unchanged:true};const base=await github('/git/ref/heads/'+defaultBase,token);const branch='design-drift/figma-'+Date.now().toString(36);await github('/git/refs',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:'refs/heads/'+branch,sha:base.object.sha})});const payload=btoa(unescape(encodeURIComponent(JSON.stringify(d,null,2)+'\n')));await github('/contents/'+path,token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Propose mapped Figma token changes',branch,sha:file.sha,content:payload})});const pr=await github('/pulls',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Review Figma token updates',base:defaultBase,head:branch,body:'Proposed from the Venn Figma plugin. Changes:\n'+changes.map(x=>`- ${x.name}: ${x.before} → ${x.after}`).join('\n')+'\n\nReview before merging.',draft:true})});return {unchanged:false,url:pr.html_url,changes}}

// Hosted queue: credentials remain in plugin memory only. Figma plugins cannot run unattended.
const API='https://design-drift-tarun.vercel.app';
let liveConfig=null,liveTimer=null,liveBusy=false,lastSnapshotAt=0,pendingReceipts=[];
async function liveFetch(path,options={}){
 if(!liveConfig)throw Error('Pair the current Figma file with Venn first.');
 const res=await fetch(API+'/api/plugin/'+liveConfig.workspace+path,{...options,headers:{'Content-Type':'application/json','X-DD-Plugin-Key':liveConfig.key,...(options.headers||{})}});
 const data=await res.json();if(!res.ok)throw Error(data.error||'Could not reach Venn');return data;
}
async function publishSnapshot(){
 const snap=await snapshot(liveConfig.collection);
 if(snap.fileKey!==liveConfig.fileKey)throw Error('The open Figma file does not match the paired workspace.');
 return liveFetch('/snapshot',{method:'POST',body:JSON.stringify(snap)});
}
async function syncQueue(){
 if(!liveConfig||liveBusy)return;liveBusy=true;
 try{
  while(pendingReceipts.length){await liveFetch('/receipt',{method:'POST',body:JSON.stringify(pendingReceipts[0])});pendingReceipts.shift();}
  if(!lastSnapshotAt||Date.now()-lastSnapshotAt>300000){await publishSnapshot();lastSnapshotAt=Date.now();}
  const result=await liveFetch('/jobs');const jobs=result.jobs||[];
  if(result.figmaFileKey!==figma.fileKey||result.collection!==liveConfig.collection)throw Error('Connected workspace targets another Figma file');
  const applied=[],skipped=[];
  for(const job of jobs){
   if(job.kind!=='variable'||!['color','number','string','boolean'].includes(job.type)){skipped.push(job.name);continue;}
   const manifest={schema:'design-drift/manifest-v1',id:'server-'+job.id,target:{figmaFileKey:figma.fileKey,collectionName:liveConfig.collection},source:{sha:job.sourceSha},operations:[{kind:'variable',name:job.name,type:job.type,expected:job.expected,value:job.value}]};
   try{
    const checks=await plan(manifest);
    if(checks.some(c=>c.status!=='ready')){skipped.push(job.name);applied.push({id:job.id,name:job.name,before:job.expected,after:job.value,readBack:checks[0]?.actual});continue;}
    const receipt=await apply(manifest);
    const after=await plan({...manifest,operations:[{...manifest.operations[0],expected:job.value}]});
    const readBack=after[0]?.actual;
    applied.push({id:job.id,name:job.name,before:checks[0].actual,after:job.value,readBack});
   }catch(error){skipped.push(job.name);emit('liveError',{message:job.name+': '+error.message});}
  }
  if(applied.length){const receipt={schema:'design-drift/receipt-v1',fileKey:figma.fileKey,actor:owner(),appliedAt:new Date().toISOString(),operations:applied};pendingReceipts.push(receipt);await liveFetch('/receipt',{method:'POST',body:JSON.stringify(receipt)});pendingReceipts.shift();await publishSnapshot();lastSnapshotAt=Date.now();}
  emit('liveUpdate',{applied:applied.length,skipped,remaining:jobs.length-applied.length});
 }catch(e){emit('liveError',{message:e.message})}finally{liveBusy=false}
}
function stopLive(){if(liveTimer){clearInterval(liveTimer);liveTimer=null;}liveConfig=null;lastSnapshotAt=0;emit('liveStopped',{});}
async function startLive(msg){
 stopLive();if(!/^[a-f0-9-]{36}$/i.test(msg.workspace||'')||typeof msg.key!=='string'||msg.key.length<24)throw Error('Enter a valid workspace ID and pairing key.');
 if(!figma.fileKey)throw Error('Save your Figma document before connecting it.');
 liveConfig={workspace:msg.workspace,key:msg.key,fileKey:figma.fileKey,collection:msg.collection};
 await syncQueue();liveTimer=setInterval(syncQueue,20000);emit('liveStarted',{fileKey:figma.fileKey});
}
figma.ui.onmessage=async msg=>{try{
 if(msg.type==='liveStart')await startLive(msg);
 if(msg.type==='liveStop')stopLive();
 if(msg.type==='liveNow')await syncQueue();
 if(msg.type==='init'){const collections=(await figma.variables.getLocalVariableCollectionsAsync()).map(x=>x.name);emit('init',{fileKey:figma.fileKey||null,fileName:figma.root.name,collections,actor:owner()});}
 if(msg.type==='snapshot'){const data=await snapshot(msg.collection||DEFAULT_COLLECTION);emit('snapshot',{data});}
 if(msg.type==='manifest'){status.manifest=validManifest(msg.data);const checks=await plan(status.manifest);status.preview=checks;emit('preview',{manifestId:status.manifest.id,checks:checks.map(c=>({name:c.name,kind:c.kind,expected:c.expected,actual:c.actual,to:c.to,status:c.status}))});}
 if(msg.type==='apply'){if(!status.manifest||msg.manifestId!==status.manifest.id||msg.confirmed!==true)throw Error('Import, inspect, and confirm a manifest before applying it.');const receipt=await apply(status.manifest);emit('applied',{data:receipt});figma.notify(receipt.operations.length+' Figma value'+(receipt.operations.length===1?'':'s')+' updated');}
 if(msg.type==='propose'){const result=await propose(msg.token,msg.collection);emit('proposed',{result});}
 }catch(e){emit('error',{message:e?.message||String(e)})}};
