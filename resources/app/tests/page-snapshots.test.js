'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
function transit(fetch){
 const window={SERVER_BACKED:true,BLTransitAnalysis:require('../public/transit-analysis')};
 vm.runInNewContext(source('transit-analysis-ui.js'),{window,fetch,URLSearchParams,Date,Map,WeakMap,Set});return window.BLTransitAnalysisUI;
}
const response=country=>({ok:true,json:async()=>({analysis:{source:'database',records:[{country}]},message:'',orderCount:1})});
test('transit variants reuse snapshots, coalesce requests and reset on force/model refresh',async()=>{
 let calls=0;const api=transit(async()=>{calls++;return response('Turkey');});
 await Promise.all([api.loadLive(false,{window:'y1'}),api.loadLive(false,{window:'y1'})]);assert.equal(calls,1);
 await api.loadLive(false,{window:'m3'});await api.loadLive(false,{window:'y1'});assert.equal(calls,2);
 await api.loadLive(true,{window:'y1'});assert.equal(calls,3);
 await api.loadLive(false,{window:'m3'});assert.equal(calls,4);
 api.invalidate({liveOnly:true});await api.loadLive(false,{window:'y1'});assert.equal(calls,5);
 assert.ok(api.knownCountries().length>0);
});
test('late transit responses cannot replace a newer scope or refreshed model',async()=>{
 const waiting=[];const api=transit(()=>new Promise(resolve=>waiting.push(resolve)));
 const old=api.loadLive(false,{window:'y1'});api.invalidate({liveOnly:true});
 const current=api.loadLive(false,{window:'m3'});waiting[1](response('MISIR'));await current;
 const countries=api.knownCountries();waiting[0](response('TURKIYE'));await old;assert.deepEqual(api.knownCountries(),countries);
 // A cached view cancels ownership of another in-flight view. Revisiting that
 // view must either apply its finished snapshot or fetch it again.
 const other=api.loadLive(false,{window:'w4'});await api.loadLive(false,{window:'m3'});
 waiting[2](response('FAS'));await other;assert.deepEqual(api.knownCountries(),countries);
 await api.loadLive(false,{window:'w4'});assert.notDeepEqual(api.knownCountries(),countries);
});
test('transit snapshot retention is bounded to four variants',async()=>{
 let calls=0;const api=transit(async()=>{calls++;return response('Turkey');});
 for(const win of ['y1','m3','m6','w4','all','w8'])await api.loadLive(false,{window:win});
 await api.loadLive(false,{window:'y1'});assert.equal(calls,7);
});
test('unchanged directory polling does not rebuild or broadcast the snapshot; active draft survives an in-flight poll',async()=>{
 let pending=null,events=0,reads=0;
 const data={revision:1,countries:[],types:[],records:[{id:'r',manufacturer:'DEMO',email:'demo@example.com'}]};
 const window={addEventListener(){},dispatchEvent(){events++;}};
 vm.runInNewContext(source('email-groups.js'),{window,fetch:()=>new Promise(resolve=>{pending=()=>resolve({ok:true,json:async()=>data});}),document:{getElementById(){return null;},addEventListener(){},removeEventListener(){}},CustomEvent:class{},setTimeout(){},setInterval(){},clearInterval(){},Date,Map,Set});
 const api=window.BLEmailGroups;
 let read=api.refresh();pending();await read;assert.equal(events,1);
 read=api.refresh();pending();await read;assert.equal(events,1);
 read=api.refresh();data.revision=2;api.state.editingId='r';api.state.draft={note:'uncommitted'};
 api.state.modal={querySelector(){reads++;return null;}};pending();await read;
 assert.equal(reads,0);assert.equal(api.state.draft.note,'uncommitted');assert.equal(api.state.data.revision,2);
});
test('a manufacturer source invalidation during a directory-only refresh loads the newer rows before completing',async()=>{
 let rows=[{manufacturer:'OLD'}],version='old',reads=0;
 const waiting=[],window={BLManufacturerCards:{buildCards:items=>({asasNames:[],cards:items.slice()})},BLManufacturerDataBridge:{rows:async()=>{reads++;return rows;},version:()=>version},addEventListener(){}};
 vm.runInNewContext(source('manufacturers.js'),{window,document:{body:{dataset:{activeTab:'manufacturers'}}},fetch:()=>new Promise(resolve=>waiting.push(()=>resolve({ok:true,json:async()=>({revision:1,records:[]})}))),localStorage:{getItem(){return null;}},Date,Map,Set,Intl});
 const api=window.BLManufacturersPage;
 api.state.rows=rows;api.state.rowsVersion=version;
 const pending=api.refresh({rows:false});assert.equal(waiting.length,1);
 rows=[{manufacturer:'NEW'}];version='new';
 const newer=api.refresh({rows:true,force:true});assert.equal(newer,pending);
 waiting.shift()();await new Promise(resolve=>setImmediate(resolve));assert.equal(waiting.length,1);
 waiting.shift()();await newer;
 assert.equal(reads,1);assert.equal(api.state.rowsVersion,'new');assert.equal(api.state.result.cards[0].manufacturer,'NEW');
});
test('manufacturer loading cannot stamp a replaced row array with the new source version',async()=>{
 let version='old',firstResolve,calls=0;
 const old=[{manufacturer:'OLD'}],current=[{manufacturer:'NEW'}];
 const window={BLManufacturerCards:{buildCards:rows=>({asasNames:[],cards:rows})},BLManufacturerDataBridge:{version:()=>version,rows:()=>{calls++;return calls===1?new Promise(resolve=>{firstResolve=()=>resolve(old);}):Promise.resolve(current);}},addEventListener(){}};
 vm.runInNewContext(source('manufacturers.js'),{window,document:{body:{dataset:{activeTab:'orders'}}},fetch:async()=>({ok:true,json:async()=>({revision:1,records:[]})}),localStorage:{getItem(){return null;}},Date,Map,Set,Intl});
 const pending=window.BLManufacturersPage.refresh();version='new';firstResolve();await pending;
 assert.equal(calls,2);assert.equal(window.BLManufacturersPage.state.rowsVersion,'new');assert.equal(window.BLManufacturersPage.state.rows[0].manufacturer,'NEW');
});
