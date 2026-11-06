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

test('country codes are normalised once for rules and requests',()=>{
 assert.deepEqual(Engine.countryList(new Set([' ma ','',null,'EG','eg'])),['EG','MA']);
 assert.deepEqual(Engine.countryList('MA'),[]);
});

// The owner rule comes from app-main (owner workspace data); here a minimal owner map stands in.
function harness(owners={}){
 const requests=[],saves=[],state={mode:'single',ownerId:'buyer-a',canEdit:true,owners:Object.fromEntries(Object.entries(owners).map(([id,list])=>[id,[...list]]))};
 const names={'buyer-a':'Demo Buyer A','buyer-b':'Demo Buyer B'};
 const context={window:null,appLang:'tr',state:{currentUser:{id:'buyer-a'}},document:{body:{dataset:{activeTab:'overview'}}},BLCollectionLflEngine:Engine,BLCanonicalFields:require('../public/canonical-fields'),
  escapeHtml:value=>String(value).replace(/[&<>"']/g,'_'),kolFormatMoneyDisplay:value=>Number(value).toFixed(2),
  kolEffectiveValue:(row,key)=>row[key],kolSuppFob:row=>({price:Number(row.targetPrice),source:'target'}),
  kolLflCountryRuleFor:row=>{const ownerId=state.mode==='multi'?row._collectionOwnerId:state.ownerId;return {ownerId,ownerName:names[ownerId]||ownerId,countries:state.owners[ownerId]||[],canEdit:state.mode!=='multi'&&state.canEdit};},
  kolSetLflCountryExclusions:countries=>{if(state.mode==='multi'||!state.canEdit)return false;state.owners[state.ownerId]=[...countries];saves.push([...countries]);return true;},
  fetch:async(url,options)=>{
   const references=Engine.buildReferences(source);
   if(url.startsWith('/api/collection-lfl-reference'))return {ok:true,json:async()=>({version:'v1',references})};
   const body=JSON.parse(options.body);requests.push(body);
   const stored=references.find(ref=>ref.key===body.key);
   return {ok:true,json:async()=>({version:'v1',reference:Engine.excludeCountries(stored,body.excludedCountries),rows:Engine.referenceDetails(source,stored,body.excludedCountries)})};
  }};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/collection-lfl.js'),'utf8'),context);
 return {ui:context.BLCollectionLfl,context,state,requests,saves};
}
const ALL=(1000+2000+8000)/400;

test('cells, footer and details follow the row owner rule, not the viewer',async()=>{
 const {ui,context,state,requests}=harness({'buyer-a':['MA','EG']});await ui.ensure();
 const row={id:1,...candidate,targetPrice:12};
 assert.equal(ui.model(row,'season').reference.average,10);
 assert.match(ui.model(row,'season').detail,/Hariç ülkeler: .*EG.*MA/);
 assert.equal(ui.model(row,'impact').impact.before,10);
 assert.equal(ui.footerSummaries([row],['season']).get('season').weightedBefore,10);
 const report=await ui.detailReport(row,'season');
 assert.deepEqual([...requests[0].excludedCountries],['EG','MA']);assert.deepEqual(report.rows.map(item=>item.orderCode),['DEMO-1']);
 // Buyer A views buyer B's models: B's rule (none) applies, not A's own rule.
 state.mode='multi';
 const ofB={id:-1,...candidate,targetPrice:12,_collectionOwnerId:'buyer-b',_collectionOwnerName:'Demo Buyer B'},ofA={...ofB,id:-2,_collectionOwnerId:'buyer-a'};
 assert.equal(ui.model(ofB,'season').reference.average,ALL);
 assert.equal(ui.model(ofA,'season').reference.average,10);
 assert.equal(ui.footerSummaries([ofA,ofB],['season']).get('season').weightedBefore,(10*100+ALL*100)/200,'each row uses its owner rule');
 const html=ui.drawer(ofB);
 assert.match(html,/Buyer: Demo Buyer B/);assert.doesNotMatch(html,/data-cpd-lfl-country-add/,'another buyer rule is view-only');assert.match(html,/yalnız görüntülenir/);
 context.appLang='en';assert.match(ui.drawer(ofA),/Country filter/);assert.match(ui.model(ofA,'season').detail,/Excluded countries/);
});

test('drawer toggles countries in one collapsed checkbox list, including saved countries absent from the source',async()=>{
 const {ui,state,saves}=harness({'buyer-a':['MA','BD']});await ui.ensure();
 const row={id:1,...candidate,targetPrice:12};
 let html=ui.drawer(row);
 assert.match(html,/<details class="cpdCountryPicker">/);
 assert.doesNotMatch(html,/cpdCountryChip|country-add|country-remove|<select/);
 assert.match(html,/data-cpd-lfl-country="CN"/);
 assert.match(html,/data-cpd-lfl-country="MA" checked/);
 assert.match(html,/data-cpd-lfl-country="BD" checked/,'saved exclusions remain removable if absent from the source');
 const checkbox={dataset:{cpdLflCountry:'EG'},checked:true,closest:selector=>selector==='[data-cpd-lfl-country]'?checkbox:null};
 assert.equal(ui.onDrawerChange(checkbox,row),true);assert.deepEqual(saves.at(-1),['BD','EG','MA']);
 assert.equal(ui.model(row,'season').reference.average,10);
 checkbox.dataset.cpdLflCountry='MA';checkbox.checked=false;
 assert.equal(ui.onDrawerChange(checkbox,row),true);assert.deepEqual(saves.at(-1),['BD','EG']);
 checkbox.dataset.cpdLflCountry='BD';
 ui.onDrawerChange(checkbox,row);assert.deepEqual(saves.at(-1),['EG']);
 state.canEdit=false;html=ui.drawer(row);
 assert.match(html,/data-cpd-lfl-country="EG" checked disabled/);
 checkbox.checked=true;checkbox.dataset.cpdLflCountry='CN';
 assert.equal(ui.onDrawerChange(checkbox,row),true);assert.deepEqual(saves.at(-1),['EG'],'view-only access never writes');
});

test('owner workspace keeps the rule across full saves, row saves, structure changes and replication merges',async()=>{
 const os=require('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'collection-country-ws-'));
 const previous={server:process.env.BUYER_LOG_SERVER_DATA_ROOT,local:process.env.BUYER_LOG_LOCAL_DATA_ROOT,data:process.env.BUYER_LOG_DATA_ROOT};
 process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(root,'server');process.env.BUYER_LOG_LOCAL_DATA_ROOT=path.join(root,'local');process.env.BUYER_LOG_DATA_ROOT=path.join(root,'app');
 const clear=()=>Object.keys(require.cache).filter(key=>key.includes(`${path.sep}server${path.sep}`)).forEach(key=>delete require.cache[key]);
 clear();
 try{
  const store=require('../server/lib/collection-workspaces');
  let saved=store.saveWorkspace('demo-owner',{rows:[{id:1,modelKod:'DEMO'}],lflCountryExclusions:['eg','MA','bad code','MA']});
  assert.deepEqual(saved.lflCountryExclusions,['EG','MA']);
  saved=store.saveWorkspace('demo-owner',{rows:[{id:1,modelKod:'DEMO 2'}]});
  assert.deepEqual(saved.lflCountryExclusions,['EG','MA'],'an older full save without the field keeps the rule');
  saved=(await store.saveWorkspaceAsync('demo-owner',{rows:saved.rows})).saved;
  assert.deepEqual(saved.lflCountryExclusions,['EG','MA']);
  let result=await store.applyRowChangesAsync('demo-owner',{upserts:[{...saved.rows[0],modelKod:'DEMO 3'}]});
  assert.deepEqual(result.saved.lflCountryExclusions,['EG','MA'],'row edits keep the rule');
  const before=result.saved._revision;
  result=await store.applyRowChangesAsync('demo-owner',{structure:{lflCountryExclusions:['MA']}});
  assert.equal(result.changed,true);assert.equal(result.saved._revision,before+1);assert.equal(result.rowPatches,null,'viewers reload the owner structure');
  assert.deepEqual(store.loadWorkspace('demo-owner').lflCountryExclusions,['MA']);
  result=await store.applyRowChangesAsync('demo-owner',{structure:{manufacturers:['DEMO MFR']}});
  assert.deepEqual(result.saved.lflCountryExclusions,['MA'],'an older structure save without the field keeps the rule');
  assert.equal(store.diffWorkspaceRows({rows:[],lflCountryExclusions:[]},{rows:[],lflCountryExclusions:['MA']}),null);
  const {mergeCollectionWorkspaces:mergeWorkspaces}=require('../server/lib/collection-replication');
  {
   const base={rows:[],lflCountryExclusions:['MA']};
   assert.deepEqual(mergeWorkspaces(base,{rows:[],lflCountryExclusions:['EG','MA']},{rows:[],lflCountryExclusions:['MA']}).workspace.lflCountryExclusions,['EG','MA'],'local change wins over an unchanged remote');
   assert.deepEqual(mergeWorkspaces(base,{rows:[],lflCountryExclusions:['MA']},{rows:[],lflCountryExclusions:[]}).workspace.lflCountryExclusions,[],'remote change is adopted');
  }
 }finally{
  for(const [key,name] of [['server','BUYER_LOG_SERVER_DATA_ROOT'],['local','BUYER_LOG_LOCAL_DATA_ROOT'],['data','BUYER_LOG_DATA_ROOT']]){if(previous[key]==null)delete process.env[name];else process.env[name]=previous[key];}
  clear();fs.rmSync(root,{recursive:true,force:true});
 }
});

test('app-main persists the owner rule through every Collection structure path',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
 for(const pattern of [
  /function kolStructureSignature\(\)\{\s*return JSON\.stringify\(\{[^}]*lflCountryExclusions:kolLflCountryExclusions/,
  /change\.structure=\{[^}]*lflCountryExclusions:kolLflCountryExclusions/,
  /function kolWorkspacePayload\(\)\{return \{[^}]*lflCountryExclusions:kolLflCountryExclusions/,
  /statusCatalog:kolStatusEntries\(\),lflCountryExclusions:kolLflCountryExclusions\|\|\[\],nextId:kolNextId,\s*updatedAt/,
  /kolLflCountryExclusions=kolNormalizeLflCountryExclusions\(choose\('lflCountryExclusions'\)\)/,
  /kolLflCountryExclusions=kolNormalizeLflCountryExclusions\(choose\(localStructure\.lflCountryExclusions/,
  /kolLflCountryExclusions=kolNormalizeLflCountryExclusions\(workspace&&workspace\.lflCountryExclusions\)/,
  /kolLflCountryExclusionsByOwner\.set\(String\(owner\.id\|\|''\),kolNormalizeLflCountryExclusions\(workspace\.lflCountryExclusions\)\)/,
 ])assert.match(source,pattern);
 assert.match(source,/function kolLflCountryRuleFor\(row\)\{\s*if\(kolWorkspaceMode==='multi'\)\{[^\n]*canEdit:false\}/,'multi-buyer view is read-only and per owner');
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

test('every Collection baseline structure carries the country rule, so a save never leaves the workspace dirty',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
 const literal=[...source.matchAll(/structure(?:=|:)JSON\.stringify\(\{[^\n]*?\}\)/g)].map(match=>match[0]);
 assert.ok(literal.length>=2,'PATCH and PUT acknowledgement baselines are found');
 for(const text of literal)assert.match(text,/lflCountryExclusions:/,text.slice(0,120));
 // Key order must equal kolStructureSignature(), which the dirty check compares byte for byte.
 const keys=text=>[...text.matchAll(/(columns|manufacturers|statusCatalog|order|lflCountryExclusions):/g)].map(match=>match[1]);
 const signature=source.match(/function kolStructureSignature\(\)\{\s*return JSON\.stringify\(\{([^\n]*)\}\);/)[1];
 for(const text of literal)assert.deepEqual(keys(text),keys(signature));
});

test('a schema-4 upgrade keeps the saved values when the same-key source no longer reproduces them',async()=>{
 const os=require('node:os'),{createReferenceCache}=require('../server/lib/collection-lfl-reference');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'collection-lfl-upgrade-sum-'));
 const full=[order({orderCode:'A',fob:10}),order({orderCode:'B',fob:30})];let rows=full;
 const args={identity:'same-key-user',version:'rev-1',loadRows:async()=>rows};
 try{
  await createReferenceCache({directory}).get(args);
  const file=path.join(directory,fs.readdirSync(directory).find(name=>name.endsWith('.json'))),saved=JSON.parse(fs.readFileSync(file,'utf8'));
  saved.schema=4;saved.references=saved.references.map(({byCountry,...item})=>item);fs.writeFileSync(file,JSON.stringify(saved));
  rows=[full[0]];
  const kept=await createReferenceCache({directory}).get(args);
  assert.equal(kept.schema,4);assert.equal(kept.references.find(item=>!item.month&&!item.throughMonth).average,20);
  rows=full;assert.equal((await createReferenceCache({directory}).get(args)).schema,5,'a complete identical source upgrades');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});


test('returning country choices to the saved state clears the redundant draft without a server write',async()=>{
 const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
 const save=app.slice(app.indexOf('async function kolSaveWorkspaceNow'),app.indexOf('function kolQueueWorkspaceSave'));
 const cleared=[];
 const context={clearTimeout(){},kolWorkspaceSaveTimer:null,kolWorkspaceCanEdit:true,kolWorkspaceSaving:false,kolWorkspaceOwnerId:'buyer-a',kolWorkspacePending:true,kolWorkspaceRevision:3,
  kolCollectChanges:()=>({empty:true}),kolClearPendingWorkspace:owner=>cleared.push(owner)};
 vm.createContext(context);vm.runInContext(save,context);
 const result=await context.kolSaveWorkspaceNow();
 assert.equal(result.unchanged,true);assert.deepEqual(cleared,['buyer-a']);assert.equal(context.kolWorkspacePending,false);
 // An empty prepared subset cannot discard a draft for other unsaved changes.
 cleared.length=0;await context.kolSaveWorkspaceNow({preparedChange:{empty:true}});assert.deepEqual(cleared,[]);
});
