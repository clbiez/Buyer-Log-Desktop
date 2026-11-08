'use strict';
const nativeTest=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {fixture,turn,until,deferred}=require('./native-fixture.cjs');
const test=(name,fn)=>nativeTest(name,{timeout:5000},fn);
const config='/api/model-connections',schema='/api/model-connections/schema';
const patch=r=>r.opts.method==='PATCH';
const localWrites=f=>f.events.filter(e=>['sync','forget','render'].includes(e[0]));
for(const action of ['open','remove'])test('thin '+action+' waits whole UI gate before definitions, confirm, DOM removal or network',async()=>{
 const f=fixture({thin:true}),old=f.document.createElement('div');old.id='_cpModelColumnModal';f.document.body.appendChild(old);
 let reads=0;const defs=f.c.CP_MODEL_COLUMN_DEFS;
 f.c.CP_MODEL_COLUMN_DEFS=new Proxy(defs,{get(target,key){reads++;return Reflect.get(target,key);}});
 const p=action==='open'?f.c.openCpModelColumnModal('column-one'):f.c.removeCpModelColumn('column-one');
 await turn();assert.equal(reads,0);assert.equal(f.requests.length,0);assert.equal(f.events.some(x=>x[0]==='confirm'||x[0]==='remove'),false);
 f.c.CP_MODEL_COLUMN_DEFS=defs;f.promote();await p;await turn();
 assert.equal(f.events.filter(x=>x[0]==='full-fetch').length,1);assert.ok(f.requests.length>0);
});
for(const change of ['tab','source','session','profile','actor','permission'])test('thin open '+change+' while promotion pending cannot replace old modal',async()=>{
 const f=fixture({thin:true}),old=f.document.createElement('div');old.id='_cpModelColumnModal';f.document.body.appendChild(old);
 const p=f.c.openCpModelColumnModal('column-one');await turn();
 if(change==='tab')f.tab('cp');if(change==='source')f.retire();if(change==='session')f.c.retireOrdersProjectionSource('session',{sessionChanged:true});
 if(change==='profile')f.state.currentUser={id:'other'};if(change==='actor')f.state.currentUser.id='other';if(change==='permission')f.revoke();
 f.promote();await p;assert.equal(f.modal,old);assert.equal(f.requests.length,0);assert.equal(localWrites(f).length,0);
});
for(const stage of ['http','json'])for(const change of ['tab','profile','actor','context','source','session','definitions','dom'])test('open '+change+' at config '+stage+' is stale before modal replacement/schema',async()=>{
 const f=fixture(),old=f.document.createElement('div');old.id='_cpModelColumnModal';f.document.body.appendChild(old);
 const hold=f.hold(config,stage),p=f.c.openCpModelColumnModal('column-one');await hold.entered;
 if(change==='tab')f.tab('cp');if(change==='profile')f.state.currentUser={id:'demo-actor'};if(change==='actor')f.state.currentUser.id='changed';
 if(change==='context')f.c.window.BL_USER_CONTEXT={id:'demo-actor'};if(change==='source')f.retire();if(change==='session')f.c.retireOrdersProjectionSource('session',{sessionChanged:true});
 if(change==='definitions')f.c.CP_MODEL_COLUMN_DEFS[0].label='changed';if(change==='dom'){const replacement=f.document.createElement('div');replacement.id='_cpModelColumnModal';f.document.body.appendChild(replacement);}
 const before=f.modal;hold.release();await p;assert.equal(f.modal,before);assert.equal(f.requests.filter(r=>r.url===schema).length,0);assert.equal(localWrites(f).length,0);
});
for(const active of [true,false])test('ordinary full open retains rows/selection, uses original endpoints; active='+active,async()=>{
 const f=fixture({active}),view=f.state.orders,selection=f.state.ordersSelected;await f.open();
 assert.equal(f.state.orders,view);assert.equal(f.state.ordersSelected,selection);assert.deepEqual(f.requests.map(r=>r.url),[config,schema]);assert.equal(f.events.some(e=>e[0]==='full-fetch'),false);
});
for(const stage of ['http','json'])test('schema selected connection and sequence checked after '+stage+' (A → B → A)',async()=>{
 const f=fixture(),old=f.hold(schema,stage);await f.open();await old.entered;
 await f.chooseConnection('b');assert.match(f.modal.querySelector('#_cpModelColumnList').innerHTML,/FieldB/);
 const latest=f.hold(schema,stage);await f.chooseConnection('a');await latest.entered;
 old.request.data={columns:[{kind:'column',table:'Demo',name:'StaleA'}]};old.release();await turn();
 assert.doesNotMatch(f.modal.querySelector('#_cpModelColumnList').innerHTML,/StaleA/);
 latest.request.data={columns:[{kind:'column',table:'Demo',name:'LatestA'}]};latest.release();await turn();
 assert.match(f.modal.querySelector('#_cpModelColumnList').innerHTML,/LatestA/);
});
for(const stage of ['http','json'])for(const change of ['close','tab','profile','definitions','dom','control','list','source'])test('late schema '+stage+' after '+change+' cannot render detached/changed modal',async()=>{
 const f=fixture(),hold=f.hold(schema,stage);await f.open();await hold.entered;const modal=f.modal,list=modal.querySelector('#_cpModelColumnList');
 const before=list.innerHTML;
 if(change==='close')modal.remove();if(change==='tab')f.tab('cp');if(change==='profile')f.state.currentUser={id:'other'};
 if(change==='definitions')f.c.CP_MODEL_COLUMN_DEFS[0].name='other';if(change==='source')f.retire();
 if(change==='dom'){const replacement=f.document.createElement('div');replacement.id='_cpModelColumnModal';f.document.body.appendChild(replacement);}
 if(change==='control'||change==='list'){
  const id=change==='control'?'_cpModelConnection':'_cpModelColumnList',old=modal.querySelector('#'+id),replacement=f.document.createElement('div');
  replacement.id=id;replacement.value=old.value;replacement.isConnected=true;old.isConnected=false;modal.nodes.set('#'+id,replacement);
 }
 hold.release();await turn();assert.equal(list.innerHTML,before);assert.equal(localWrites(f).length,0);
});
function mutate(f,change){
 const modal=f.modal;
 if(change==='close')modal.remove();else if(change==='tab')f.tab('cp');else if(change==='profile')f.state.currentUser={id:'demo-actor'};
 else if(change==='actor')f.state.currentUser.id='other';else if(change==='source')f.retire();
 else if(change==='definitions')f.c.CP_MODEL_COLUMN_DEFS[0].name='Other';
 else if(change==='connection')return f.chooseConnection('b');
 else if(change==='field')return f.chooseField();
 else if(change==='node'){const n=modal.querySelector('#_cpModelLabelEn');n.isConnected=false;modal.nodes.set('#_cpModelLabelEn',{...n,isConnected:true,value:'Replacement'});}
 else{const node=modal.querySelector(change==='group'?'#_cpModelGroupNew':'#_cpModelLabelEn');node.value='Changed';return node.fire('input');}
}
for(const boundary of ['preflight-http','preflight-json','patch-http','patch-json'])for(const change of ['connection','field','heading','group','close','tab','profile','actor','source','definitions','node'])test('save '+change+' during '+boundary+' stops original command/local commit',async()=>{
 const f=fixture();await f.open();await f.chooseField();
 const hold=f.hold(boundary.startsWith('preflight')?config:patch,boundary.endsWith('json')?'json':'http');
 const pending=f.save();await hold.entered;await mutate(f,change);hold.release();await pending;await turn();
 assert.equal(f.patches.length,boundary.startsWith('preflight')?0:1);assert.equal(localWrites(f).length,0);
 assert.equal(f.requests.filter(r=>r.url===config).length,boundary.startsWith('preflight')?2:2,'no post-write reload after stale PATCH');
});
test('save detects change away and back while preflight is pending',async()=>{
 const f=fixture();await f.open();await f.chooseField();const hold=f.hold(config),pending=f.save();await hold.entered;
 const node=f.modal.querySelector('#_cpModelLabelEn'),before=node.value;node.value='Temporary';await node.fire('input');node.value=before;await node.fire('input');
 hold.release();await pending;assert.equal(f.patches.length,0);assert.equal(localWrites(f).length,0);
});
for(const active of [true,false])test('actual own PATCH → actual load receipt continues full save; active='+active,async()=>{
 const f=fixture({active}),view=f.state.orders;await f.open();await f.chooseField();await f.save();
 assert.equal(f.patches.length,1);assert.equal(f.patches[0].command.op,'update');assert.equal(f.modal,null);assert.equal(f.state.orders,view);
 assert.equal(f.events.filter(e=>e[0]==='sync').length,1);assert.equal(f.c.modelConnState.revision,6);assert.equal(f.c._ordersProjectionSourceEpoch,active?2:0);
 assert.equal(f.requests.filter(r=>r.opts.method==='PATCH')[0].body.expectedSourceRevision.length,16);
});
test('remove validates original confirm action then forgets/syncs only after actual own receipt',async()=>{
 const f=fixture();await f.c.removeCpModelColumn('column-one');assert.equal(f.patches.length,1);assert.equal(f.patches[0].command.op,'remove');
 assert.equal(f.events.filter(e=>e[0]==='forget').length,2);assert.equal(f.events.filter(e=>e[0]==='sync').length,1);assert.equal(f.serverItems[0].cpColumns.length,0);
});
for(const stage of ['http','json'])test('remove stale after PATCH '+stage+' cannot alter local layout/schema',async()=>{
 const f=fixture(),hold=f.hold(patch,stage),pending=f.c.removeCpModelColumn('column-one');await hold.entered;f.retire();hold.release();await pending;
 assert.equal(f.patches.length,1);assert.equal(localWrites(f).length,0);
});
test('changed full preflight payload is foreign, even with no external epoch retirement',async()=>{
 const f=fixture();await f.open();await f.chooseField();f.foreign();await f.save();
 assert.equal(f.patches.length,0);assert.equal(localWrites(f).length,0);assert.equal(f.c.modelConnState.revision,6);
});
for(const stage of ['http','json'])test('post-write load '+stage+' cannot adopt newer foreign revision or epoch',async()=>{
 const f=fixture();await f.open();await f.chooseField();const p=f.hold(patch),pending=f.save();await p.entered;
 f.foreign();const reload=f.hold(config,stage);p.release();await reload.entered;reload.release();await pending;
 assert.equal(localWrites(f).length,0);assert.equal(f.c.modelConnState.revision,5);
});
for(const change of ['close','heading','profile','source'])for(const stage of ['http','json'])test('post-write load '+stage+' validates original '+change+' before callee config apply',async()=>{
 const f=fixture();await f.open();await f.chooseField();const p=f.hold(patch),pending=f.save();await p.entered;
 const reload=f.hold(config,stage);p.release();await reload.entered;await mutate(f,change);reload.release();await pending;
 assert.equal(localWrites(f).length,0);assert.equal(f.c.modelConnState.revision,5);
});
for(const boundary of ['add-http','add-json','post-add-http','post-add-json','remove-preflight-http','remove-preflight-json','remove-http','remove-json','post-remove-http','post-remove-json'])test('two-stage move remains add-first and stops after change at '+boundary,async()=>{
 const f=fixture();await f.open();await f.chooseConnection('b');await f.chooseField();
 const first=f.hold(patch),pending=f.save();await first.entered;assert.equal(f.patches[0].command.op,'add');
 let hold=first;
 if(boundary!=='add-http'){
  if(boundary==='add-json')hold=f.hold(patch,'json');
  else if(boundary.startsWith('post-add'))hold=f.hold(config,boundary.endsWith('json')?'json':'http');
  else if(boundary.startsWith('remove-preflight')){let n=0;hold=f.hold(r=>r.url===config&&++n===2,boundary.endsWith('json')?'json':'http');}
  else if(boundary.startsWith('remove-'))hold=f.hold(r=>patch(r)&&r.body.cpColumn.op==='remove',boundary.endsWith('json')?'json':'http');
  else{let n=0;hold=f.hold(r=>r.url===config&&++n===3,boundary.endsWith('json')?'json':'http');}
  first.release();await hold.entered;
 }
 f.modal.querySelector('#_cpModelLabelEn').value='Changed';await f.modal.querySelector('#_cpModelLabelEn').fire('input');hold.release();await pending;
 const destructive=boundary.startsWith('remove-http')||boundary.startsWith('remove-json')||boundary.startsWith('post-remove');
 assert.deepEqual(f.patches.map(p=>p.command.op),destructive?['add','remove']:['add']);assert.equal(localWrites(f).length,0);
 if(!destructive)assert.equal(f.serverItems[0].cpColumns.length,1,'original retained');assert.equal(f.serverItems[1].cpColumns.length,1,'add retained');
});
test('ordinary full move actually executes add then remove, with two known revisions',async()=>{
 const f=fixture();await f.open();await f.chooseConnection('b');await f.chooseField();await f.save();
 assert.deepEqual(f.patches.map(p=>p.command.op),['add','remove']);assert.equal(f.c.modelConnState.revision,7);assert.equal(f.serverItems[0].cpColumns.length,0);assert.equal(f.serverItems[1].cpColumns.length,1);
 assert.equal(f.modal,null);assert.equal(f.c._ordersProjectionSourceEpoch,4);
});
for(const stage of ['http','json'])test('lost add '+stage+' response never guesses success, retries or removes original',async()=>{
 const f=fixture();await f.open();await f.chooseConnection('b');await f.chooseField();const hold=f.hold(patch,stage),pending=f.save();await hold.entered;hold.reject(Error('synthetic lost response'));await pending;
 assert.deepEqual(f.patches.map(p=>p.command.op),['add']);assert.equal(f.serverItems[0].cpColumns.length,1);assert.equal(f.serverItems[1].cpColumns.length,1);assert.equal(localWrites(f).length,0);
});
test('foreign real modelConnLoad during pending PATCH cannot be rebound by later own reload',async()=>{
 const f=fixture();await f.open();await f.chooseField();const hold=f.hold(patch),pending=f.save();await hold.entered;
 f.foreign();await f.c.modelConnLoad();const epoch=f.c._ordersProjectionSourceEpoch;hold.release();await pending;
 assert.equal(f.c._ordersProjectionSourceEpoch,epoch);assert.equal(localWrites(f).length,0);assert.equal(f.c.modelConnState.revision,7);
});
test('private load receipt is bound to original action, known revision and consumed once',async()=>{
 const f=fixture();vm.runInContext('globalThis.action=captureCpModelAction();globalThis.ticket=action.request(6);',f.c);
 f.foreign();await f.c.modelConnLoad(f.c.ticket);
 vm.runInContext('action.consume(ticket);',f.c);assert.equal(f.c._ordersProjectionSourceEpoch,2);
 assert.throws(()=>vm.runInContext('action.consume(ticket)',f.c),e=>e.code==='ORDERS_FULL_STALE');
 // Replay after another source change cannot revive the original action.
 f.retire();assert.throws(()=>vm.runInContext('action.consume(ticket)',f.c),e=>e.code==='ORDERS_FULL_STALE');
 vm.runInContext('globalThis.other=captureCpModelAction();',f.c);
 assert.throws(()=>vm.runInContext('other.consume(ticket)',f.c),e=>e.code==='ORDERS_FULL_STALE');
});
test('modelConnLoad without private continuation keeps original state return contract',async()=>{
 const f=fixture();f.foreign();const state=f.c.modelConnState;assert.equal(await f.c.modelConnLoad(),state);assert.equal(state.revision,6);assert.equal(f.c._ordersProjectionSourceEpoch,2);assert.equal(f.c.modelConnLoad.length,0);
});
test('foreign preflight refresh cancels old command and allows an explicit fresh action',async()=>{
 const f=fixture();await f.open();await f.chooseField();f.foreign();await f.save();assert.equal(f.patches.length,0);
 assert.equal(f.c.modelConnState.revision,6);await f.open();await f.chooseField();await f.save();assert.equal(f.patches.length,1);assert.equal(f.modal,null);
});
for(const stage of ['http','json'])for(const change of ['tab','profile','definitions','definition-identity'])test('remove original action '+change+' at preflight '+stage+' cannot PATCH or forget',async()=>{
 const f=fixture(),hold=f.hold(config,stage),pending=f.c.removeCpModelColumn('column-one');await hold.entered;
 if(change==='definition-identity')f.c.CP_MODEL_COLUMN_DEFS=[...f.c.CP_MODEL_COLUMN_DEFS];else await mutate(f,change);
 hold.release();await pending;assert.equal(f.patches.length,0);assert.equal(localWrites(f).length,0);
});
test('remove rechecks after synchronous confirm callback before starting preflight',async()=>{
 const f=fixture();f.c.confirm=()=>{f.retire();return true;};await f.c.removeCpModelColumn('column-one');assert.equal(f.requests.length,0);assert.equal(localWrites(f).length,0);
});
for(const stage of ['http','json'])test('direct write command mutation during '+stage+' preflight cannot issue PATCH',async()=>{
 const f=fixture(),hold=f.hold(config,stage),command={op:'remove',id:'column-one'},pending=f.c.writeCpModelColumn('a',command);pending.catch(()=>{});await hold.entered;
 command.id='changed';hold.release();await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.patches.length,0);
});
test('original server per-source CAS still rejects a foreign update after preflight',async()=>{
 const f=fixture();await f.open();await f.chooseField();const hold=f.hold(patch,'before'),pending=f.save();await hold.entered;f.foreign();hold.release();await pending;
 assert.equal(f.patches.length,0);assert.equal(localWrites(f).length,0);assert.match(f.modal.querySelector('#_cpModelStatus').textContent,/SOURCE_CHANGED/);
});
for(const stage of ['http','json'])test('lost second remove '+stage+' response cannot claim local success or retry',async()=>{
 const f=fixture();await f.open();await f.chooseConnection('b');await f.chooseField();const hold=f.hold(r=>patch(r)&&r.body.cpColumn.op==='remove',stage),pending=f.save();await hold.entered;
 hold.reject(Error('synthetic lost remove response'));await pending;assert.deepEqual(f.patches.map(p=>p.command.op),['add','remove']);assert.equal(localWrites(f).length,0);assert.ok(f.modal);
});
for(const change of ['none','close','heading','profile','source'])test('real callee fresh-full await checks original '+change+' before config commit/receipt',async()=>{
 const f=fixture();await f.open();await f.chooseField();const wait=deferred(),entered=deferred();
 f.c.fetchOrdersProjection=options=>{assert.equal(options.fullOnly,true);entered.resolve();return wait.promise;};
 f.c._ordersRetiredFiniteView={view:f.state.orders};const pending=f.save();await entered.promise;
 if(change!=='none')await mutate(f,change);
 wait.resolve({payload:{rows:[{_id:1,complete:true}],collectionCatalogs:{}}});await pending;
 assert.equal(f.c._ordersGlobalUpdateDepth,0);
 if(change==='none'){assert.equal(f.c.modelConnState.revision,6);assert.equal(f.modal,null);assert.equal(f.events.filter(e=>e[0]==='sync').length,1);}
 else{assert.equal(f.c.modelConnState.revision,5);assert.equal(localWrites(f).length,0);}
});
for(const change of ['command','actor'])test('direct thin writer preserves original '+change+' across promotion',async()=>{
 const f=fixture({thin:true}),command={op:'remove',id:'column-one'},pending=f.c.writeCpModelColumn('a',command);pending.catch(()=>{});await turn();
 if(change==='command')command.id='different';else f.state.currentUser.id='different';f.promote();await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.requests.length,0);
});
test('save retains original list DOM identity across PATCH JSON wait',async()=>{
 const f=fixture();await f.open();await f.chooseField();const hold=f.hold(patch,'json'),pending=f.save();await hold.entered;
 const old=f.modal.querySelector('#_cpModelColumnList'),replacement=f.document.createElement('div');replacement.id=old.id;replacement.isConnected=true;old.isConnected=false;f.modal.nodes.set('#'+old.id,replacement);
 hold.release();await pending;assert.equal(f.patches.length,1);assert.equal(localWrites(f).length,0);assert.equal(f.requests.filter(r=>r.url===config).length,2);
});
test('unknown PATCH revision cannot justify config epoch rebinding or local save success',async()=>{
 const f=fixture();await f.open();await f.chooseField();const hold=f.hold(patch),pending=f.save();await hold.entered;delete hold.request.data.revision;hold.release();await pending;
 assert.equal(f.patches.length,1);assert.equal(localWrites(f).length,0);assert.ok(f.modal);
});
test('private unconsumed receipt cannot transfer to a different original action',async()=>{
 const f=fixture();vm.runInContext('globalThis.first=captureCpModelAction();globalThis.second=captureCpModelAction();globalThis.ticket=first.request(6);',f.c);
 f.foreign();await f.c.modelConnLoad(f.c.ticket);
 assert.throws(()=>vm.runInContext('second.consume(ticket)',f.c),e=>e.code==='ORDERS_FULL_STALE');
 assert.throws(()=>vm.runInContext('first.consume(ticket)',f.c),e=>e.code==='ORDERS_FULL_STALE');
});
