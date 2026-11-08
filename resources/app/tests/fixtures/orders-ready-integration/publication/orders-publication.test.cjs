'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,actual,app,fn,deferred}=require('./native-fixture.cjs');
test('ready view and real controller stay private until one guarded publication; normalization owns its write closure',async()=>{
 const s=await setup();let prepared;
 prepared=s.make({setAccepted:value=>{assert.equal(s.scope.state.orders,null);assert.equal(s.controllers.get(prepared.view),prepared.controller,'controller exists before visible module CAS');s.scope._ordersAcceptedReceipt=value;}});
 assert.equal(s.scope.state.orders,null);assert.equal(s.scope._ordersAcceptedReceipt,null);
 assert.equal(s.controllers.has(prepared.view),false);assert.equal(prepared.accepted,s.accepted);
 assert.notEqual(prepared.view.rows,s.accepted.payload.rows);assert.notEqual(prepared.view.rows[0],s.accepted.payload.rows[0]);
 assert.notEqual(prepared.view.rows[0]._logisticSegments,s.accepted.payload.rows[0]._logisticSegments);
 assert.notEqual(prepared.view.rows[0]._logisticSegments[0],s.accepted.payload.rows[0]._logisticSegments[0]);
 assert.equal(prepared.view.rows[0].unknown,s.accepted.payload.rows[0].unknown,'unwritten nested unknown is not graph-copied');
 assert.equal(prepared.view.rows[0]._canEdit,false);assert.ok(prepared.view.rows[0].OPD instanceof Date);
 assert.equal(JSON.stringify(s.accepted.payload),s.readyWire);assert.equal(JSON.stringify(s.f.f.full),s.ordinaryFull);
 assert.equal(prepared.publishReady(),prepared.view);assert.equal(s.scope._ordersAcceptedReceipt,s.accepted);
 assert.equal(s.scope.state.ordersSelected,s.selected);assert.equal(s.selected.size,0);
 assert.equal(s.controllers.get(s.scope.state.orders),prepared.controller);assert.equal(s.events.filter(e=>e.kind!=='normalize').length,0);
 assert.throws(()=>prepared.publishReady(),{code:'ORDERS_FULL_STALE'});
});
test('first ready CAS rechecks real selection, source, pricing and accepted receipt after private preparation',async()=>{
 for(const drift of [s=>{s.scope.state.ordersSelected=new Set();},s=>s.selected.add('unproved-id'),
  s=>s.scope.retireOrdersProjectionSource('between-prepare-and-publish'),s=>s.scope.state.overrides.pricingRules.push({probe:0}),
  s=>{s.scope._ordersAcceptedReceipt={unowned:true};},(_s,p)=>{p.view.rows=[...p.view.rows];}]){
  const s=await setup(),p=s.make();drift(s,p);assert.throws(()=>p.publishReady());assert.equal(s.scope.state.orders,null);
  assert.equal(s.controllers.has(p.view),false);assert.equal(s.requests.length,0);assert.equal(s.events.filter(e=>e.kind==='pricing').length,0);
 }
});
test('actual full-parent DTO/headers/raw SHA and sparse native order promote once; hooks execute only after full CAS',async()=>{
 const s=await setup(),p=s.publish(),thin=s.scope.state.orders,held=[thin.rows[1],thin.rows[0],thin.rows[1]];
 const a=p.controller.ensure(),b=p.controller.ensure();await s.started.promise;
 assert.equal(s.scope.state.orders,thin);assert.equal(s.events.filter(e=>e.kind==='pricing').length,0);s.gate.resolve();
 const [one,two]=await Promise.all([a,b]);assert.equal(one,two);assert.equal(s.requests.length,1);
 const request=s.requests[0];assert.equal(request.url,'/api/page-projection/orders/full-parent');
 assert.deepEqual(JSON.parse(request.init.body),{token:s.accepted.parent.token,requestNonce:'publication_parent_nonce',
  fullGzipChecksum:s.accepted.parent.fullGzipChecksum,guardStamp:s.accepted.parent.guardStamp});
 assert.equal(Object.hasOwn(JSON.parse(request.init.body),'fullJsonSha256'),false);
 assert.equal(s.scope.state.orders.rows,one.rows);assert.notEqual(s.scope.state.orders,thin);assert.equal(s.controllers.has(s.scope.state.orders),false);
 assert.equal(s.scope.state.ordersSelected,s.selected);assert.equal(s.selected.size,0);assert.equal(s.scope._ordersAcceptedReceipt,s.accepted);
 assert.ok(one.rows.every(row=>row._canEdit===false));assert.ok(one.rows[0].OPD instanceof Date);
 assert.ok(Object.hasOwn(one.rows[0],'__CPX_UNUSED'));assert.equal(one.rows[0].unknown.zero,0);assert.equal(one.rows[0].unknown.false,false);assert.equal(one.rows[0].unknown.nil,null);
 assert.equal(Object.hasOwn(one.rows[1],'Probe'),false);assert.ok(Object.hasOwn(one.rows[0],'__proto__'));
 assert.deepEqual(one.remapRows(held),[one.rows[1],one.rows[0],one.rows[1]]);assert.throws(()=>one.remapRows([{...thin.rows[0]}]),{code:'ORDERS_FULL_SELECTION'});
 assert.equal(one.rows[0]['Order Code'],one.rows[1]['Order Code'],'duplicate display/business codes are never used as ordinals');
 const hooks=s.events.filter(e=>e.kind!=='normalize');assert.deepEqual(hooks.map(e=>e.kind),['pricing','invalidate']);
 assert.ok(hooks.every(e=>e.live===s.scope.state.orders));assert.equal(hooks[0].rows,one.rows);
 await p.controller.ensure();assert.equal(s.requests.length,1);assert.equal(s.events.filter(e=>e.kind==='pricing').length,1);
 assert.equal(JSON.stringify(s.f.f.full),s.ordinaryFull);assert.equal(JSON.stringify(s.accepted.payload),s.readyWire);
});
test('pending DOM input invalidates accepted UI capture but not private full source continuity/remap',async()=>{
 const s=await setup(),p=s.publish();s.f.controls.get('ordersSearch').value='native pending value';
 assert.throws(()=>s.accepted.assertCurrent(),{code:'ORDERS_FULL_STALE'});const captured=p.controller.captureUiSource();captured.assertPending();
 const pending=p.controller.ensure();await s.started.promise;s.gate.resolve();const full=await pending;
 assert.equal(captured.assertPromoted(),full);assert.equal(s.f.controls.get('ordersSearch').value,'native pending value');
});
test('actual full sync gate stays closed in the native publish-to-posthooks microtask gap',async()=>{
 const s=await setup(),observed=deferred();s.scope.managedSelectionSnapshot=fn(s.scope,'managedSelectionSnapshot',app);
 const p=s.publish({normalizeDates:rows=>{
  s.f.f.reference.normalize(rows);
  if(s.scope.state.orders)queueMicrotask(()=>queueMicrotask(()=>{
   let gateCode;try{s.scope.managedSelectionSnapshot('orders');}catch(error){gateCode=error.code;}
   observed.resolve({view:s.scope.state.orders,rows:s.scope.state.orders.rows,marker:s.controllers.get(s.scope.state.orders),
    thin:s.scope.ordersProjectionIsThin(),gateCode,hooks:s.events.filter(e=>e.kind!=='normalize').length,reentrant:p.controller.ensure()});
  }));
 }}),thin=s.scope.state.orders,pending=p.controller.ensure();await s.started.promise;s.gate.resolve();
 const gap=await observed.promise;assert.notEqual(gap.view,thin);assert.ok(Object.hasOwn(gap.rows[0],'__CPX_UNUSED'),'actual full rows are already published');
 assert.equal(gap.marker,p.controller);assert.equal(gap.thin,true);assert.equal(gap.gateCode,'ORDERS_FULL_REQUIRED');assert.equal(gap.hooks,0);
 const [full,reentrant]=await Promise.all([pending,gap.reentrant]);assert.equal(full.rows,reentrant.rows);assert.equal(s.requests.length,1,'native snapshot is full while public guard remains unsettled');
 assert.equal(s.scope.state.orders.rows,full.rows);assert.equal(s.scope.ordersProjectionIsThin(),false);
 assert.equal(s.controllers.has(s.scope.state.orders),false);assert.equal(s.events.filter(e=>e.kind==='pricing').length,1);
});
test('real normalizer added keys and after-pricing shape/value/key order match actual ordinary ensureOrdersLoaded',async()=>{
 const price=rows=>{for(const row of rows){row.fixturePriceZero=0;row.fixturePriceFalse=false;row.fixturePriceNull=null;}};
 const reference=await setup(),scope=reference.scope;let afterPricing;
 scope.state.ordersLogisticExpanded=new Set();scope.setOrdersLoadingState=()=>{};
 scope.normalizeCPDates=reference.f.f.reference.normalize;scope.reviveServerDates=fn(scope,'reviveServerDates',app);
 scope.fetchOrdersProjection=async()=>({payload:{...JSON.parse(reference.f.rawText),sources:{asas:'native fixture'}}});
 scope.invalidateUnifiedPriorityDecisions=(reason,tables)=>{assert.equal(reason,'orders-projection-loaded');assert.deepEqual(tables,['orders']);};
 scope.applyPricingRulesToLoadedRows=({render})=>{assert.equal(render,false);price(scope.state.orders.rows);afterPricing=scope.state.orders.rows;};
 scope.ensureCollectionCatalogLoaded=async()=>{};scope.buildOrdersFilters=()=>{};scope.applyCoreAutoFilterState=()=>{};
 scope.renderOrders=()=>{throw Error('deferRender');};scope.showToast=message=>{throw Error(message);};
 assert.equal(await fn(scope,'ensureOrdersLoaded',app)({fullOnly:true,deferRender:true}),true);
 const s=await setup({afterPricing:price}),p=s.publish(),pending=p.controller.ensure();await s.started.promise;s.gate.resolve();const full=await pending;
 assert.deepEqual(full.rows.map(Object.keys),afterPricing.map(Object.keys),'actual ordinary normalized + flagged + priced key order');
 assert.equal(JSON.stringify(full.rows),JSON.stringify(afterPricing),'complete values/types/date serialization after pricing');
 const rawKeys=Object.keys(s.f.f.full.rows[0]),keys=Object.keys(full.rows[0]);
 const added=keys.filter(key=>!rawKeys.includes(key)&&key!=='_canEdit'&&!key.startsWith('fixturePrice'));
 assert.ok(added.length>0,'actual normalizeCPDates adds native approval/logistic cache fields');
 assert.ok(added.every(key=>keys.indexOf(key)<keys.indexOf('_canEdit')),'normalizer keys precede newly appended flag');
 assert.ok(keys.indexOf('_canEdit')<keys.indexOf('fixturePriceZero'),'pricing follows the ordinary flag adaptation');
});
test('pending retirement, pricing, permission, actor, row identity and selection drift fail before full CAS/hooks',async()=>{
 for(const drift of [s=>s.scope.retireOrdersProjectionSource('pending-native'),s=>s.scope.state.overrides.pricingRules.push({probe:false}),
  s=>{s.scope.window.BLCanAccessArea=()=>false;},s=>{s.scope.state.currentUser.id='another';},
  s=>{s.scope.state.orders.rows[0]={...s.scope.state.orders.rows[0]};},s=>{s.scope.state.ordersSelected=new Set();},
  s=>s.selected.add('known-or-unknown-display-id'),s=>s.selected.add(s.scope.state.orders.rows[0]),s=>s.selected.add({foreign:true})]){
  const s=await setup(),p=s.publish(),thin=s.scope.state.orders,pending=p.controller.ensure();pending.catch(()=>{});await s.started.promise;
  drift(s);s.gate.resolve();await assert.rejects(pending);assert.equal(s.scope.state.orders,thin);
  assert.equal(s.events.filter(e=>e.kind==='pricing'||e.kind==='invalidate').length,0);
 }
});
test('real full-parent transport rejects wrong owner/context/gzip/raw bytes and never retries through ready',async()=>{
 for(const options of [{headersChange:h=>{h['X-Orders-Owner-B64']='b3RoZXI';}},
  {headersChange:h=>{h['X-Orders-Broad-Context-Sha256']='0'.repeat(64);}},
  {headersChange:h=>{h['X-Orders-Full-Gzip-Sha256']='0'.repeat(64);}},
  {bytesChange:bytes=>{const changed=Buffer.from(bytes);changed[changed.length-2]^=1;return changed;}}]){
  const s=await setup(options),p=s.publish(),thin=s.scope.state.orders,pending=p.controller.ensure();pending.catch(()=>{});
  await s.started.promise;s.gate.resolve();await assert.rejects(pending);assert.equal(s.scope.state.orders,thin);assert.equal(s.requests.length,1);
  assert.equal(s.events.filter(e=>e.kind==='pricing'||e.kind==='invalidate').length,0);
 }
});
test('normalization writes only fresh row/segment objects and deleting any original raw field fails closed',async()=>{
 const first=await setup();assert.throws(()=>first.make({normalizeDates:rows=>{delete rows[0].unknown;}}),{code:'ORDERS_FULL_PRESENCE'});
 assert.equal(first.scope.state.orders,null);assert.equal(first.scope._ordersAcceptedReceipt,null);
 const s=await setup(),p=s.publish({normalizeDates:rows=>{s.f.f.reference.normalize(rows);if(s.scope.state.orders)delete rows[0].unknown;}});
 const thin=s.scope.state.orders,pending=p.controller.ensure();await s.started.promise;s.gate.resolve();
 await assert.rejects(pending,{code:'ORDERS_FULL_PRESENCE'});assert.equal(s.scope.state.orders,thin);
 assert.equal(JSON.stringify(s.accepted.payload),s.readyWire);assert.equal(s.events.filter(e=>e.kind==='pricing').length,0);
});
test('one cancelled subscriber leaves another native promotion alive; both cancelled publish nothing',async()=>{
 for(const cancelBoth of [false,true]){
  const s=await setup(),p=s.publish(),thin=s.scope.state.orders,first=new AbortController(),second=new AbortController();
  const a=p.controller.ensure({signal:first.signal}),b=p.controller.ensure({signal:second.signal});a.catch(()=>{});b.catch(()=>{});await s.started.promise;
  first.abort();if(cancelBoth)second.abort();s.gate.resolve();await assert.rejects(a,{name:'AbortError'});
  if(cancelBoth){await assert.rejects(b,{name:'AbortError'});assert.equal(s.scope.state.orders,thin);assert.equal(s.events.filter(e=>e.kind==='pricing').length,0);}
  else{const full=await b;assert.equal(s.scope.state.orders.rows,full.rows);assert.equal(s.events.filter(e=>e.kind==='pricing').length,1);}
 }
});
test('post-publication hook failure retains the unsettled full guard until root retirement/full recovery',async()=>{
 const failure=Object.assign(Error('fixture pricing failed'),{code:'FIXTURE_PRICING'}),s=await setup({afterPricing:()=>{throw failure;}}),p=s.publish();
 const thin=s.scope.state.orders,a=p.controller.ensure(),b=p.controller.ensure();a.catch(()=>{});b.catch(()=>{});await s.started.promise;s.gate.resolve();
 await assert.rejects(a,failure);await assert.rejects(b,failure);assert.notEqual(s.scope.state.orders,thin);
 assert.equal(s.controllers.get(s.scope.state.orders),p.controller);assert.equal(s.scope.ordersProjectionIsThin(),true);
 assert.ok(Object.hasOwn(s.scope.state.orders.rows[0],'__CPX_UNUSED'),'guarded committed full is not replaced by the thin payload');
 assert.equal(s.events.filter(e=>e.kind==='pricing').length,1);assert.equal(s.events.filter(e=>e.kind==='invalidate').length,1);
 await assert.rejects(p.controller.ensure(),failure);assert.equal(s.requests.length,1);assert.equal(s.events.filter(e=>e.kind==='pricing').length,1);
 const committed=s.scope.state.orders;s.scope.retireOrdersProjectionSource('after-hooks-failed',{discardThin:true});
 assert.equal(s.scope.state.orders,null);assert.equal(s.scope._ordersRetiredFiniteView.view,committed);assert.equal(s.scope.state.ordersSelected,s.selected);
});
test('ordinary full or nonempty real selections are not adopted into the first thin contract',async()=>{
 for(const change of [s=>{s.scope.state.orders={rows:[]};},s=>s.selected.add(0),s=>s.selected.add(null),s=>s.selected.add({})]){
  const s=await setup();change(s);const old=s.scope.state.orders,selected=s.scope.state.ordersSelected;
  assert.throws(()=>s.make(),{code:'ORDERS_FULL_SELECTION'});assert.equal(s.scope.state.orders,old);assert.equal(s.scope.state.ordersSelected,selected);
  assert.equal(s.events.length,0);assert.equal(s.requests.length,0);
 }
});
