'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const helper=source.slice(source.indexOf('function managedSelectionSourceRows('),source.indexOf('function managedSelectionChange('));
for(const key of ['cp','orders'])test(key+': filtered-out rows stay in selected copy source and current scope is preserved',()=>{
 const rows=[{_id:1},{_id:2},{_id:3}],state={[key]:{rows},cpSelected:new Set([1,2,3]),ordersSelected:new Set([1,2,3])};
 const api=new Function('state','partialViewRows','filteredCP','filteredOrders','selectionHasId',helper+';return {managedSelectionSourceRows,managedSelectionSnapshot};')(state,(k,r)=>r.filter(x=>x._id!==3),()=>[rows[0]],()=>[rows[0]],(s,id)=>s.has(id));
 const result=api.managedSelectionSnapshot(key);assert.deepEqual(result.rows.map(x=>x._id),[1,2]);assert.deepEqual(result.hidden.map(x=>x._id),[2]);
});
test('record-based clipboard and Excel use the full scoped source only when rows are selected',()=>{
 assert.match(source,/const all=selSet\?\.size\?managedSelectionSourceRows\(tableKey\)/);
 assert.match(source,/cfg\.set\?\.size\?managedSelectionSourceRows\(tab\):cfg\.rowsFn\(\)/);
});
