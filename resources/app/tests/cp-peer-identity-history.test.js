'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),block=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const row=(id,code,note='next')=>({_id:id,'Order Code':code,'Model Name':'DEMO','C.Code':'01',note_col_1:note});
function harness(rows){
 const calls={render:0,invalidate:0,refreshIds:[],dirty:[],toast:[]},context={state:{currentUser:{id:'buyer'},cp:{rows},orders:{rows:rows.map(item=>({...item}))},overrides:{},cpDirty:new Set()},window:{BLOrderLinePeerIndex:require('../public/order-line-peer-index'),BLGridClipboard:{diagnostics:{record(){}},selectionSize:()=>({})}},document:{activeElement:null},CP_NOTE_COLUMN_DEFS:[{id:'note_col_1'}],CP_PASTE_ROW_REFRESH_LIMIT:30,appLang:'en',isAreaFrozen:()=>false,editableValuesEqual:(a,b)=>a===b,markDirty:id=>calls.dirty.push(id),invalidateCoreFacetCaches:()=>{calls.invalidate++;},refreshCpRowOnly:id=>calls.refreshIds.push(id),refreshOverviewNotesLive(){},scheduleOverviewRender(){},refreshSubmfrList(){},refreshLicensorList(){},renderOrders:()=>{calls.render++;},showToast:text=>calls.toast.push(text),applyFormulas(){},syncCpProductionLogisticSegment(){},invalidateUnifiedPriorityDecisions(){},updateUndoRedoButtons(){},managedEditorSnapshot:()=>null,norm:value=>String(value??'').trim()};
 vm.createContext(context);vm.runInContext(block('function turknorm(','// ================= LICENSE ROYALTY'),context);vm.runInContext(block('function refreshRowEverywhere(','// ================= GERİ AL'),context);vm.runInContext(block('let undoStack = [];','function discardAllChanges('),context);vm.runInContext(block('function commitCpEditor(','/* Lojistik açılır ok'),context);vm.runInContext(block('function applyCpGridPasteConfirmed(','function registerManagedGridClipboard('),context);
 return {context,calls};
}
test('preparing a native CP transaction isolates live rows, peer rows, overrides and dirty state',()=>{
 const original=row(1,'100'),h=harness([original]),ctx=h.context;ctx.structuredClone=structuredClone;
 const key=ctx.lineKeyOfRow(original),before=JSON.stringify(ctx.state);
 const prepared=ctx.withCpBulkDraft([key],()=>{ctx.state.cp.rows[0].note_col_1='draft';ctx.state.orders.rows[0].note_col_1='draft';ctx.state.overrides.test='draft';ctx.state.cpDirty.add(1);return ctx.state.cp.rows[0].note_col_1;});
 assert.equal(prepared.value,'draft');assert.equal(prepared.rows[0].after.note_col_1,'draft');assert.equal(JSON.stringify(ctx.state),before);assert.equal(ctx.state.cp.rows[0],original);
});
test('a normal edit while a bulk Undo ACK is pending keeps its own history action',async()=>{
 const h=harness([row(1,'100')]),ctx=h.context;let release;
 ctx.applyCpBulkHistory=()=>new Promise(resolve=>release=resolve);
 vm.runInContext("undoStack=[{kind:'batch',actions:[],bulkGuard:{owner:'buyer'}}];redoStack=[];",ctx);
 const pending=ctx.undo();ctx.pushUndo({id:1,fields:[{key:'note_col_1',prev:'before',next:'newer'}]});release(true);await pending;
 assert.equal(vm.runInContext('undoStack.length',ctx),1);assert.equal(vm.runInContext("undoStack[0].fields[0].next",ctx),'newer');assert.equal(vm.runInContext('redoStack.length',ctx),0);
});
test('a normal edit while a bulk Redo ACK is pending stays after the redone action',async()=>{
 const h=harness([row(1,'100')]),ctx=h.context;let release;
 ctx.applyCpBulkHistory=()=>new Promise(resolve=>release=resolve);
 vm.runInContext("undoStack=[];redoStack=[{kind:'batch',actions:[],bulkGuard:{owner:'buyer'}}];",ctx);
 const pending=ctx.redo();ctx.pushUndo({id:1,fields:[{key:'note_col_1',prev:'before',next:'newer'}]});release(true);await pending;
 assert.equal(vm.runInContext('undoStack.length',ctx),2);assert.equal(vm.runInContext('undoStack[0].kind',ctx),'batch');assert.equal(vm.runInContext("undoStack[1].fields[0].next",ctx),'newer');assert.equal(vm.runInContext('redoStack.length',ctx),0);
});

test('a stale inline editor cannot write to another canonical line after its display id is reused',()=>{
 const original=row(1,'100'),h=harness([original]),key=h.context.lineKeyOfRow(original),foreign=row(1,'999'),current=row(9,'100');h.context.state.cp.rows=[foreign,current];
 const result=h.context.commitCpEditor({dataset:{id:'1',key:'note_col_1',kind:'text',lineKey:key,editOwner:'buyer'},value:'must not write'});
 assert.equal(result,false);assert.equal(foreign.note_col_1,'next');assert.equal(current.note_col_1,'next');assert.equal(h.calls.dirty.length,0);
});

test('a bound inline editor rejects a different owner even when line and display id match',()=>{
 const original=row(1,'100'),h=harness([original]);const editor={dataset:{id:'1',key:'note_col_1',kind:'text',lineKey:h.context.lineKeyOfRow(original),editOwner:'buyer'},value:'denied'};h.context.state.currentUser={id:'another-buyer'};
 assert.equal(h.context.commitCpEditor(editor),false);assert.equal(original.note_col_1,'next');assert.equal(h.calls.dirty.length,0);
});

test('rendered editor bindings reuse normalization but invalidate on identity and owner changes',()=>{
 const original=row(1,'100'),h=harness([original]),keyOf=h.context.lineKeyOfRow;let reads=0;h.context.escapeHtml=String;h.context.lineKeyOfRow=value=>{reads++;return keyOf(value);};
 const first=h.context.cpEditorIdentityAttributes(original);assert.equal(h.context.cpEditorIdentityAttributes(original),first);assert.equal(reads,1);
 original['Model Name']='OTHER';assert.match(h.context.cpEditorIdentityAttributes(original),/100\|OTHER\|01/);h.context.state.currentUser={id:'other'};assert.match(h.context.cpEditorIdentityAttributes(original),/data-edit-owner="other"/);assert.equal(reads,3);
});

test('a retained shared-field editor cannot write after its shared edit capability is revoked',()=>{
 const original={...row(1,'100'),'Supp. FOB':12.5,_canEditShared:false},h=harness([original]);h.context.state.overrides.suppfobmap={};h.context.state.overrides.suppfobmetamap={};h.context.propagateOrderPricingFields=()=>{};
 const result=h.context.commitCpEditor({dataset:{id:'1',key:'Supp. FOB',kind:'suppfob',lineKey:h.context.lineKeyOfRow(original),editOwner:'buyer'},value:'18.25'},{refresh:false});
 assert.equal(result,false);assert.equal(original['Supp. FOB'],12.5);assert.equal(h.calls.dirty.length,0);
});

test('Undo and Redo follow the original canonical row through display id reuse',()=>{
 const original=row(1,'100'),h=harness([original]);h.context.pushUndo({id:1,fields:[{key:'note_col_1',prev:'before',next:'next'}]});
 const foreign=row(1,'999'),current=row(9,'100');h.context.state.cp.rows=[foreign,current];h.context.state.orders.rows=[{...current}];
 h.context.undo();assert.equal(current.note_col_1,'before');assert.equal(foreign.note_col_1,'next');assert.equal(h.context.state.orders.rows[0].note_col_1,'before');
 h.context.redo();assert.equal(current.note_col_1,'next');assert.equal(foreign.note_col_1,'next');
});

test('history captured for one user cannot mutate the next user projection',()=>{
 const original=row(1,'100'),h=harness([original]);h.context.pushUndo({id:1,fields:[{key:'note_col_1',prev:'before',next:'next'}]});h.context.state.currentUser={id:'other'};const current=row(1,'100');h.context.state.cp.rows=[current];
 h.context.undo();assert.equal(current.note_col_1,'next');assert.equal(h.calls.dirty.length,0);
});

test('a batch Undo invalidates/renders peer projections once per user command',()=>{
 const one=row(1,'100'),two=row(2,'200'),h=harness([one,two]);h.context.pushUndo({kind:'batch',actions:[{id:1,fields:[{key:'note_col_1',prev:'first',next:'next'}]},{id:2,fields:[{key:'note_col_1',prev:'second',next:'next'}]}]});
 h.context.undo();assert.equal(one.note_col_1,'first');assert.equal(two.note_col_1,'second');assert.equal(h.calls.render,1);assert.equal(h.calls.invalidate,1);assert.deepEqual(h.calls.refreshIds,[2,1]);
});

test('bulk paste refuses a stale source row before mutating a reused display id',()=>{
 const original=row(1,'100'),h=harness([original]),foreign=row(1,'999');h.context.state.cp.rows=[foreign];
 const result=h.context.applyCpGridPasteConfirmed({source:{rows:1,columns:1},readonly:0,skipped:0,invalid:0,ops:[{row:original,column:{k:'note_col_1'},target:'text',value:'denied'}]},{});
 assert.equal(result.ok,false);assert.equal(foreign.note_col_1,'next');assert.equal(h.calls.dirty.length,0);
});

for(const invalidation of ['identity','owner'])test('the real delivery dropdown rejects stale '+invalidation+' instead of bypassing the bound editor',()=>{
 const original={...row(1,'100'),'Del. Type':'Gemi'},h=harness([original]),ctx=h.context,listeners={},options=['','Gemi','Uçak'].map(value=>({dataset:{value},events:{},addEventListener(name,fn){this.events[name]=fn;}}));
 const trigger={dataset:{id:'1',key:'Del. Type',kind:'deltype',value:'Gemi',lineKey:ctx.lineKeyOfRow(original),editOwner:'buyer'},setAttribute(){},getBoundingClientRect:()=>({width:150})},menu={style:{},setAttribute(){},querySelectorAll:()=>options,remove(){}};
 ctx.document={addEventListener:(name,fn)=>{listeners[name]=fn;},createElement:()=>menu,body:{appendChild(){}}};ctx.window.addEventListener=()=>{};ctx.window.innerHeight=973;ctx.DELTYPE_OPTS=['Gemi','Uçak'];ctx.escapeHtml=String;ctx.transitDelTypeDisplay=value=>value;ctx.requestAnimationFrame=()=>{};
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'),start=html.indexOf('(function initDelTypeDropdown(){'),end=html.indexOf('\n})();',start);vm.runInContext(html.slice(start,end+6),ctx);
 listeners.click({target:{closest:()=>trigger},preventDefault(){},stopPropagation(){}});
 const current={...row(1,invalidation==='identity'?'999':'100'),'Del. Type':'Gemi'};ctx.state.cp.rows=[current];if(invalidation==='owner')ctx.state.currentUser={id:'other'};
 options.find(option=>option.dataset.value==='Uçak').events.click({stopPropagation(){}});assert.equal(current['Del. Type'],'Gemi');assert.equal(h.calls.dirty.length,0);assert.equal(h.calls.render,0);
});
