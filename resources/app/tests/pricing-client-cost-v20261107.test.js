'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.join(__dirname,'../public');
const source=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
function collectionContext(rows,extra={}){
 const src=source('quotations.js'),c={kolRows:rows,kolWorkspaceOwnerId:'a',kolWorkspaceMode:'multi',kolWorkspaceSharedMode:false,qNorm:v=>String(v??'').trim(),qLineOwnerId:line=>line.ownerId,window:{BLCollectionModelGroups:require('../public/collection-model-groups')},...extra};vm.createContext(c);vm.runInContext(src.slice(src.indexOf('  const qRowCollections='),src.indexOf('  /* Quotation satırı Koleksiyon')),c);return c;
}
const read=(c,fn)=>c.qWithCollectionRead?c.qWithCollectionRead(fn):fn();
test('CPR-05: one operation indexes each owner once and keeps first-match/owner/legacy semantics',()=>{
 let visits=0;const rows=Array.from({length:300},(_,i)=>({id:i+1,_collectionSourceId:i%150+1,get _collectionOwnerId(){visits++;return i<150?'a':'b';},_sourceOrderCode:'O'+i,modelGroupId:'g'+i,modelGroupRole:'parent',urunTipi:'C'+i}));
 const c=collectionContext(rows);read(c,()=>{for(let i=0;i<100;i++){assert.equal(c.qFindCollectionRow({ownerId:'a',rowId:5}),rows[4]);assert.equal(c.qFindCollectionRow({ownerId:'b',rowId:5}),rows[154]);}assert.equal(c.qFindCollectionRow({ownerId:'b',rowId:999,orderCode:'o155'}),rows[155]);assert.equal(c.qFindCollectionRow({ownerId:'missing',rowId:5}),null);});
 assert.ok(visits<=rows.length*3,`owner scans ${visits} should be bounded by owners, not lines`);
 rows[4]={...rows[4],_collectionSourceId:500};c.kolWorkspaceRevision=2;
 read(c,()=>{assert.equal(c.qFindCollectionRow({ownerId:'a',rowId:5}),null);assert.equal(c.qFindCollectionRow({ownerId:'a',rowId:500}),rows[4]);});
 c.kolWorkspaceMode='single';c.kolWorkspaceOwnerId='b';c.kolRows=[{id:5,urunTipi:'new'}];assert.equal(read(c,()=>c.qFindCollectionRow({ownerId:'b',rowId:5})),c.kolRows[0]);assert.equal(read(c,()=>c.qFindCollectionRow({ownerId:'a',rowId:5})),null);
});
test('CPR-05: grouped values use one parent index but see local parent/override changes on next operation',()=>{
 let scans=0;const rows=Array.from({length:100},(_,i)=>({id:i+1,_collectionSourceId:i+1,_collectionOwnerId:'a',get modelGroupId(){scans++;return 'g';},modelGroupRole:i?'variant':'parent',urunTipi:i?'variant':'parent'}));const c=collectionContext(rows);
 read(c,()=>{for(let i=1;i<50;i++){const row=c.qFindCollectionRow({ownerId:'a',rowId:i+1});assert.equal(c.qCollectionEffectiveValue(row,'urunTipi'),'parent');}});assert.ok(scans<300,`parent index scans: ${scans}`);
 rows[0].urunTipi='updated';rows[1].variantOverrides={urunTipi:''};read(c,()=>{assert.equal(c.qCollectionEffectiveValue(rows[2],'urunTipi'),'updated');assert.equal(c.qCollectionEffectiveValue(rows[1],'urunTipi'),'');});
});
test('CPR-06: scorecards read each price once, retaining tied wins and dropped/duplicate supplier rules',()=>{
 const E=require('../public/pricing-desk-engine');let reads=0;const items=Array.from({length:60},(_,i)=>({id:'l'+i,modelKey:'m'+Math.floor(i/3),manufacturer:'S'+i%3,get price(){reads++;return i%3===2?'':'9';},approved:i===0,dropped:i===4}));const req={items,manufacturers:[{name:'S0'},{name:'S1'},{name:'S2'}]};const out=E.supplierScorecards(req);assert.equal(out.find(x=>x.name==='S0').wins,20);assert.equal(out.find(x=>x.name==='S1').wins,19);assert.equal(out.find(x=>x.name==='S2').models,0);assert.ok(reads<=items.length,`price reads ${reads}`);
});
test('CPR-07: workspace search updates navigation without replacing active detail/editor',()=>{
 const src=source('quotations.js');assert.match(src,/search\?\.addEventListener\('input',\s*\(\)=>qRenderNav\(search\.value\)\)/);assert.doesNotMatch(src,/search\?\.addEventListener\('input',\(\)=>qRenderWorkspaceAll\(search\.value\)\)/);
});
test('CPR-07: precomputed status statistics avoid rescanning request items',()=>{
 const E=require('../public/pricing-workspace-engine');let reads=0;const req={status:'active',get items(){reads++;return [{modelKey:'m',price:'9',approved:true,manufacturer:'S'}];}};const stats=E.requestStats(req);reads=0;assert.equal(E.requestMatchesFilter(req,'approved',stats),true);assert.equal(E.requestMatchesFilter(req,'waiting-approval',stats),false);assert.equal(E.requestMatchesFilter(req,'active',stats),true);assert.equal(reads,0);
});
test('CPR-12: a line edit writes only its line amount and shares one FX snapshot',()=>{
 const src=source('open-costing.js'),start=src.indexOf('function updateCalculatedDom('),end=src.indexOf('\nfunction textInput',start),E=require('../public/open-costing-engine'),snapshot={base:'USD',dir:'per_base',rates:{EUR:.8}};
 const row={id:'edit',qty:'1,25',unitPrice:'3,50',currency:'EUR'},other={id:'other',qty:1,unitPrice:2,currency:'EUR'},current={meta:{currency:'USD',quantity:20},rates:{profitPct:10},sections:{fabric:[row,other]}};for(const k of E.SECTION_KEYS)current.sections[k]??=[];
 let fx=0;const writes=[],c={current,window:{BLOpenCostingEngine:E},SECTION_DEFS:E.SECTION_KEYS.map(key=>({key})),calculate:()=>E.calculateRecord(current,snapshot),calculateRecord:r=>E.calculateRecord(r,snapshot),fxSnapFor:()=>{fx++;return snapshot;},lineTotal:(r,rec,missing,snap)=>{if(!snap)fx++;return E.lineTotal(r,rec,missing,snap||snapshot);},money:String,n:E.parseLocalizedNumber,quantityText:String,setTextAll:(s,t)=>writes.push([s,t]),syncSummaryZeroVisibility(){},$:()=>null};vm.createContext(c);vm.runInContext(src.slice(start,end),c);c.updateCalculatedDom({section:'fabric',row});assert.deepEqual(writes.filter(([s])=>s.startsWith('[data-oc-line=')),[['[data-oc-line="edit"]','5.46875']]);assert.equal(fx,1);assert.deepEqual(current.summary,E.calculateRecord(current,snapshot));
});
test('CPR-06: scorecards equal the general analysis for sparse, tied, legacy and duplicate cells',()=>{
 const E=require('../public/pricing-desk-engine');let seed=7;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
 for(let run=0;run<40;run++){
  const items=Array.from({length:100},(_,i)=>({id:'l'+i,modelKey:['m1','m2',' m1','m2 ','','m3'][Math.floor(rand()*6)],manufacturer:['A','a',' B ','C',''][Math.floor(rand()*5)],price:['','9,50','9.5','28.5','0','3,1666666667'][Math.floor(rand()*6)],approved:rand()<.2,dropped:rand()<.1}));
  const req={items,manufacturers:[{name:'A'},{name:'B'},{name:'C'},{name:'No quote'}]},matrix=E.requestMatrix(req),observations=matrix.models.flatMap(model=>model.lines.filter(line=>!line.dropped&&E.price(line.price)!=null).map(line=>({identityKey:model.modelKey,manufacturer:line.manufacturer,value:E.price(line.price),approved:!!line.approved}))),analyzed=new Map(E.analyze(observations).suppliers.map(s=>[s.key,s]));
  const expected=matrix.manufacturers.map(name=>{const s=analyzed.get(E.keyOf(name));return {key:E.keyOf(name),name,total:matrix.models.length,models:s?.models||0,wins:s?.modelWins||0,approved:s?.approved||0,modelIndex:s?.modelIndex??null};}).sort(E.compareSuppliers);
  assert.deepEqual(E.supplierScorecards(req),expected);
 }
});
