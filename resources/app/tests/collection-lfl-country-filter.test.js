'use strict';
// Buyer ülke kuralı: Previous Season / LFL / Sezon Etkisi referanslarından seçili üretim ülkeleri çıkarılır.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Engine=require('../public/collection-lfl-engine');
const order=(patch={})=>({orderCode:'DEMO-1',season:'S6',mag:'CU4E',classification:'K',inStoreMonth:'2026-02',fob:10,quantity:100,country:'CHINA',...patch});
const source=[
 order(),
 order({orderCode:'DEMO-MA',country:'FAS',fob:20,quantity:100}),
 order({orderCode:'DEMO-EG',country:'Mısır',fob:40,quantity:200,inStoreMonth:'2026-03'}),
 order({orderCode:'DEMO-TR',country:'TÜRKİYE',fob:500}),
 order({orderCode:'NOW-CN',season:'S7',inStoreMonth:'2027-01',fob:10,quantity:100}),
 order({orderCode:'NOW-MA',season:'S7',inStoreMonth:'2027-01',fob:30,quantity:100,country:'MOROCCO'}),
 order({orderCode:'NOW-EG',season:'S7',inStoreMonth:'2026-12',fob:50,quantity:100,country:'EGYPT'}),
];
const candidate={season:'S7',mag:'CU4E',urunTipi:'K',inStoreMonth:'FEBRUARY 2027',quantity:100};

test('country exclusion recomputes season, same-month and cumulative references from per-country sums',()=>{
 const refs=Engine.buildReferences(source),index=new Map(refs.map(ref=>[ref.key,ref])),timelines=Engine.createSeasonTimelines(refs);
 const season=Engine.reference(index,candidate,'season');
 assert.equal(season.quantity,400);assert.equal(season.average,(1000+2000+8000)/400);
 assert.deepEqual(season.byCountry.map(item=>item.country),['CN','EG','MA'],'canonical country codes; TRY rows stay out of USD references');
 const filtered=Engine.reference(index,candidate,'season',['MA','EG']);
 assert.equal(filtered.average,10);assert.equal(filtered.quantity,100);assert.equal(filtered.count,1);assert.equal(filtered.orderCount,1);
 assert.deepEqual(filtered.excludedCountries,['EG','MA']);
 assert.equal(Engine.reference(index,candidate,'season',['TR']),season,'excluding an absent country keeps the exact stored reference');
 assert.equal(Engine.reference(index,candidate,'month',['MA']).average,10);
 assert.equal(Engine.reference(index,candidate,'season',['CN','MA','EG']),null,'nothing left means no comparison data');
 const impact=Engine.seasonImpact(timelines,candidate,20);
 assert.equal(impact.before,(1000+3000+5000)/300);assert.equal(impact.reference.firstMonth,'2026-12');assert.equal(impact.reference.undatedCount,0);
 const own=Engine.seasonImpact(timelines,candidate,20,['MA','EG']);
 assert.equal(own.before,10);assert.equal(own.after,15);assert.equal(own.reference.firstMonth,'2027-01');assert.equal(own.reference.quantity,100);
 assert.equal(Engine.seasonImpact(timelines,{...candidate,inStoreMonth:'JANUARY 2027'},20,['EG']).status,'no-prior','only excluded countries before the month');
 const details=Engine.referenceDetails(source,season,['EG']);
 assert.deepEqual(details.map(row=>row.orderCode),['DEMO-1','DEMO-MA']);
 assert.ok(Math.abs(details.reduce((sum,row)=>sum+row._referenceWeight,0)-100)<1e-9,'weights use the filtered quantity');
});

test('buyer rules: own rule wins over the all-buyers default and codes are normalised',()=>{
 const rules=[{buyer:'*',countries:['tr']},{buyer:'Demo Buyer',countries:['eg','ma','MA']}];
 assert.deepEqual(Engine.countryRuleFor(rules,' demo buyer '),['EG','MA']);
 assert.deepEqual(Engine.countryRuleFor(rules,'Other Buyer'),['TR']);
 assert.deepEqual(Engine.countryRuleFor(rules,''),['TR']);
 assert.deepEqual(Engine.countryRuleFor([],'Demo Buyer'),[]);
 assert.deepEqual(Engine.countryList(new Set([' ma ','',null,'EG'])),['EG','MA']);
});

function harness(stored){
 const storage=new Map(stored?[[ 'lcw.koleksiyon.analytics.lflCountryRules.v1',JSON.stringify(stored)]]:[]),requests=[];
 const context={window:null,appLang:'tr',state:{currentUser:{id:'buyer'}},document:{body:{dataset:{activeTab:'overview'}}},BLCollectionLflEngine:Engine,BLCanonicalFields:require('../public/canonical-fields'),
  BLStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},
  escapeHtml:value=>String(value).replace(/[&<>"']/g,'_'),kolFormatMoneyDisplay:value=>Number(value).toFixed(2),
  kolEffectiveValue:(row,key)=>row[key],kolSuppFob:row=>({price:Number(row.targetPrice),source:'target'}),
  fetch:async(url,options)=>{
   const references=Engine.buildReferences(source);
   if(url.startsWith('/api/collection-lfl-reference'))return {ok:true,json:async()=>({version:'v1',references})};
   const body=JSON.parse(options.body);requests.push(body);
   const stored=references.find(ref=>ref.key===body.key);
   return {ok:true,json:async()=>({version:'v1',reference:Engine.excludeCountries(stored,body.excludedCountries),rows:Engine.referenceDetails(source,stored,body.excludedCountries)})};
  }};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/collection-lfl.js'),'utf8'),context);
 return {ui:context.BLCollectionLfl,context,storage,requests};
}

test('Collection cells, footer and detail requests follow the row buyer country rule',async()=>{
 const {ui,context,storage,requests}=harness({rules:[{buyer:'Demo Buyer',countries:['MA','EG']}]});await ui.ensure();
 const mine={id:1,...candidate,buyer:'Demo Buyer',targetPrice:12},other={id:2,...candidate,buyer:'Other Buyer',targetPrice:12};
 assert.equal(ui.model(mine,'season').reference.average,10);
 assert.equal(ui.model(other,'season').reference.average,(1000+2000+8000)/400,'buyers without a rule keep every country');
 assert.match(ui.model(mine,'season').detail,/Hariç ülkeler: .*EG.*MA/);
 assert.equal(ui.model(mine,'impact').impact.before,10);
 assert.equal(ui.footerSummaries([mine],['season']).get('season').weightedBefore,10);
 const report=await ui.detailReport(mine,'season');
 assert.deepEqual([...requests[0].excludedCountries],['EG','MA']);assert.deepEqual(report.rows.map(row=>row.orderCode),['DEMO-1']);
 const owned={id:3,...candidate,_collectionOwnerName:'Demo Buyer',targetPrice:12};
 assert.equal(ui.model(owned,'season').reference.average,10,'shared workspaces fall back to the owner name');
 const html=ui.drawer(mine);
 assert.match(html,/Ülke filtresi/);assert.match(html,/data-cpd-lfl-country="MA" checked/);assert.match(html,/data-cpd-lfl-country="CN"(?! checked)/);
 assert.equal(ui.setCountryRule('Demo Buyer',[]),true);
 assert.equal(JSON.parse(storage.get('lcw.koleksiyon.analytics.lflCountryRules.v1')).rules.length,0);
 assert.equal(ui.model(mine,'season').reference.average,(1000+2000+8000)/400);
 assert.equal(ui.setCountryRule('*',['CN']),true);
 assert.equal(ui.model(other,'season').reference.average,(2000+8000)/300,'the all-buyers default applies without a buyer rule');
 context.appLang='en';assert.match(ui.drawer(other),/Country filter/);assert.match(ui.model(other,'season').detail,/Excluded countries/);
});

test('saved schema-4 summaries stay available and upgrade only from the same complete source revision',async()=>{
 const os=require('node:os'),{createReferenceCache}=require('../server/lib/collection-lfl-reference');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'collection-lfl-country-'));let loads=0,rows=source;
 const args={identity:'legacy-user',version:'rev-1',loadRows:async()=>{loads++;return rows;}};
 const legacy=()=>{
  const file=path.join(directory,fs.readdirSync(directory).find(name=>name.endsWith('.json'))),saved=JSON.parse(fs.readFileSync(file,'utf8'));
  saved.schema=4;saved.references=saved.references.map(({byCountry,...item})=>item);fs.writeFileSync(file,JSON.stringify(saved));return saved;
 };
 try{
  await createReferenceCache({directory}).get(args);const old=legacy();
  rows=[];assert.deepEqual(await createReferenceCache({directory}).get(args),old,'an empty source never replaces saved legacy values');
  rows=source;assert.deepEqual(await createReferenceCache({directory}).get({...args,version:'rev-2'}),old,'a newer source still needs an explicit refresh');
  assert.deepEqual(await createReferenceCache({directory}).get({...args,loadRows:async()=>{throw new Error('unavailable');}}),old);
  rows=source;const upgraded=await createReferenceCache({directory}).get(args);
  assert.equal(upgraded.schema,5);assert.equal(upgraded.calculatedAt,old.calculatedAt);assert.ok(upgraded.references.every(item=>Array.isArray(item.byCountry)));
  assert.equal((await createReferenceCache({directory}).read(args)).schema,5);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('reference endpoint returns a saved legacy summary when its source cannot upgrade it',async()=>{
 const routes=new Map(),legacy={schema:4,version:'old',references:[{key:'k',average:1}]};let ready=false;
 require('../server/routes/lfl-routes')({get:(url,...handlers)=>routes.set(url,handlers),post(){}},{
  userAccess:{requireArea:()=>()=>{},publicProfile:user=>user,filterRowsByScope:(_user,rows)=>rows},sourceUserId:()=> 'owner',sourceFilterReadiness:()=>({ready}),
  cacheForUser:()=>({}),ensureDataLoaded:async()=>{},collectionLflCache:{read:async()=>legacy,get:async()=>{throw new Error('not expected');}},
  sendDateSafeJson:(res,data)=>res.json(data),apiError:(_res,error)=>{throw error;}});
 const handler=routes.get('/api/collection-lfl-reference').at(-1),invoke=async()=>{const res={code:200,set(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await handler({currentUser:{id:'u'},query:{}},res);return res;};
 let res=await invoke();assert.equal(res.code,200);assert.equal(res.data,legacy);
 ready=true;res=await invoke();assert.equal(res.code,200);assert.equal(res.data,legacy,'missing LFL runtime keeps the legacy summary');
});

test('legacy summaries without country sums are never presented as filtered',async()=>{
 const {ui,context}=harness({rules:[{buyer:'Demo Buyer',countries:['MA']}]});
 context.fetch=async()=>({ok:true,json:async()=>({version:'v0',references:Engine.buildReferences(source).map(({byCountry,...item})=>item)})});
 await ui.ensure();const row={id:9,...candidate,buyer:'Demo Buyer',targetPrice:12};
 assert.equal(ui.model(row,'season').reference.average,(1000+2000+8000)/400);
 assert.doesNotMatch(ui.model(row,'season').detail,/Hariç ülkeler/);
 assert.match(ui.drawer(row),/Referansları yenile düğmesini kullanın/);
});
