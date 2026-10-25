'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Lineage=require('../public/price-lineage'),Fields=require('../public/canonical-fields');
const Desk=require('../public/pricing-desk-engine');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('record bindings distinguish workspace, session and canonical identity while allowing new row revisions',()=>{
 const row={id:1,modelKod:'DEMO',plmId:'100',colourCode:'01',_rev:1},ctx={module:'collection',owner:'buyer-a',user:'viewer',fields:Fields},bound=Lineage.binding(row,ctx);
 assert.equal(Lineage.sameBinding(bound,Lineage.binding({...row,_rev:2},ctx)),true);
 for(const [changed,context]of [[row,{...ctx,owner:'buyer-b'}],[row,{...ctx,user:'another'}],[{...row,modelKod:'OTHER'},ctx],[{...row,colourCode:'02'},ctx]])assert.equal(Lineage.sameBinding(bound,Lineage.binding(changed,context)),false);
});
test('lineage reports canonical price selection, fallback month and actual source age without recalculating prices',()=>{
 const snapshot=Lineage.snapshot({module:'collection',record:'DEMO',source:{kind:'confirmed',name:'A',amount:12,origin:'import',at:'2026-10-20T00:00:00Z'},values:{overseasLanded:14.1234,trLanded:11},rule:{id:'rule-a',royalty:20},fx:{rate:40,requestedMonth:'2026-02',resolvedMonth:'2026-01',exact:false,revision:3,sourceModifiedAt:'2026-10-01T00:00:00Z'},revisions:{collection:4,pricingRules:2},now:'2026-10-25T00:00:00Z'});
 assert.equal(snapshot.source.amount,12);assert.equal(snapshot.source.kind,'confirmed');assert.equal(snapshot.values.overseasLanded,14.1234);assert.equal(snapshot.fx.fallback,true);assert.equal(snapshot.fx.ageDays,24);assert.equal(snapshot.source.ageDays,5);assert.equal(snapshot.rule.id,'rule-a');
});
test('manual FX has no automatic month attribution; missing source dates stay unknown',()=>{
 const snapshot=Lineage.snapshot({module:'collection',fx:{manual:true,rate:44,requestedMonth:'2026-02',resolvedMonth:'2026-01',revision:3},source:{kind:'target',amount:0},now:'2026-10-25'});
 assert.equal(snapshot.fx.requestedMonth,null);assert.equal(snapshot.fx.resolvedMonth,null);assert.equal(snapshot.fx.revision,null);assert.equal(snapshot.fx.fallback,false);assert.equal(snapshot.source.ageDays,null);assert.equal(snapshot.source.amount,0);
});
test('approving an imported price does not replace the price offer origin or timestamp',()=>{
 const line={id:'line',manufacturer:'A',price:'4',updatedAt:'2026-10-25T00:00:00Z',history:[{id:'offer',type:'offer',price:'4',source:'import',at:'2026-10-01T00:00:00Z'},{id:'approval',type:'approve',source:'manual',at:'2026-10-25T00:00:00Z'}]},req={id:'request',createdAt:'2026-09-01T00:00:00Z'};
 const provenance=Lineage.offerProvenance([{line,req}],{engine:Desk,amount:4,manufacturer:'A'});assert.equal(provenance.origin,'import');assert.equal(provenance.at,'2026-10-01T00:00:00Z');assert.equal(provenance.lineId,'line');
});
test('the installed drawer attributes an imported price to its offer event after approval',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/collection-price-drawer.js'),'utf8'),start=source.indexOf('  function lineageSnapshot('),end=source.indexOf('  function lineageRows(',start);
 const row={id:1},line={id:'line',manufacturer:'A',price:'4',updatedAt:'2026-10-25',history:[{id:'offer',type:'offer',price:'4',source:'import',at:'2026-10-01'},{id:'approval',type:'approve',source:'manual',at:'2026-10-25'}]},req={id:'req'};
 const ctx={state:{module:'collection'},global:{BLPricingDeskEngine:Desk,BLPriceLineage:Lineage,BLPriceLineageBridge:{snapshot:(_row,_module,provenance)=>provenance}},norm:String,kolParseMoneyNum:Desk.price,kolSuppFob:()=>({name:'A',price:4}),kolGroupSummaryEffectiveLandedRow:value=>value,ledgerLines:()=>[{line,req}]};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);const actual=ctx.lineageSnapshot(row);assert.equal(actual.origin,'import');assert.equal(actual.at,'2026-10-01');
});
test('a current price without a matching latest offer never borrows an older equal-price timestamp',()=>{
 const line={id:'pending',manufacturer:'A',price:'4',history:[{id:'old-four',type:'offer',price:'4',source:'import',at:'2026-10-01'},{id:'five',type:'offer',price:'5',source:'manual',at:'2026-10-20'}]};
 const provenance=Lineage.offerProvenance([{line,req:{id:'req'}}],{engine:Desk,amount:4,manufacturer:'A'});assert.equal(provenance.origin,'unconfirmed');assert.equal(provenance.at,null);
});
