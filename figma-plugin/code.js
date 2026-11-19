// Venn — isolated Penny demonstration.
// Never changes the file without explicit review and confirmation in the plugin.
figma.showUI(__html__, {width: 440, height: 520, themeColors: true});
const SOURCE = 'https://design-drift-tarun.vercel.app/source.json';
const FILE_KEY = 'nfPIHqVPJv4OJ5yOavc1ha';
const COLLECTION = 'Penny / Test tokens';
const TOKEN_NAME = 'radius/button';
const NODE_ID = '1:9';
let lastCheck = null;
let receipt = null;
function send(type,data={}) {figma.ui.postMessage({type,...data});}
function assertMatch(d){
  if(!d||d.schema!=='design-drift/source-v1'||d.target?.figmaFileKey!==FILE_KEY||d.target.collection!==COLLECTION||d.target.componentNodeId!==NODE_ID||!Array.isArray(d.changes)||d.changes.length!==1)throw Error('The source snapshot does not match this test.');
  const change=d.changes[0];
  if(change.name!==TOKEN_NAME||change.type!=='number'||change.expectedBaseline!==2||change.proposed!==12||change.kind!=='variable')throw Error('Unexpected token change. No update was made.');
  return change;
}
async function findVariable(){
  if(figma.fileKey!==FILE_KEY)throw Error('Open the separate Penny test file before running this demo.');
  const collections=await figma.variables.getLocalVariableCollectionsAsync();
  const collection=collections.find(c=>c.name===COLLECTION);
  if(!collection)throw Error('The Penny test token collection was not found.');
  const variables=await figma.variables.getLocalVariablesAsync();
  const variable=variables.find(v=>v.variableCollectionId===collection.id&&v.name===TOKEN_NAME&&v.resolvedType==='FLOAT');
  if(!variable)throw Error('The mapped button-radius variable was not found.');
  const value=variable.valuesByMode[collection.defaultModeId];
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('The current button-radius value is not a number.');
  const component=await figma.getNodeByIdAsync(NODE_ID);
  if(!component||component.name!=='Penny / Button / Primary')throw Error('The mapped Penny button component was not found.');
  const binding=component.boundVariables?.topLeftRadius?.id;
  if(binding!==variable.id)throw Error('The test button is not bound to the expected variable. Nothing was changed.');
  return {variable, mode:collection.defaultModeId, value, component};
}
async function check(){
  const r=await fetch(SOURCE, {cache:'no-store'});
  if(!r.ok)throw Error('Could not reach the published token source.');
  const data=await r.json();
  const change=assertMatch(data);
  const figmaState=await findVariable();
  const disposition=figmaState.value===change.proposed?'up-to-date':figmaState.value===change.expectedBaseline?'ready':'conflict';
  lastCheck={change, sourceRevision:data.source.revision, disposition};
  send('preview',{status:disposition, before:figmaState.value, after:change.proposed, component:figmaState.component.name, token:change.name, revision:data.source.revision});
}
async function applyConfirmed(){
  if(!lastCheck||lastCheck.disposition!=='ready')throw Error('Review the current code and Figma values before applying.');
  const current=await findVariable();
  if(current.value!==lastCheck.change.expectedBaseline)throw Error('The Figma value changed since review. Check again before applying.');
  // Check the source again so an outdated UI cannot apply a superseded value.
  const sourceResponse=await fetch(SOURCE,{cache:'no-store'});
  if(!sourceResponse.ok)throw Error('The code source could not be verified.');
  const source=await sourceResponse.json(),change=assertMatch(source);
  if(source.source.revision!==lastCheck.sourceRevision||change.proposed!==lastCheck.change.proposed)throw Error('The published source changed. Review the new version first.');
  current.variable.setValueForMode(current.mode,change.proposed);
  const readBack=(await findVariable()).value;
  if(readBack!==change.proposed){
    try{current.variable.setValueForMode(current.mode,current.value);}catch{}
    throw Error('Figma did not confirm the new value. The plugin attempted to restore the previous value.');
  }
  receipt={schema:'design-drift/penny-receipt-v1',fileKey:FILE_KEY,collection:COLLECTION,tokenName:TOKEN_NAME,component:current.component.name,before:current.value,after:change.proposed,readBack,actor:figma.currentUser?.name||'Figma user',appliedAt:new Date().toISOString(),sourceRevision:source.source.revision,verification:'plugin-readback-only'};
  lastCheck={change,sourceRevision:source.source.revision,disposition:'up-to-date'};
  send('applied',{receipt});
  figma.notify('Penny button radius updated and read back in Figma.');
}
figma.ui.onmessage=async message=>{
 try{
  if(message.type==='check')await check();
  if(message.type==='apply'&&message.confirmed===true)await applyConfirmed();
  if(message.type==='receipt'){if(!receipt)throw Error('No completed update to export.');send('receipt',{receipt});}
 }catch(error){send('error',{message:error?.message||String(error)});}
};
