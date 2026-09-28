'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const E=require('../public/price-supplier-insights-engine.js');
const ui=fs.readFileSync(path.join(ROOT,'public','price-supplier-analysis.js'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'public','price-supplier-analysis.css'),'utf8');

let seq=0;
const obs=(season,id,extra={})=>({
  season,
  manufacturer:'Supplier '+id,
  classification:'Tee',
  buyingGroup:'BG',
  buyer:'Buyer',
  mag:'MAG',
  mmyg:'MMYG',
  productGroup:'Top',
  country:'TR',
  price:10,
  currency:'USD',
  quantity:100,
  modelKey:`M-${id}-${seq++}`,
  ...extra,
});

test('Price & Supplier exposes configurable buyer filters beyond the legacy four',()=>{
  for(const dim of ['buyingGroup','buyer','mag','mmyg','classification','productGroup','country','manufacturer'])
    assert.ok(E.FILTER_DIMENSIONS.includes(dim),dim);
  assert.match(ui,/filterLayout:\[\.\.\.DEFAULT_FILTER_LAYOUT\]/);
  assert.match(ui,/data-ps-filter-toggle=/);
  assert.match(ui,/filterConfig:'Filtre ekle\/çıkar'/);
  assert.doesNotMatch(ui,/if\(!state\.filterLayout\.length\)state\.filterLayout=/,'an intentionally empty filter layout must stay empty');
  assert.match(css,/\.psaFilterConfigPanel/);
});

test('In-Store and OPD months are read from LFL row/raw data and catalogued per season',()=>{
  const data=E.prepare([
    obs('W7','a',{row:{inStoreMonth:'2027-05',opdMonth:'2027-04'}}),
    obs('W7','b',{row:{inStoreMonth:'2027-06',opdMonth:'2027-05'}}),
    obs('W6','c',{row:{inStoreMonth:'2026-05',opdMonth:'2026-04'}}),
  ]);
  assert.deepEqual(E.periodValues(data,'inStore','W7'),['2027-05','2027-06']);
  assert.deepEqual(E.periodValues(data,'opd','W7'),['2027-04','2027-05']);
  assert.deepEqual(E.periodValues(data,'inStore','W6'),['2026-05']);
});

test('current and comparison seasons may use independent In-Store/OPD months',()=>{
  const data=E.prepare([
    obs('W7','current-hit',{row:{inStoreMonth:'2027-05',opdMonth:'2027-04'}}),
    obs('W7','current-miss',{row:{inStoreMonth:'2027-06',opdMonth:'2027-05'}}),
    obs('W6','compare-hit',{row:{inStoreMonth:'2026-06',opdMonth:'2026-04'}}),
    obs('W6','compare-miss',{row:{inStoreMonth:'2026-05',opdMonth:'2026-03'}}),
  ]);
  const model=E.analyze(data,{
    currentSeason:'W7',
    previousSeason:'W6',
    currentPeriod:{dateField:'inStore',month:'2027-05'},
    previousPeriod:{dateField:'opd',month:'2026-04'},
  });
  assert.equal(model.hasComparison,true);
  assert.deepEqual(model.current.map(rec=>rec.obs.manufacturer),['Supplier current-hit']);
  assert.deepEqual(model.previous.map(rec=>rec.obs.manufacturer),['Supplier compare-hit']);
  assert.equal(model.totals.records,1);
  assert.equal(model.previous.length,1);
});

test('period controls are side-specific and clearing filters clears months without removing layout',()=>{
  assert.match(ui,/data-ps="\\$\\{kind\\}DateField"/);
  assert.match(ui,/data-ps="\\$\\{kind\\}Month"/);
  assert.match(ui,/currentPeriod:state\.periods\.current,previousPeriod:state\.periods\.previous/);
  assert.match(ui,/state\.periods\.current\.month='';state\.periods\.previous\.month=''/);
  assert.match(ui,/PERIOD_KINDS\.forEach\(kind=>\{state\.periods\[kind\]\.month='';\}\)/);
  assert.match(ui,/state\.filterLayout=state\.filterLayout\.filter\(item=>item!==dim\);state\.filters\[dim\]='';recalc\(\)/);
});
