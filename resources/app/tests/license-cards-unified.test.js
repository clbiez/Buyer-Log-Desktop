'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const cards=require('../server/lib/license-cards'),validators=require('../server/lib/resource-rule-service');
const business=require('../public/business-rules'),parse=require('../server/lib/parse'),sync=require('../server/lib/license-card-sync');
const engine=require('../public/license-cards-engine');
const rule=(id,categories=[],royalty=10)=>({id,license:'Demo',licensor:'Agency',opdStart:'',opdEnd:'',seasons:[],categories,royalty,trCommission:2,ydCommission:4,hologramCost:.057,legacyTrHologramCost:.079});
test('manual creation preserves existing cards, contracts and rejects duplicate identities',()=>{
 const base={pricingRules:[rule('general')],_revisions:{licenseCards:2,pricingRules:3}};
 const before=JSON.stringify(base),result=cards.createCard(base,{license:'New demo',licensor:'New agency'});
 assert.equal(JSON.stringify(base),before);assert.deepEqual(result.overrides.pricingRules,base.pricingRules);
 assert.equal(result.card.license,'New demo');assert.equal(cards.revisionOf(result.overrides,'licenseCards'),3);
 assert.throws(()=>cards.createCard(base,{license:' demo ',licensor:'AGENCY'}),{code:'LICENSE_CARD_EXISTS'});
 assert.throws(()=>cards.createCard(base,{license:''}),{code:'LICENSE_CARD_INVALID'});
});
test('category contracts coexist with general fallback, survive normalization and peer recovery',()=>{
 let ov=cards.appendDiscovered({pricingRules:[rule('general')]},[{license:'Demo',licensor:'Agency'}]).overrides;
 const id=ov.licenseCards.items[0].id,token=cards.responseOf(ov,true).cards[0].editToken;
 const result=cards.updateCard(ov,id,{editToken:token,profile:{},rules:[rule('home',['Home'],3),rule('tee',['T-shirt'],5)]},validators);
 assert.equal(result.overrides.pricingRules.length,3);
 const clean=validators.normalizePricingRules(result.overrides.pricingRules);
 for(const [category,expected] of [['Home','home'],['T-shirt','tee'],['Other','general'],['','general']]){
   const found=parse.calculateSuppFobByRule(10,'2026-11-04','TR','','Agency','Demo',clean,null,category);
   assert.equal(found.rule.id,expected);assert.equal(found.value,business.calculateSuppFobWithRule(10,clean.find(r=>r.id===expected),'TR'));
 }
 const staged=sync.stageChange(result.overrides,{card:result.card,contracts:clean,actorId:'demo'});
 const records=Object.fromEntries(Object.entries(staged.licenseCardOutbox).map(([key,value])=>[key,value.fields]));
 const recovered=sync.applyRecords({},records,validators).overrides;
 assert.deepEqual(recovered.pricingRules,clean);
 assert.equal(recovered.pricingRules[1].legacyTrHologramCost,.079);
 assert.throws(()=>cards.updateCard(result.overrides,id,{editToken:token,profile:{},rules:[]},validators),{code:'REVISION_CONFLICT'});
 const current=cards.responseOf(result.overrides,true).cards[0];
 assert.throws(()=>cards.updateCard(result.overrides,id,{editToken:current.editToken,profile:{},rules:[rule('overlap',['HOME'],8)]},validators),{code:'LICENSE_RULE_OVERLAP'});
});
test('new category period leaves general and other category history unchanged',()=>{
 const rules=[rule('general'),rule('home',['Home'],3),rule('tee',['T-shirt'],5)];
 const next=engine.nextContractPeriod(rules,{license:'Demo',licensor:'Agency'},'2026-11-04','next','home');
 assert.deepEqual(next.rule.categories,['Home']);assert.equal(next.rules.find(r=>r.id==='general').opdEnd,'');
 assert.equal(next.rules.find(r=>r.id==='tee').opdEnd,'');assert.equal(next.rules.find(r=>r.id==='home').opdEnd,'2026-11-03');
});
test('deleting a contract is explicit, scoped, guarded and leaves omitted history intact',()=>{
 const ov=cards.appendDiscovered({pricingRules:[rule('general'),rule('home',['Home'],3)]},[{license:'Demo',licensor:'Agency'}]).overrides;
 const card=cards.responseOf(ov,true).cards[0];
 const result=cards.updateCard(ov,card.id,{editToken:card.editToken,profile:{},deletedRuleIds:['home']},validators);
 assert.deepEqual(result.overrides.pricingRules.map(r=>r.id),['general']);assert.equal(result.rulesChanged,true);
 assert.equal(ov.pricingRules.length,2);
 assert.throws(()=>cards.updateCard(ov,card.id,{editToken:card.editToken,profile:{},deletedRuleIds:['foreign']},validators),{code:'LICENSE_RULE_SCOPE'});
});

test('legacy HTTP and peer clients cannot widen or delete category scopes silently',()=>{
 const existing=[rule('general'),rule('home',['Home'],3),rule('tee',['T-shirt'],5)];
 let ov=cards.appendDiscovered({pricingRules:existing},[{license:'Demo',licensor:'Agency'}]).overrides;
 const card=cards.responseOf(ov,true).cards[0],oldHome={...existing[1],royalty:4};delete oldHome.categories;
 const updated=cards.updateCard(ov,card.id,{editToken:card.editToken,profile:{},rules:[oldHome]},validators).overrides;
 assert.deepEqual(updated.pricingRules.find(r=>r.id==='home').categories,['Home']);
 const partial=sync.applyRecords(ov,{[card.id]:{contracts:{pair:cards.pairKey(card.license,card.licensor),rules:[oldHome]}}},validators).overrides;
 assert.deepEqual(partial.pricingRules.find(r=>r.id==='home').categories,['Home']);assert.ok(partial.pricingRules.some(r=>r.id==='tee'));assert.ok(partial.pricingRules.some(r=>r.id==='general'));
 const modern=sync.applyRecords(ov,{[card.id]:{contracts:{categorySchemaVersion:1,pair:cards.pairKey(card.license,card.licensor),rules:[]}}},validators).overrides;
 assert.deepEqual(modern.pricingRules,[]);
 assert.throws(()=>validators.normalizePricingRules([existing[0]],{existing}),{code:'PRICING_CATEGORY_VERSION_REQUIRED'});
 assert.throws(()=>validators.normalizePricingRules(existing.slice(1),{existing}),{code:'PRICING_CATEGORY_VERSION_REQUIRED'});
 assert.deepEqual(validators.normalizePricingRules([existing[0]],{existing,categorySchemaVersion:1}).map(r=>r.id),['general']);
 assert.deepEqual(validators.normalizePricingRules([oldHome],{existing,categorySchemaVersion:1})[0].categories,['Home']);
});

test('period transitions copy country-specific precision without touching other scopes',()=>{
 const original=rule('home',['Home'],3);original.opdStart='2026-01-01';original.legacyYdHologramCost=.057;
 const next=engine.nextContractPeriod([original],{license:'Demo',licensor:'Agency'},'2026-11-04','next','home');
 assert.equal(next.rule.legacyTrHologramCost,.079);assert.equal(next.rule.legacyYdHologramCost,.057);
 assert.equal(engine.periodEnd(original,{...next.rule,categories:[]}),original.opdEnd);
 assert.equal(engine.periodEnd(original,{...next.rule,categories:[],opdStart:'2027-01-01'}),original.opdEnd);
});
