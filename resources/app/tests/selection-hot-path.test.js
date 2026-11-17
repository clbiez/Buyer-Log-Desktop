'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const bar=fs.readFileSync(path.join(__dirname,'../public/selection-action-bar.js'),'utf8');
const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
test('checkbox selection coalesces effects and resolves IDs from the render index',()=>{
 const handler=block("tbody.addEventListener('change', e=>{",'// v10.11 — CP/Orders');
 assert.match(handler,/requestAnimationFrame/);assert.match(handler,/actualIds\.get/);
 assert.doesNotMatch(handler,/selectionActualId\(|filteredOrders\(|filteredCP\(/);
 assert.match(block('function selectedEndeksmatikRows(','function selectedEndeksmatikOrder('),/selectionIndexEntries/);
 assert.doesNotMatch(block('function selectedEndeksmatikRows(','function selectedEndeksmatikOrder('),/filteredOrders\(|filteredCP\(/);
});
test('closed selection details use a cheap summary; polling reads only key and count',()=>{
 assert.match(bar,/BLManagedSelection\?\.summary/);
 assert.doesNotMatch(bar,/setInterval\(schedule/);
 const update=bar.slice(bar.indexOf('function update(){'),bar.indexOf('function schedule(){'));
 assert.doesNotMatch(update,/const data=snapshot\(/);
});
test('filter and search renders explicitly refresh the selection bar',()=>{
 assert.match(block('function renderFullTable(','window.BLTableFramework='),/BLSelectionBar\?\.refresh\(\)/);
});
test('sort metadata is resolved once outside the comparator',()=>{
 const comparator=block('function sortRows(','/* Boş tablo yönlendirmesi').split('return [...rows].sort((a,b)=>{')[1];
 assert.doesNotMatch(comparator,/COLS_BY_TABLE|columnSchemaFor|toLocaleLowerCase/);
});
function indexApi(document={},state={},visible=()=>[]){
 const helpers=block('function selectionIdKey(','// Ortak tablo araması:');
 const indexes=block('function selectionRowsIndex(','function managedSelectionSourceRows(');
 return new Function('document','state','partialViewRows','filteredOrders','filteredCP',helpers+indexes+';return {selectionRowsIndex,selectionIndexEntries,selectionHasId,managedSelectionSummary,managedSelectionView};')(document,state,(key,rows)=>rows,visible,visible);
}
test('indexed hidden and visible counts equal snapshots for partial rows and mixed IDs',()=>{
 const api=indexApi();
 const rows=[{_id:1},{_id:1},{_id:'1'},{_id:'01'},{_id:' 2 '},{_id:2},{_id:''},{_id:3},{_id:99}];
 const scope=rows.filter(row=>row._id!==99),visible=[rows[0],rows[4]],ids=new Set(visible.map(row=>String(row._id)));
 const sourceIndex=api.selectionRowsIndex(scope,true),visibleIndex=api.selectionRowsIndex(visible);
 const values=[1,'1','01',2,'2',' 2 ','',3,'3',99,'99','missing'];
 for(let mask=0;mask<1<<values.length;mask++){
  const selected=new Set(values.filter((_,i)=>mask&(1<<i)));
  const oldHidden=scope.filter(row=>api.selectionHasId(selected,row._id)&&!ids.has(String(row._id))).length;
  const hidden=[...api.selectionIndexEntries(sourceIndex,selected)].reduce((n,entry)=>n+(ids.has(String(entry.id))?0:entry.count),0);
  assert.equal(hidden,oldHidden);
  assert.equal(api.selectionIndexEntries(visibleIndex,selected).size,new Set(visible.filter(row=>api.selectionHasId(selected,row._id)).map(row=>row._id)).size);
 }
});
test('200 checkbox changes synchronously update selection and flush effects once',()=>{
 const api=indexApi(),frames=[],selected=new Set(),rows=Array.from({length:200},(_,i)=>({_id:i}));
 const table={_blSelectionView:{visibleIndex:api.selectionRowsIndex(rows)}};
 let change,footers=0,notifications=0,clipboardClears=0;
 const tbody={_chkMeta:{selSet:selected,table,rows,visibleIndex:table._blSelectionView.visibleIndex,actualIds:new Map(rows.map(row=>[String(row._id),row._id])),getId:r=>r._id,onSelectionChange(){notifications++;}},addEventListener(type,fn){change=fn;}};
 const handler=block("tbody.addEventListener('change', e=>{",'    tbody._chkMeta =');
 // The extracted block includes the closing brace of the one-time binding guard.
 new Function('tbody','requestAnimationFrame','selectionIdKey','selectionSetId','selectionIndexEntries','updateSelectionFooterCount','window',handler.slice(0,handler.lastIndexOf('    }')))(tbody,fn=>frames.push(fn),String,(set,id,checked)=>checked?set.add(id):set.delete(id),api.selectionIndexEntries,()=>footers++,{BLGridClipboard:{state(){return clipboardClears?null:{activeCell:{}};},clear(){clipboardClears++;}},BLSelectionBar:{refresh(){}}});
 const boxes=rows.map(row=>({classList:{contains:()=>true},dataset:{id:String(row._id)},checked:false,dispatchEvent(){change({target:this});}}));
 tbody.querySelectorAll=()=>boxes;
 boxes[199].checked=true;change({target:boxes[199]});
 const range=require('../public/grid-range-select');
 assert.equal(range.applyRange(tbody,'0',boxes[199]),199);
 assert.equal(selected.size,200);assert.equal(frames.length,1);assert.equal(notifications,0);assert.equal(clipboardClears,1);
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
  if(['number','date'].includes(s.sortType)){
   if(sx!=null&&sy!=null)return(sx-sy)*dir;
   if((sx==null)!==(sy==null))return sx==null?1:-1;
  }
  return rules.compareChronologicalValues(x,y,dir);
 });
 const values=['',null,undefined,'S7','W6','S5','JUNE 2027','JULY 2027','same','same',0,2,10,'3','2026-01-01','2027-01-01'];
 for(const key of ['Season','season','Priority','number','date','private','text'])for(const dir of [1,-1]){
  const rows=values.map((v,i)=>({_id:i,[key]:v}));
  assert.deepEqual(sort(rows,key,dir),previous(rows,key,dir),key+':'+dir);
 }
});

test('render views reject replaced source data and the summary never sorts or filters',()=>{
 const rows=[{_id:1},{_id:2}],selected=new Set(['2']),state={orders:{rows},ordersSelected:selected};
 const table={};const api=indexApi({getElementById:()=>table},state);
 table._blSelectionView={sourceRows:rows,sourceIndex:api.selectionRowsIndex(rows),visibleIds:new Set(['1'])};
 assert.equal(api.managedSelectionSummary('orders').hidden,1);
 state.orders.rows=[{_id:1}];assert.equal(api.managedSelectionView('orders'),null);assert.equal(api.managedSelectionSummary('orders'),null);
});
test('Endeksmatik button uses exactly one visible order even with other hidden selections',()=>{
 const rows=[{_id:1},{_id:2}],state={ordersSelected:new Set(['2'])},api=indexApi();
 const view={visibleIndex:api.selectionRowsIndex(rows)};
 const select=new Function('state','managedSelectionView','selectionIndexEntries',block('function selectedEndeksmatikRows(','function selectedEndeksmatikOrder(')+';return selectedEndeksmatikRows;')(state,()=>view,api.selectionIndexEntries);
 assert.deepEqual(select('orders'),[rows[1]]);
 state.ordersSelected.add('outside');assert.deepEqual(select('orders'),[rows[1]],'hidden selections must not disable the only visible order');
 state.ordersSelected.add(1);assert.deepEqual(select('orders'),[]);
 state.ordersSelected=new Set(['outside']);assert.deepEqual(select('orders'),[]);
 state.ordersSelected=new Set(['1']);view.visibleIndex=api.selectionRowsIndex([rows[0],rows[0]]);assert.equal(select('orders').length,0,'two projected rows must keep Endeksmatik disabled');
});
test('selection bar polls only key/count and reserves snapshots for open details',()=>{
 const vm=require('node:vm'),frames=[],timers=new Map(),events={},nodes=[];
 let snapshots=0,summaries=0,summaryData={hidden:1};
 const node=()=>{const n={hidden:false,dataset:{},listeners:{},children:[],innerHTML:'',setAttribute(){},appendChild(child){this.children.push(child);},addEventListener(type,fn){this.listeners[type]=fn;},querySelector(){return {setAttribute(){},focus(){}};},contains(){return false;}};nodes.push(n);return n;};
 const body=node();body.dataset.activeTab='orders';
 const targets={navCopy:{disabled:false,title:''},navExcelBtn:{disabled:false,title:''},ordersToolsBtn:{disabled:false,title:''}};
 const doc={body,readyState:'complete',createElement:node,addEventListener(type,fn){events[type]=fn;},getElementById:id=>targets[id]||nodes.find(n=>n.id===id)};
 const context={document:doc,state:{ordersSelected:new Set([1])},appLang:'tr',requestAnimationFrame:fn=>frames.push(fn),setInterval(fn){timers.set(1,fn);return 1;},clearInterval:id=>timers.delete(id),MutationObserver:class{observe(){}},BLManagedSelection:{summary(){summaries++;return summaryData;},snapshot(){snapshots++;return {rows:[{_id:1}],hidden:[{_id:1}]};}}};
 context.window=context;vm.runInNewContext(bar,context);
 const flush=()=>{while(frames.length)frames.shift()();};flush();
 const selectionBar=nodes.find(n=>n.id==='blSelectionBar');
 assert.equal(selectionBar.hidden,false);assert.equal(snapshots,0);assert.match(selectionBar.innerHTML,/filtre dışında/);
 const before=summaries;for(let i=0;i<15;i++)timers.get(1)();flush();assert.equal(summaries,before);assert.equal(snapshots,0);
 targets.navCopy.disabled=true;context.BLSelectionBar.refresh();flush();assert.match(selectionBar.innerHTML,/data-selection-target="navCopy" disabled/);
 summaryData={hidden:0};context.BLSelectionBar.refresh();flush();
 summaryData=null;context.BLSelectionBar.refresh();flush();assert.match(selectionBar.innerHTML,/class="blSelectionCount"[^>]* disabled/);
 summaryData={hidden:0};context.BLSelectionBar.refresh();flush();assert.doesNotMatch(selectionBar.innerHTML,/class="blSelectionCount"[^>]* disabled/);
 summaryData={hidden:1};context.BLSelectionBar.refresh();flush();
 selectionBar.listeners.click({target:{closest:()=>({dataset:{selectionDetails:''}})},stopPropagation(){}});assert.equal(snapshots,1);
 context.appLang='en';events['bl:language-changed']();flush();assert.match(selectionBar.innerHTML,/outside filters/);assert.equal(snapshots,2);
 context.state.ordersSelected.clear();timers.get(1)();flush();assert.equal(selectionBar.hidden,true);assert.equal(timers.size,0);
});

test('row-only edits invalidate visibility and keep the shared delegated checkbox handler',()=>{
 assert.doesNotMatch(block('function refreshCpRowOnly(','let _overviewNotesRefreshFrame'),/chk\.addEventListener/);
 assert.match(block('function refreshRowsEverywhere(','// ================= GERİ AL'),/view\.dirty=true/);
 assert.match(block('function managedSelectionView(','function managedSelectionSummary('),/view\.dirty\?updateManagedSelectionView/);
});

test('a row-only edit revalidates filters once and subsequent selection reads stay indexed',()=>{
 const rows=[{_id:1},{_id:2}],state={orders:{rows},ordersSelected:new Set([2])},table={};let filters=0;
 const api=indexApi({getElementById:()=>table},state,()=>{filters++;return [rows[0]];});
 table._blSelectionView={sourceRows:rows,dirty:true};
 assert.equal(api.managedSelectionSummary('orders').hidden,1);
 assert.equal(api.managedSelectionSummary('orders').hidden,1);
 assert.equal(filters,1);assert.equal(table._blSelectionView.dirty,undefined);
});
