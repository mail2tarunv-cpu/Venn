const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm');
const source=JSON.parse(fs.readFileSync(__dirname+'/../source.json','utf8'));
const pluginCode=fs.readFileSync(__dirname+'/../figma-plugin/code.js','utf8');
function setup({radius=2,fileKey=source.target.figmaFileKey,binding=true,revision=source.source.revision}={}){
 const messages=[],writes=[];let responseData=structuredClone(source);responseData.source.revision=revision;
 const variable={id:'VariableID:1:7',name:'radius/button',variableCollectionId:'coll',resolvedType:'FLOAT',valuesByMode:{mode:radius},setValueForMode(mode,v){writes.push(v);this.valuesByMode[mode]=v}};
 const component={name:'Penny / Button / Primary',boundVariables:{topLeftRadius:{id:binding?'VariableID:1:7':'different'}}};
 const figma={fileKey,root:{name:'Penny test'},currentUser:{name:'Test designer'},showUI(){},notify(){},ui:{postMessage:m=>messages.push(m),onmessage:null},variables:{getLocalVariableCollectionsAsync:async()=>[{id:'coll',name:source.target.collection,defaultModeId:'mode'}],getLocalVariablesAsync:async()=>[variable]},getNodeByIdAsync:async()=>component};
 const context={figma,__html__:'',console,fetch:async()=>({ok:true,json:async()=>structuredClone(responseData)}),Date,Error,Promise,Number,String,Array,Math};vm.createContext(context);vm.runInContext(pluginCode,context);
 return {messages,writes,variable,figma,context,setRevision:r=>{responseData.source.revision=r},async send(m){await figma.ui.onmessage(m);return messages.at(-1)}};
}
(async()=>{
 const a=setup();
 assert.equal(a.writes.length,0);
 assert.equal((await a.send({type:'check'})).status,'ready');
 assert.equal(a.writes.length,0,'preview should never write');
 const result=await a.send({type:'apply',confirmed:true});
 assert.equal(result.type,'applied');assert.equal(a.variable.valuesByMode.mode,12);assert.equal(result.receipt.readBack,12);assert.equal(a.writes.length,1);
 assert.equal((await a.send({type:'check'})).status,'up-to-date');
 const b=setup({radius:7});assert.equal((await b.send({type:'check'})).status,'conflict');assert.equal((await b.send({type:'apply',confirmed:true})).type,'error');assert.deepEqual(b.writes,[]);
 const c=setup({fileKey:'not-this-file'});assert.equal((await c.send({type:'check'})).type,'error');assert.deepEqual(c.writes,[]);
 const d=setup({binding:false});assert.equal((await d.send({type:'check'})).type,'error');assert.deepEqual(d.writes,[]);
 const e=setup();await e.send({type:'check'});e.setRevision('superseded');assert.equal((await e.send({type:'apply',confirmed:true})).type,'error');assert.deepEqual(e.writes,[]);
 const f=setup();assert.equal((await f.send({type:'apply',confirmed:true})).type,'error');assert.deepEqual(f.writes,[]);
 {const c=setup({fileKey:null});assert.equal((await c.send({type:'check'})).type,'preview','no file key: other guards still allow a valid check');}
 console.log('PASS Figma plugin: no implicit writes; preview; approved update & read-back; already updated; conflict; wrong file; wrong binding; superseded revision; unreviewed apply blocked');
})().catch(e=>{console.error(e);process.exit(1)});
