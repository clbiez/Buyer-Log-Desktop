'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const APP=fs.readFileSync(require('node:path').join(__dirname,'../public/app-main.js'),'utf8');
function cut(start,end){const a=APP.indexOf(start),b=APP.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return APP.slice(a,b);}
const plain=v=>JSON.parse(JSON.stringify(v));
function details(){const c=vm.createContext({appLang:'tr'});vm.runInContext(cut('const KOL_PRICE_DETAIL_FIELDS=','// Görünür tanımlayıcı listesine')+cut('function kolCopyMoney(','function kolSpreadsheetRawValue(')+';this.api={fields:KOL_PRICE_DETAIL_FIELDS,expand:kolExpandPriceDetails,money:kolCopyMoney};',c);return c.api;}
test('detail anchors preserve order, folds, hidden anchors and avoid duplicate input columns',()=>{
 const {expand,fields}=details(),base=k=>({kind:'base',k});
 const out=expand([base('modelKod'),base('trLanded'),base('endeksmatik')]);
 assert.deepEqual(plain(out.map(d=>d.k)),['modelKod','trLanded',...fields.filter(f=>f.anchor==='trLanded').map(f=>f.k),'endeksmatik',...fields.filter(f=>f.anchor==='endeksmatik').map(f=>f.k)]);
 assert.deepEqual(plain(expand([base('modelKod')]).map(d=>d.k)),['modelKod']);
 const folded=expand([{kind:'priceStrip',k:'__priceStrip__',folds:['__bestPrice__','__confirmedPrice__']},base('trPrice'),base('trLanded')]);
 assert.deepEqual(plain(folded.slice(1,4).map(d=>d.k)),['__bestMfr__','__offerCount__','__targetDiff__']);
 assert.equal(folded.filter(d=>d.k==='trPrice').length,1);
 assert.deepEqual(plain(expand(folded).map(d=>d.k)),plain(folded.map(d=>d.k)));
});
test('copy money uses two decimals and leaves missing/nonfinite values empty',()=>{const {money}=details();assert.equal(money(9.801300000000001),'9,80');assert.equal(money(8.19),'8,19');assert.equal(money(0),'0,00');for(const v of [null,undefined,'',NaN,Infinity])assert.equal(money(v),'');});
function clipboard(){
 const rows=[{id:1,trPrice:'400',trFx:'40',trLandedMult:'1.05'},{id:2,trPrice:'250',trFx:'30',trLandedMult:'1.2'}],linked=new Set();
 const c=vm.createContext({kolRows:rows,kolWorkspaceCanEdit:true,kolBulkPreparing:false,kolCellLinkedToModel:(_,k)=>linked.has(k),kolSpreadsheetColumnMeta:k=>({key:k,editable:true,type:k==='trPrice'?'money':'number',col:{moneyLocal:k==='trPrice'}}),kolParseMoneyNum:v=>Number(String(v).replace(',','.')),kolEffectiveValue:(r,k)=>r[k],kolUndoStack:[],kolUndoSummaryStack:[],kolRedoStack:[],kolRedoSummaryStack:[],kolSnapshot:()=>structuredClone(rows),kolPushUndo(){c.kolUndoStack.push(structuredClone(rows));c.kolUndoSummaryStack.push({});},kolApplyCollectionCellChange:({rowId,key,value})=>{rows.find(r=>r.id===rowId)[key]=value;return true;},saveKolRows:()=>true,renderKol(){},window:{},updateKolUndoRedoButtons(){}});
 vm.runInContext(cut("const KOL_TR_LANDED_COPY_PREFIX=",'function kolSpreadsheetMakeEditor(')+cut('function kolSpreadsheetBatchEdit(','function kolSpreadsheetSetColumnWidth(')+';this.api={validate:kolSpreadsheetValidateValue,batch:kolSpreadsheetBatchEdit};',c);
 return {rows,linked,...c.api};
}
test('internal TR Landed paste/fill copies all three inputs even when no landed value can be calculated',()=>{
 const {rows,validate,batch}=clipboard();assert.deepEqual(plain(validate(2,'trLanded','BL-TR-LANDED:1').value),{__trLandedSourceId:1});
 assert.equal(batch([{rowId:2,key:'trLanded',value:validate(2,'trLanded','BL-TR-LANDED:1').value}]).ok,true);
 for(const k of ['trPrice','trFx','trLandedMult'])assert.equal(rows[1][k],rows[0][k]);
});
test('external TR Landed single value changes TRY input only; invalid tokens and linked inputs are rejected',()=>{
 const {rows,linked,validate,batch}=clipboard();assert.equal(validate(2,'trLanded','BL-TR-LANDED:missing').ok,false);
 assert.equal(validate(2,'trLanded','abc').ok,false);
 assert.equal(batch([{rowId:2,key:'trLanded',value:'600'}]).ok,true);assert.equal(rows[1].trPrice,'600');assert.equal(rows[1].trFx,'30');assert.equal(rows[1].trLandedMult,'1.2');
 linked.add('trFx');assert.equal(validate(2,'trLanded','BL-TR-LANDED:1').reason,'linked');
});
test('row exports expand price details without changing the grid column metadata',()=>{
 assert.match(cut('async function buildCollectionStyledCopy(','/* ==================================================================='),/const descriptors=kolExportDescriptors\(\)/);
 assert.match(cut('async function kolExportWithImages(','function kolStyleExportValue('),/d.kind==='priceDetail'[\s\S]*kolPriceDetailRaw\(d.field,r\)[\s\S]*KOL_PRICE_DETAIL_NUMFMT\[d.field.type\]/);
 assert.match(APP,/colsFn:\s*\(\)=>kolDisplayDescriptors\(\)/);
});
test('overlapping TR Landed block paste snapshots sources before writing targets',()=>{const {rows,batch}=clipboard();rows.push({id:3,trPrice:'100',trFx:'10',trLandedMult:'1'});assert.equal(batch([{rowId:2,key:'trLanded',value:'BL-TR-LANDED:1'},{rowId:3,key:'trLanded',value:'BL-TR-LANDED:2'}]).ok,true);assert.equal(rows[1].trPrice,'400');assert.equal(rows[2].trPrice,'250');assert.equal(rows[2].trFx,'30');});
test('quotations workbook exports numeric values, real approvals and coverage/win ordered suppliers in TR/EN',()=>{
 for(const lang of ['tr','en']){
  const cells=new Map(),at=(r,c)=>{const k=`${r}:${c}`;if(!cells.has(k))cells.set(k,{});return cells.get(k);},sheet={getRow:r=>({getCell:c=>at(r,c),eachCell(){}})},wb={addWorksheet(name,options){this.name=name;this.options=options;return sheet;}};
  const rows=[{modelKod:'M1',plmId:'001',colour:'Blue',targetPrice:'10',pricing:{A:'8',B:'9'},best:{name:'A',price:8},approved:{name:'B',price:9}},{modelKod:'M2',plmId:'002',colour:'Red',targetPrice:'11',pricing:{A:'12',B:'9'},best:{name:'B',price:9},approved:null}];
  const context=vm.createContext({appLang:lang,kolManufacturers:[{name:'A'},{name:'B'},{name:'C'}],kolEffectivePricing:r=>r.pricing,kolBestPricing:r=>r.best,kolConfirmedPricing:r=>r.approved,kolEffectiveValue:(r,k)=>r[k],kolParseMoneyNum:v=>v==null?NaN:Number(v),norm:v=>String(v).trim().toLowerCase(),kolExportSingleLineText:v=>String(v??'').replace(/\n/g,' '),KOL_PRICE_DETAIL_NUMFMT:{money:'"$"#,##0.00'}});
  vm.runInContext(cut('function kolAddQuotationWorksheet(','async function kolExportWithImages(')+';this.add=kolAddQuotationWorksheet;',context);context.add(wb,rows);
  assert.equal(wb.name,lang==='tr'?'Teklifler':'Quotations');assert.deepEqual(plain(sheet.columns.slice(8).map(c=>c.header)),['A','B','C']);assert.equal(at(2,2).value,'001');assert.equal(at(2,2).numFmt,'@');assert.equal(at(2,9).value,8);assert.equal(at(2,9).fill.fgColor.argb,'FFE4F3EB');assert.equal(at(2,10).font.bold,true);assert.equal(at(3,7).value,'');assert.equal(at(3,8).value,null);assert.equal(at(2,11).value,null);assert.equal(at(2,9).numFmt,'"$"#,##0.00');
 }
});

test('cost FX and multipliers reject nonnumeric paste before changing stored values',()=>{const {rows,validate,batch}=clipboard();for(const key of ['trFx','trLandedMult','ydLandedMult']){assert.equal(validate(2,key,'abc').reason,'invalid-number');assert.equal(batch([{rowId:2,key,value:'abc'}]).ok,false);assert.equal(validate(2,key,'1,05').ok,true);}assert.equal(rows[1].trFx,'30');assert.equal(rows[1].trLandedMult,'1.2');});
