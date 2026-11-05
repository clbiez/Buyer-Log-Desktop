'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const helper=source.slice(source.indexOf('function managedSelectionSourceRows('),source.indexOf('function managedSelectionChange('));
const sortHelper=source.slice(source.indexOf('function sortRows('),source.indexOf('/* Boş tablo yönlendirmesi:'));
function selectionApi(state,scope=rows=>rows,visible=()=>[]){
 const sortRows=new Function('BLBusinessRules','COLS_BY_TABLE','columnSchemaFor','norm',sortHelper+';return sortRows;')(require('../public/business-rules'),{cp:[],orders:[]},()=>null,value=>String(value??''));
 return new Function('state','partialViewRows','filteredCP','filteredOrders','selectionHasId','sortRows',helper+';return {managedSelectionSourceRows,managedSelectionSnapshot};')(state,(key,rows)=>scope(rows),visible,visible,(selected,id)=>[...selected].some(value=>String(value)===String(id)),sortRows);
}
for(const key of ['cp','orders']){
 test(key+': selection follows the latest sort column/direction without mutating records or selection',()=>{
  const rows=[{_id:1,name:'Charlie',code:20},{_id:2,name:'Alpha',code:100},{_id:3,name:'Bravo',code:3},{_id:4,name:'Outside scope',code:1}];
  const selected=new Set(['3',1,'2',4]),sort={key:'name',dir:1};
  const state={[key]:{rows},[key+'Sort']:sort,cpSelected:selected,ordersSelected:selected};
  const api=selectionApi(state,list=>list.filter(row=>row._id!==4),()=>[rows[0],rows[1]]);
  assert.deepEqual(api.managedSelectionSnapshot(key).rows.map(row=>row._id),[2,3,1]);
  assert.deepEqual(api.managedSelectionSnapshot(key).hidden.map(row=>row._id),[3]);
  sort.dir=-1;
  assert.deepEqual(api.managedSelectionSnapshot(key).rows.map(row=>row._id),[1,3,2]);
  sort.key='code';sort.dir=1;
  assert.deepEqual(api.managedSelectionSourceRows(key).map(row=>row._id),[3,1,2]);
  sort.key=null;
  assert.deepEqual(api.managedSelectionSourceRows(key),rows.slice(0,3));
  assert.deepEqual(rows.map(row=>row._id),[1,2,3,4]);
  assert.deepEqual([...selected],['3',1,'2',4]);
 });
 test(key+': projected rows retain stable ties and current sort across the whole source',()=>{
  const rows=[{_id:1,STATUS:'Z'},{_id:2,STATUS:'A'},{_id:3,STATUS:'Z'}];
  const state={[key]:{rows},[key+'Sort']:{key:'STATUS',dir:1},cpSelected:new Set([1,2,3]),ordersSelected:new Set([1,2,3])};
  const api=selectionApi(state,list=>list.flatMap(row=>[row,{...row,STATUS:'M',projected:true}]));
  assert.deepEqual(api.managedSelectionSourceRows(key).map(row=>[row._id,row.STATUS]),[[2,'A'],[1,'M'],[2,'M'],[3,'M'],[1,'Z'],[3,'Z']]);
 });
}
for(const key of ['cp','orders'])test(key+': filtered-out rows stay in selected copy source and current scope is preserved',()=>{
 const rows=[{_id:1},{_id:2},{_id:3}],state={[key]:{rows},cpSelected:new Set([1,2,3]),ordersSelected:new Set([1,2,3])};
 const api=new Function('state','partialViewRows','filteredCP','filteredOrders','selectionHasId',helper+';return {managedSelectionSourceRows,managedSelectionSnapshot};')(state,(k,r)=>r.filter(x=>x._id!==3),()=>[rows[0]],()=>[rows[0]],(s,id)=>s.has(id));
 const result=api.managedSelectionSnapshot(key);assert.deepEqual(result.rows.map(x=>x._id),[1,2]);assert.deepEqual(result.hidden.map(x=>x._id),[2]);
});
test('record-based clipboard and Excel use the full scoped source only when rows are selected',()=>{
 assert.match(source,/const all=selSet\?\.size\?managedSelectionSourceRows\(tableKey\)/);
 assert.match(source,/cfg\.set\?\.size\?managedSelectionSourceRows\(tab\):cfg\.rowsFn\(\)/);
});
