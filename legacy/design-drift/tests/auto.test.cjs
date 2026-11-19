const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const results=[],calls=[];let interval=null;
const variable={name:'radius/button',variableCollectionId:'coll',resolvedType:'FLOAT',valuesByMode:{mode:2},setValueForMode(mode,v){this.valuesByMode[mode]=v}};
const figma={fileKey:'nfPIHqVPJv4OJ5yOavc1ha',root:{name:'Penny test'},currentUser:{name:'Designer',id:'f-1'},notify(){},showUI(){},ui:{postMessage:x=>results.push(x),onmessage:null},variables:{getLocalVariableCollectionsAsync:async()=>[{name:'Penny / Test tokens',id:'coll',defaultModeId:'mode'}],getLocalVariablesAsync:async()=>[variable]},getNodeByIdAsync:async()=>null};
const uuid='11111111-1111-4111-8111-111111111111';
const fetch=async(url,opts={})=>{
 calls.push({url,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null});
 let data={};
 if(url.endsWith('/snapshot'))data={ok:true};
 else if(url.endsWith('/jobs'))data={schema:'design-drift/jobs-v1',figmaFileKey:figma.fileKey,collection:'Penny / Test tokens',jobs:variable.valuesByMode.mode===2?[{id:uuid,name:'radius/button',kind:'variable',type:'number',expected:2,value:12,sourceSha:'abc',status:'queued_auto'}]:[]};
 else if(url.endsWith('/receipt'))data={processed:1};
 return {ok:true,json:async()=>data};
};
const ctx={figma,__html__:'',console,fetch,TextDecoder,Uint8Array,Date,Error,Promise,Math,clearInterval(){interval=null},setInterval(fn){interval=fn;return 4}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../figma-plugin/code.js','utf8'),ctx);
(async()=>{
 await figma.ui.onmessage({type:'liveStart',workspace:uuid,key:'long-secret-pairing-key-of-at-least-24-chars',collection:'Penny / Test tokens'});
 assert.equal(variable.valuesByMode.mode,12,'Figma variable must update');
 assert(calls.some(c=>c.url.endsWith('/snapshot')),'missing snapshot');
 const receipt=calls.find(c=>c.url.endsWith('/receipt'));assert(receipt,'missing receipt');
 assert.equal(receipt.body.operations[0].readBack,12,'missing plugin value verification');
 assert(results.some(x=>x.type==='liveStarted'));
 await figma.ui.onmessage({type:'liveStop'});assert.equal(interval,null);
 console.log('PASS plugin automatic queue: snapshot, mapped token apply, value read-back, receipt, session stop');
})().catch(e=>{console.error(e);process.exit(1)});
