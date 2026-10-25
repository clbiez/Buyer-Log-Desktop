'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../server/lib/license-cards'),P=require('../server/lib/resource-rule-service'),W=require('./fixtures/retired-ui/license-atlas-workspace'),A=require('../public/license-atlas-engine'),E=require('../public/license-cards-engine');
const {createLicenseCardService}=require('../server/lib/license-card-service');
const clone=v=>JSON.parse(JSON.stringify(v));
const atlas=()=>({license:{id:'old',name:'One',agency:'DTR',stages:[],addresses:[{id:'office',label:'Samples',text:'Demo address',manufacturerVisible:true}],portal:{url:'https://example.com',manufacturerVisible:false},manufacturerVisible:true}});
const rule=(id,license,licensor,royalty=10)=>({id,license,licensor,opdStart:'2026-01-01',opdEnd:'',seasons:[],royalty,trCommission:2,ydCommission:3,hologramCost:.1});
function fixture(){let state=C.appendDiscovered({_revision:1,_revisions:{pricingRules:3},pricingRules:[rule('first','One','Agency A'),rule('dtr','One','DTR')]},[{license:'One',licensor:'Agency A'}]).overrides,writes=0,published;
 const service=createLicenseCardService({loadOverrides:()=>state,saveOverrides:(next,revision)=>{assert.equal(revision,state._revision);writes++;state=clone({...next,_revision:state._revision+1});return state;},publish:async(_,change)=>{published=change;return {ok:true};}});
 return {service,get state(){return state;},get writes(){return writes;},get published(){return published;}};
}
test('pricing pairs are visible immediately and virtual licensor edits materialize without losing the original card',()=>{
 const f=fixture(),before=C.responseOf(f.state,true);assert.equal(before.cards.length,2);assert.equal(C.stateOf(f.state).items.length,1);
 const dtr=before.cards.find(c=>c.licensor==='DTR');const saved=C.updateCard(f.state,dtr.id,{editToken:dtr.editToken,profile:{processAtlas:atlas()},rules:[{...dtr.rules[0],royalty:14}]},P).overrides;
 assert.equal(saved.licenseCards.items.length,2);assert.equal(saved.pricingRules.find(r=>r.id==='first').royalty,10);assert.equal(saved.pricingRules.find(r=>r.id==='dtr').royalty,14);
 assert.equal(W.merge(C.responseOf(saved,true).cards).licenses.find(l=>l.id===before.cards[0].id).agency,'Agency A');
});
test('combined details batch validates all contracts before writing and publishes a distinct snapshot for each licensor',async()=>{
 const f=fixture(),before=C.responseOf(f.state,true),entries=before.cards.map((c,i)=>({id:c.id,editToken:c.editToken,processAtlas:atlas(),profile:{contactName:'Demo contact'},rules:[{...c.rules[0],royalty:12+i}]}));
 const invalid=clone(entries);invalid[1].rules[0].royalty=99;
 await assert.rejects(f.service.updateAtlasBatch({id:'editor'},invalid),{code:'LICENSE_RULES_INVALID'});assert.equal(f.writes,0);
 await f.service.updateAtlasBatch({id:'editor'},entries);assert.equal(f.writes,1);assert.equal(f.state._revisions.pricingRules,4);
 for(const [i,c] of before.cards.entries()){assert.equal(f.state.licenseCardOutbox[c.id].fields.contracts.rules[0].royalty,12+i);assert.equal(f.state.licenseCardOutbox[c.id].fields.contracts.pair,C.pairKey(c.license,c.licensor));}
 assert.equal(f.published.rulesChanged,true);
 await assert.rejects(f.service.updateAtlasBatch({id:'editor'},entries),{code:'REVISION_CONFLICT'});assert.equal(f.writes,1);
});
test('legacy recovery fans one atlas out to all licensors, preserves contracts, and reports unknown or ambiguous backups',async()=>{
 const f=fixture(),before=C.responseOf(f.state,true),backup={licenses:[atlas().license],sharedAddresses:[]};
 const plan=W.recovery(before.cards,backup);assert.equal(plan.changes.length,2);assert.deepEqual(plan.unmatched,[]);
 await f.service.updateAtlasBatch({id:'editor'},plan.changes.map(c=>({...c,processAtlas:A.normalize(c.processAtlas)})));
 assert.deepEqual(f.state.pricingRules,before.pricingRules);assert.equal(f.state._revisions.pricingRules,3);
 assert.deepEqual(W.recovery(before.cards,{licenses:[{...atlas().license,name:'Unknown'}]}).unmatched,['Unknown']);
 assert.throws(()=>W.recovery(before.cards,{licenses:[atlas().license,atlas().license]}),{code:'LICENSE_ATLAS_INVALID'});
 const full=W.merge(C.responseOf(f.state,true).cards);const again=W.recovery(C.responseOf(f.state,true).cards,full);assert.equal(again.changes.length,2);assert.equal(new Set(again.changes.map(c=>c.id)).size,2);
});
test('latest scope uses current first, then nearest upcoming, then latest historical; addresses export independently of portal',()=>{
 const old={id:'old',opdStart:'2025-01-01',opdEnd:'2025-12-31'},now={id:'now',opdStart:'2026-01-01',opdEnd:'2026-12-31'},future={id:'future',opdStart:'2027-01-01'};
 assert.equal(E.latestContract([future,old,now],'2026-10-20').id,'now');assert.equal(E.latestContract([future,old],'2026-10-20').id,'future');assert.equal(E.latestContract([old],'2026-10-20').id,'old');
 const out=A.project({id:'one',license:'One',processAtlas:atlas()});assert.equal(out.addresses[0].text,'Demo address');assert.equal(out.portal.url,'');
});
test('supplier workspace retains the canonical licensor instead of an imported operational agency',()=>{
 const data=atlas();const projected=A.project({id:'bound',license:'One',licensor:'Agency A',processAtlas:data});assert.equal(projected.agency,'Agency A');
 const merged=W.merge([{id:projected.id,license:projected.name,licensor:projected.agency,processAtlas:{license:projected}}]);assert.equal(merged.licenses[0].agency,'Agency A');
});
test('recovering a Buyer Log backup scopes each independent image library to its original card',()=>{
 const originals=['One','Two','Three'].map((id,i)=>({id,license:id,licensor:'Owner',editToken:'token',processAtlas:{...atlas(),visualLibrary:[{id:'visual',name:id,data:'data:image/png;base64,'+String(i+1).repeat(700000)}]}}));
 for(const c of originals){c.processAtlas.license.name=c.license;c.processAtlas.license.stages=[{id:'concept',title:'Concept',visualGuideId:'visual',submissions:[]}];}
 const backup=W.merge(originals),plan=W.recovery(originals,backup);assert.equal(plan.changes.length,3);
 for(const change of plan.changes){const normalized=A.normalize(change.processAtlas);assert.equal(normalized.visualLibrary.length,1);assert.equal(normalized.visualLibrary[0].name,change.license);}
});
