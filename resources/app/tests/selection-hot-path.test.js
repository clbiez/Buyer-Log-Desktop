'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const bar=fs.readFileSync(path.join(__dirname,'../public/selection-action-bar.js'),'utf8');
const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
test('checkbox selection coalesces effects and resolves IDs from the render index',()=>{
 const handler=block("tbody.addEventListener('change', e=>{",'// v10.11 — CP/Orders');
 assert.match(handler,/requestAnimationFrame/);assert.match(handler,/actualIds\.get/);
 assert.doesNotMatch(handler,/selectionActualId\(|filteredOrders\(|filteredCP\(/);
 assert.match(block('function selectedEndeksmatikRows(','function selectedEndeksmatikOrder('),/selected\?\.size!==1/);
 assert.doesNotMatch(block('function selectedEndeksmatikRows(','function selectedEndeksmatikOrder('),/filteredOrders\(|filteredCP\(/);
});
test('closed selection details use a cheap summary; polling reads only key and count',()=>{
 assert.match(bar,/BLManagedSelection\?\.summary/);
 assert.doesNotMatch(bar,/setInterval\(schedule/);
 const update=bar.slice(bar.indexOf('function update(){'),bar.indexOf('function schedule(){'));
 assert.doesNotMatch(update,/const data=snapshot\(/);
});
test('sort metadata is resolved once outside the comparator',()=>{
 const comparator=block('function sortRows(','/* Boş tablo yönlendirmesi').split('return [...rows].sort((a,b)=>{')[1];
 assert.doesNotMatch(comparator,/COLS_BY_TABLE|columnSchemaFor|toLocaleLowerCase/);
});
function indexApi(){
 const helpers=block('function selectionIdKey(','// Ortak tablo araması:');
 const indexes=block('function selectionRowsIndex(','function managedSelectionSourceRows(');
 return new Function('document','state',helpers+indexes+';return {selectionRowsIndex,selectionIndexEntries,selectionHasId,managedSelectionSummary};')({},{});
}
test('indexed hidden and visible counts equal snapshots for partial rows and mixed IDs',()=>{
 const api=indexApi();
 const rows=[{_id:1},{_id:1},{_id:'1'},{_id:'01'},{_id:' 2 '},{_id:2},{_id:''},{_id:3},{_id:99}];
 const scope=rows.filter(row=>row._id!==99),visible=[rows[0],rows[4]],ids=new Set(visible.map(row=>String(row._id)));
 const sourceIndex=api.selectionRowsIndex(scope),visibleIndex=api.selectionRowsIndex(visible);
 const values=[1,'1','01',2,'2',' 2 ','',3,'3',99,'99','missing'];
 for(let mask=0;mask<1<<values.length;mask++){
  const selected=new Set(values.filter((_,i)=>mask&(1<<i)));
  const oldHidden=scope.filter(row=>api.selectionHasId(selected,row._id)&&!ids.has(String(row._id))).length;
  const hidden=[...api.selectionIndexEntries(sourceIndex,selected)].reduce((n,entry)=>n+(ids.has(String(entry.id))?0:entry.rows.length),0);
  assert.equal(hidden,oldHidden);
  assert.equal(api.selectionIndexEntries(visibleIndex,selected).size,new Set(visible.filter(row=>api.selectionHasId(selected,row._id)).map(row=>row._id)).size);
 }
});
test('200 checkbox changes synchronously update selection and flush effects once',()=>{
 const api=indexApi(),frames=[],selected=new Set(),rows=Array.from({length:200},(_,i)=>({_id:i}));
 const table={_blSelectionView:{visibleIndex:api.selectionRowsIndex(rows)}};
 let change,footers=0,notifications=0,clipboardClears=0;
 const tbody={_chkMeta:{selSet:selected,table,rows,actualIds:new Map(rows.map(row=>[String(row._id),row._id])),getId:r=>r._id,onSelectionChange(){notifications++;}},addEventListener(type,fn){change=fn;}};
 const handler=block("tbody.addEventListener('change', e=>{",'    tbody._chkMeta =');
 // The extracted block includes the closing brace of the one-time binding guard.
 new Function('tbody','requestAnimationFrame','selectionIdKey','selectionSetId','selectionIndexEntries','updateSelectionFooterCount','window',handler.slice(0,handler.lastIndexOf('    }')))(tbody,fn=>frames.push(fn),String,(set,id,checked)=>checked?set.add(id):set.delete(id),api.selectionIndexEntries,()=>footers++,{BLGridClipboard:{clear(){clipboardClears++;}},BLSelectionBar:{refresh(){}}});
 for(const row of rows)change({target:{classList:{contains:()=>true},dataset:{id:String(row._id)},checked:true}});
 assert.equal(selected.size,200);assert.equal(frames.length,1);assert.equal(notifications,0);
 frames.shift()();assert.equal(footers,1);assert.equal(notifications,1);assert.equal(clipboardClears,1);
});
test('sortRows preserves original results including stable ties, blanks, private notes and periods',()=>{
 const rules=require('../public/business-rules');
 const columns={cp:[{k:'private',personalNote:true}],orders:[]};
 const schema=column=>({sortType:column.k==='number'?'number':column.k==='date'?'date':'text',sortValue:value=>value==null||value===''?null:column.k==='date'?Date.parse(value):Number(value)});
 const read=(row,key)=>row[key],rank=value=>Number(value)||0;
 const sort=new Function('BLBusinessRules','COLS_BY_TABLE','columnSchemaFor','readPrivateOrderNote','priorityRank',block('function sortRows(','/* Boş tablo yönlendirmesi')+';return sortRows;')(rules,columns,schema,read,rank);
 const previous=(rows,key,dir)=>[...rows].sort((a,b)=>{
  let x=read(a,key),y=read(b,key);
  if(key==='Priority')return(rank(x)-rank(y))*dir;
  if(String(key).toLocaleLowerCase('tr-TR')==='season')return rules.compareChronologicalValues(x,y,dir);
  const col=(columns.cp||[]).find(c=>c.k===key)||(columns.orders||[]).find(c=>c.k===key),s=schema(col||{k:key},rows),sx=s.sortValue(x),sy=s.sortValue(y);
  if(sx!=null&&sy!=null&&['number','date'].includes(s.sortType))return(sx-sy)*dir;
  return rules.compareChronologicalValues(x,y,dir);
 });
 const values=['',null,undefined,'S7','W6','S5','JUNE 2027','JULY 2027','same','same',0,2,10,'3','2026-01-01','2027-01-01'];
 for(const key of ['Season','season','Priority','number','date','private','text'])for(const dir of [1,-1]){
  const rows=values.map((v,i)=>({_id:i,[key]:v}));
  assert.deepEqual(sort(rows,key,dir),previous(rows,key,dir),key+':'+dir);
 }
});
