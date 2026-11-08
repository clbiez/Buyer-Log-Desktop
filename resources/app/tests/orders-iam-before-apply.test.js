'use strict';
// PREPARED ONLY. Extracts the actual IAM function and actual app retirement.
const nativeTest=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const test=(name,body)=>nativeTest(name,{timeout:5000},body);
const {source:app,iamSource:source,extractFunction,extractIamFunction,installLifecycle}=require('./helpers/orders-retirement-source');
function fixture({thin=false,hook=true,signature=''}={}){
 const events=[],old={id:'demo',centralIamEnabled:true,accessAreas:{orders:true}},next={id:'demo',centralIamEnabled:true,accessAreas:{orders:false}};
 const state={currentUser:old,orders:{rows:[{_id:0}],...(thin?{projectionProfile:'thin'}:{})},ordersSelected:new Set()};
 const abort=new AbortController(),promotion=new AbortController();
 const c=vm.createContext({state,Promise,AbortController,appLang:'en',iamSessionCheck:false,lastSessionSignature:signature,
  projectionRequestGeneration:{orders:0},_ordersFullViewControllers:new WeakMap(),
  window:{BL_USER_CONTEXT:old},current:()=>state.currentUser,
  fetch:async()=>({ok:true,json:async()=>({selected:true,user:next})}),
  applyUserAccessUI:()=>events.push(['applied',abort.signal.aborted,promotion.signal.aborted,state.currentUser]),showToast:()=>events.push('toast'),tr:(_tr,en)=>en,location:{assign:value=>events.push(['navigate',value])},setTimeout:fn=>fn(),
 });
 installLifecycle(c,{_ordersProjectionClient:{invalidate:()=>events.push('invalidate')},_ordersAcceptedReceipt:{},_ordersFiniteLoadAbort:abort,_ordersPromotionAbort:promotion,_ordersPromotionSubscribers:1,_ordersLoadFlight:{},ordersLoadPromise:Promise.resolve()});
 delete c.window.BLBeforeIamProfileApply;
 vm.runInContext(['ordersProjectionIsThin','ordersFullActionError','retireOrdersProjectionSource'].map(n=>extractFunction(app,n)).join('\n')+'\n'+['beforeIamProfileApply','checkIamSession','switchUser'].map(n=>extractIamFunction(source,n)).join('\n'),c);
 if(hook)c.window.BLBeforeIamProfileApply=()=>{assert.equal(c.window.BL_USER_CONTEXT,old);assert.equal(state.currentUser,old);return c.retireOrdersProjectionSource('orders.iam.before-profile');};
 return {c,state,events,old,next,abort,promotion};
}
test('actual IAM profile update aborts finite/promotions before either profile setter and UI event',async()=>{
 const f=fixture({thin:true});await f.c.checkIamSession();assert.equal(f.state.currentUser,f.next);assert.equal(f.c.window.BL_USER_CONTEXT,f.next);
 assert.deepEqual(f.events.find(e=>Array.isArray(e)&&e[0]==='applied').slice(1),[true,true,f.next]);assert.equal(f.c._ordersUiSessionEpoch,0);assert.equal(f.c._ordersProjectionSourceEpoch,1);
});
test('unchanged signature bypasses the retirement callback and all original profile apply work',async()=>{
 const f=fixture();f.c.lastSessionSignature=JSON.stringify(f.next);await f.c.checkIamSession();assert.deepEqual(f.events,[]);assert.equal(f.state.currentUser,f.old);assert.equal(f.abort.signal.aborted,false);
});
test('legacy ordinary full page without new capability keeps the existing profile update path',async()=>{
 const f=fixture({hook:false});await f.c.checkIamSession();assert.equal(f.state.currentUser,f.next);assert.equal(f.abort.signal.aborted,false);assert.equal(f.c.iamSessionCheck,false);
});
test('thin page without synchronous pre-apply capability refuses assignment and does not advance signature',async()=>{
 const f=fixture({thin:true,hook:false});await f.c.checkIamSession();assert.equal(f.state.currentUser,f.old);assert.equal(f.c.window.BL_USER_CONTEXT,f.old);assert.equal(f.c.lastSessionSignature,'');assert.equal(f.c.iamSessionCheck,false);
});
test('in-flight finite admission also requires the hook before a thin module has published',async()=>{
 const f=fixture({hook:false});f.c.window.BLOrdersFiniteLifecycleRequired=true;await f.c.checkIamSession();assert.equal(f.state.currentUser,f.old);assert.equal(f.c.lastSessionSignature,'');
});
test('failed synchronous callback refuses profile assignment and leaves polling retryable',async()=>{
 for(const callback of [()=>false,()=>{throw Error('retirement failed');}]){
  const f=fixture();f.c.window.BLBeforeIamProfileApply=callback;await f.c.checkIamSession();assert.equal(f.state.currentUser,f.old);assert.equal(f.c.lastSessionSignature,'');assert.equal(f.c.iamSessionCheck,false);
 }
});
test('invalid async callback cannot authorize profile update and rejected promises are drained',async()=>{
 const f=fixture();f.c.window.BLBeforeIamProfileApply=()=>Promise.reject(Error('invalid async hook'));
 await f.c.checkIamSession();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.currentUser,f.old);assert.equal(f.c.lastSessionSignature,'');assert.equal(f.c.iamSessionCheck,false);
});
test('ordinary full IAM update retains the existing Orders rows and selection refs',async()=>{
 const f=fixture(),view=f.state.orders,selected=f.state.ordersSelected;await f.c.checkIamSession();assert.equal(f.state.orders,view);assert.equal(f.state.ordersSelected,selected);assert.equal(f.c._ordersRetiredFiniteView,null);
});
test('actual switchUser navigates, rather than inferring a synthetic session identity from profile JSON',()=>{
 const f=fixture();f.c.switchUser();assert.deepEqual(f.events,[['navigate','/select-user.html?switch=1']]);assert.equal(f.c._ordersUiSessionEpoch,0);
});
