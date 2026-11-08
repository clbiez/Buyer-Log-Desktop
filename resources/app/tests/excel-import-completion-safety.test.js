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
