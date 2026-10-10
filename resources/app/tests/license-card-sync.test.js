'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const cards=require('../server/lib/license-cards'),sync=require('../server/lib/license-card-sync'),policy=require('../server/lib/shared-sync-policy');
const source=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
const helper=source.slice(source.indexOf('function normalizePricingRuleDate('),source.indexOf("app.get('/api/landed-multipliers'"));
const deps=vm.runInNewContext(helper+'\n({normalizePricingRuleDate,normalizePricingRuleSeasons,pricingRuleSeasonSetsOverlap,pricingRuleDateRangesOverlap})');
const fixture=()=>cards.appendDiscovered({_revision:0,_revisions:{pricingRules:3},pricingRules:[],notesmap:{private:{Notes:'local'}}},[{license:'Example',licensor:'Owner'}],'2026-01-01T00:00:00Z').overrides;
const rule={id:'current',license:'Example',licensor:'Owner',opdStart:'2026-01-01',opdEnd:'',seasons:[],royalty:10,trCommission:2,ydCommission:3,hologramCost:0.05};

test('the narrow license peer path never enables other master rule documents',()=>{
  const ov=fixture(),card=ov.licenseCards.items[0];
  const event=policy.sanitizeDelta({id:'license-card:'+card.id,patch:{profile:card,contracts:{pair:cards.pairKey('Example','Owner'),rules:[rule]},pricingRules:[{id:'foreign'}],password:'secret'}});
  assert.deepEqual(Object.keys(event.patch).sort(),['contracts','profile']);
  assert.equal(policy.sanitizeDelta({id:'store:overrides.json',patch:{pricingRules:[rule]}}),null);
  assert.equal(policy.sanitizeDelta({id:'license-card:'+card.id,delete:true}),null);
  assert.equal(policy.classifyRecordId('license-card:'+card.id),'SHARED_BUSINESS');
});

test('a received profile/contract applies once, keeps local data and earlier contracts',()=>{
  const ov=fixture(),card=ov.licenseCards.items[0];
  ov.pricingRules=[{...rule,id:'past',opdStart:'2025-01-01',opdEnd:'2025-12-31'}];
  const incoming={[card.id]:{profile:{...card,workingNotes:'Portal approval'},contracts:{pair:cards.pairKey(card.license,card.licensor),rules:[...ov.pricingRules,rule]}}};
  const first=sync.applyRecords(ov,incoming,deps);
  assert.equal(first.rulesChanged,true);assert.equal(first.overrides.pricingRules.length,2);
  assert.equal(first.overrides.notesmap.private.Notes,'local');assert.equal(first.overrides._revisions.pricingRules,4);
  const second=sync.applyRecords(first.overrides,incoming,deps);
  assert.equal(second.changed,false);assert.equal(second.overrides._revisions.pricingRules,4);
  const overwritten=JSON.parse(JSON.stringify(first.overrides));
  overwritten.licenseCards.items[0].workingNotes='stale master profile';
  overwritten.pricingRules.find(r=>r.id==='current').trCommission=1;
  const recovered=sync.applyRecords(overwritten,incoming,deps);
  assert.equal(recovered.overrides.licenseCards.items[0].workingNotes,'Portal approval');
  assert.equal(recovered.overrides.pricingRules.find(r=>r.id==='current').trCommission,2);
  incoming[card.id].profile={...incoming[card.id].profile,portalUsername:'buyer'};
  const third=sync.applyRecords(first.overrides,incoming,deps);
  assert.equal(third.rulesChanged,false);assert.equal(third.overrides._revisions.pricingRules,4);
});

test('peer contracts cannot target another license and profile validation rejects unsafe URLs',()=>{
  const ov=fixture(),card=ov.licenseCards.items[0],original=JSON.stringify(ov);
  assert.throws(()=>sync.applyRecords(ov,{[card.id]:{profile:card,contracts:{pair:cards.pairKey(card.license,card.licensor),rules:[{...rule,license:'Other'}]}}},deps),{code:'LICENSE_RULE_SCOPE'});
  assert.throws(()=>sync.applyRecords(ov,{[card.id]:{profile:{...card,portalUrl:'javascript:alert(1)'}}},deps),{code:'LICENSE_PORTAL_INVALID'});
  assert.equal(JSON.stringify(ov),original);
});

test('publication mirrors only the edited card and its own contracts',async()=>{
  let ov=fixture();const card=ov.licenseCards.items[0];let published;
  const service=sync.createLicenseCardSync({deltaStore:{mirror:async(collection,entries,options)=>{published={collection,entries,options};return {ok:true};}},loadOverrides:()=>ov,saveOverrides:next=>{ov=next;},...deps});
  await service.publish({currentUser:{id:'authorized-editor'}},{card,contracts:[rule]});
  assert.equal(published.collection,'license-card');assert.equal(published.options.userId,'authorized-editor');
  assert.deepEqual(Object.keys(published.entries),[card.id]);assert.equal(published.entries[card.id].contracts.rules.length,1);
});

test('a complete peer snapshot removes deleted contracts and may replace an active rule ID',()=>{
  const ov=fixture(),card=ov.licenseCards.items[0];ov.pricingRules=[rule];
  let received=sync.applyRecords(ov,{[card.id]:{profile:card,contracts:{pair:cards.pairKey(card.license,card.licensor),rules:[]}}},deps);
  assert.equal(received.overrides.pricingRules.length,0);
  received=sync.applyRecords(ov,{[card.id]:{profile:card,contracts:{pair:cards.pairKey(card.license,card.licensor),rules:[{...rule,id:'replacement',trCommission:4}]}}},deps);
  assert.equal(received.overrides.pricingRules.length,1);assert.equal(received.overrides.pricingRules[0].id,'replacement');
});

test('failed mirror retains durable outbox and later flush retries without losing newer local data',async()=>{
  let ov=fixture(),available=false;const card=ov.licenseCards.items[0];
  const service=sync.createLicenseCardSync({deltaStore:{mirror:async()=>({ok:available})},loadOverrides:()=>ov,saveOverrides:next=>{ov=next;},...deps});
  ov=sync.stageChange(ov,{card,contracts:[rule],actorId:'authorized-editor'});
  assert.equal((await service.publish({currentUser:{id:'authorized-editor'}},{card,contracts:[rule]})).pending,true);
  assert.equal(ov.licenseCardOutbox[card.id].fields.contracts.rules[0].id,'current');
  available=true;ov.notesmap.extra={Notes:'new local edit'};
  assert.equal((await service.flushOutbox()).pending,false);assert.deepEqual(ov.licenseCardOutbox,{});
  assert.equal(ov.notesmap.extra.Notes,'new local edit');
});
