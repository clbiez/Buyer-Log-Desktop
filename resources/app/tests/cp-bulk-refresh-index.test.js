'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
function harness(rows,beforeSync=()=>{}){
  const events=[],rendered=new Map(),classes=new Map();
  const classList=id=>({add:k=>classes.get(id).add(k),remove:k=>classes.get(id).delete(k),toggle:(k,on)=>on?classes.get(id).add(k):classes.get(id).delete(k),contains:k=>classes.get(id).has(k)});
  const context={state:{cp:{rows},cpSelected:new Set([2]),cpDirty:new Set([2])},window:{BLCpAssistant:{computeDecisionsForRows(){}}},appLang:'en',
    invalidateCoreFacetCaches:()=>events.push('invalidate'),syncUnifiedPrioritiesForTable:()=>{events.push('sync');beforeSync(context);},
    computeFlags:row=>{events.push(['flags',row.tag]);return {priority:row.Priority};},visibleCols:()=>[{k:'Priority'},{k:'Notes'}],
    cellHtml:(col,row,flags)=>`<td>${col.k}:${row[col.k]||''}:${flags.priority}</td>`,applyGroupedBoundariesToRow(){},cpLogisticDetailRowElement:()=>null,
    document:{querySelector:selector=>{const id=selector.match(/data-id="([^"]*)"/)[1];if(!['1','2'].includes(id))return null;if(!classes.has(id))classes.set(id,new Set());return {set innerHTML(value){rendered.set(id,value);},querySelector:()=>({addEventListener(){}}),children:[],classList:classList(id)};}},
    refreshOverviewNotesLive:()=>events.push('notes'),scheduleOverviewRender:()=>events.push('schedule')};
  vm.createContext(context);vm.runInContext(['refreshCpRowOnly','refreshRowsEverywhere'].map(name=>extractFunction(source,name)).join('\n'),context);
  return {context,events,rendered,classes,run:ids=>context.refreshRowsEverywhere(ids)};
}
test('bulk refresh keeps first strict match, requested order, dirty/selection cells and hidden flag calls',()=>{
  const rows=[{_id:2,tag:'first',Priority:'ACTION',Notes:'first'},{_id:2,tag:'duplicate',Priority:'WRONG'},{_id:'2',tag:'string',Priority:'STRING'},{_id:1,tag:'one',Priority:'OK'},{_id:3,tag:'hidden',Priority:'WAIT'},{_id:NaN,tag:'nan'}];
  const h=harness(rows);h.run([2,1,3,2,'2',NaN,999]);
  assert.deepEqual(h.events,['invalidate','sync',['flags','first'],['flags','one'],['flags','hidden'],['flags','string'],'notes','schedule']);
  assert.match(h.rendered.get('1'),/Priority:OK:OK/);assert.match(h.rendered.get('2'),/Priority:STRING:STRING/);
  assert.ok(h.classes.get('1').has('rowDirty')===false);
  h.run([2]);assert.match(h.rendered.get('2'),/checked/);assert.match(h.rendered.get('2'),/Notes:first:ACTION/);assert.ok(h.classes.get('2').has('rowDirty'));
});
test('index is made after priority synchronization and renewed for array reset, reordering and reused ids',()=>{
  let syncs=0;const old={_id:1,tag:'old',Priority:'OLD'},next={_id:1,tag:'new',Priority:'NEW'};
  const h=harness([old],c=>{if(syncs++===0)c.state.cp.rows=[next,{_id:2,tag:'two',Priority:'TWO'}];});
  h.run([1,2]);assert.match(h.rendered.get('1'),/Priority:NEW:NEW/);assert.equal(h.events.some(e=>Array.isArray(e)&&e[1]==='old'),false);
  const replacement={_id:1,tag:'replacement',Priority:'REPLACED'};h.context.state.cp.rows.unshift(replacement);h.run([1,2]);assert.match(h.rendered.get('1'),/Priority:REPLACED:REPLACED/);
  h.context.state.cp.rows=[old];h.run([1,2]);assert.match(h.rendered.get('1'),/Priority:OLD:OLD/);
});
test('large bulk refresh avoids rescanning the CP array for every requested id',()=>{
  let reads=0;const rows=Array.from({length:5000},(_,id)=>({get _id(){reads++;return id;},tag:'r'+id})),h=harness(rows);
  h.run(Array.from({length:100},(_,i)=>4900+i));
  assert.ok(reads<rows.length*4,`expected a bounded pass over CP rows, observed ${reads} id reads`);
  assert.equal(h.events.filter(e=>Array.isArray(e)).length,100);
});
test('single-row and absent CP projections keep the existing no-op and first-match behavior',()=>{
  let reads=0;const rows=[{get _id(){reads++;return 1;},tag:'first'},{get _id(){reads++;return 2;},tag:'second'}],h=harness(rows);
  h.run([1]);assert.ok(reads<=2,'single-row refresh must not scan the complete array to build an index');
  h.context.state.cp=null;h.run([1,2]);assert.equal(h.events.filter(e=>Array.isArray(e)).length,1);
});
