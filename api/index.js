'use strict';
const crypto=require('node:crypto');
const env=process.env;
const json=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));};
const bad=(res,status,reason)=>json(res,status,{error:reason});
const hmac=(value,secret)=>crypto.createHmac('sha256',secret).update(value).digest('hex');
const eq=(a,b)=>{const aa=Buffer.from(a||''),bb=Buffer.from(b||'');return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)};
const clean=(s,max=250)=>typeof s==='string'?s.trim().slice(0,max):'';
const origin=()=>env.APP_ORIGIN||'http://localhost:3000';
const base=()=>!!(env.SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY);
const appReady=()=>!!(env.GITHUB_APP_ID&&env.GITHUB_APP_PRIVATE_KEY&&env.GITHUB_WEBHOOK_SECRET);
const oauthReady=()=>!!(env.GITHUB_OAUTH_CLIENT_ID&&env.GITHUB_OAUTH_CLIENT_SECRET&&env.SESSION_HMAC_SECRET);
const supportedTypes=['color','number','string','boolean'];
const scalar=(x)=>typeof x==='string'||typeof x==='number'||typeof x==='boolean';
async function body(req,limit=128000){if(Buffer.isBuffer(req.rawBody))return req.rawBody;if(Buffer.isBuffer(req.body))return req.body;if(typeof req.body==='string')return Buffer.from(req.body);const chunks=[];let n=0;for await(const b of req){n+=b.length;if(n>limit)throw Object.assign(Error('Payload too large'),{status:413});chunks.push(b)}return Buffer.concat(chunks)}
const parseJson=(buf)=>{try{return JSON.parse(buf.toString('utf8')||'{}')}catch{throw Object.assign(Error('Invalid JSON'),{status:400})}};
async function table(name,{method='GET',query='',data=null,prefer=null}={}){
 if(!base())throw Object.assign(Error('Database not configured'),{status:503});
 const url=env.SUPABASE_URL+'/rest/v1/'+name+query;
 const h={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY};
 if(data!=null)h['Content-Type']='application/json';if(prefer)h.Prefer=prefer;
 const r=await fetch(url,{method,headers:h,body:data==null?undefined:JSON.stringify(data)});
 if(!r.ok)throw Object.assign(Error('Database request failed ('+r.status+')'),{status:502});
 if(r.status===204)return [];const s=await r.text();return s?JSON.parse(s):[];
}
const T={workspaces:'dd_workspaces',snapshots:'dd_snapshots',changes:'dd_changes',audit:'dd_audit',deliveries:'dd_deliveries'};
const filter=(id)=>'?id=eq.'+encodeURIComponent(id);
const cookie=(req,name)=>{const m=(req.headers.cookie||'').match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)'));return m?decodeURIComponent(m[1]):null};
function signed(payload){const text=Buffer.from(JSON.stringify(payload)).toString('base64url');return text+'.'+hmac(text,env.SESSION_HMAC_SECRET)}
function unsign(token){if(!token||!env.SESSION_HMAC_SECRET)return null;const [txt,sig]=token.split('.');if(!txt||!sig||!eq(sig,hmac(txt,env.SESSION_HMAC_SECRET)))return null;try{const p=JSON.parse(Buffer.from(txt,'base64url').toString());return p.exp>Date.now()?p:null}catch{return null}}
const viewer=(req)=>unsign(cookie(req,'dd_session'));
const session=(req)=>{const v=viewer(req);if(!v?.githubId)throw Object.assign(Error('Sign in with GitHub first'),{status:401});return v};
const csrf=(req)=>{const o=req.headers.origin;if(o&&o!==origin())throw Object.assign(Error('Invalid origin'),{status:403})};
async function own(workspaceId,userId){if(!/^[0-9a-f-]{36}$/.test(workspaceId||''))throw Object.assign(Error('Invalid workspace ID'),{status:400});const a=await table(T.workspaces,{query:filter(workspaceId)+'&owner_github_id=eq.'+userId+'&select=*'});if(!a.length)throw Object.assign(Error('Workspace not found'),{status:404});return a[0]}
function cookieSet(res,name,val,{maxAge=86400}={}){res.setHeader('Set-Cookie',`${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`)}
async function githubToken(installationId){if(!appReady())throw Object.assign(Error('GitHub App not configured'),{status:503});const issued=Math.floor(Date.now()/1000),claims={iat:issued-30,exp:issued+480,iss:env.GITHUB_APP_ID};const head=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify(claims)).toString('base64url');const key=env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g,'\n');const signature=crypto.sign('RSA-SHA256',Buffer.from(head+'.'+payload),key).toString('base64url');const r=await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`,{method:'POST',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+head+'.'+payload+'.'+signature,'X-GitHub-Api-Version':'2022-11-28'}});if(!r.ok)throw Object.assign(Error('GitHub App installation access denied'),{status:502});return (await r.json()).token}
async function gh(path,token){const r=await fetch('https://api.github.com'+path,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})}});if(!r.ok)throw Object.assign(Error('GitHub request failed ('+r.status+')'),{status:502});return r.json()}
async function workspaceToken(w){return w.github_installation_id?githubToken(w.github_installation_id):null}
async function snapshot(w){const a=await table(T.snapshots,{query:'?workspace_id=eq.'+w.id+'&select=*&order=captured_at.desc&limit=1'});return a[0]||null}
const validValue=(type,val)=>type==='color'?/^#[a-fA-F0-9]{6}$/.test(val):type==='number'?typeof val==='number'&&Number.isFinite(val):type==='string'?typeof val==='string'&&val.length<=2048:type==='boolean'?typeof val==='boolean':false;
const normalize=(v,type)=>type==='color'?String(v).toUpperCase():v;
function classify(name,source,target,workspace,snap){
 const type=source?.type;
 if(!supportedTypes.includes(type)||!validValue(type,source.value)||!target||target.type!==type||!validValue(type,target.value))return {kind:'complex',status:'pending_review',reason:'Missing mapping or unsupported value'};
 if(normalize(source.value,type)===normalize(target.value,type))return null;
 const allow=workspace.auto_safe && Array.isArray(workspace.auto_tokens)&&workspace.auto_tokens.includes(name);
 const recent=snap&&Date.now()-Date.parse(snap.captured_at)<24*3600*1000;
 const safe=allow&&recent&&['color','number'].includes(type);
 return {kind:safe?'safe':'complex',status:safe?'queued_auto':'pending_review',reason:safe?'Allowlisted token with recent Figma snapshot':'Manual review required'};
}
async function event(w,changeId,eventName,actorKind,actor,details={},sha=null){return table(T.audit,{method:'POST',data:{workspace_id:w.id,change_id:changeId,event:eventName,actor_kind:actorKind,actor,detail:details,source_sha:sha},prefer:'return=minimal'})}
async function reconcile(w,sha,actor='GitHub',url=null){
 const t=await workspaceToken(w);
 const file=await gh('/repos/'+w.repo+'/contents/'+w.token_path+'?ref='+encodeURIComponent(sha||w.branch),t);
 if(!file.content||file.size>1000000)throw Error('Unsupported GitHub token file');
 const data=JSON.parse(Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8'));
 if(!data.tokens||typeof data.tokens!=='object')throw Error('GitHub file has no tokens');
 const snap=await snapshot(w),existing=snap?.tokens||{};
 if(!snap) {await event(w,null,'waiting_for_snapshot','system','Venn',{sha});return {status:'waiting_for_figma_snapshot',changes:0}}
 if(snap.figma_file_key!==w.figma_file_key||snap.collection!==w.figma_collection)throw Error('Figma snapshot does not match connected file');
 let count=0;const preview=[];
 for(const [name,src] of Object.entries(data.tokens).slice(0,1000)){
  const tgt=existing[name],result=classify(name,src,tgt,w,snap);if(!result)continue;
  const row={workspace_id:w.id,source_sha:sha||file.sha,name,kind:'variable',token_type:src.type||'unknown',expected:tgt?.value??null,proposed:src.value??null,status:result.status,classification:result.reason,source_actor:actor,source_url:url};
  preview.push(row);
 }
 for(const row of preview){const open=await table(T.changes,{query:'?workspace_id=eq.'+w.id+'&name=eq.'+encodeURIComponent(row.name)+'&status=in.(pending_review,queued_auto,queued_approved,applying)&select=id,proposed&limit=5'});if(open.length){if(open.some(e=>same(e.proposed,row.proposed)))continue;row.status='pending_review';row.classification='New code revision while an earlier update is pending';}const rows=await table(T.changes,{method:'POST',query:'?on_conflict=workspace_id,source_sha,name',data:row,prefer:'resolution=ignore-duplicates,return=representation'});if(rows?.length){count++;await event(w,rows[0].id,'change_detected','github',actor,{name:row.name,from:row.expected,to:row.proposed,status:row.status},row.source_sha)}}
 return {status:'processed',changes:count};
}
async function pairAuth(req,w){const key=clean(req.headers['x-dd-plugin-key'],256);if(!key||!w.plugin_key_hash||!eq(hmac(key,env.SESSION_HMAC_SECRET||'not-configured'),w.plugin_key_hash))throw Object.assign(Error('Invalid plugin pairing key'),{status:401})}
function same(a,b){return typeof a==='string'&&typeof b==='string'?a.toUpperCase()===b.toUpperCase():a===b}
async function handler(req,res){const path=new URL(req.url,'http://localhost').pathname.replace(/^\/api\/?/,'/');const method=req.method||'GET';
 const pluginRoute=path.startsWith('/plugin/');
 if(pluginRoute){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-DD-Plugin-Key');res.setHeader('Vary','Origin');if(method==='OPTIONS'){res.statusCode=204;return res.end();}}
 if(method!=='GET'&&!pluginRoute&&path!=='/github/webhook')csrf(req);
 if(path==='/status'&&method==='GET')return json(res,200,{backend:true,database:base(),githubApp:appReady(),githubLogin:oauthReady(),figmaEnterpriseWrite:false,figmaEnterpriseCredentialPresent:!!env.FIGMA_ENTERPRISE_TOKEN,autoPolicy:'verified-safe-tokens',pluginMode:'while-open',ready:base()&&appReady()&&oauthReady()});
 if(path==='/github/login'&&method==='GET'){
  if(!oauthReady())return bad(res,503,'GitHub login has not been configured');const state=crypto.randomBytes(24).toString('hex');cookieSet(res,'dd_oauth_state',signed({state,exp:Date.now()+600000}),{maxAge:600});const u=new URL('https://github.com/login/oauth/authorize');u.searchParams.set('client_id',env.GITHUB_OAUTH_CLIENT_ID);u.searchParams.set('redirect_uri',origin()+'/api/github/callback');u.searchParams.set('state',state);u.searchParams.set('scope','read:user');res.statusCode=302;res.setHeader('Location',u.toString());return res.end();}
 if(path==='/github/callback'&&method==='GET'){
  const u=new URL(req.url,'http://localhost'), state=unsign(cookie(req,'dd_oauth_state'));if(!state||state.state!==u.searchParams.get('state'))return bad(res,403,'Invalid OAuth state');const code=u.searchParams.get('code');const r=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_OAUTH_CLIENT_ID,client_secret:env.GITHUB_OAUTH_CLIENT_SECRET,code})});const t=await r.json();if(!t.access_token)return bad(res,401,'GitHub login failed');const person=await gh('/user',t.access_token);cookieSet(res,'dd_session',signed({githubId:person.id,login:person.login,exp:Date.now()+8*3600*1000}),{maxAge:8*3600});res.statusCode=302;res.setHeader('Location',origin()+'/');return res.end();}
 if(path==='/github/logout'&&method==='POST'){cookieSet(res,'dd_session','',{maxAge:0});return json(res,200,{ok:true})}
 if(path==='/me'&&method==='GET')return json(res,200,{user:viewer(req)?{login:viewer(req).login,id:viewer(req).githubId}:null});
 if(path==='/workspaces'&&method==='GET'){const u=session(req);return json(res,200,{workspaces:await table(T.workspaces,{query:'?owner_github_id=eq.'+u.githubId+'&select=id,repo,branch,token_path,figma_file_key,figma_collection,auto_safe,auto_tokens,github_installation_id,created_at&order=created_at.desc'})})}
 if(path==='/workspaces'&&method==='POST'){
  const u=session(req),d=parseJson(await body(req));const repo=clean(d.repo,200),branch=clean(d.branch,150),tokenPath=clean(d.tokenPath,300),key=clean(d.figmaFileKey,100),collection=clean(d.collection,150),installId=d.installationId;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||!/^[\w./-]+$/.test(branch)||!/^[-\w./]+\.json$/.test(tokenPath)||!/^[A-Za-z0-9]{22,128}$/.test(key)||!collection)return bad(res,400,'Invalid repository, token path or Figma file');
  if(repo.split('/')[0].toLowerCase()!==String(u.login||'').toLowerCase())return bad(res,403,'This version supports repositories owned by the signed-in GitHub account only');
  if(!Number.isInteger(installId)||installId<1)return bad(res,400,'Install the GitHub App first; installation ID is required');
  const verify=await gh('/repos/'+repo,await githubToken(installId));if(verify.full_name?.toLowerCase()!==repo.toLowerCase())return bad(res,403,'GitHub App lacks access to the repository');
  const rows=await table(T.workspaces,{method:'POST',data:{owner_github_id:u.githubId,repo,branch,token_path:tokenPath,figma_file_key:key,figma_collection:collection,github_installation_id:installId,auto_safe:false,auto_tokens:[]},prefer:'return=representation'});return json(res,201,{workspace:rows[0]});}
 const wi=path.match(/^\/workspaces\/([a-f0-9-]{36})(?:\/(.+))?$/i);if(wi){const id=wi[1],action=wi[2]||'',u=method==='GET'&&action==='plugin-jobs'?null:session(req);const w=u?await own(id,u.githubId):await table(T.workspaces,{query:filter(id)+'&select=*'}).then(r=>r[0]);if(!w)return bad(res,404,'Workspace not found');
  if(action==='settings'&&method==='PATCH'){const d=parseJson(await body(req));const allow=Array.isArray(d.autoTokens)?d.autoTokens.filter(x=>typeof x==='string'&&x.length<=100).slice(0,100):[];if(typeof d.autoSafe!=='boolean')return bad(res,400,'Invalid automation policy');await table(T.workspaces,{method:'PATCH',query:filter(id),data:{auto_safe:d.autoSafe,auto_tokens:allow,updated_at:new Date().toISOString()},prefer:'return=minimal'});await event(w,null,'policy_changed','github',u.login,{autoSafe:d.autoSafe,autoTokens:allow});return json(res,200,{ok:true});}
  if(action==='pair'&&method==='POST'){if(!env.SESSION_HMAC_SECRET)return bad(res,503,'Pairing unavailable');const key=crypto.randomBytes(32).toString('base64url');await table(T.workspaces,{method:'PATCH',query:filter(id),data:{plugin_key_hash:hmac(key,env.SESSION_HMAC_SECRET)},prefer:'return=minimal'});await event(w,null,'plugin_pairing_rotated','github',u.login);return json(res,200,{pairingKey:key,workspaceId:w.id,apiOrigin:origin(),note:'Shown once. Install in the Figma plugin; keep private.'})}
  if(action==='changes'&&method==='GET')return json(res,200,{changes:await table(T.changes,{query:'?workspace_id=eq.'+id+'&select=*&order=created_at.desc&limit=100'})});
  if(action==='history'&&method==='GET')return json(res,200,{events:await table(T.audit,{query:'?workspace_id=eq.'+id+'&select=*&order=at.desc&limit=100'})});
  if(action==='scan'&&method==='POST'){const d=parseJson(await body(req));const sha=clean(d.sha,100);const result=await reconcile(w,sha||w.branch,u.login);return json(res,200,result)}
  const approval=action.match(/^changes\/([a-f0-9-]{36})\/(approve|dismiss)$/i);if(approval&&method==='POST'){
   const idChange=approval[1],verb=approval[2];const rr=await table(T.changes,{query:'?id=eq.'+idChange+'&workspace_id=eq.'+w.id+'&select=*'});if(!rr.length)return bad(res,404,'Change not found');const change=rr[0];if(!['pending_review','queued_auto'].includes(change.status))return bad(res,409,'Change is no longer reviewable');const status=verb==='approve'?'queued_approved':'dismissed';await table(T.changes,{method:'PATCH',query:filter(change.id)+'&status=eq.'+change.status,data:{status,approved_by:u.githubId,updated_at:new Date().toISOString()},prefer:'return=minimal'});await event(w,change.id,verb==='approve'?'approved':'dismissed','github',u.login,{name:change.name},change.source_sha);return json(res,200,{status});}
 }
 const plugin=path.match(/^\/plugin\/([a-f0-9-]{36})\/(snapshot|jobs|receipt)$/i);if(plugin){const id=plugin[1],action=plugin[2];const w=(await table(T.workspaces,{query:filter(id)+'&select=*'}))[0];if(!w)return bad(res,404,'Workspace not found');await pairAuth(req,w);
  if(action==='snapshot'&&method==='POST'){
   const d=parseJson(await body(req));if(d.schema!=='design-drift/snapshot-v1'||d.fileKey!==w.figma_file_key||d.collection!==w.figma_collection||typeof d.tokens!=='object'||Object.keys(d.tokens).length>3000)return bad(res,400,'Snapshot does not match this workspace');
   for(const t of Object.values(d.tokens))if(!supportedTypes.includes(t.type)||!validValue(t.type,t.value))return bad(res,400,'Invalid token');
   await table(T.snapshots,{method:'POST',data:{workspace_id:w.id,figma_file_key:d.fileKey,collection:d.collection,tokens:d.tokens,actor:d.actor||{},captured_at:new Date().toISOString()},prefer:'return=minimal'});
   await event(w,null,'figma_snapshot','plugin',clean(d.actor?.name,80)||'Figma plugin',{tokenCount:Object.keys(d.tokens).length});let scan={status:'not_scanned'};try{scan=await reconcile(w,w.branch,'GitHub')}catch(error){console.warn('Snapshot saved, scan failed:',error.message)}return json(res,201,{ok:true,scan});}
  if(action==='jobs'&&method==='GET'){
   const rows=await table(T.changes,{query:'?workspace_id=eq.'+id+'&status=in.(queued_auto,queued_approved)&select=*&order=created_at.asc&limit=40'});
   const jobs=rows.filter(x=>validValue(x.token_type,x.proposed)&&validValue(x.token_type,x.expected)).map(x=>({id:x.id,name:x.name,kind:x.kind,type:x.token_type,expected:x.expected,value:x.proposed,status:x.status,sourceSha:x.source_sha}));return json(res,200,{schema:'design-drift/jobs-v1',workspace:id,figmaFileKey:w.figma_file_key,collection:w.figma_collection,jobs});}
  if(action==='receipt'&&method==='POST'){
   const d=parseJson(await body(req));if(!d||d.schema!=='design-drift/receipt-v1'||d.fileKey!==w.figma_file_key||!Array.isArray(d.operations)||d.operations.length>40)return bad(res,400,'Invalid receipt');
   let count=0;for(const op of d.operations){const rr=await table(T.changes,{query:'?id=eq.'+encodeURIComponent(op.id)+'&workspace_id=eq.'+w.id+'&select=*'});const c=rr[0];if(!c||!['queued_auto','queued_approved','applying'].includes(c.status))continue;
    const isApplied=same(op.after,c.proposed)&&same(op.readBack,c.proposed)&&same(op.before,c.expected);
    const status=isApplied?'applied':'conflict';await table(T.changes,{method:'PATCH',query:filter(c.id)+'&status=in.(queued_auto,queued_approved,applying)',data:{status,updated_at:new Date().toISOString()},prefer:'return=minimal'});await event(w,c.id,isApplied?'plugin_confirmed':'conflict','plugin',clean(d.actor?.name,100)||'Figma plugin',{name:c.name,before:op.before,after:op.after,readBack:op.readBack},c.source_sha);count++;
   }return json(res,200,{processed:count,note:'Plugin read-back evidence. Not an independent Figma REST audit.'});}
 }
 if(path==='/github/webhook'&&method==='POST'){
  if(!env.GITHUB_WEBHOOK_SECRET)return bad(res,503,'Webhook not configured');const raw=await body(req,1000000),sign=req.headers['x-hub-signature-256']||'',expected='sha256='+hmac(raw,env.GITHUB_WEBHOOK_SECRET);if(!eq(sign,expected))return bad(res,401,'Invalid webhook signature');
  if(!base())return bad(res,503,'Database not configured');const id=clean(req.headers['x-github-delivery'],120);if(!/^[a-zA-Z0-9-]{20,120}$/.test(id))return bad(res,400,'Invalid delivery ID');const existing=await table(T.deliveries,{query:'?delivery_id=eq.'+id+'&select=delivery_id'});if(existing.length)return json(res,200,{ok:true,duplicate:true});
  const d=parseJson(raw),kind=req.headers['x-github-event'];let branches=[];if(kind==='push'&&d.ref?.startsWith('refs/heads/'))branches=[{repo:d.repository?.full_name,branch:d.ref.slice(11),sha:d.after,actor:d.pusher?.name||d.sender?.login,url:d.compare,installId:d.installation?.id}];if(kind==='pull_request'&&d.action==='closed'&&d.pull_request?.merged)branches=[{repo:d.repository?.full_name,branch:d.pull_request.base.ref,sha:d.pull_request.merge_commit_sha,actor:d.sender?.login,url:d.pull_request.html_url,installId:d.installation?.id}];
  let updated=0;for(const b of branches){if(!b.repo||!b.sha)continue;const ws=await table(T.workspaces,{query:'?repo=eq.'+encodeURIComponent(b.repo)+'&branch=eq.'+encodeURIComponent(b.branch)+'&select=*'});for(const w of ws){if(w.github_installation_id!==b.installId)continue;const out=await reconcile(w,b.sha,b.actor,b.url);updated+=out.changes||0}}
  await table(T.deliveries,{method:'POST',data:{delivery_id:id},prefer:'return=minimal'});return json(res,200,{ok:true,changes:updated});
 }
 return bad(res,404,'Route not found');
}
module.exports=async(req,res)=>{try{await handler(req,res)}catch(error){const status=error.status||500;if(status>=500)console.error('Venn backend',error.message);bad(res,status,status>=500?'Backend unavailable; check configuration and logs':error.message)}};
module.exports._test={classify,validValue,eq,signed,normalize};
