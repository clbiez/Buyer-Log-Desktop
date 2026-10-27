'use strict';
const R=require('../../../resources/app/scripts/sync-e2e/runtime.cjs'), B=require('../../../resources/app/scripts/sync-e2e/browser.cjs'),assert=require('node:assert/strict');
const root=process.argv[2];let rt,browser;const streams=[];const out={status:'failed',scope:'Real authenticated HTTP/SSE on isolated production backend; ancillary isolation check, not a multi-user UI load'};
async function subscribe(server,cookie,id){const controller=new AbortController(),events=[];const res=await fetch(server.base+'/api/live-events?clientId='+id,{headers:{Cookie:cookie},signal:controller.signal});assert.equal(res.status,200);const reader=res.body.getReader();const task=(async()=>{let buffer='';try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);let at;while((at=buffer.indexOf('\n\n'))>=0){const item=buffer.slice(0,at);buffer=buffer.slice(at+2);if(item.startsWith('data: '))events.push(JSON.parse(item.slice(6)));}}}catch(e){if(e.name!=='AbortError')throw e;}})();const stream={controller,events,task};streams.push(stream);return stream;}
(async()=>{try{
 rt=await R.setup(root,{users:3,backends:1,port:7380});out.source=rt.manifest.source;out.sourceDirty=rt.manifest.sourceDirty;
 const server=rt.servers[0],owner=rt.manifest.accounts[1].id,grantee=rt.manifest.accounts[0].id,own=await R.login(server,owner),foreign=await R.login(server,rt.manifest.accounts[2].id),guest=await R.login(server,grantee),moderator=await R.login(server);
 const route='/api/collection-workspaces/'+owner;out.foreignGetStatus=(await R.api(server,route,{cookie:foreign})).status;assert.equal(out.foreignGetStatus,403);
 R.check(await R.api(server,'/api/collection-permissions/'+grantee,{cookie:moderator,method:'PUT',body:{ownerId:owner,level:'view'}}));
 const workspace=R.check(await R.api(server,route,{cookie:own})).workspace,allowed=await subscribe(server,own,'allowed-owner'),denied=await subscribe(server,foreign,'foreign-owner'),revoked=await subscribe(server,guest,'revoked-recipient');
 async function save(name){const w=R.check(await R.api(server,route,{cookie:own})).workspace;return R.check(await R.api(server,route,{method:'PUT',cookie:own,body:{...w,rows:[{id:1,modelKod:'PRIVATE-OWNER-SSE-ISOLATION'}],manufacturers:[{name,email:''}],expectedRevision:w._revision}}));}
 out.acceptance=await save('Private synthetic supplier');
 await R.until(()=>allowed.events.some(e=>e.area==='collection'&&e.ownerId===owner&&e.mode==='reload'),{ms:10000,label:'authorized owner receives native structural reload'});await R.delay(700);
 out.authorizedEvents=allowed.events.filter(e=>e.ownerId===owner);out.unauthorizedEvents=denied.events.filter(e=>e.ownerId===owner);assert.equal(out.unauthorizedEvents.length,0,'foreign workspace metadata must not reach unauthorized SSE subscriber');
 assert.ok(revoked.events.some(e=>e.area==='collection'&&e.ownerId===owner));
 const permissionBefore=revoked.events.filter(e=>e.area==='collection-permissions'&&e.ownerId===owner).length;
 R.check(await R.api(server,'/api/collection-permissions/'+grantee,{cookie:moderator,method:'DELETE',body:{ownerId:owner}}));
 await R.until(()=>revoked.events.filter(e=>e.area==='collection-permissions'&&e.ownerId===owner).length>permissionBefore,{ms:5000,label:'revoked recipient receives permission invalidation on existing connection'});
 const before=revoked.events.filter(e=>e.area==='collection'&&e.ownerId===owner).length,ownBefore=allowed.events.filter(e=>e.area==='collection'&&e.ownerId===owner).length;
 out.afterRevokeAcceptance=await save('Private supplier after revocation');
 await R.until(()=>allowed.events.filter(e=>e.area==='collection'&&e.ownerId===owner).length>ownBefore,{ms:5000,label:'owner remains live after revocation'});await R.delay(700);
 out.revokedCollectionEventsAfter=revoked.events.filter(e=>e.area==='collection'&&e.ownerId===owner).length-before;assert.equal(out.revokedCollectionEventsAfter,0);assert.equal((await R.api(server,route,{cookie:guest})).status,403);
 assert.equal(denied.events.filter(e=>e.ownerId===owner).length,0,'permission invalidation must not expose private owner to an unrelated user');
 out.revokedReconnectStatus=(await R.api(server,route,{cookie:await R.login(server,grantee)})).status;assert.equal(out.revokedReconnectStatus,403);
 browser=await B.launch();const s=await B.open(browser,server,rt.manifest.accounts[1],owner);await s.page.screenshot({path:R.path.join(root,'private-owner-authorized-ui.png')});
 out.actualBrowserContexts=1;out.authenticatedRawSubscribers=3;out.backendInstances=1;out.replicas=1;out.status='passed';console.log('PASS native Collection reload owner isolation, live revocation, recipient invalidation and unrelated permission-event isolation');
 }catch(e){out.error=e.stack;throw e;}finally{await browser?.close();for(const s of streams)s.controller.abort();await Promise.allSettled(streams.map(s=>s.task));R.fs.mkdirSync(root,{recursive:true});R.fs.writeFileSync(R.path.join(root,'result.json'),JSON.stringify(out,null,2));if(rt)for(const s of rt.servers)await R.stopServer(s);}})().catch(e=>{console.error(e);process.exitCode=1;});
