'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/license-cards.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const initial=()=>({revision:1,pricingRevision:3,canEdit:true,cards:[{id:'demo',license:'Demo License',licensor:'Demo Owner',editToken:'original',workingNotes:'Original',rules:[{id:'rate',royalty:13}]}]});
function editor(){
 let remote=initial(),gets=0,puts=0,renderCount=0,putBody,held,reader;
 const host={getClientRects:()=>[{}],querySelector:()=>null,querySelectorAll:()=>[],set innerHTML(value){this.html=value;renderCount++;}};
 const window={BLLicenseCardsEngine:require('../public/license-cards-engine'),BL_CLIENT_ID:'my-tab'};
 const context={window,document:{getElementById:()=>host,activeElement:null},appLang:'en',Intl,FileReader:class{readAsDataURL(){reader=this;}},fetch:async(url,options)=>{
  if(options.method==='PUT'){puts++;putBody=JSON.parse(options.body);remote={...remote,revision:remote.revision+1,cards:remote.cards.map(c=>({...c,...putBody.profile,editToken:'saved'}))};}
  else {gets++;if(held){const wait=held;held=null;await wait;}}
  return {ok:true,json:async()=>clone(remote)};
 }};
 vm.runInNewContext(source.replace('window.initLicenseCardsPage=','window.testEditor={S,action,save,load,uploadSymbol};window.initLicenseCardsPage='),context);
 return {window,host,get state(){return window.testEditor.S;},get renders(){return renderCount;},get gets(){return gets;},get puts(){return puts;},get body(){return putBody;},completeSymbol(){reader.result='data:image/png;base64,AAAA';reader.onload();},remote(value){remote=value;},hold(value){held=value;},async open(){await window.initLicenseCardsPage();window.testEditor.S.selected='demo';window.testEditor.action('edit');window.testEditor.S.draft.profile.workingNotes='Unsaved draft';},async settle(){await window.testEditor.S.pending;}};
}
test('duplicate, unrelated and reconnect invalidations preserve the draft, DOM and ability to save',async()=>{
 const e=editor();await e.open();const renders=e.renders;
 const updated=initial();updated.revision=7;updated.pricingRevision=12;updated.cards.push({id:'other',editToken:'different'});e.remote(updated);
 e.window.BLLicenseCardsPage.invalidate();await e.settle();
 assert.equal(e.state.conflict,false);assert.equal(e.renders,renders);assert.equal(e.state.draft.profile.workingNotes,'Unsaved draft');
 await e.window.testEditor.save();assert.equal(e.puts,1);assert.equal(e.body.editToken,'original');assert.equal(e.body.revision,7);assert.equal(e.body.profile.workingNotes,'Unsaved draft');
});
test('only a verified change to the selected card blocks saving; cancel clears the conflict',async()=>{
 const e=editor();await e.open();const updated=initial();updated.cards[0].editToken='peer-change';e.remote(updated);
 e.window.BLLicenseCardsPage.invalidate();await e.settle();assert.equal(e.state.conflict,true);assert.equal(e.state.draft.profile.workingNotes,'Unsaved draft');
 await e.window.testEditor.save();assert.equal(e.puts,0);
 e.window.testEditor.action('cancel');assert.equal(e.state.conflict,false);
 e.window.testEditor.action('edit');await e.window.testEditor.save();assert.equal(e.puts,1);
});
test('save waits for an in-flight verification and its own save notification cannot poison the next edit',async()=>{
 const e=editor();await e.open();let release;e.hold(new Promise(resolve=>{release=resolve;}));
 e.window.BLLicenseCardsPage.invalidate();const saving=e.window.testEditor.save();assert.equal(e.puts,0);release();await saving;
 e.window.BLLicenseCardsPage.invalidate();await e.settle();e.window.testEditor.action('edit');assert.equal(e.state.conflict,false);
 await e.window.testEditor.save();assert.equal(e.puts,2);
});
test('a removed selected card keeps the draft visible and blocks its write',async()=>{
 const e=editor();await e.open();e.remote({...initial(),cards:[]});e.window.BLLicenseCardsPage.invalidate();await e.settle();
 assert.equal(e.state.conflict,true);assert.match(e.host.html,/Unsaved draft/);await e.window.testEditor.save();assert.equal(e.puts,0);
});

test('a delayed symbol upload cannot attach to a replacement draft',async()=>{
 const e=editor();await e.open();const reading=e.window.testEditor.uploadSymbol({target:{files:[{type:'image/png',size:10}]}});
 e.window.testEditor.action('cancel');e.window.testEditor.action('edit');e.completeSymbol();await reading;
 assert.equal(e.state.draft.profile.symbolDataUrl,'');
});
