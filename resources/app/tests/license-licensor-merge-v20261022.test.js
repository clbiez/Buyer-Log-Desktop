'use strict';
// Licensor name merges (one row, royalty works for both spellings), imported Supp. FOB
// following the current contract automatically, and approval-map copy/paste from the list.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const B=require('../public/business-rules'),E=require('../public/license-cards-engine'),parse=require('../server/lib/parse');
const cards=require('../server/lib/license-cards'),sync=require('../server/lib/license-card-sync'),policy=require('../server/lib/shared-sync-policy');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('licensor names that differ only by company/country suffix share one merge key', () => {
  for(const [a,b] of [['ERMODA','ERMODA UK LTD'],['Ermoda','ermoda uk ltd.'],['LCW','LCW A.Ş.'],['Demo Rights','Demo Rights GmbH']])assert.equal(B.licensorMergeKey(a),B.licensorMergeKey(b),`${a} ≡ ${b}`);
  for(const [a,b] of [['Warner Bros','Warner Bros Consumer Products'],['DTR','Disney'],['ERMODA','ERMODA STUDIO']])assert.notEqual(B.licensorMergeKey(a),B.licensorMergeKey(b),`${a} ≠ ${b}`);
  assert.equal(B.licensorsMerged('ERMODA','ERMODA UK LTD',{split:[]}),true);
  assert.equal(B.licensorsMerged('ERMODA','ERMODA UK LTD',{split:['ERMODA']}),false,'a split merge stays separate');
  assert.equal(B.licensorsMerged('ERMODA','ERMODA UK LTD',{entries:{ERMODA:{split:true}}}),false,'stored shape is understood too');
});

test('royalty: the order’s own licensor contract first, the merged name only as fallback', () => {
  const own={id:'own',license:'Naruto',licensor:'ERMODA UK LTD',royalty:12,trCommission:5},merged={id:'merged',license:'Naruto',licensor:'ERMODA',royalty:14,trCommission:5};
  const any=()=>true;
  assert.equal(B.findRuleByLicensor([merged,own],'ERMODA UK LTD',any,{split:[]}).id,'own');
  assert.equal(B.findRuleByLicensor([merged],'ERMODA UK LTD',any,{split:[]}).id,'merged');
  assert.equal(B.findRuleByLicensor([merged],'ERMODA UK LTD',any,{split:['ERMODA']}),null,'split → no fallback, the missing contract stays visible');
});

const order=(ocode,licensor)=>({ocode,model:'Model',ccode:'RED',license:'Naruto',licensor,manufacturer:'Factory',countryRaw:'TURKIYE',season:'AW26',qty:100,kalan:100,fob:10,opd:new Date(2026,5,1),ex:new Date(2026,11,1),mb:new Date(2027,0,1)});
const rule={id:'naruto',license:'Naruto',licensor:'ERMODA',opdStart:'2026-03-13',opdEnd:'',seasons:[],royalty:14,trCommission:5,ydCommission:9,hologramCost:0};
test('server CP/Orders: a merged licensor spelling gets the contract; split removes it', () => {
  for(const build of [parse.buildCPRowsFromASAS,parse.buildOrdersRowsFromASAS]){
    const rows=build([order(1,'ERMODA UK LTD')],{},{pricingRules:[rule]});
    assert.equal(rows[0]['Supp. FOB'],B.calculateSuppFobWithRule(10,rule,'TR'));
    const split=build([order(1,'ERMODA UK LTD')],{},{pricingRules:[rule],licensorMerges:{entries:{ERMODA:{split:true,at:'2026-10-22'}}}});
    assert.equal(split[0]['Supp. FOB'],null);
  }
});

test('server: imported (CP update) Supp. FOB follows the current contract; a deliberate manual price stays', () => {
  const expected=B.calculateSuppFobWithRule(10,rule,'TR');
  for(const build of [parse.buildCPRowsFromASAS,parse.buildOrdersRowsFromASAS]){
    const imported=build([order(1,'ERMODA')],{},{pricingRules:[rule],suppfobmap:{'1':7},suppfobmetamap:{'1':{source:'manual',origin:'cpupdate'}}});
    assert.equal(imported[0]['Supp. FOB'],expected);assert.equal(imported[0]._suppFobManual,false);
    const legacy=build([order(1,'ERMODA')],{},{pricingRules:[rule],suppfobmap:{'1':7}});
    assert.equal(legacy[0]['Supp. FOB'],expected,'a value stored without a source is not a deliberate price');
    const noRule=build([order(1,'ERMODA')],{},{pricingRules:[],suppfobmap:{'1':7},suppfobmetamap:{'1':{source:'manual',origin:'cpupdate'}}});
    assert.equal(noRule[0]['Supp. FOB'],7,'without a contract the imported value stays');
    const manual=build([order(1,'ERMODA')],{},{pricingRules:[rule],suppfobmap:{'1':7},suppfobmetamap:{'1':{source:'manual'}}});
    assert.equal(manual[0]['Supp. FOB'],7,'a deliberate manual price is never overwritten');
  }
});

test('client: imported Supp. FOB is recalculated from the current rule in every loaded view', () => {
  const src=read('public/app-main.js'),start=src.indexOf('function importedSuppFob(row)'),end=src.indexOf('function applyLicensorRulesToLoadedRows()');
  const ctx={state:{overrides:{suppfobmap:{'1':7},suppfobmetamap:{'1':{source:'manual',origin:'cpupdate'}}}},normalizeSuppFobMeta:m=>m&&typeof m==='object'?{...m}:null,lineKeyOfRow:()=>'',
    hasManualSuppFob:()=>true,editableValuesEqual:(a,b)=>a===b,turknorm:v=>String(v||'').toUpperCase(),toNum:Number,automaticSuppFobRuleMeta:r=>r?{source:'rule',ruleId:r.id}:null,priced:{value:9.1,rule:{id:'r'}}};
  ctx.calculateSuppFobFromRule=()=>ctx.priced;vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
  const row={'Order Code':'1','Supp. FOB':7,_suppFobMeta:{source:'manual',origin:'cpupdate'},Licensor:'ERMODA'};
  assert.equal(ctx.recalcSuppFobForRow(row),true);assert.equal(row['Supp. FOB'],9.1);assert.equal(row._suppFobMeta.source,'rule');
  ctx.priced={value:null,rule:null};assert.equal(ctx.recalcSuppFobForRow(row),true);assert.equal(row['Supp. FOB'],7,'contract gone → imported value back');
  const typed={'Order Code':'1','Supp. FOB':8,_suppFobMeta:{source:'manual'},Licensor:'ERMODA'};ctx.priced={value:9.1,rule:{id:'r'}};
  assert.equal(ctx.recalcSuppFobForRow(typed),false);assert.equal(typed['Supp. FOB'],8,'a value typed in this session stays');
});

test('license list: merged spellings show as one row with the richest card; split shows both', () => {
  const list=[{id:'a',license:'Real Madrid',licensor:'ERMODA UK LTD',rules:[]},{id:'b',license:'Real Madrid',licensor:'ERMODA',rules:[{id:'r',royalty:15,trCommission:5,opdStart:'2026-03-13'}],processAtlas:{license:{stages:[{id:'s'}]}}},{id:'c',license:'Other',licensor:'ERMODA UK LTD',rules:[]}];
  const opts={mergeKey:B.licensorMergeKey,merges:{split:[]}},rows=E.rows(list,opts);
  assert.deepEqual(rows.map(r=>[r.license,r.licensor,r.merged.map(m=>m.id)]),[['Other','ERMODA UK LTD',[]],['Real Madrid','ERMODA',['a']]]);
  assert.equal(E.rows(list,{...opts,licensor:'ERMODA UK LTD'}).length,2,'filtering by the merged spelling still finds the row');
  assert.equal(E.rows(list,{...opts,merges:{split:['ERMODA']}}).length,3);
  assert.deepEqual(E.mergeSummary(list,opts),[{key:'ERMODA',names:['ERMODA','ERMODA UK LTD'],licenses:['Other','Real Madrid'],split:false}]);
});

test('merge decisions: stored per key, bump pricing revision, sync newest-wins over the peer policy', () => {
  const base={_revision:0,_revisions:{licenseCards:2,pricingRules:5}};
  const r=cards.setLicensorMerge(base,{key:'ERMODA UK LTD',split:true},'2026-10-22T10:00:00Z');
  assert.deepEqual(r.licensorMerges.split,['ERMODA']);assert.equal(r.overrides._revisions.pricingRules,6);
  assert.throws(()=>cards.setLicensorMerge(base,{key:'',split:true}),{code:'LICENSE_MERGE_INVALID'});
  assert.equal(cards.responseOf(r.overrides,true).licensorMerges.split[0],'ERMODA');
  const staged=sync.stageChange(r.overrides,{cards:[],licensorMerges:cards.licensorMergesOf(r.overrides)});
  assert.equal(staged.licenseCardOutbox[sync.MERGES_ID].fields.merges.entries.ERMODA.split,true);
  assert.deepEqual(Object.keys(policy.sanitizeDelta({id:'license-card:licensor-merges',patch:{merges:{entries:{}},pricingRules:[]}}).patch),['merges']);
  const peer=sync.applyRecords(base,{[sync.MERGES_ID]:{merges:{entries:{ERMODA:{split:true,at:'2026-10-22T10:00:00Z'}}}}},{});
  assert.equal(peer.rulesChanged,true);assert.deepEqual(cards.licensorMergesOf(peer.overrides).split,['ERMODA']);
  const older=sync.applyRecords(peer.overrides,{[sync.MERGES_ID]:{merges:{entries:{ERMODA:{split:false,at:'2026-10-21T10:00:00Z'}}}}},{});
  assert.equal(older.changed,false,'an older decision never wins');
});

test('map paste from the list: steps travel, the target keeps its identity, image, portal and notes', () => {
  const source={version:1,license:{id:'s',name:'Real Madrid',stages:[{id:'st',title:'PPS',submissions:[{id:'r',addressId:'a1',timing:'Kargo'}],visualGuideId:'g'}],addresses:[{id:'a1',label:'UK',text:'x'},{id:'unused',label:'U',text:'y'}],portal:{url:'https://src',notes:''},cover:'data:src',internalNotes:'SRC'},visualLibrary:[{id:'g',name:'g',data:'data:g'},{id:'other',name:'o',data:'data:o'}],customSelectOptions:{timing:[{value:'Kargo',label:'Kargo'}]}};
  const target={id:'t',license:'Naruto',licensor:'ERMODA',processAtlas:{version:1,license:{id:'t',name:'Naruto',stages:[{id:'old'}],addresses:[{id:'mine',label:'M',text:'z'}],portal:{url:'https://own',notes:''},cover:'data:own',internalNotes:'OWN'},visualLibrary:[],customSelectOptions:{timing:[{value:'Mine',label:'Mine'}]}}};
  const out=E.pasteMap(source,target);
  assert.deepEqual(out.license.stages.map(s=>s.title),['PPS']);
  assert.deepEqual([out.license.id,out.license.name,out.license.agency,out.license.cover,out.license.portal.url,out.license.internalNotes],['t','Naruto','ERMODA','data:own','https://own','OWN']);
  assert.deepEqual(out.license.addresses.map(a=>a.id),['mine','a1']);assert.deepEqual(out.visualLibrary.map(v=>v.id),['g']);
  assert.deepEqual(out.customSelectOptions.timing.map(o=>o.value),['Mine','Kargo']);
  const blank=E.pasteMap(source,{id:'n',license:'New',licensor:'X'});assert.equal(blank.license.cover,'');assert.equal(blank.license.stages.length,1);
});

test('client wiring: list copy/paste, merge panel and split route', () => {
  const src=read('public/license-cards.js'),routes=read('server/routes/license-card-routes.js');
  for(const act of ['copyMap','pasteMap','pasteSelected','mergeSplit','mergeJoin','merges'])assert.ok(src.includes(`a==='${act}'`),act);
  assert.match(src,/E\.pasteMap\(clip\.atlas,current\)/);assert.match(src,/'\/api\/license-cards\/licensor-merges',\{method:'PUT'/);
  assert.match(routes,/app\.put\('\/api\/license-cards\/licensor-merges'/);
  assert.ok(routes.indexOf("'/api/license-cards/licensor-merges'")<routes.indexOf("app.put('/api/license-cards/:id'"));
});

test('review fixes: suffix-only key, own contract blocks the merged fallback, imported values are not re-sent as manual', () => {
  assert.equal(B.licensorMergeKey('AS ROMA'),'AS ROMA','a leading token is not a suffix');
  const own2025={id:'own',license:'Naruto',licensor:'ERMODA UK LTD',opdStart:'2025-01-01',opdEnd:'2025-12-31',seasons:[],royalty:12,trCommission:5,ydCommission:9},merged2026={...rule,id:'m'};
  for(const build of [parse.buildCPRowsFromASAS,parse.buildOrdersRowsFromASAS]){
    const rows=build([order(1,'ERMODA UK LTD')],{},{pricingRules:[own2025,merged2026]});
    assert.equal(rows[0]['Supp. FOB'],null,'its own (expired) contract exists → no silent fallback, the gap stays visible');
    const imported=build([order(1,'ERMODA')],{},{pricingRules:[],suppfobmap:{'1':7},suppfobmetamap:{'1':{source:'manual',origin:'cpupdate'}}});
    assert.deepEqual(imported[0]._suppFobImported,{value:7,meta:{source:'manual',origin:'cpupdate'}});
  }
  const src=read('public/app-main.js');
  assert.match(src,/if\(row\._suppFobManual===true&&!importedSuppFob\(row\)\)\{\n\s*body\.suppFob=/);
  assert.match(src,/if\(row\._suppFobManual===true&&!importedSuppFob\(row\)\)\{\n\s*state\.overrides\.suppfobmap\[key\]=/);
  const shared={version:1,license:{stages:[{id:'s',submissions:[{id:'r',addressId:'sh'}]}],addresses:[]},sharedAddresses:[{id:'sh',label:'Shared',text:'t'}],visualLibrary:[]};
  assert.deepEqual(E.pasteMap(shared,{id:'t',license:'L',licensor:'X'}).license.addresses.map(a=>a.id),['sh'],'routed shared addresses travel');
});
