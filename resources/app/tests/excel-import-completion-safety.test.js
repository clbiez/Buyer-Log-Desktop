'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {extractFunction}=require('./helpers/app-main-functions.js'),Plan=require('../public/excel-import-plan.js');
const text=fs.readFileSync(path.join(__dirname,'../public/excel-import-wizard.js'),'utf8');
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve:v=>resolve(v),reject:e=>reject(e)};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const calls=[],row={id:1,rev:1},spec={moduleId:'cp',target:{revision:1}};
 const plan={executable:true,fingerprint:Plan.planFingerprint(spec),revisionGuard:{storeRevision:1,rows:[{targetPosition:0,rev:1}]},newColumns:[{id:'new-note',label:'Synthetic note'}],operations:[{op:'update',targetPosition:0}],summary:{skippedRows:0,warnings:[]},conflicts:[]};
 const columns={created:[{planFieldId:'new-note',id:'note_created'}],rollback:async()=>calls.push(['rollback'])};
 const adapter={canEdit:()=>true,revision:()=>1,rows:()=>[row],rowRevision:r=>r.rev,
  createCustomColumns:async()=>{calls.push(['create']);if(options.createWait)await options.createWait.promise;return columns;},
  execute:async(_plan,_map,progress)=>{calls.push(['execute']);if(options.executeWait)await options.executeWait.promise;if(options.executeFail)throw Error('synthetic transport lost');progress({stage:'importing',done:1,total:1});return {created:0,updated:1,failed:0};},
  refresh:async()=>{calls.push(['refresh']);if(options.refreshFail)throw Error('synthetic refresh failed');}};
 const state={plan,adapter,moduleId:'cp'},host={isConnected:true},profile={id:'synthetic-owner'};
 const scope={state,host,global:{BL_USER_CONTEXT:profile},Plan,Map,T:(_tr,en)=>en,planSpec:()=>spec,
  render:()=>calls.push(['render',scope.state]),audit:(status,result)=>calls.push(['audit',status,result]),close:()=>{calls.push(['close']);scope.state=null;scope.host=null;}};
 const start=text.indexOf('  async function runImport(');assert.ok(start>=0,'actual nested runImport anchor');
 scope.importActorEpoch=0;
 for(const name of ['importActorStamp','syncImportActor','importResultMessage']){const at=text.indexOf('  function '+name+'(');assert.ok(at>=0);scope[name]=Function('scope','with(scope){return ('+extractFunction(text.slice(at+2),name)+');}')(scope);}
 scope.importActorSignature=scope.importActorStamp();
 const run=Function('scope','with(scope){return ('+extractFunction(text.slice(start+2),'runImport')+');}')(scope);
 return {scope,state,host,profile,plan,row,adapter,columns,calls,run};
}
test('confirmed row ACK followed by refresh failure never rolls back columns or erases acknowledged counts',async()=>{
 const f=fixture({refreshFail:true});await f.run();assert.equal(f.calls.some(x=>x[0]==='rollback'),false,'confirmed writes must keep created columns');
 assert.equal(f.state.result.updated,1);assert.equal(f.state.result.customFieldsCreated,1);assert.equal(f.state.result.serverWrite,'acknowledged');assert.equal(f.state.result.status,'failed');assert.match(f.state.result.message,/saved|acknowledged/i);
});
test('uncertain execute failure retains columns and labels server outcome unknown',async()=>{
 const f=fixture({executeFail:true});await f.run();assert.equal(f.calls.some(x=>x[0]==='rollback'),false,'lost transport is not proof of no commit');
 assert.equal(f.state.result.serverWrite,'unknown');assert.equal(f.state.result.customFieldsCreated,1);assert.match(f.state.result.message,/confirm|unknown/i);
});
test('actual plan is checked again after column creation before row mutation',async()=>{
 const wait=deferred(),f=fixture({createWait:wait}),pending=f.run();await turn();f.row.rev=2;wait.resolve();await pending;
 assert.equal(f.calls.some(x=>x[0]==='execute'),false);assert.equal(f.calls.some(x=>x[0]==='rollback'),false);assert.equal(f.state.result.serverWrite,'not-started');
});
test('late primary completion cannot refresh audit or clear a newly opened wizard',async()=>{
 const wait=deferred(),f=fixture({executeWait:wait}),pending=f.run();await turn();const replacement={plan:{id:'new-plan'},busy:'new-busy',progress:{new:true}};f.scope.state=replacement;f.scope.host={isConnected:true};wait.resolve();await pending;
 assert.deepEqual(replacement,{plan:{id:'new-plan'},busy:'new-busy',progress:{new:true}});assert.equal(f.calls.some(x=>x[0]==='refresh'||x[0]==='audit'),false);
});
test('closed or replaced wizard cannot continue from column ACK into row execution',async()=>{
 const wait=deferred(),f=fixture({createWait:wait}),pending=f.run();await turn();f.scope.state=null;f.scope.host=null;wait.resolve();await pending;
 assert.equal(f.calls.some(x=>x[0]==='execute'||x[0]==='audit'||x[0]==='rollback'),false);
});
test('actor replacement and in-place actor-id drift block late work without targeting new owner',async()=>{
 for(const replace of [f=>{f.scope.global.BL_USER_CONTEXT={id:'another-owner'};},f=>{f.profile.id='another-owner';}]){
  const wait=deferred(),f=fixture({createWait:wait}),pending=f.run();await turn();replace(f);wait.resolve();await pending;
  assert.equal(f.calls.some(x=>x[0]==='execute'||x[0]==='audit'||x[0]==='rollback'),false);
 }
});
test('successful current import preserves counts refresh ordering and feedback',async()=>{
 const f=fixture();await f.run();assert.equal(f.state.result.status,'success');assert.equal(f.state.result.updated,1);assert.equal(f.state.busy,false);assert.equal(f.state.plan,null);
 assert.equal(f.calls.filter(x=>x[0]==='execute').length,1);assert.ok(f.calls.findIndex(x=>x[0]==='execute')<f.calls.findIndex(x=>x[0]==='refresh'));
});
test('read-only denial starts no creation or row mutation',async()=>{
 const f=fixture();f.adapter.canEdit=()=>false;await f.run();assert.equal(f.calls.some(x=>x[0]==='create'||x[0]==='execute'||x[0]==='rollback'),false);assert.equal(f.state.result.status,'failed');
});
test('permission revoked during column creation blocks the subsequent row write',async()=>{
 const wait=deferred(),f=fixture({createWait:wait}),pending=f.run();await turn();f.adapter.canEdit=()=>false;wait.resolve();await pending;
 assert.equal(f.calls.some(x=>x[0]==='execute'),false);assert.equal(f.state.result.serverWrite,'not-started');
});
test('a second click cannot start another import while the first job is pending',async()=>{
 const wait=deferred(),f=fixture({executeWait:wait}),pending=f.run();await turn();await f.run();
 assert.equal(f.calls.filter(x=>x[0]==='create').length,1);assert.equal(f.calls.filter(x=>x[0]==='execute').length,1);wait.resolve();await pending;
});
test('partial primary ACK counts remain intact when the view refresh fails',async()=>{
 const f=fixture({refreshFail:true});f.adapter.execute=async()=>({created:2,updated:3,failed:4});await f.run();
 assert.equal(f.state.result.created,2);assert.equal(f.state.result.updated,3);assert.equal(f.state.result.failed,4);
 assert.equal(f.state.result.serverWrite,'acknowledged');assert.equal(f.calls.some(x=>x[0]==='rollback'),false);
});
test('optional source guards cannot return false or an unawaited Promise as permission to continue',async()=>{
 for(const guard of [()=>false,async()=>true]){
  const f=fixture();f.adapter.assertCurrent=guard;await f.run();assert.equal(f.calls.some(x=>x[0]==='create'||x[0]==='execute'),false);
 }
});
test('normal same-actor hydration performed by the actual app keeps successful import completion',async()=>{
 const f=fixture(),app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
 const start=app.indexOf('    state.currentUser=data.currentUser||state.currentUser||window.BL_USER_CONTEXT||null;');
 const end=app.indexOf('    reviveServerDates(',start);assert.ok(start>=0&&end>start);
 f.adapter.refresh=async()=>{const actualHydration=Function('state','window','data',app.slice(start,end));actualHydration({currentUser:f.profile},f.scope.global,{currentUser:{...f.profile}});};
 await f.run();assert.equal(f.state.result?.status,'success');assert.equal(f.calls.some(x=>x[0]==='audit'&&x[1]==='success'),true);
});
function actualCpAdapter(){return require('./helpers/cp-import-fixture').actualCpAdapter();}
test('actual CP revision witness survives its own new blank column while still rejecting original-field edits',()=>{
 const f=actualCpAdapter(),before=f.adapter.rowRevision(f.row),plan={executable:true,revisionGuard:{storeRevision:1,rows:[{targetPosition:0,rev:before}]}};
 f.scope.CP_NOTE_COLUMN_DEFS.push({id:'note_created',label:'New'});f.row.note_created='';
 assert.equal(Plan.assertApplicable(plan,{revision:1,rows:[f.row],rowRevision:f.adapter.rowRevision}).ok,true,'own schema addition must not change the old row witness');
 f.row.Notes='concurrent edit';assert.equal(Plan.assertApplicable(plan,{revision:1,rows:[f.row],rowRevision:f.adapter.rowRevision}).code,'STALE_ROW');
});
test('actual CP request carries the original plan revision through the mutation queue',async()=>{
 const f=actualCpAdapter(),plan={operations:[{op:'update'}],revisionGuard:{storeRevision:1}};f.scope.state.storeRevisions.orders=2;
 await f.adapter.execute(plan,new Map());assert.equal(f.sent.length,1);assert.equal(f.sent[0][2].expectedRevision,1);
});
test('an observed account/access change cannot be hidden by returning to the original actor before completion',async()=>{
 const wait=deferred(),f=fixture({createWait:wait}),pending=f.run();await turn();
 f.scope.global.BL_USER_CONTEXT={id:'another-owner'};f.scope.syncImportActor();f.scope.global.BL_USER_CONTEXT=f.profile;f.scope.syncImportActor();wait.resolve();await pending;
 assert.equal(f.calls.some(x=>x[0]==='execute'||x[0]==='audit'),false);
});
test('same-id access revocation invalidates a pending job even when legacy canEdit still returns true',async()=>{
 const wait=deferred(),f=fixture({createWait:wait}),pending=f.run();await turn();f.scope.global.BL_USER_CONTEXT={...f.profile,permissions:{write:false}};wait.resolve();await pending;
 assert.equal(f.calls.some(x=>x[0]==='execute'||x[0]==='audit'),false);
});
test('actual CP refresh cannot silently report completion when the real loader returns false',async()=>{
 const f=actualCpAdapter();f.scope.loadFromServer=async()=>false;
 await assert.rejects(f.adapter.refresh(),/reload|loaded|refresh/i);
});
test('actual CP successful refresh preserves its original undefined result and calls the loader once',async()=>{
 const f=actualCpAdapter();let calls=0;f.scope.loadFromServer=async()=>{calls++;return true;};assert.equal(await f.adapter.refresh(),undefined);assert.equal(calls,1);
});
test('changing language after a failed import redraws the new outcome explanation in the selected language',async()=>{
 const f=fixture({refreshFail:true});await f.run();f.scope.en=()=>false;f.scope.T=(tr,_en)=>tr;
 const escAt=text.indexOf('  function esc('),renderAt=text.indexOf('  function renderImportStep(');assert.ok(escAt>=0&&renderAt>=0);
 f.scope.esc=Function('scope','with(scope){return ('+extractFunction(text.slice(escAt+2),'esc')+');}')(f.scope);
 const render=Function('scope','with(scope){return ('+extractFunction(text.slice(renderAt+2),'renderImportStep')+');}')(f.scope);
 assert.match(render(),/Sunucu aktarım yanıtı alındı/);
});
test('the owned CP refresh failure detail also changes language with the outcome',async()=>{
 const cp=actualCpAdapter(),f=fixture();cp.scope.loadFromServer=async()=>false;f.adapter.refresh=cp.adapter.refresh;await f.run();
 f.scope.T=(tr,_en)=>tr;assert.match(f.scope.importResultMessage(f.state.result),/sunucu verisi yeniden yüklenemedi/);
});

test('replacing a plan in the same wizard while creation is pending preserves the new draft',async()=>{
 const wait=deferred(),f=fixture({createWait:wait}),pending=f.run();await turn();const replacement={id:'new-draft'};f.state.plan=replacement;f.state.busy='new-busy';wait.resolve();await pending;
 assert.equal(f.scope.state,f.state);assert.equal(f.state.plan,replacement);assert.equal(f.state.busy,'new-busy');assert.equal(f.calls.some(e=>e[0]==='execute'||e[0]==='close'),false);
});
