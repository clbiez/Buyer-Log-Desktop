'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Engine=require('../public/collection-lfl-engine');
const {createReferenceCache}=require('../server/lib/collection-lfl-reference');
const vm=require('node:vm'),Groups=require('../public/collection-model-groups');
const order=(patch={})=>({orderCode:'DEMO-1',season:'S6',mag:'CU4E',classification:'K.KOL LİSANS',inStoreMonth:'2026-02',fob:10,quantity:100,country:'CHINA',...patch});

test('season impact adds a single prospective row to prior MB months of the same season and group',()=>{
 const refs=Engine.buildReferences([order({season:'S7',inStoreMonth:'2027-01'}),order({season:'S7',inStoreMonth:'2027-02',fob:20}),order({season:'S7',inStoreMonth:'2027-04',fob:100}),order({season:'S7',inStoreMonth:'2027-01',mag:'OTHER',fob:90}),order({season:'S7',inStoreMonth:'',fob:999}),order()]);
 const timelines=Engine.createSeasonTimelines(refs),row={season:'S7',inStoreMonth:'MARCH 2027',mag:'CU4E',urunTipi:'K.KOL LİSANS',quantity:'100'};
 const result=Engine.seasonImpact(timelines,row,12);
 assert.equal(result.status,'ready');assert.equal(result.before,15);assert.equal(result.after,14);assert.equal(result.reference.quantity,200);assert.equal(result.reference.orderCount,1);
 assert.equal(result.reference.undatedCount,1);
 assert.ok(Math.abs(result.percent-(-100/15))<1e-9);assert.equal(result.delta,-1);
 assert.equal(Engine.seasonImpact(timelines,{...row,inStoreMonth:'JANUARY 2027'},12).status,'no-prior');
 assert.equal(Engine.seasonImpact(timelines,{...row,inStoreMonth:'FEBRUARY 2027'},12).before,10,'same-month orders are not in the baseline');
 assert.equal(Engine.seasonImpact(timelines,{...row,quantity:0},12).status,'quantity');
 assert.equal(Engine.seasonImpact(timelines,row,0).status,'price');
 assert.equal(Engine.seasonImpact(timelines,{...row,inStoreMonth:''},12).status,'month');
 assert.equal(Engine.seasonImpact(timelines,{...row,_sourceOrderCode:'DEMO-1'},12).status,'linked-order');
 assert.equal(Engine.seasonImpact(timelines,{...row,mag:'MISSING'},12).status,'no-prior');
 const equal=Engine.seasonImpact(timelines,row,15);assert.equal(equal.after,15);assert.equal(equal.percent,0);
 const boundary=Engine.createSeasonTimelines(Engine.buildReferences([order({season:'W7',inStoreMonth:'2026-12',fob:8})]));
 assert.equal(Engine.seasonImpact(boundary,{...row,season:'W7',inStoreMonth:'JANUARY 2027'},12).after,10);
});

test('sample size counts distinct source orders per reference, never colour/source rows',()=>{
 const entries=Engine.buildReferences([order({id:'colour-a'}),order({id:'colour-b'}),order({orderCode:' demo-1 '}),order({orderCode:'DEMO-2'}),order({orderCode:'DEMO-3'}),order({orderCode:'DEMO-4',inStoreMonth:'2026-03'})]);
 const row={season:'S7',mag:'CU4E',urunTipi:'K.KOL LİSANS',inStoreMonth:'FEBRUARY 2027'},index=new Map(entries.map(item=>[item.key,item]));
 const monthly=Engine.reference(index,row,'month'),seasonal=Engine.reference(index,row,'season');
 assert.equal(monthly.orderCount,3);assert.equal(monthly.count,5);assert.equal(monthly.unidentifiedCount,0);
 assert.equal(seasonal.orderCount,4);assert.equal(seasonal.count,6);
 const unknown=Engine.buildReferences([order({orderCode:'',id:'not-an-order-code'})])[0];
 assert.equal(unknown.orderCount,0);assert.equal(unknown.unidentifiedCount,1);
 assert.ok(!JSON.stringify(entries).includes('DEMO-1'),'persist counts only, not source order identifiers');
});

test('MB month references match the same month one year earlier, independently of the full season',()=>{
 const index=new Map(Engine.buildReferences([order(),order({fob:20,quantity:300}),order({inStoreMonth:'2026-03',fob:30,quantity:400}),order({inStoreMonth:'2025-02',fob:90,quantity:100}),order({inStoreMonth:'',fob:50,quantity:100})]).map(item=>[item.key,item]));
 const row={season:'S7',mag:'CU4E',urunTipi:'K.KOL LİSANS',inStoreMonth:'ŞUBAT 2027'};
 assert.equal(Engine.reference(index,row,'month').average,17.5);
 assert.equal(Engine.reference(index,row,'month').month,'2026-02');
 assert.equal(Engine.reference(index,row,'season').average,33);
 for(const month of ['FEBRUARY 2027','202702','2027-02','02/2027'])assert.equal(Engine.reference(index,{...row,inStoreMonth:month},'month').average,17.5);
 assert.equal(Engine.reference(index,{...row,inStoreMonth:'MARCH 2027'},'month').average,30);
 assert.equal(Engine.reference(index,{...row,inStoreMonth:'APRIL 2027'},'month'),null);
 assert.equal(Engine.reference(index,{...row,inStoreMonth:''},'month'),null);
 assert.equal(Engine.reference(index,{...row,inStoreMonth:'invalid'},'month'),null);
 const boundary=new Map(Engine.buildReferences([order({inStoreMonth:'2026-01',inStore:'2025-12-29'})]).map(item=>[item.key,item]));
 assert.equal(Engine.reference(boundary,{...row,inStoreMonth:'JANUARY 2027'},'month').average,10,'source MB month takes priority over the Gregorian date');
});

test('quantity weighted references share normalized canonical dimensions and keep seasons/currencies separate',()=>{
 const entries=Engine.buildReferences([order(),order({fob:20,quantity:300}),order({country:'TURKIYE',fob:500}),order({season:'W6',fob:99}),order({quantity:0}),order({fob:-1}),order({mag:'OTHER'})]);
 const index=new Map(entries.map(item=>[item.key,item]));
 const match=Engine.reference(index,{season:'s7',mag:' cu4e ',urunTipi:'k.kol lisans'});
 assert.equal(match.average,17.5);assert.equal(match.quantity,400);assert.equal(match.count,2);assert.equal(match.season,'S6');
 assert.equal(Engine.reference(index,{season:'S8',mag:'CU4E',urunTipi:'K.KOL LİSANS'}),null);
 assert.equal(Engine.reference(index,{season:'S7',mag:'',urunTipi:'K.KOL LİSANS'}),null);
 assert.equal(Engine.previousSeason('S2027'),'S2026');assert.equal(Engine.previousSeason('S07'),'S06');assert.equal(Engine.previousSeason('invalid'),'');
 assert.equal(Engine.changePercent(14,17.5),-20);assert.equal(Engine.changePercent(0,17.5),null);
});

test('Price uses live confirmed/best/target values, grouped dimensions and one request across renders',async()=>{
 let requests=0;
 let refs=Engine.buildReferences([order()]);
 const context={window:null,appLang:'tr',state:{currentUser:{id:'demo'}},document:{body:{dataset:{activeTab:'overview'}}},BLCollectionLflEngine:Engine,
  escapeHtml:value=>String(value).replace(/[<>&"]/g,'_'),kolFormatMoneyDisplay:value=>Number(value).toFixed(2),kolEffectiveValue:(row,key)=>row.effective?.[key]??row[key],
  kolSuppFob:row=>Groups.confirmedPricing(row,row.pricing||{},Groups.kolParseMoneyNum)||Groups.bestPricing(row.pricing||{},Groups.kolParseMoneyNum)||(Number(row.targetPrice)>0?{price:Number(row.targetPrice),source:'target'}:null),
  fetch:async()=>{requests++;return {ok:true,json:async()=>({references:refs})};}};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/collection-lfl.js'),'utf8'),context);
 const ui=context.BLCollectionLfl;
 await Promise.all([ui.ensure(),ui.ensure()]);await ui.ensure();assert.equal(requests,1);
 const row={id:1,season:'S7',mag:'CU4E',urunTipi:'K.KOL LİSANS',inStoreMonth:'FEBRUARY 2027',targetPrice:8,pricing:{}};
 assert.equal(ui.model(row).percent,-20);
 assert.equal(ui.model(row).lowSample,true);assert.match(ui.model(row).warning,/1.*sipariş/);
 assert.match(ui.cell(row,''),/Yalnız 1 sipariş/);assert.match(ui.combinedCell(row,'',['__lfl__']),/⚠ 1 sipariş/);
 row.pricing={A:9,B:12};assert.equal(ui.model(row).percent,-10);
 row.confirmedManufacturer='B';assert.equal(ui.model(row).percent,20);
 assert.equal(ui.model({...row,effective:{mag:'OTHER'}}).reference,null);
 assert.equal(ui.model({...row,season:'S8'}).reference,null);
 const noData={...row,season:'S8'};
 assert.match(ui.cell(noData,''),/Kıyaslanacak veri yok/);assert.match(ui.combinedText(noData,['__lfl__']),/Kıyaslanacak veri yok/);
 assert.match(ui.text(row),/1.*sipariş/);
 assert.equal(ui.model({...row,effective:{inStoreMonth:'MARCH 2027'}}).reference,null);
 assert.equal(ui.model({...row,inStoreMonth:''}).reference,null);
 assert.equal(ui.model({...row,inStoreMonth:''}).noData,false);
 assert.equal(ui.model({...row,inStoreMonth:''},'season').reference.average,10);
 row.pricing={};row.targetPrice='';assert.equal(ui.model(row).percent,null);assert.equal(ui.model(row).reference.average,10);
 refs=Engine.buildReferences([1,2,3].map(number=>order({orderCode:'DEMO-'+number})));
 ui.invalidate();await ui.ensure();assert.equal(ui.model(row).lowSample,true);assert.match(ui.model(row).warning,/3.*sipariş/);
 refs=Engine.buildReferences([1,2,3,4].map(number=>order({orderCode:'DEMO-'+number})));
 ui.invalidate();await ui.ensure();assert.equal(requests,3);assert.equal(ui.model(row).lowSample,false);assert.equal(ui.model(row).warning,'');
 context.appLang='en';assert.match(ui.cell(noData,''),/No comparison data/);
 refs=Engine.buildReferences([order({orderCode:''})]);ui.invalidate();await ui.ensure();assert.match(ui.model(row).warning,/cannot be verified/);
 context.state.currentUser={id:'another-user'};await ui.ensure();assert.equal(requests,5);
 refs=Engine.buildReferences([order({season:'S7',inStoreMonth:'2027-01'})]);ui.invalidate();await ui.ensure();
 row.quantity='100';row.targetPrice='20';
 assert.equal(ui.model(row,'impact').impact.before,10);assert.equal(ui.model(row,'impact').impact.after,15);
 assert.match(ui.cell(row,'','impact'),/50%/);assert.equal(ui.model(row,'impact').lowSample,true);
 row.quantity='300';assert.equal(ui.model(row,'impact').impact.after,17.5);
 row.targetPrice='5';assert.equal(ui.model(row,'impact').impact.after,6.25);
 assert.equal(ui.model({...row,effective:{quantity:100}},'impact').impact.after,7.5);
 assert.match(ui.cell({...row,inStoreMonth:'JANUARY 2027'},'','impact'),/No earlier-month data/);
 assert.equal(ui.model({...row,_sourceOrderCode:'DEMO-1'},'impact').impact.status,'linked-order');
 assert.equal(ui.model({...row,quantity:0},'impact').impact.status,'quantity');
 assert.equal(requests,6,'changing quantity or price never reloads season source data');
});

test('reference endpoint checks Collection/LFL permissions and filters rows before aggregating',async()=>{
 const routes=new Map(),guards=[];
 const app={get:(url,...handlers)=>routes.set(url,handlers),post:()=>{}};
 const register=require('../server/routes/lfl-routes');
 let readiness=true,loads=0,captured;
 const runtime={lflLoadedAt:'snapshot',lflRows:[order(),order({buyer:'not-authorized',fob:99})]};
 register(app,{userAccess:{requireArea:area=>{guards.push(area);return ()=>{};},publicProfile:user=>({...user,scopes:{mags:['CU4E']}}),localIamRevision:()=>1,filterRowsByScope:(_user,rows)=>rows.filter(row=>row.buyer!=='not-authorized')},sourceUserId:()=> 'source-user',sourceFilterReadiness:()=>({ready:readiness}),ensureDataLoaded:async()=>{loads++;},cacheForUser:()=>runtime,collectionLflCache:{get:async args=>{captured=args;return {references:Engine.buildReferences(await args.loadRows())};}},sendDateSafeJson:(res,data)=>res.json(data),apiError:(_res,error)=>{throw error;}});
 assert.deepEqual(guards.slice(0,2),['koleksiyon','lfl']);
 const handler=routes.get('/api/collection-lfl-reference').at(-1),res={set(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
 await handler({currentUser:{id:'user-a'},query:{}},res);
 assert.equal(res.data.references[0].average,10);assert.equal(res.data.references[0].count,1);assert.equal(captured.version,'snapshot');
 assert.ok(!JSON.stringify(res.data).includes('not-authorized'));
 assert.equal(loads,0,'an uploaded LFL snapshot must not be replaced by a general source reload');
 readiness=false;await handler({currentUser:{id:'user-a'},query:{}},res);assert.equal(res.code,409);assert.equal(loads,0);
});

test('cache coalesces concurrent requests, persists aggregates and invalidates only on source/scope changes',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'collection-lfl-'));let loads=0;
 const args={identity:'user-a-scope-1',version:'source-1',loadRows:async()=>{loads++;return [order()];}};
 try{
  const cache=createReferenceCache({directory});
  const [first,second]=await Promise.all([cache.get(args),cache.get(args)]);
  assert.strictEqual(first,second);assert.equal(loads,1);
  assert.deepEqual(await createReferenceCache({directory}).get(args),first);assert.equal(loads,1);
  await cache.get({...args,version:'source-2'});assert.equal(loads,2);
  await cache.get({...args,identity:'user-b-scope-1'});assert.equal(loads,3);
  await cache.get({...args,rebuild:true});assert.equal(loads,4);
  assert.ok(!fs.readFileSync(path.join(directory,fs.readdirSync(directory)[0]),'utf8').includes('orderCode'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('older disk caches are rebuilt once to include cumulative season summaries',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'collection-lfl-upgrade-'));let loads=0;
 const args={identity:'upgrade',version:'same-source',loadRows:async()=>{loads++;return [order()];}};
 try{
  await createReferenceCache({directory}).get(args);
  const file=path.join(directory,fs.readdirSync(directory)[0]),old=JSON.parse(fs.readFileSync(file,'utf8'));
  old.schema=3;old.references=[];fs.writeFileSync(file,JSON.stringify(old));
  const snapshot=await createReferenceCache({directory}).get(args);
  assert.equal(loads,2);assert.equal(snapshot.schema,4);assert.ok(snapshot.references.some(item=>item.throughMonth==='2026-02'&&item.orderCount===1));
  await createReferenceCache({directory}).get(args);assert.equal(loads,2);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
