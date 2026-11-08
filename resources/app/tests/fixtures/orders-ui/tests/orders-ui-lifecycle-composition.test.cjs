'use strict';
// UNRUN V2 additions. The complete original UI assertion file stays byte-exact.
const nativeTest=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const test=(name,body)=>nativeTest(name,{timeout:5000},body);
const f=require('./ui-fixture.cjs'),c=f.composition,recipe=require('../snippets/ui-patch-recipe.cjs');
const turn=()=>new Promise(setImmediate);
function controls(x){x.evaluate(f.between(x.source,"['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason'].forEach(id=>{","\nbindTableSearchClipboardPaste(document.getElementById('ordersSearch'))"));}
test('V1 helper/recipe/seam and all existing UI assertions remain exact frozen bytes',()=>{
 for(const [file,sha] of [['candidate/orders-ui-command.js',c.PINS.uiHelper],['snippets/ui-patch-recipe.cjs',c.PINS.recipe],['snippets/app-ui-seam.js',c.PINS.seam],
  ['tests/orders-ui-command.test.cjs','837d8e5578820edd1e6e33b12f8f744b7751db43e0e36bcac40e26a96ecf27cd'],['tests/helpers/orders-retirement-source.js',c.PINS.lifecycleHelper]])
  assert.equal(f.hash(fs.readFileSync(path.join(__dirname,'..',file))),sha,file);
});
test('UI candidate is exactly existing recipe applied to exact retirement input, preserving all new retirement functions',()=>{
 assert.equal(f.hash(f.source),c.PINS.retirement);
 assert.equal(f.patched,recipe.app(f.source,f.extractFunction,c.seam));
 const start=text=>text.indexOf('let ordersLoadPromise=null;'),end=text=>text.indexOf('let cpLoadPromise=null;',start(text));
 assert.equal(f.patched.slice(start(f.patched),end(f.patched)),c.lifecycle);
 for(const name of ['ensureOrdersFullForAction','ensureOrdersLoaded','fetchOrdersProjection','loadFromServer','hydrateUserPreferencesAfterUi'])
  assert.equal(f.extractFunction(f.patched,name),f.extractFunction(f.source,name),name+' actual retirement body');
});
test('fixture executes actual new ensure function and actual lexical lifecycle rather than counter/guard substitutes',()=>{
 const x=f.fixture();assert.equal(x.ctx.ensureOrdersFullForAction.toString(),f.extractFunction(c.selectedSource,'ensureOrdersFullForAction'));
 for(const name of ['retireOrdersProjectionSource','ordersProjectionMustLoadFull','beginOrdersGlobalUpdate','assertOrdersGlobalUpdate','prepareOrdersGlobalApply','endOrdersGlobalUpdate','ordersLoadFlightCurrent','ensureOrdersFullBeforePreferences'])
  assert.equal(x.ctx[name].toString(),f.extractFunction(f.source,name),name+' is actual installed declaration');
 const view=x.state.orders,selection=x.state.ordersSelected;
 x.ctx._ordersAcceptedReceipt={old:true};x.ctx._ordersFiniteLoadAbort=new AbortController();const finite=x.ctx._ordersFiniteLoadAbort;
 assert.equal(x.ctx._ordersProjectionSourceEpoch,0);assert.equal(x.ctx._ordersUiSessionEpoch,0);
 x.ctx.retireOrdersProjectionSource('actual-ui-retirement',{sessionChanged:true});
 assert.equal(x.ctx._ordersProjectionSourceEpoch,1);assert.equal(x.ctx._ordersUiSessionEpoch,1);assert.equal(finite.signal.aborted,true);
 assert.equal(x.ctx._ordersAcceptedReceipt,null);assert.equal(x.ctx._ordersRetiredFiniteView.view,view);assert.equal(x.ctx._ordersColdFiniteClosed,true);
 assert.equal(x.state.orders,view);assert.equal(x.state.ordersSelected,selection);assert.ok(x.events.includes('invalidate'));
});
test('actual new full action fast path matches the exact old full body and preserves ordinary row references',async()=>{
 const next=f.fixture({thin:false}),old=f.fixture({thin:false}),nextRows=next.state.orders.rows,oldRows=old.state.orders.rows;
 old.evaluate(f.extractFunction(c.legacySource,'ensureOrdersFullForAction'));
 assert.equal(await next.ctx.ensureOrdersFullForAction('ordinary'),nextRows);assert.equal(await old.ctx.ensureOrdersFullForAction('ordinary'),oldRows);
 assert.deepEqual(nextRows,oldRows);assert.equal(next.fetches(),0);assert.equal(old.fetches(),0);
 assert.equal(next.ctx._ordersPromotionAbort,null);assert.equal(next.ctx._ordersPromotionSubscribers,0);
 assert.equal(next.ctx._ordersProjectionSourceEpoch,0);assert.equal(next.ctx._ordersUiSessionEpoch,0);
});
test('actual ensure forwards owned signal to native controller and cleans its real subscriber slot after publication',async()=>{
 const x=f.fixture();let received;const actual=x.controller.ensure.bind(x.controller);
 x.controller.ensure=options=>{received=options?.signal;return actual(options);};
 const task=x.ctx.ensureOrdersFullForAction('owned-native');await turn();
 assert.ok(x.ctx._ordersPromotionAbort instanceof AbortController);assert.equal(received,x.ctx._ordersPromotionAbort.signal);assert.equal(x.ctx._ordersPromotionSubscribers,1);
 x.settle();const rows=await task;assert.equal(rows,x.state.orders.rows);assert.equal(x.state.orders.kind,'full');
 assert.equal(x.ctx._ordersPromotionAbort,null);assert.equal(x.ctx._ordersPromotionSubscribers,0);assert.equal(x.acceptedReads(),0);
});
test('real retirement aborts shared native promotion subscribers and prevents both late publications',async()=>{
 const x=f.fixture(),before=x.state.orders;let signal;
 const actual=x.controller.ensure.bind(x.controller);x.controller.ensure=options=>{signal=options?.signal;return actual(options);};
 const first=x.ctx.ensureOrdersFullForAction('one'),second=x.ctx.ensureOrdersFullForAction('two');first.catch(()=>{});second.catch(()=>{});await turn();
 assert.equal(x.ctx._ordersPromotionSubscribers,2);assert.equal(x.fetches(),1);const owned=x.ctx._ordersPromotionAbort;assert.equal(signal,owned.signal);
 x.ctx.retireOrdersProjectionSource('changed-source');assert.equal(owned.signal.aborted,true);assert.equal(x.ctx._ordersPromotionAbort,null);assert.equal(x.ctx._ordersPromotionSubscribers,0);
 x.settle();await assert.rejects(first,{code:'ORDERS_FULL_STALE'});await assert.rejects(second,{code:'ORDERS_FULL_STALE'});
 assert.equal(x.state.orders,before);assert.equal(x.acceptedReads(),0);assert.equal(x.ctx._ordersProjectionSourceEpoch,1);
});
test('UI command observes actual retirement and same-actor session epoch change before any pending control mutation',async()=>{
 const x=f.fixture();controls(x);const input=x.nodes.get('ordersSearch');input.value='typed';
 const pending=f.fire(input,'input');await turn();
 // Baseline has no UI gate and should be behavioral RED here, not a missing
 // lifecycle ReferenceError: the exact retirement block exists in both modes.
 assert.equal(x.events.includes('debounced-render'),false);assert.equal(x.ctx._ordersPromotionSubscribers,1);
 const owned=x.ctx._ordersPromotionAbort;x.ctx.retireOrdersProjectionSource('same-actor-new-session',{sessionChanged:true});
 assert.equal(owned.signal.aborted,true);assert.equal(x.ctx._ordersUiSessionEpoch,1);x.settle();await pending;
 assert.equal(x.events.includes('debounced-render'),false);assert.equal(x.events.includes('save'),false);assert.equal(x.state.orders.kind,'thin');
});
