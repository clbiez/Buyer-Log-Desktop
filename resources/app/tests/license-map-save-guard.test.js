'use strict';
// Approval-map saves are guarded by the map the editor opened (atlasToken), not by the whole
// card: rate/contact/contract edits, a peer echo or a stale list reply must not block them.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const cards=require('../server/lib/license-cards'),sync=require('../server/lib/license-card-sync');
const deps={normalizePricingRuleDate:v=>v,normalizePricingRuleSeasons:v=>v||[],pricingRuleSeasonSetsOverlap:()=>true,pricingRuleDateRangesOverlap:()=>false};
const map=(id,title)=>({version:1,license:{id,name:'DRAGON BALL',agency:'ULUPINAR',stages:[{id:'s1',title,approver:'mixed',submissions:[{id:'r1',method:'physical',recipient:'LCW',qty:'4 pieces',timing:'approval'}]}],addresses:[],portal:{url:'',notes:''},manufacturerVisible:true},sharedAddresses:[],visualLibrary:[]});
function fixture(){
  let ov=cards.appendDiscovered({_revision:0,_revisions:{},pricingRules:[]},[{license:'DRAGON BALL',licensor:'ULUPINAR'}],'2026-01-01T00:00:00Z').overrides;
  const id=ov.licenseCards.items[0].id;
  ov=cards.updateCard(ov,id,{editToken:cards.responseOf(ov,true).cards[0].editToken,profile:{processAtlas:map(id,'Artwork')}},deps,'2026-01-02T00:00:00Z').overrides;
  return {ov,id,card:o=>cards.responseOf(o,true).cards.find(c=>c.id===id)};
}

test('a map save succeeds after unrelated card changes and blocks only a changed map',()=>{
  const {ov,id,card}=fixture(),opened=card(ov);
  assert.equal(typeof opened.atlasToken,'string');
  // Contact and contract edits after the editor opened change editToken, not the map.
  let next=cards.updateCard(ov,id,{editToken:opened.editToken,profile:{workingNotes:'call Somerbond'},rules:[{id:'c1',opdStart:'2026-01-01',opdEnd:'',seasons:[],royalty:10,trCommission:2,ydCommission:3,hologramCost:0.05}]},deps).overrides;
  assert.notEqual(card(next).editToken,opened.editToken);
  assert.equal(card(next).atlasToken,opened.atlasToken);
  const saved=cards.updateCard(next,id,{atlasToken:opened.atlasToken,profile:{processAtlas:map(id,'Fit Sample')}},deps).overrides;
  assert.equal(card(saved).processAtlas.license.stages[0].title,'Fit Sample');
  assert.equal(card(saved).workingNotes,'call Somerbond');
  assert.equal(card(saved).rules.length,1);
  // The same map changed elsewhere: the stale editor must not overwrite it.
  assert.throws(()=>cards.updateCard(saved,id,{atlasToken:opened.atlasToken,profile:{processAtlas:map(id,'PPS')}},deps),{code:'REVISION_CONFLICT',statusCode:409});
});

test('the map token cannot carry other card fields or contracts',()=>{
  const {ov,id,card}=fixture(),t=card(ov).atlasToken;
  assert.throws(()=>cards.updateCard(ov,id,{atlasToken:t,profile:{processAtlas:map(id,'X'),workingNotes:'x'}},deps),{code:'LICENSE_ATLAS_INVALID'});
  assert.throws(()=>cards.updateCard(ov,id,{atlasToken:t,profile:{processAtlas:map(id,'X')},rules:[]},deps),{code:'LICENSE_ATLAS_INVALID'});
  assert.throws(()=>cards.updateCard(ov,id,{atlasToken:t,editToken:card(ov).editToken,profile:{processAtlas:map(id,'X')}},deps),{code:'LICENSE_ATLAS_INVALID'});
});

test('our own record echoed back by the shared folder keeps the map token',()=>{
  const {ov,id,card}=fixture(),staged=sync.stageChange(ov,{card:ov.licenseCards.items[0],actorId:'me'});
  const record=staged.licenseCardOutbox[id].fields;delete staged.licenseCardOutbox[id];
  const echoed=sync.applyRecords(staged,{[id]:record},deps).overrides;
  assert.equal(card(echoed).atlasToken,card(ov).atlasToken);
});

/* ---- client: license-cards.js in a VM ---- */
const source=fs.readFileSync(path.join(__dirname,'../public/license-cards.js'),'utf8');
function page(){
  const requests=[],queue=[];let editor=null;
  const host={dataset:{},getClientRects:()=>[{}],querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},contains:()=>false,set innerHTML(v){this.html=v;}};
  const window={BLLicenseCardsEngine:require('../public/license-cards-engine'),BLUI:require('../public/ui-primitives'),BLLicenseMapEditor:{open(opts){editor=opts;}}};
  const fetch=(url,options={})=>new Promise(resolve=>{requests.push({url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});queue.push(resolve);});
  const context={window,document:{getElementById:()=>host,activeElement:null,addEventListener(){}},CSS:{escape:v=>v},appLang:'en',Intl,setTimeout,showToast(){},fetch,JSON,Promise,Map,Set,Object,Array,Number,String,Boolean,Error,Date,Math,RegExp,encodeURIComponent};
  vm.runInNewContext(source.replace('window.initLicenseCardsPage=','window.guardTests={S,load,openMap};window.initLicenseCardsPage='),context);
  const reply=(i,data,status=200)=>queue[i]({ok:status<300,status,statusText:'',json:async()=>data});
  return {window,requests,reply,get S(){return window.guardTests.S;},get editor(){return editor;},api:window.guardTests};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const listOf=(token,atlas,title)=>({revision:1,canEdit:true,cards:[{id:'license-aaaaaaaaaaaaaaaaaaaaaaaa',license:'DRAGON BALL',licensor:'ULUPINAR',editToken:token,atlasToken:atlas,processAtlas:map('license-aaaaaaaaaaaaaaaaaaaaaaaa',title),rules:[]}]});

test('a list reply read before our own save answers cannot bring the old card back',async()=>{
  const p=page(),id='license-aaaaaaaaaaaaaaaaaaaaaaaa';
  const first=p.api.load();p.reply(0,listOf('e1','a1','Artwork'));await first;
  p.api.openMap(id);
  const background=p.api.load();await flush();        // request 1: list read before the save
  const saving=p.editor.onSave(map(id,'Fit Sample'));await flush(); // request 2: the save
  p.reply(2,listOf('e2','a2','Fit Sample'));await saving;
  p.reply(1,listOf('e1','a1','Artwork'));await flush(); // stale reply lands after the save
  p.reply(3,listOf('e2','a2','Fit Sample'));await background;
  assert.equal(p.S.data.cards[0].atlasToken,'a2');
  assert.equal(p.S.data.cards[0].processAtlas.license.stages[0].title,'Fit Sample');
});

test('the map editor saves with the token of the map it opened, not the latest list copy',async()=>{
  const p=page(),id='license-aaaaaaaaaaaaaaaaaaaaaaaa';
  const first=p.api.load();p.reply(0,listOf('e1','a1','Artwork'));await first;
  p.api.openMap(id);
  // A rate edit elsewhere refreshed the list: editToken moved, the map did not.
  const refresh=p.api.load();p.reply(1,listOf('e9','a1','Artwork'));await refresh;
  const saving=p.editor.onSave(map(id,'Fit Sample'));await flush();
  assert.deepEqual(Object.keys(p.requests[2].body).sort(),['atlasToken','profile']);
  assert.equal(p.requests[2].body.atlasToken,'a1');
  p.reply(2,listOf('e10','a2','Fit Sample'));await saving;
  // A second save in the same session follows our own new map.
  const again=p.editor.onSave(map(id,'PPS'));await flush();
  assert.equal(p.requests[3].body.atlasToken,'a2');
  p.reply(3,listOf('e11','a3','PPS'));await again;
});
