'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/license-royalty-commissions.js'),'utf8');
const api=require('../public/business-rules');
function helpers(findSuppFobRule=()=>null){
  const start=source.indexOf('  function parseSuppFobPreviewValue('),end=source.indexOf('  let openingPricePreview=',start);
  assert.ok(start>=0&&end>start,'quick calculator helpers exist');
  return new Function('api','findSuppFobRule','norm','turknorm',source.slice(start,end)+';return {parseSuppFobPreviewValue,suppFobPricePreview};')(api,findSuppFobRule,v=>String(v??'').trim(),v=>String(v??'').trim().toUpperCase());
}
const row={_id:7,OPD:'2026-03-01',Season:'S7',Country:'Bangladesh',Licensor:'DEMO',License:'DEMO LICENSE','Supp. FOB':1.68,'FOB ($)':2.27};
const rule={id:'demo',royalty:17,trCommission:3,ydCommission:9,hologramCost:0};
test('comma and dot decimals work; empty, negative, grouped and malformed input never becomes a price',()=>{
  const {parseSuppFobPreviewValue:parse}=helpers();
  for(const text of ['1,68','1.68',' 1,68 '])assert.equal(parse(text),1.68);
  assert.equal(parse('0'),0);
  for(const text of ['',null,'abc','-1','1,2,3','1.234,56','Infinity','1e3','0x10'])assert.equal(parse(text),null,text);
});
test('preview uses the exact order dimensions and the shared country commission engine without mutating data',()=>{
  const before=JSON.stringify({row,rule});let args;
  const {suppFobPricePreview:preview}=helpers((...values)=>{args=values;return rule;});
  const result=preview(row,'1,85');
  assert.deepEqual(args,[row.OPD,row.Country,row.Season,row.Licensor,row.License]);
  assert.equal(result.finalFob,2.5);assert.equal(result.delta,0.23);assert.equal(result.group,'YD');
  assert.equal(preview({...row,Country:'Türkiye'},'1.85').finalFob,2.31);
  assert.equal(JSON.stringify({row,rule}),before);
});
test('legacy hologram precision and half-up rounding match Royalty Calculations',()=>{
  const migrated={...rule,royalty:12.5,ydCommission:0,legacyYdHologramCost:0.057};
  assert.equal(helpers(()=>migrated).suppFobPricePreview(row,'2').finalFob,2.34);
  assert.equal(helpers(()=>({...rule,royalty:20,ydCommission:0,hologramCost:0.005})).suppFobPricePreview(row,'1').finalFob,1.26);
});
test('missing contract/country and invalid or 100 percent rules cannot produce a plausible result',()=>{
  assert.equal(helpers().suppFobPricePreview(row,'1').error,'rule');
  assert.equal(helpers(()=>rule).suppFobPricePreview({...row,Country:''},'1').error,'country');
  for(const r of [{...rule,ydCommission:null},{...rule,royalty:91},{...rule,hologramCost:-1}])assert.equal(helpers(()=>r).suppFobPricePreview(row,'1').finalFob,null);
  for(const value of ['','abc','-1'])assert.equal(helpers(()=>rule).suppFobPricePreview(row,value).finalFob,null);
});
test('DTR uses its existing no-contract fallback and zero is a valid trial price',()=>{
  assert.equal(helpers().suppFobPricePreview({...row,Licensor:'DTR'},'1,85').finalFob,1.85);
  assert.equal(helpers(()=>rule).suppFobPricePreview(row,'0').finalFob,0);
  assert.equal(helpers(()=>rule).suppFobPricePreview({...row,'FOB ($)':''},'1').delta,null);
});
test('context entry is scoped to Supp. FOB in CP/Orders and keeps shared clipboard entries',()=>{
  const menu=fs.readFileSync(path.join(__dirname,'../public/row-context-menu.js'),'utf8');
  assert.match(menu,/function suppFobCalculatorEntry\(config, table, cell\)/);
  assert.match(menu,/key !== 'Supp\. FOB'/);
  assert.match(menu,/BLSuppFobCalculator\.openForRow/);
  assert.match(menu,/managedClipboardEntries\(config, table, cell\)/);
  assert.match(source,/await refreshPricingRulesFromServer\(\)/);
  assert.match(source,/initialFocus:'#_suppFobPreviewInput'/);
});
