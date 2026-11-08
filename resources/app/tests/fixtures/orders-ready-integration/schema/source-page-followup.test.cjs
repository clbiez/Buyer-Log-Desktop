'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
// Import the frozen fixture, never its test entry or a modified packet. It uses
// actual client.createFetchFull + native promotion + real server header producer.
const pub=require('../publication/native-fixture.cjs');
const recipe=require('./candidate/source-page-followup.cjs');
const old=fs.readFileSync(require('node:path').resolve(__dirname,'../wiring/snippets/app-first-slice.js'),'utf8');
const next=process.env.BL_SCHEMA_SOURCE_PAGE_BASELINE==='1'?old:recipe.patch(old);
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(){
 const f=await pub.setup();f.scope.captureOrdersReadySource=pub.fn(f.scope,'captureOrdersReadySource',next);
 const sourceNow=f.scope.captureOrdersReadySource(f.accepted),p=f.publish({sourceNow});return {...f,p};
}
test('published Orders parent promotes on CP visual page with actual unchanged Orders full transport identity',async()=>{
 const f=await fixture();f.scope.activeProfilePage=()=> 'cp';f.scope.currentActiveTab=()=> 'cp';
 assert.throws(()=>f.accepted.assertCurrent(),{code:'ORDERS_FULL_STALE'},'cold acceptance capture remains stricter');
 const pending=f.p.controller.ensure();pending.catch(()=>{});await turn();
 assert.equal(f.requests.length,1,'visual CP page must not retire the published Orders source');f.gate.resolve();const full=await pending;
 assert.equal(f.scope.state.orders.rows,full.rows);assert.equal(f.requests[0].url,'/api/page-projection/orders/full-parent');
 const body=JSON.parse(f.requests[0].init.body);assert.deepEqual(body.token,f.accepted.parent.token);assert.equal(body.token.module,'orders');
 assert.equal(body.fullGzipChecksum,f.accepted.parent.fullGzipChecksum);assert.equal(body.guardStamp,f.accepted.parent.guardStamp);
 assert.equal(f.scope.ordersProjectionIsThin(),false);assert.equal(f.scope.activeProfilePage(),'cp');
});
test('actual UI command independently rejects an old visual-tab target after full await',async()=>{
 const f=await fixture(),ui=require(pub.actual.APP+'/public/orders-ui-command.js');
 f.scope.activeProfilePage=()=> 'cp';let changes=0,errors=0;
 const gate=ui.create({isThin:f.scope.ordersProjectionIsThin,captureSource:()=>f.p.controller.captureUiSource(),
  ensureFull:()=>f.p.controller.ensure(),activeTab:()=>f.scope.activeProfilePage(),onError:()=>{errors++;}});
 const action=gate.run({reason:'schema-cross-tab',lane:'schema',inspect:()=>()=>true,change:()=>{changes++;}});
 await turn();assert.equal(f.requests.length,1);f.scope.activeProfilePage=()=> 'orders';f.gate.resolve();
 assert.equal(await action,false);assert.equal(changes,0);assert.equal(errors,1);assert.equal(f.scope.ordersProjectionIsThin(),false,'full promotion itself succeeded safely');
});
