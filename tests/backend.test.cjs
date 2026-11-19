const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const api=require('../api/index.js');
const {classify,validValue}=api._test;
async function request(method,path,body='',headers={}){
 const req=new PassThrough();req.method=method;req.url='/api'+path;req.headers=headers;
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(s=''){this.body=s;this.done()}};
 const done=new Promise(r=>{res.done=r});api(req,res);req.end(body);await done;return {code:res.statusCode,body:res.body?JSON.parse(res.body):null};
}
(async()=>{
 const recent={captured_at:new Date().toISOString()};const w={auto_safe:true,auto_tokens:['radius/button']};
 const figma={type:'number',value:2},git={type:'number',value:12};
 assert.equal(classify('radius/button',git,figma,w,recent).status,'queued_auto');
 assert.equal(classify('spacing/component',git,figma,w,recent).status,'pending_review');
 assert.equal(classify('radius/button',git,figma,w,{captured_at:'2020-01-01T00:00:00Z'}).status,'pending_review');
 assert.equal(classify('radius/button',{type:'number',value:2},figma,w,recent),null);
 assert.equal(validValue('color','#FF9922'),true);assert.equal(validValue('color','red'),false);
 assert.equal((await request('GET','/status')).code,200);
 assert.equal((await request('GET','/me')).body.user,null);
 assert.equal((await request('POST','/github/webhook','{}')).code,503);
 assert.equal((await request('POST','/workspaces','{}')).code,401);
 assert.equal((await request('POST','/workspaces','{}',{'origin':'https://evil.example'})).code,403);
 const preflight=await request('OPTIONS','/plugin/00000000-0000-0000-0000-000000000001/jobs','',{'origin':'null'});assert.equal(preflight.code,204);
 console.log('PASS backend: safe classifications, stale snapshot, sign-in guard, webhook fail-closed, CSRF, status');
})().catch(e=>{console.error(e);process.exit(1)});
