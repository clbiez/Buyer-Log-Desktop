'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{fork}=require('node:child_process'),{once}=require('node:events');
let child,root,base,info,admin,a,b,logs='',sequence=0;const pending=new Map();
async function rpc(command,args={}){const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.send({id,command,...args});});}
async function call(url,{who=a,method='GET',body,headers={}}={}){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(who?{Cookie:who}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),type=response.headers.get('content-type')||'';return {status:response.status,body:type.includes('json')?await response.json():await response.text(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
test.before(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-legacy-authority-'));child=fork(path.join(__dirname,'helpers/legacy-authority-server.cjs'),[root],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
 info=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture timeout: '+logs.slice(-2500))),25000);child.on('message',message=>{if(message.ready){clearTimeout(timer);resolve(message);}else if(pending.has(message.id)){const entry=pending.get(message.id);pending.delete(message.id);message.error?entry.reject(Error(message.error)):entry.resolve(message.result);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Fixture stopped '+code+': '+logs.slice(-2500)));});});base='http://127.0.0.1:'+info.port;
 admin=(await call('/api/user-login',{who:null,method:'POST',body:{username:'fixture-admin',password:'Fixture-only-123'}})).cookie;a=(await call('/api/user-login',{who:null,method:'POST',body:{username:'fixture-a',password:'Fixture-only-123'}})).cookie;b=(await call('/api/user-login',{who:null,method:'POST',body:{username:'fixture-b',password:'Fixture-only-123'}})).cookie;assert.ok(admin&&a&&b);
});
test.after(async()=>{if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}if(root){const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('bl-legacy-authority-'));await fsp.rm(resolved,{recursive:true,force:true,maxRetries:30,retryDelay:50});}});

test('a known temporary pricing draft belongs only to its creating user, including reopen and content',async()=>{
 const made=await call('/api/email-drafts/pricing',{method:'POST',body:{subject:'Isolated private Buyer A fixture',html:'<p>PRIVATE BUYER A</p>'}});assert.equal(made.status,200);assert.match(made.body.draftId,/^[a-f0-9]{32}$/);const before=await rpc('snapshot');
 for(const who of [b,admin]){const denied=await call('/api/email-drafts/pricing/reopen',{who,method:'POST',body:{draftId:made.body.draftId}});assert.equal(denied.status,410);assert.equal(denied.body.emlBase64,undefined);assert.deepEqual(await rpc('snapshot'),before,'foreign caller cannot open, extend or alter the private draft');}
 assert.equal((await call('/api/email-drafts/'+made.body.filename,{who:b})).status,410);assert.deepEqual(await rpc('snapshot'),before);
 const own=await call('/api/email-drafts/pricing/reopen',{method:'POST',body:{draftId:made.body.draftId}});assert.equal(own.status,200);assert.ok(own.body.emlBase64);assert.equal((await rpc('snapshot')).opens,before.opens+1);
});

test('the generic CP image alias cannot read or delete a foreign private Collection image',async()=>{
 const image=await rpc('seedSharedImage',{ownerId:info.users[0].id});assert.ok(image.id);assert.equal((await call('/api/collection-images/'+image.id)).status,200);const before=await rpc('snapshot');
 for(const prefix of ['/api/cp-images/','/api/collection-images/'])for(const method of ['GET','DELETE']){const denied=await call(prefix+image.id,{who:b,method});assert.equal(denied.status,403,method+' '+prefix);assert.deepEqual(await rpc('snapshot'),before);}
 assert.equal((await call('/api/cp-images/'+image.id)).status,200);
});

test('normal automation outputs are private and cannot bypass the scoped agent-draft namespace',async()=>{
 for(const user of info.users){const directory=await call('/api/users/admin',{who:admin}),granted=await call('/api/users/'+user.id,{who:admin,method:'PUT',body:{expectedRevision:directory.body.revision,permissionCodes:['AUTOMATIONS.VIEW','AUTOMATIONS.CREATE','AUTOMATIONS.EDIT'],reason:'Disposable automation authority fixture'}});assert.equal(granted.status,200,JSON.stringify(granted.body));}
 const groups=await call('/api/automations/email-groups',{who:admin,method:'POST',body:{groups:[{id:'fixture-group',name:'Fixture only',to:['fixture@example.invalid'],cc:[],bcc:[]}]}});assert.equal(groups.status,200,JSON.stringify(groups.body));
 const made=await call('/api/automations/recipes',{method:'POST',body:{name:'Private owner A draft',source:'manual',purpose:'email',email:{groupId:'fixture-group',subject:'PRIVATE OWNER A',body:'Synthetic private owner output',openDraftOnManual:false}}});assert.equal(made.status,201,JSON.stringify(made.body));const run=await call('/api/automations/recipes/'+made.body.recipe.id+'/run',{method:'POST',body:{}});assert.equal(run.status,200,JSON.stringify(run.body));const url=run.body.result.email.draftUrl;assert.ok(url.startsWith('/api/automations/mail-drafts/'));assert.equal((await call(url)).status,200,'creator keeps its normal automation output');const before=await rpc('snapshot');for(const who of [b,admin]){assert.equal((await call(url,{who})).status,404,'known filename is not authority');assert.deepEqual(await rpc('snapshot'),before);}
 const agent=await rpc('seedAgentDraft',{ownerId:info.users[0].id}),legacy=await rpc('seedLegacyDraft'),beforeNamespace=await rpc('snapshot');for(const filename of [agent.filename,legacy.filename])assert.equal((await call('/api/automations/mail-drafts/'+encodeURIComponent(filename))).status,404,'normal download cannot read agent-scope or ownerless legacy output');assert.deepEqual(await rpc('snapshot'),beforeNamespace);
});

test('a real CP preview cannot export an order transferred away without changing the buyer profile',async()=>{
 const made=await call('/api/automations/recipes',{method:'POST',body:{name:'Ownership transfer fixture',source:'cp',purpose:'email',email:{groupId:'fixture-group',subject:'Transferred order',openDraftOnManual:false}}});assert.equal(made.status,201,JSON.stringify(made.body));const url='/api/automations/recipes/'+made.body.recipe.id;
 const preview=await call(url+'/preview',{method:'POST',body:{}});assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.preview.matched,1);
 await rpc('transferOwnOrder');const before=await rpc('snapshot');try{const denied=await call(url+'/run',{method:'POST',body:{previewToken:preview.body.previewToken}});assert.equal(denied.status,409,JSON.stringify(denied.body));assert.equal(denied.body.code,'AUTOMATION_NO_MATCH');assert.deepEqual(await rpc('snapshot'),before);}finally{await rpc('transferOwnOrder',{restore:true});}
});

test('normal automation stops before draft persistence when access is revoked between preparation and execution',async()=>{
 const made=await call('/api/automations/recipes',{who:b,method:'POST',body:{name:'HELD AUTHORITY fixture',source:'manual',purpose:'email',email:{groupId:'fixture-group',subject:'Must not persist',body:'Revoked work',openDraftOnManual:false}}});assert.equal(made.status,201,JSON.stringify(made.body));
 const held=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Automation stage did not reach the fixture delay')),5000),listener=message=>{if(message.event==='automation-held'){clearTimeout(timeout);child.off('message',listener);resolve();}};child.on('message',listener);});const running=call('/api/automations/recipes/'+made.body.recipe.id+'/run',{who:b,method:'POST',body:{}});await held;
 const directory=await call('/api/users/admin',{who:admin}),revoked=await call('/api/users/'+info.users[1].id,{who:admin,method:'PUT',body:{expectedRevision:directory.body.revision,permissionCodes:[],reason:'Disposable revoke while preparing'}});assert.equal(revoked.status,200);const before=await rpc('snapshot');await rpc('releaseAutomation');const denied=await running;assert.equal(denied.status,403,JSON.stringify(denied.body));assert.deepEqual(await rpc('snapshot'),before,'revoked work must not create a draft or launch an OS application');
});

test('literal legacy write/asset matrix rejects foreign, mixed, stale and unselected requests without resource mutation',async()=>{
 const own=await call('/api/overrides/4100001',{method:'PATCH',body:{model:'DEMO-A',ccode:'01',notes:{Notes:'OWN POSITIVE CONTROL'}}});assert.equal(own.status,200);assert.equal((await call('/api/checklist-supplier/answers',{method:'POST',body:{entries:[{orderKey:info.keys[0],itemId:'fabric',state:'approved'}]}})).status,200);
 const upload=await call('/api/checklist-supplier/attachments',{who:b,method:'POST',body:{filename:'synthetic.txt',base64:Buffer.from('foreign synthetic evidence').toString('base64'),context:{orderKey:info.keys[1]}}});assert.equal(upload.status,200);const attachment=upload.body.attachment;assert.equal((await call('/api/checklist-supplier/attachments/'+attachment.id,{who:b})).status,200);
 const cases=[
  {name:'foreign-note',url:'/api/overrides/4100002',method:'PATCH',body:{model:'DEMO-B',ccode:'01',notes:{Notes:'DENIED'}},status:403},
  {name:'mixed-note-batch',url:'/api/overrides/batch',method:'POST',body:{items:[{orderCode:4100001,patch:{model:'DEMO-A',ccode:'01',notes:{Notes:'MUST NOT APPLY'}}},{orderCode:4100002,patch:{model:'DEMO-B',ccode:'01',notes:{Notes:'DENIED'}}}]},status:403},
  {name:'foreign-supplier-price',url:'/api/overrides/batch-suppfob',method:'POST',body:{items:[{orderCode:4100002,model:'DEMO-B',ccode:'01',suppFob:5}]},status:403},
  {name:'stale-revision',url:'/api/overrides/4100001',method:'PATCH',body:{model:'DEMO-A',ccode:'01',notes:{Notes:'STALE'}},headers:{'If-Match':'"0"'},status:409},
  {name:'foreign-answer',url:'/api/checklist-supplier/answers',method:'POST',body:{entries:[{orderKey:info.keys[1],itemId:'fabric',state:'approved'}]},status:403},
  {name:'global-definition-capability',url:'/api/checklist-supplier/definitions',method:'POST',body:{definitions:[{id:'denied',kind:'checklist',name:'Denied'}]},status:403},
  {name:'foreign-evidence-upload',url:'/api/checklist-supplier/attachments',method:'POST',body:{filename:'denied.txt',base64:Buffer.from('denied').toString('base64'),context:{orderKey:info.keys[1]}},status:403},
  {name:'foreign-evidence-read',url:'/api/checklist-supplier/attachments/'+attachment.id,status:404},
  {name:'foreign-evidence-delete',url:'/api/checklist-supplier/attachments/'+attachment.id,method:'DELETE',status:404},
  {name:'image-path-traversal',url:'/api/cp-images/%2e%2e%2fuser-access.json',status:404},
  {name:'evidence-path-traversal',url:'/api/checklist-supplier/attachments/%2e%2e%2fuser-access.json',status:404},
  {name:'unselected-session',url:'/api/overrides/4100001',who:null,method:'PATCH',body:{notes:{Notes:'DENIED'}},status:401}
 ];
 for(const row of cases){const before=await rpc('snapshot'),result=await call(row.url,row);assert.equal(result.status,row.status,row.name+' '+JSON.stringify(result.body));assert.deepEqual(await rpc('snapshot'),before,row.name+' must leave protected resources unchanged');}
 for(const [who,ownId,foreignId] of [[a,'510001','510002'],[b,'510002','510001']]){const reports=await call('/api/test-reports',{who});assert.equal(reports.status,200);assert.ok(reports.body.reports[ownId]);assert.equal(reports.body.reports[foreignId],undefined);}
 for(const who of [a,b])assert.equal((await call('/api/fabric-cards',{who})).status,200,'fabric cards are an intentionally shared dictionary, not private order evidence');
 await rpc('deleteForeignOrder');const beforeDeleted=await rpc('snapshot');assert.equal((await call('/api/overrides/4100002',{who:b,method:'PATCH',body:{model:'DEMO-B',ccode:'01',notes:{Notes:'DELETED ORDER'}}})).status,403);assert.deepEqual(await rpc('snapshot'),beforeDeleted);
 const directory=await call('/api/users/admin',{who:admin}),disabled=await call('/api/users/'+info.users[0].id,{who:admin,method:'PUT',body:{expectedRevision:directory.body.revision,enabled:false,status:'INACTIVE',reason:'Disposable authority fixture'}});assert.equal(disabled.status,200,JSON.stringify(disabled.body));assert.equal(disabled.body.user.enabled,false);const rawAfterDisable=await rpc('identity');assert.equal(rawAfterDisable.users.find(user=>user.id===info.users[0].id).enabled,false,JSON.stringify(rawAfterDisable));const beforeDisabled=await rpc('snapshot'),deniedDisabled=await call('/api/overrides/4100001',{method:'PATCH',body:{notes:{Notes:'DISABLED'}}});assert.equal(deniedDisabled.status,401,JSON.stringify({rawAfterDisable,after:await rpc('identity')}));assert.deepEqual(await rpc('snapshot'),beforeDisabled);
});
