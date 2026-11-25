'use strict';
// Siparişler/CP: satır işaretleme donması. sortRows her karşılaştırmada sütun
// arayıp önbelleksiz şemayı tüm satırlardan yeniden çıkarıyordu (30k satırda
// fiilen O(n² log n)); seçim çubuğu bu sıralamayı her tıklamada ve 700 ms'de bir
// tekrarlıyordu. Sözleşme: şema sıralama başına bir kez çözülür, sonuç eskisiyle
// aynıdır; seçim çubuğu girdiler değişmedikçe snapshot almaz.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const BAR=fs.readFileSync(path.join(__dirname,'../public/selection-action-bar.js'),'utf8');
const BLBusinessRules=require('../public/business-rules');
const schemaApi=require('../public/column-schema');
const sortHelper=source.slice(source.indexOf('function sortRows('),source.indexOf('/* Boş tablo yönlendirmesi:'));

function makeSort(cols,columnSchemaFor){
  return new Function('BLBusinessRules','COLS_BY_TABLE','columnSchemaFor','priorityRank','readPrivateOrderNote',sortHelper+';return sortRows;')(
    BLBusinessRules,{cp:cols,orders:[]},columnSchemaFor,value=>({P1:1,P2:2,P3:3}[value]||9),()=>'');
}
// Önceki karşılaştırıcının birebir referansı (değer eşdeğerliği için).
function referenceSort(rows,key,dir,cols,columnSchemaFor){
  return [...rows].sort((a,b)=>{
    const x=a[key],y=b[key];
    if(key==='Priority')return ((({P1:1,P2:2,P3:3}[x])||9)-((({P1:1,P2:2,P3:3}[y])||9)))*dir;
    if(String(key).toLocaleLowerCase('tr-TR')==='season')return BLBusinessRules.compareChronologicalValues(x,y,dir);
    const column=cols.find(item=>item.k===key);
    const schema=columnSchemaFor(column||{k:key},rows);
    const sx=schema&&schema.sortValue(x),sy=schema&&schema.sortValue(y);
    if(schema&&(schema.sortType==='number'||schema.sortType==='date')){
      if(sx!=null&&sy!=null)return (sx-sy)*dir;
      if((sx==null)!==(sy==null))return sx==null?1:-1;
    }
    return BLBusinessRules.compareChronologicalValues(x,y,dir);
  });
}

const cols=[{k:'Model Name'},{k:'Order Quantity',type:'int'},{k:'Delivery Date',type:'date'},{k:'Season'},{k:'Priority'}];
function rows(count){
  const out=[];
  for(let i=0;i<count;i++){
    const n=(i*7919)%count;
    out.push({_id:'r'+i,'Model Name':i%11===0?'':'Model '+(n%97),'Order Quantity':i%13===0?'':String(n%50),
      'Delivery Date':i%17===0?'':`2026-${String(1+n%12).padStart(2,'0')}-${String(1+n%28).padStart(2,'0')}`,
      Season:['S26','W26','S27','',''][n%5],Priority:['P1','P2','P3',''][n%4]});
  }
  return out;
}

test('sortRows resolves the column schema once per sort, not once per comparison',()=>{
  let calls=0;
  const resolver=(column,list)=>{calls++;return schemaApi.resolveColumnSchema(column,list);};
  const sortRows=makeSort(cols,resolver);
  for(const key of ['Model Name','Order Quantity','Delivery Date']){
    calls=0;
    sortRows(rows(2000),key,1);
    assert.equal(calls,1,key+': schema must be resolved exactly once for the whole sort');
  }
});

test('sortRows keeps the exact previous order (stable ties, blanks last, both directions)',()=>{
  const resolver=(column,list)=>schemaApi.resolveColumnSchema(column,list);
  const sortRows=makeSort(cols,resolver);
  const data=rows(600);
  for(const key of ['Model Name','Order Quantity','Delivery Date','Season','Priority','Unknown'])for(const dir of [1,-1]){
    const before=data.map(row=>row._id);
    assert.deepEqual(sortRows(data,key,dir).map(row=>row._id),referenceSort(data,key,dir,cols,resolver).map(row=>row._id),key+' '+dir);
    assert.deepEqual(data.map(row=>row._id),before,'input order must not be mutated');
  }
});

test('sorting 30k rows by an unresolved text column stays fast',()=>{
  const resolver=(column,list)=>schemaApi.resolveColumnSchema(column,list);
  const sortRows=makeSort(cols,resolver);
  const data=rows(30000),started=process.hrtime.bigint();
  sortRows(data,'Model Name',1);
  const ms=Number(process.hrtime.bigint()-started)/1e6;
  assert.ok(ms<5000,'30k text sort took '+Math.round(ms)+' ms');
});

test('selection bar reuses its snapshot while selection, rows, sort and search are unchanged',()=>{
  assert.match(source,/signature:managedSelectionSignature,/);
  const fn=source.slice(source.indexOf('function managedSelectionSignature('),source.indexOf('window.BLManagedSelection={'));
  for(const part of ['state[tableKey]?.rows','_chkMeta?.rows','ordersRMMaterializedRows()','cpRMMaterializedRows()','sort?.key','sort?.dir',"'ordersSearch'",'selected||[]'])
    assert.ok(fn.includes(part),'signature must include '+part);
  const update=BAR.slice(BAR.indexOf('function update(){'),BAR.indexOf('function schedule(){'));
  assert.match(update,/const input=inputSignature\(key\);\s*if\(input&&input===lastInput&&key===oldKey&&count===lastCount&&lang===lastLang&&!bar\.hidden\)return;/);
  assert.ok(update.indexOf('inputSignature(key)')<update.indexOf('snapshot()'),'the cheap signature check must run before the full snapshot');
  assert.equal((update.match(/snapshot\(\)/g)||[]).length,1,'one snapshot per update');
  assert.doesNotMatch(BAR.slice(BAR.indexOf('function render('),BAR.indexOf('function update(){')),/snapshot\(\)/,'render reuses the update snapshot');
});

test('membership-only paths skip the full sort; ordered selection equals sort-then-filter',()=>{
  // Endeksmatik/atlas düğmeleri ve seçim çubuğu görünürlüğü yalnız üyelik ister.
  const endeks=source.slice(source.indexOf('function selectedEndeksmatikRows(mode)'),source.indexOf('function selectedEndeksmatikOrder('));
  assert.match(endeks,/filteredOrders\(\{sort:false\}\)/);assert.match(endeks,/filteredCP\(\{sort:false\}\)/);
  for(const name of ['filteredOrders','filteredCP']){
    const fn=source.slice(source.indexOf('function '+name+'(options){'));
    assert.match(fn.slice(0,1200),/Sort\.key&&options\?\.sort!==false\)/,name+' must keep sorting by default');
  }
  const helper=source.slice(source.indexOf('function managedSelectionSourceRows('),source.indexOf('function managedSelectionChange('));
  assert.match(helper,/filteredOrders\(\{sort:false\}\):filteredCP\(\{sort:false\}\)/);
  const table=require('./helpers/bl-table-search').createTableSearch();
  require('../public/table-search-row-groups').install({BLTableSearch:table});
  const resolver=(column,list)=>schemaApi.resolveColumnSchema(column,list);
  const sortRows=makeSort(cols,resolver);
  const data=rows(800),selected=new Set(data.filter((_,i)=>i%9===0).map(row=>row._id));
  for(const query of ['','Model 3, Model 1'])for(const key of ['Model Name','Order Quantity','Delivery Date'])for(const dir of [1,-1]){
    const state={orders:{rows:data},ordersSort:{key,dir},ordersSelected:selected,cpSelected:new Set()};
    const api=new Function('state','partialViewRows','filteredCP','filteredOrders','selectionHasId','sortRows','window','document','parseTableSearchTerms','cpSearchHaystack',helper+';return {managedSelectionSourceRows,managedSelectionSnapshot};')(
      state,(k,list)=>list,()=>data.slice(0,400),()=>data.slice(0,400),(set,id)=>set.has(id),sortRows,{BLTableSearch:table},{getElementById:()=>({value:query})},table.parseTerms,row=>Object.values(row).join(' '));
    const expected=api.managedSelectionSourceRows('orders').filter(row=>selected.has(row._id)).map(row=>row._id);
    const snap=api.managedSelectionSnapshot('orders');
    assert.deepEqual(snap.rows.map(row=>row._id),expected,key+' '+dir+' '+query);
    assert.deepEqual(snap.hidden.map(row=>row._id),expected.filter(id=>Number(id.slice(1))>=400||!data.slice(0,400).some(row=>row._id===id)),'hidden '+key);
  }
});
