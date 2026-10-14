'use strict';
/* Price & Supplier Analysis for Office: the observation builder now lives in
   the shared engine (screen bridge + server); the Office READ uses the same
   rows, observations and analysis as the screen and returns aggregates only. */
const test=require('node:test'),assert=require('node:assert/strict');
const Prices=require('../public/price-supplier-insights-engine'),fields=require('../server/lib/canonical-fields');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{registerPriceAnalysisTools}=require('../server/lib/agent-price-analysis-tools');
const row=(i,season,manufacturer,fob,country='CHINA')=>({'Order Code':String(4100000+i),'Model Name':'DEMO '+i,Season:season,Manufacturer:manufacturer,FOB:fob,'Supp. FOB':fob-1,'Order Quantity':100+i,Category:'KAZAK','Buying Group':'DEMO GROUP',Country:country,_id:'r'+i});
const rows=[row(1,'6S27','ALPHA',10),row(2,'6S27','BETA',12),row(3,'6S27','ALPHA',11,'TÜRKİYE'),row(4,'6W26','ALPHA',9),row(5,'6W26','BETA',13)];

test('shared observation builder keeps the screen semantics (TRY for Turkey, price by type, canonical identity)',()=>{
  const a=Prices.orderPriceObservation(rows[0],'orders','finalFob',0,fields),b=Prices.orderPriceObservation(rows[2],'orders','supplierFob',2,fields);
  assert.equal(a.price,10);assert.equal(a.currency,'USD');assert.equal(a.manufacturer,'ALPHA');assert.equal(a.orderCode,'4100001');assert.equal(a.season,'6S27');assert.equal(a.quantity,101);assert.equal(a.rowId,'r1');
  assert.equal(b.price,10);assert.equal(b.currency,'TRY');
  assert.equal(Prices.orderPriceObservation({...rows[0],FOB:0},'orders','finalFob',0,fields).price,null);
  assert.throws(()=>Prices.canonicalObservation(rows[0],'orders',{},null),/Canonical field registry/);
});

test('Office READ returns the same analysis as the engine, scoped source only, aggregates without raw rows',async()=>{
  const profile={id:'demo',enabled:true};let asked=0;
  const registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,appendAudit:()=>{}}});
  registerPriceAnalysisTools(registry,{rows:async p=>{asked++;assert.equal(p,profile);return {rows,loadedAt:'2026-10-14T10:00:00.000Z'};}});
  const result=await registry.execute('priceanalysis.insights.read',{},{ownerId:profile.id,profile});
  const dataset=Prices.prepare(rows.map((r,i)=>Prices.orderPriceObservation(r,'orders','finalFob',i,fields))),periods=Prices.defaultPeriods(Prices.seasons(dataset));
  const expected=Prices.analyze(dataset,{...periods,minSample:2});
  assert.equal(asked,1);assert.equal(result.data.currentSeason,expected.currentSeason);assert.equal(result.data.hasComparison,expected.hasComparison);
  assert.deepEqual(result.data.totals,expected.totals);assert.equal(result.data.manufacturers.length,2);
  assert.ok(!JSON.stringify(result.data).includes('"row"'),'no raw source rows leave the tool');
  const filtered=await registry.execute('priceanalysis.insights.read',{filters:{manufacturer:['BETA']},priceType:'supplierFob'},{ownerId:profile.id,profile});
  assert.deepEqual(filtered.data.manufacturers.map(m=>m.name),['BETA']);assert.equal(filtered.data.priceType,'supplierFob');
  await assert.rejects(registry.execute('priceanalysis.insights.read',{filters:{invented:['x']}},{ownerId:profile.id,profile}),{code:'OFFICE_TOOL_SCHEMA'});
});

test('missing source filter fails closed',async()=>{
  const profile={id:'demo',enabled:true},registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,appendAudit:()=>{}}});
  registerPriceAnalysisTools(registry,{rows:async()=>({rows:[],sourceFilterRequired:true})});
  await assert.rejects(registry.execute('priceanalysis.insights.read',{},{ownerId:profile.id,profile}),{code:'OFFICE_SOURCE_FILTER_REQUIRED'});
});

test('holiday READ sends only country and year through the native service and maps provider failures',async()=>{
  const {registerHolidayTools}=require('../server/lib/agent-holiday-tools');
  const profile={id:'demo',enabled:true},calls=[];let fail=null;
  const registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,appendAudit:()=>{}}});
  registerHolidayTools(registry,{holidayService:{getYear:async args=>{calls.push(args);if(fail)throw Object.assign(new Error('x'),{code:fail});return {countryCode:'BD',year:2026,rows:[{date:'2026-12-16',name:'Victory Day',localName:'বিজয় দিবস',extra:'ignored'}],source:'verified-catalog',stale:false};}}});
  const result=await registry.execute('overview.holidays.read',{countryCode:'bd',year:2026},{ownerId:profile.id,profile});
  assert.deepEqual(calls,[{countryCode:'BD',year:2026}]);
  assert.deepEqual(result.data.holidays,[{date:'2026-12-16',name:'Victory Day',localName:'বিজয় দিবস'}]);
  await assert.rejects(registry.execute('overview.holidays.read',{countryCode:'BDX',year:2026},{ownerId:profile.id,profile}),{code:'OFFICE_TOOL_SCHEMA'});
  fail='HOLIDAY_PROVIDER_FAILED';await assert.rejects(registry.execute('overview.holidays.read',{countryCode:'BD',year:2026},{ownerId:profile.id,profile}),{code:'OFFICE_HOLIDAY_UNAVAILABLE'});
});
