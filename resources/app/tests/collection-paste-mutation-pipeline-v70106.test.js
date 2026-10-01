'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Groups=require('../public/collection-model-groups.js');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');

function between(source,startText,endText){
  const start=source.indexOf(startText),end=source.indexOf(endText,start+startText.length);
  assert.ok(start>=0&&end>start,`missing block ${startText}`);
  return source.slice(start,end);
}

test('manual editors, pricing editors and clipboard batch share one Collection cell-change dispatcher',()=>{
  const dispatcher=between(APP,'function kolApplyCollectionCellChange(','const KOL_VARIANT_FIELDS');
  assert.match(dispatcher,/key\.startsWith\('pricing:'\)/);
  assert.match(dispatcher,/return commitKolPriceEditor\(priceEditor,options\)/);
  assert.match(dispatcher,/return commitKolEditor\(cellEditor,options\)/);

  const render=between(APP,'function renderKol(){','function kolSpreadsheetFormulaInfo');
  assert.match(render,/kolApplyCollectionCellChange\(\{rowId:Number\(el\.dataset\.id\),key:el\.dataset\.k,editor:el,source:'manual'\}/);
  assert.match(render,/key:\`pricing:\$\{el\.dataset\.mfr\}\`/);

  const dateEditor=between(APP,'function enterKolDateEdit(','// Koleksiyon tablosu: öneri açılır listeleri');
  assert.match(dateEditor,/kolApplyCollectionCellChange\(\{rowId:id,key,editor:input,source:'manual'\}/);

  const batch=between(APP,'function kolSpreadsheetBatchEdit(','function kolSpreadsheetSetColumnWidth');
  assert.match(batch,/kolApplyCollectionCellChange\(\{rowId:op\.rowId,key,value:op\.value,source:mutationSource\}/);
  assert.match(batch,/deferDependencies:true/);
});

test('period picker enters the same batch pipeline used by clipboard paste',()=>{
  const period=between(APP,'function kolApplyInStoreSchedule(row,schedule){','let _kolPeriodDrawer');
  assert.match(period,/kolSpreadsheetBatchEdit\(\[/);
  assert.match(period,/key:'inStoreWeek'/);
  assert.match(period,/key:'inStoreMonth'/);
  assert.match(period,/key:'inStore'/);
  assert.match(period,/\{source:'picker'\}/);
});

test('period paste is normalized and cannot bypass the picker linked-field ownership rule',()=>{
  const validate=between(APP,'function kolSpreadsheetValidateValue(','function kolSpreadsheetMakeEditor');
  assert.match(validate,/c\?\.inStorePeriod&&\['inStoreWeek','inStoreMonth','inStore'\]\.some\(periodKey=>kolCellLinkedToModel\(row,periodKey\)\)/);
  assert.match(validate,/c\?\.inStorePeriod==='month'[\s\S]*?kolScheduleFromMonthCode\(raw\)[\s\S]*?kolMonthDisplay\(schedule\.inStoreMonth\)/);
  assert.match(validate,/c\?\.inStorePeriod==='week'[\s\S]*?kolScheduleFromWeekCode\(raw\)[\s\S]*?value=schedule\.inStoreWeek/);
});

test('multi-cell paste applies explicit values first, recomputes dependencies after, and preserves explicit Retail',()=>{
  const batch=between(APP,'function kolSpreadsheetBatchEdit(','function kolSpreadsheetSetColumnWidth');
  assert.match(batch,/const explicitByRow=new Map\(\),periodByRow=new Map\(\)/);
  assert.ok(batch.indexOf('for(const op of validated)')<batch.indexOf('for(const info of periodByRow.values())'),'dependency pass must run after explicit writes');
  assert.match(batch,/preserve=explicitByRow\.get\(rowId\)\|\|new Set\(\)/);
  assert.match(batch,/kolApplyInStoreScheduleFields\(row,schedule,\{preserveKeys:preserve,applyRetail:true\}\)/);
  assert.match(batch,/preserve\.has\('inStore'\)&&!preserve\.has\('retail'\)/);
  assert.doesNotMatch(batch,/shipment|sevk/i,'paste dependency transaction must never auto-fill Shipment Date');
});

test('period helper makes manual Month and pasted Month converge to the same final date state',()=>{
  const source=between(APP,'function kolApplyInStoreScheduleFields(','function kolApplyInStoreSchedule(row,schedule){').trim();
  const factory=new Function('deps',`
    let kolRows=deps.kolRows;
    const kolCellLinkedToModel=deps.kolCellLinkedToModel;
    const kolEffectiveValue=deps.kolEffectiveValue;
    const kolSetModelSharedField=deps.kolSetModelSharedField;
    const editableValuesEqual=deps.editableValuesEqual;
    const kolMonthDisplay=deps.kolMonthDisplay;
    const toISODate=deps.toISODate;
    const kolApplyInStoreRetailDependency=deps.kolApplyInStoreRetailDependency;
    ${source}
    return kolApplyInStoreScheduleFields;
  `);

  const run=(initial,schedule,preserve)=>{
    const row={...initial},kolRows=[row];
    const helper=factory({
      kolRows,
      kolCellLinkedToModel:()=>false,
      kolEffectiveValue:(r,k)=>r[k]??'',
      kolSetModelSharedField:(r,k,v)=>{r[k]=v;return r;},
      editableValuesEqual:(a,b)=>String(a??'')===String(b??''),
      kolMonthDisplay:v=>String(v)==='202705'?'May 2027':String(v||''),
      toISODate:v=>String(v||''),
      kolApplyInStoreRetailDependency:(r,iso)=>{
        const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-14);
        r.retail=d.toISOString().slice(0,10);return true;
      },
    });
    helper(row,schedule,{preserveKeys:preserve,applyRetail:true});
    return row;
  };

  const initial={inStoreMonth:'',inStoreWeek:'',inStore:'',retail:'',shipmentDate:'KEEP'};
  const schedule={inStoreMonth:'202705',inStoreWeek:'2027-17',inStore:'2027-04-26'};

  const manualResult=run(initial,schedule,new Set());
  const pastedInitial={...initial,inStoreMonth:'May 2027'};
  const pasteResult=run(pastedInitial,schedule,new Set(['inStoreMonth']));

  const businessRelevant=row=>({
    inStoreMonth:row.inStoreMonth,
    inStoreWeek:row.inStoreWeek,
    inStore:row.inStore,
    retail:row.retail,
    shipmentDate:row.shipmentDate,
  });
  assert.deepEqual(businessRelevant(pasteResult),businessRelevant(manualResult));
  assert.equal(pasteResult.retail,'2027-04-12');
  assert.equal(pasteResult.shipmentDate,'KEEP');
});

test('explicit multi-column Retail wins over period recomputation',()=>{
  const helper=between(APP,'function kolApplyInStoreScheduleFields(','function kolApplyInStoreSchedule(row,schedule){');
  assert.match(helper,/!preserve\.has\('retail'\)/);
  const batch=between(APP,'function kolSpreadsheetBatchEdit(','function kolSpreadsheetSetColumnWidth');
  assert.match(batch,/explicitByRow\.get\(rowId\)/);
  assert.match(batch,/preserve\.has\('inStore'\)&&!preserve\.has\('retail'\)/);
});

test('pricing paste uses the exact manual price commit path so FOB/rule pricing is recomputed',()=>{
  const dispatcher=between(APP,'function kolApplyCollectionCellChange(','const KOL_VARIANT_FIELDS');
  assert.match(dispatcher,/key\.startsWith\('pricing:'\)/);
  assert.match(dispatcher,/commitKolPriceEditor\(priceEditor,options\)/);
  const priceCommit=between(APP,'function commitKolPriceEditor(','function kolHasActiveTableFilters');
  assert.match(priceCommit,/kolApplyRulePricing\(row\)/);
  assert.match(priceCommit,/setSharedValue\(kolRows,row\.modelGroupId,'pricing',nextPricing\)/);
  assert.match(priceCommit,/setVariantOverride\(kolRows,row\.id,'pricing',nextPricing\)/);
});

test('bind/inheritance state remains identical for manual and paste because both use canonical grouped storage',()=>{
  const base=Groups.normalizeRows([
    {id:1,plmId:'P1',modelKod:'M1',inStoreMonth:'May 2027',colour:'BLACK',colourCode:'BLK',quantity:'10',fabric:'Cotton',targetPrice:'10'},
    {id:2,plmId:'P1',modelKod:'M1',inStoreMonth:'May 2027',colour:'GREY',colourCode:'GRY',quantity:'10',fabric:'Cotton',targetPrice:'10'},
  ]).rows;
  const parent=base.find(r=>r.modelGroupRole==='parent')||base[0];
  const variant=base.find(r=>r.modelGroupRole==='variant')||base[1];
  assert.ok(parent&&variant&&parent.modelGroupId===variant.modelGroupId,'test fixture must form one model group');

  let withOverride=Groups.setVariantOverride(base,variant.id,'fabric','Viscose');
  const applyCanonical=rows=>Groups.setSharedValue(rows,parent.modelGroupId,'fabric','Linen');
  const manualResult=applyCanonical(JSON.parse(JSON.stringify(withOverride)));
  const pasteResult=applyCanonical(JSON.parse(JSON.stringify(withOverride)));

  const view=rows=>rows.map(r=>({
    id:r.id,
    fabric:Groups.effectiveValue(r,'fabric',rows),
    overrides:r.variantOverrides||{},
  }));
  assert.deepEqual(view(pasteResult),view(manualResult));
  assert.equal(Groups.effectiveValue(pasteResult.find(r=>r.id===variant.id),'fabric',pasteResult),'Viscose');
});

test('batch transaction still has one undo, one persistence cycle and one final render on success',()=>{
  const batch=between(APP,'function kolSpreadsheetBatchEdit(','function kolSpreadsheetSetColumnWidth');
  assert.equal((batch.match(/kolPushUndo\(\)/g)||[]).length,1);
  assert.equal((batch.match(/saveKolRows\(\)/g)||[]).length,1);
  assert.equal((batch.match(/renderKol\(\)/g)||[]).length,2,'success + rollback only');
  assert.match(batch,/pushUndo:false,save:false,syncQuotations:false,deferDependencies:true/);
  assert.match(batch,/kolRows=before/);
});

test('hidden In Store column stays writable so a picked week moves the In Store date',()=>{
  // Regression: görünümde In Store sütunu gizliyken hafta seçimi tarihi
  // güncellemiyordu. Gizli sütun descriptor kataloğunda olmadığı için meta
  // editable:false dönüyor, inStore yazımı düşüyor ve ay sürücüsü tarihi
  // ayın ilk haftasına (örn. 26.04.27) geri çekiyordu.
  const source=between(APP,'function kolFieldDescriptorByKey(key){','function kolWeightedAverage(').trim()+'\n'+between(APP,'function kolSpreadsheetColumnMeta(key){','function kolSpreadsheetRawValue(').trim();
  const col={k:'inStore',label:'In Store',date:true};
  const meta=new Function('deps',`
    const L=v=>v,KOL_LANDED_INPUT_COLS={},kolHiddenCols=new Set(['inStore']);
    const kolAllOrderedCols=()=>[deps.col];
    const kolColumnLabel=c=>c.label;
    const kolDescriptorCatalog=()=>new Map();
    const kolDescriptorByKey=key=>kolDescriptorCatalog().get(key)||{kind:'synthetic',k:key,label:key};
    const kolSpreadsheetFormulaInfo=()=>'';
    const kolFieldMetadata=()=>({inheritance:'model'});
    ${source}
    return kolSpreadsheetColumnMeta;
  `)({col});
  const result=meta('inStore');
  assert.equal(result.editable,true);
  assert.equal(result.type,'date');
  assert.equal(result.col,col);
});

test('write-side Collection lookups resolve hidden columns; only rendering follows visibility',()=>{
  const spec=between(APP,'function kolColourOverrideSpec(key){','function kolCellLinkedToModel(');
  assert.match(spec,/kolFieldDescriptorByKey\(visibleKey\)/);
  assert.doesNotMatch(spec,/kolDescriptorByKey\(/);
  const meta=between(APP,'function kolSpreadsheetColumnMeta(key){','function kolSpreadsheetRawValue(');
  assert.match(meta,/kolFieldDescriptorByKey\(key\)/);
  assert.doesNotMatch(meta,/kolDescriptorByKey\(/);
  const formula=between(APP,'function kolSpreadsheetFormulaInfo(key){','function kolSpreadsheetColumnMeta(key){');
  assert.match(formula,/kolFieldDescriptorByKey\(key\)/);
});
