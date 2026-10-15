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
  assert.deepEqual(result.data.holidays,[{date:'2026-12-16',name:'Victory Day',localName:'বিজয় দিবস',nationalHoliday:true,global:true,subdivisionCodes:null,holidayTypes:['Public'],estimated:false}]);
  await assert.rejects(registry.execute('overview.holidays.read',{countryCode:'BDX',year:2026},{ownerId:profile.id,profile}),{code:'OFFICE_TOOL_SCHEMA'});
  fail='HOLIDAY_PROVIDER_FAILED';await assert.rejects(registry.execute('overview.holidays.read',{countryCode:'BD',year:2026},{ownerId:profile.id,profile}),{code:'OFFICE_HOLIDAY_UNAVAILABLE'});
});

test('a real provider outage is refused instead of returning an empty or estimate-only calendar',async()=>{
  const {registerHolidayTools}=require('../server/lib/agent-holiday-tools'),{createHolidayService}=require('../server/lib/holiday-service');
  const profile={id:'demo',enabled:true},registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,appendAudit:()=>{}}});
  registerHolidayTools(registry,{holidayService:createHolidayService({fetchFn:async()=>{throw new Error('offline');}})});
  for(const countryCode of ['DE','EG'])await assert.rejects(registry.execute('overview.holidays.read',{countryCode,year:2026},{ownerId:profile.id,profile}),{code:'OFFICE_HOLIDAY_UNAVAILABLE'});
});

test('regional and non-public holidays keep the flags the screen uses',async()=>{
  const {registerHolidayTools}=require('../server/lib/agent-holiday-tools');
  const profile={id:'demo',enabled:true},registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,appendAudit:()=>{}}});
  registerHolidayTools(registry,{holidayService:{getYear:async()=>({ok:true,countryCode:'DE',year:2026,source:'nager',rows:[{date:'2026-01-06',name:'Epiphany',localName:'Heilige Drei Könige',nationalHoliday:false,global:false,subdivisionCodes:['DE-BW','DE-BY'],holidayTypes:['Public']},{date:'2026-12-24',name:'Christmas Eve',localName:'Heiligabend',nationalHoliday:true,global:true,subdivisionCodes:null,holidayTypes:['Bank']}]})}});
  const [regional,bank]=(await registry.execute('overview.holidays.read',{countryCode:'DE',year:2026},{ownerId:profile.id,profile})).data.holidays;
  assert.equal(regional.nationalHoliday,false);assert.deepEqual(regional.subdivisionCodes,['DE-BW','DE-BY']);assert.deepEqual(bank.holidayTypes,['Bank']);
});

test('only a current season compares against the season before it, like the screen',async()=>{
  const profile={id:'demo',enabled:true},seasonRows=['6S25','6W25','6S26','6W26'].flatMap((season,i)=>[row(10+i,season,'ALPHA',10+i),row(20+i,season,'BETA',12+i)]);
  const registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,appendAudit:()=>{}}});
  registerPriceAnalysisTools(registry,{rows:async()=>({rows:seasonRows})});
  const result=await registry.execute('priceanalysis.insights.read',{currentSeason:'6S26'},{ownerId:profile.id,profile});
  const seasons=Prices.seasons(Prices.prepare(seasonRows.map((r,i)=>Prices.orderPriceObservation(r,'orders','finalFob',i,fields))));
  assert.equal(result.data.currentSeason,'6S26');assert.equal(result.data.previousSeason,Prices.previousSeason('6S26',seasons));
  await assert.rejects(registry.execute('priceanalysis.insights.read',{filters:{manufacturer:['—']}},{ownerId:profile.id,profile}),{code:'OFFICE_TASK_INVALID'});
  await assert.rejects(registry.execute('priceanalysis.insights.read',{filters:{manufacturer:['']}},{ownerId:profile.id,profile}),{code:'OFFICE_TOOL_SCHEMA'});
});

test('pricing supplier suggestion: filtered Collection models go to below-average suppliers; output passes its schema; needs Collection and Price Analysis',async()=>{
  const profile={id:'demo',enabled:true},registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,appendAudit:()=>{}}});
  const priced=[row(11,'6S27','ALPHA',8),row(12,'6S27','ALPHA',8),row(13,'6S27','BETA',12),row(14,'6S27','BETA',12)];
  const options=[{id:'k1','PLM ID':'900001','Style Name':'DEMO A',Season:'June 2027',Category:'KAZAK'},{id:'k2','PLM ID':'900002','Style Name':'DEMO B',Season:'June 2027',Category:'HIRKA'},{id:'k3','PLM ID':'900003','Style Name':'DEMO C',Season:'May 2027',Category:'KAZAK'}];
  let owner='';
  registerPriceAnalysisTools(registry,{rows:async()=>({rows:priced}),collectionRows:async ownerId=>{owner=ownerId;return options;}});
  const tool=registry.catalog?(await registry.catalog({...profile})).find(item=>item.id==='pricing.suppliers.suggest'):null;
  if(tool){assert.deepEqual(tool.areas,['koleksiyon','priceanalysis']);assert.match(tool.description,/below the classification average/);}
  const result=await registry.execute('pricing.suppliers.suggest',{filters:[{field:'season',operator:'eq',value:'June 2027'}]},{ownerId:profile.id,profile});
  assert.equal(owner,'demo');
  assert.deepEqual(result.data.suppliers.map(s=>[s.name,s.models.map(m=>m.rowId),Math.round(s.classifications[0].index)]),[['ALPHA',['k1'],-20]],'only June 2027 models; BETA is above the KAZAK average');
  assert.deepEqual(result.data.unmatched['no-price-data'].models.map(m=>m.rowId),['k2']);
  require('../server/lib/agent-tool-schema').validate(registry.get('pricing.suppliers.suggest').outputSchema,result);
  await assert.rejects(registry.execute('pricing.suppliers.suggest',{perGroup:9},{ownerId:profile.id,profile}),{code:'OFFICE_TOOL_SCHEMA'});
});
