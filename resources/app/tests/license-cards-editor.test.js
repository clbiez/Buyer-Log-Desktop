'use strict';
// License cards list: per-card drafts survive background refreshes; only a verified
// change to that card (editToken) blocks its save. Ported from the card editor tests.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/license-cards.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const rule={id:'rate',license:'Demo License',licensor:'Demo Owner',royalty:13,trCommission:2,ydCommission:3,hologramCost:0.1,opdStart:'2026-01-01',opdEnd:'',seasons:[]};
const initial=()=>({revision:1,pricingRevision:3,canEdit:true,cards:[{id:'demo',license:'Demo License',licensor:'Demo Owner',editToken:'original',workingNotes:'Original',rules:[clone(rule)]}]});
function page(){
 let remote=initial(),gets=0,puts=0,renders=0,putBody,held,focused=null;
 const host={dataset:{},getClientRects:()=>[{}],querySelector:sel=>sel==='.lcPage'?{}:null,querySelectorAll:()=>[],addEventListener(){},contains:el=>Boolean(el&&el===focused),set innerHTML(value){this.html=value;renders++;}};
 const window={BLLicenseCardsEngine:require('../public/license-cards-engine'),BL_CLIENT_ID:'my-tab'};
 const document={getElementById:()=>host,get activeElement(){return focused;},addEventListener(){},createElement:()=>({})};
 const context={window,document,CSS:{escape:v=>v},appLang:'en',Intl,setTimeout,fetch:async(url,options={})=>{
  if(options.method==='PUT'){puts++;putBody=JSON.parse(options.body);remote={...remote,revision:remote.revision+1,cards:remote.cards.map(c=>({...c,...putBody.profile,rules:putBody.rules?c.rules.map(r=>putBody.rules.find(x=>x.id===r.id)||r):c.rules,editToken:'saved-'+puts}))};}
  else {gets++;if(held){const wait=held;held=null;await wait;}}
  return {ok:true,json:async()=>clone(remote)};
 }};
 vm.runInNewContext(source.replace('window.initLicenseCardsPage=','window.testCards={S,save,load,act,onInput,uploadCover,isDirty};window.initLicenseCardsPage='),context);
 const t=()=>window.testCards;
 return {window,host,t,get state(){return t().S;},get renders(){return renders;},get gets(){return gets;},get puts(){return puts;},get body(){return putBody;},
  remote(value){remote=value;},hold(value){held=value;},focus(el){focused=el;},
  async open(){await window.initLicenseCardsPage();},
  edit(key,value,id='demo'){t().onInput({target:{dataset:{lcRate:key,id},value,classList:{toggle(){}}}});},
  async settle(){for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));if(t().S.pending)await t().S.pending;}};
}
test('unrelated and reconnect refreshes keep the draft and the ability to save',async()=>{
 const p=page();await p.open();p.edit('royalty','14');
 const updated=initial();updated.revision=7;updated.pricingRevision=12;updated.cards.push({id:'other',license:'Other',licensor:'X',editToken:'different',rules:[]});p.remote(updated);
 p.window.BLLicenseCardsPage.invalidate();await p.settle();
 const d=p.state.drafts.get('demo');assert.equal(d.conflict,false);assert.equal(d.rules[0].royalty,14);
 await p.t().save('demo');assert.equal(p.puts,1);assert.equal(p.body.editToken,'original');assert.deepEqual(p.body.rules.map(r=>[r.id,r.royalty]),[['rate',14]]);
 assert.equal(p.state.drafts.has('demo'),false,'a successful save clears the draft');
});
test('a background refresh does not rebuild the list under the user’s cursor',async()=>{
 const p=page();await p.open();p.edit('royalty','15');const before=p.renders;
 p.focus({tagName:'INPUT',id:'',type:'text'});p.window.BLLicenseCardsPage.invalidate();await p.settle();
 assert.equal(p.renders,before);assert.equal(p.state.renderQueued,true);assert.equal(p.state.drafts.get('demo').rules[0].royalty,15);
});
test('only a verified change to the card blocks saving; discarding clears it',async()=>{
 const p=page();await p.open();p.edit('royalty','16');
 const updated=initial();updated.cards[0].editToken='peer-change';p.remote(updated);
 p.window.BLLicenseCardsPage.invalidate();await p.settle();assert.equal(p.state.drafts.get('demo').conflict,true);assert.equal(p.state.drafts.get('demo').rules[0].royalty,16);
 await p.t().save('demo');assert.equal(p.puts,0);
 p.t().act({dataset:{lcAct:'discard',id:'demo'}});assert.equal(p.state.drafts.has('demo'),false);
 p.edit('royalty','17');await p.t().save('demo');assert.equal(p.puts,1);assert.equal(p.body.editToken,'peer-change');
});
test('save waits for an in-flight verification and its own echo cannot poison the next edit',async()=>{
 const p=page();await p.open();p.edit('royalty','18');let release;p.hold(new Promise(resolve=>{release=resolve;}));
 p.window.BLLicenseCardsPage.invalidate();const saving=p.t().save('demo');assert.equal(p.puts,0);release();await saving;assert.equal(p.puts,1);
 p.window.BLLicenseCardsPage.invalidate();await p.settle();p.edit('royalty','19');assert.equal(p.state.drafts.get('demo').conflict,false);
 await p.t().save('demo');assert.equal(p.puts,2);assert.equal(p.body.editToken,'saved-1');
});
test('a removed card keeps its draft visible and blocks the write',async()=>{
 const p=page();await p.open();p.edit('royalty','20');p.remote({...initial(),cards:[]});
 p.window.BLLicenseCardsPage.invalidate();await p.settle();
 assert.equal(p.state.drafts.get('demo').conflict,true);assert.match(p.host.html,/Demo License/);assert.match(p.host.html,/value="20"/);
 await p.t().save('demo');assert.equal(p.puts,0);
});
test('invalid rates never reach the server',async()=>{
 const p=page();await p.open();p.edit('royalty','99');p.edit('trCommission','5');
 await p.t().save('demo');assert.equal(p.puts,0);assert.match(p.state.drafts.get('demo').error,/100%/);
});
test('a delayed image upload cannot attach to a replacement draft',async()=>{
 const p=page();await p.open();let finish;p.window.BLLicenseCardsImage.resize=()=>new Promise(resolve=>{finish=resolve;});
 const uploading=p.t().uploadCover({dataset:{lcCover:'demo'},files:[{type:'image/png',size:10}]});
 p.t().act({dataset:{lcAct:'discard',id:'demo'}});p.edit('royalty','21');finish('data:image/webp;base64,AAAA');await uploading;
 assert.equal(p.state.drafts.get('demo').cover,undefined);
});
