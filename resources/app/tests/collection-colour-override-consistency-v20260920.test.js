'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Groups = require('../public/collection-model-groups.js');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const SHEET = fs.readFileSync(path.join(ROOT, 'public', 'collection-spreadsheet.js'), 'utf8');

function between(source,startText,endText){
  const start=source.indexOf(startText),end=source.indexOf(endText,start+startText.length);
  assert.ok(start>=0&&end>start,`missing block ${startText}`);
  return source.slice(start,end);
}

function groupedRows(){
  return Groups.normalizeRows([
    {id:1,plmId:'10',modelKod:'DRYTOUCH-1',inStoreMonth:'2026-10',colour:'NEW BLACK',colourCode:'BLK',quantity:'5000',fabric:'100% Cotton',not:'A',targetPrice:'100'},
    {id:2,plmId:'10',modelKod:'DRYTOUCH-1',inStoreMonth:'2026-10',colour:'GREY',colourCode:'GRY',quantity:'5000',fabric:'100% Cotton',not:'A',targetPrice:'100'},
  ]).rows;
}

test('explicit override existence beats model inheritance even for falsy values',()=>{
  for(const value of ['',0,false,null]){
    let rows=groupedRows();
    const variant=rows.find(r=>r.modelGroupRole==='variant');
    rows=Groups.setVariantOverride(rows,variant.id,'fabric',value);
    const next=rows.find(r=>r.id===variant.id);
    assert.equal(Groups.hasVariantOverride(next,'fabric'),true);
    assert.strictEqual(Groups.effectiveValue(next,'fabric',rows),value);
    rows=Groups.setSharedValue(rows,next.modelGroupId,'fabric','80% Cotton');
    assert.strictEqual(Groups.effectiveValue(rows.find(r=>r.id===variant.id),'fabric',rows),value,'parent propagation must not overwrite explicit falsy override');
  }
});

test('generic text/notes/price overrides survive parent edits and remain field-scoped',()=>{
  let rows=groupedRows();
  const parent=rows.find(r=>r.modelGroupRole==='parent');
  const variant=rows.find(r=>r.modelGroupRole==='variant');
  rows=Groups.setSharedValue(rows,parent.modelGroupId,'fabric','100% Cotton');
  rows=Groups.setSharedValue(rows,parent.modelGroupId,'not','A');
  rows=Groups.setSharedValue(rows,parent.modelGroupId,'targetPrice','100');
  rows=Groups.setVariantOverride(rows,variant.id,'fabric','95% Cotton 5% Elastane');
  rows=Groups.setVariantOverride(rows,variant.id,'not','Grey note');
  rows=Groups.setVariantOverride(rows,variant.id,'targetPrice','110');
  rows=Groups.setSharedValue(rows,parent.modelGroupId,'fabric','80% Cotton');
  rows=Groups.setSharedValue(rows,parent.modelGroupId,'not','Parent B');
  rows=Groups.setSharedValue(rows,parent.modelGroupId,'targetPrice','120');
  const child=rows.find(r=>r.id===variant.id);
  assert.equal(Groups.effectiveValue(child,'fabric',rows),'95% Cotton 5% Elastane');
  assert.equal(Groups.effectiveValue(child,'not',rows),'Grey note');
  assert.equal(Groups.effectiveValue(child,'targetPrice',rows),'110');
  assert.equal(Groups.effectiveValue(child,'quantity',rows),'5000');
  assert.deepEqual(Object.keys(child.variantOverrides).sort(),['fabric','not','targetPrice']);
});

test('inline and period/custom writes use one grouped write source of truth',()=>{
  const commit=between(APP,'function commitKolEditor(','function commitKolPriceEditor(');
  const period=between(APP,'function kolSetModelSharedField(','function kolApplyInStoreSchedule(');
  const writer=between(APP,'function kolWriteGroupedStorageValue(','function kolEffectivePricing(');
  assert.match(commit,/row=kolWriteGroupedStorageValue\(row,k,val\)/);
  assert.doesNotMatch(commit,/else\{[\s\S]{0,160}row\[k\]\s*=\s*val/,'generic editor must not bypass override storage');
  assert.match(period,/return kolWriteGroupedStorageValue\(row,key,value\)/);
  assert.match(writer,/if\(grouped&&overridden\)[\s\S]*?api\.setVariantOverride/);
  assert.match(writer,/else if\(grouped&&row\.modelGroupRole==='parent'\)[\s\S]*?api\.setSharedValue/);
});

test('manufacturer price projection joins the same persisted pricing override',()=>{
  const spec=between(APP,'function kolColourOverrideSpec(key){','function kolColourOverrideStorageKeys(');
  assert.match(spec,/visibleKey\.startsWith\('pricing:'\)/);
  assert.match(spec,/storageKeys:\['pricing'\]/);
  const priceCommit=between(APP,'function commitKolPriceEditor(','function kolHasActiveTableFilters(');
  assert.match(priceCommit,/kolCellLinkedToModel\(row,`pricing:\$\{m\}`\)/,'linked price must require explicit colour-specific action');
  assert.match(priceCommit,/setVariantOverride\(kolRows,row\.id,'pricing',nextPricing\)/);
});

test('Endeksmatik and custom/formatted cells remain metadata-driven override candidates',()=>{
  const spec=between(APP,'function kolColourOverrideSpec(key){','function kolColourOverrideStorageKeys(');
  assert.match(APP,/endeksmatik:\['endeksmatikData'\]/);
  assert.match(spec,/const descriptor=kolDescriptorByKey\(visibleKey\)/);
  assert.match(spec,/descriptor\.kind!=='base'/);
  assert.match(spec,/KOL_COLOUR_OVERRIDE_PROJECTION_KEYS\[column\.k\]\|\|\[column\.k\]/);
});

test('right-click is one delegated grid path and linked native editors pass pointer to td',()=>{
  assert.match(SHEET,/function collectionDataCellFromEvent\(event\)/);
  assert.match(SHEET,/target\?\.closest\?\.\('#kolTable tbody td\[data-key\]'\)/);
  assert.match(SHEET,/table\.addEventListener\('contextmenu',[\s\S]*?collectionDataCellFromEvent\(e\)/);
  const contextListeners=(SHEET.match(/table\.addEventListener\('contextmenu'/g)||[]).length;
  assert.equal(contextListeners,1,'Collection grid should have one delegated contextmenu listener');
  assert.match(CSS,/td\.kolLinkedCell :is\(input:disabled,select:disabled,textarea:disabled,\.editCell:disabled\)\{[\s\S]*?pointer-events:none/);
});

test('Notes colour override is local; model-level Notes still retain propagation path',()=>{
  const commit=between(APP,'function commitKolEditor(','function commitKolPriceEditor(');
  assert.match(commit,/const variantOverrideEdit=.*row\.modelGroupRole==='variant'.*kolHasVariantOverride\(row,k\)/);
  assert.match(commit,/if\(k==='not'&&!variantOverrideEdit\)/);
  assert.match(commit,/peer\.not=val/,'model-level notes propagation remains present');
});

test('persistence normalizer preserves override metadata across JSON restart round-trip',()=>{
  let rows=groupedRows();
  const variant=rows.find(r=>r.modelGroupRole==='variant');
  rows=Groups.setVariantOverride(rows,variant.id,'fabric','95/5');
  rows=Groups.setVariantOverride(rows,variant.id,'not','Grey only');
  const restarted=Groups.normalizeRows(JSON.parse(JSON.stringify(rows))).rows;
  const child=restarted.find(r=>r.id===variant.id);
  assert.equal(Groups.effectiveValue(child,'fabric',restarted),'95/5');
  assert.equal(Groups.effectiveValue(child,'not',restarted),'Grey only');
});

test('dependent In Store -> Retail writes respect linked/override ownership',()=>{
  const dependency=between(APP,'function kolSetDependentGroupedField(','// ================= KOLEKSİYON: Geri Al');
  assert.match(dependency,/if\(kolCellLinkedToModel\(row,key\)\)return row/,'a linked child dependency must remain inherited');
  assert.match(dependency,/return kolSetModelSharedField\(row,key,value\)/,'editable parent/override dependencies must use the canonical grouped writer');
  assert.match(dependency,/function kolApplyInStoreRetailDependency\(row,inStoreIso,setField=kolSetDependentGroupedField\)/);
});

test('manufacturer price approve cannot bypass pricing override storage',()=>{
  const render=between(APP,"tbody.querySelectorAll('.kolPriceApprove')","tbody.querySelectorAll('.kolPriceCell')");
  assert.match(render,/kolCellLinkedToModel\(row,`pricing:\$\{m\}`\)/,'linked child price approval must not silently write raw row pricing');
  assert.match(render,/const effectivePricing=kolEffectivePricing\(row\)/);
  assert.match(render,/row=kolWriteGroupedStorageValue\(row,'pricing',\{\.\.\.effectivePricing,\[m\]:raw\}\)/,'approval must update the same canonical pricing override/shared value');
  assert.doesNotMatch(render,/row\.pricing\[m\]\s*=\s*raw/,'approval path must not bypass grouped pricing storage');
});
