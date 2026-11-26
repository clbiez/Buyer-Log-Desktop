'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/quotations.js'),'utf8');
function setup(){
 const data=new Map(),rows=new Map();
 const ctx={window:{BLCollectionColumns:{catalog:()=>['modelKod','productMainDefinition','quantity','inStoreMonth','fabric','season','custom_demo'].map(key=>({key,label:key})),label:key=>key}},BLStorage:{getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)},qCurrentUserId:()=>ctx.user,qNorm:v=>String(v??'').trim(),qLang:(tr,en)=>ctx.appLang==='en'?en:tr,qCollectionRead:null,appLang:'en',user:'buyer-a',qFindCollectionRow:item=>rows.get(item.id),qFindCpRow:()=>null,qCollectionEffectiveValue:(row,key)=>row?.[key],qItemFabric:(_req,item)=>item.fabric||'',kolFabricDisplay:raw=>'CARD: '+raw};
 vm.createContext(ctx);
 const start=source.indexOf('  const DESK_DEFAULT_COLUMNS='),end=source.indexOf('  function qItemCategory',start);
 assert.ok(start>=0&&end>start,'Pricing Desk column helpers exist');vm.runInContext(source.slice(start,end),ctx);
 return {ctx,data,rows};
}
test('defaults include product definition, quantity, MB month and fabric; empty selection is preserved per user',()=>{
 const {ctx}=setup();assert.deepEqual(Array.from(ctx.qDeskSelectedColumns()),['productMainDefinition','quantity','inStoreMonth','fabric']);
 ctx.qDeskSaveColumns([]);assert.equal(ctx.qDeskSelectedColumns().length,0);ctx.user='buyer-b';assert.equal(ctx.qDeskSelectedColumns().length,4);ctx.user='buyer-a';assert.equal(ctx.qDeskSelectedColumns().length,0);
});
test('catalog accepts Collection custom fields, rejects stale/duplicate selections and can restore defaults',()=>{
 const {ctx}=setup();ctx.qDeskSaveColumns(['custom_demo','season','season','obsolete']);assert.deepEqual(Array.from(ctx.qDeskSelectedColumns()),['custom_demo','season']);ctx.qDeskSaveColumns(null);assert.equal(ctx.qDeskSelectedColumns().length,4);
});
test('summary uses current owner-matched effective values, preserves zero, and never substitutes category',()=>{
 const {ctx,rows}=setup(),req={source:'collection'},item={id:'a',quantity:500,productMainDefinition:'Snapshot',category:'Wrong category'};
 rows.set('a',{quantity:0,inStoreMonth:'JUNE 2027',productMainDefinition:'Current product',custom_demo:'<script>'});
 assert.equal(ctx.qDeskFieldValue(req,item,'quantity'),'0');assert.equal(ctx.qDeskFieldValue(req,item,'productMainDefinition'),'Current product');assert.equal(ctx.qDeskFieldValue(req,item,'custom_demo'),'<script>');
 rows.clear();assert.equal(ctx.qDeskFieldValue(req,item,'quantity'),'500');assert.equal(ctx.qDeskFieldValue(req,{id:'missing',category:'Wrong'},'productMainDefinition'),'');
});
test('fabric summary resolves through the shared Fabric Card formatter',()=>{
 const {ctx}=setup();assert.equal(ctx.qItemFabricSummary({source:'collection'},{fabric:'3859-raw'}),'CARD: 3859-raw');
});
test('quantity sort reads the numeric source rather than localized thousands separators',()=>{
 const {ctx,rows}=setup();ctx.qTableCols=[{key:'model'},{key:'price'}];
 const start=source.indexOf('  function qListColumns(){'),end=source.indexOf('  function qTableCol(',start);
 vm.runInContext(source.slice(start,end),ctx);
 const req={source:'collection'},item={id:'quantity'};rows.set(item.id,{quantity:1200});
 const column=ctx.qListColumns().find(column=>column.field==='quantity');
 assert.equal(column.value(req,item),'1.200','quantity uses the Collection dot thousands separator in every language');assert.equal(column.number(item,req),1200);
 rows.set(item.id,{quantity:0});assert.equal(column.number(item,req),0);
 rows.set(item.id,{quantity:''});assert.ok(Number.isNaN(column.number(item,req)));
});
