'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app-main.js'),'utf8');
const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const row=(id,code,extra={})=>({_id:id,'Order Code':code,'Model Name':'DEMO','C.Code':'01',Notes:'old',_notesBy:'me','Ek Not':'private',_ekNotBy:'other',...extra});
function harness(rows,server=true){
  const calls=[],elements=new Map();
  const element=()=>({dataset:{},value:'',disabled:false,hidden:false,textContent:'',events:{},addEventListener(event,fn){this.events[event]=fn;},focus(){},setSelectionRange(){}});
  const modal=element();modal.querySelector=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};modal.remove=()=>{modal.removed=true;};
  const context={state:{cp:{rows},orders:{rows:rows.map(r=>({...r}))},overrides:{notesmap:{}},cpDirty:new Set()},window:{SERVER_BACKED:server},document:{activeElement:null,getElementById:()=>null,createElement:()=>modal,body:{appendChild(){}}},appLang:'en',norm:v=>String(v??'').trim(),L:s=>s,fmtOC:s=>s,escapeHtml:s=>s,setTimeout:()=>{},editableValuesEqual:(a,b)=>a===b,isAreaFrozen:()=>false,noteAuthoredByCurrentUser:id=>id==='me',overviewNoteCanonical:s=>s.trim(),showToast:msg=>calls.push(['toast',msg]),renderOrders:()=>calls.push(['renderOrders']),settleOverrideWrites:async()=>{},enqueueOverrideMutation:async(kind,url,opts)=>{calls.push(['write',JSON.parse(opts.body)]);return {ok:true,updated:JSON.parse(opts.body).items.length};},pushUndo:a=>calls.push(['undo',a]),_origMarkDirty:id=>calls.push(['dirty',id]),refreshRowEverywhere:id=>calls.push(['refresh',id]),markDirty:id=>calls.push(['local',id]),noteAuthorIdentity:()=>({id:'me',name:'Demo User'}),remoteRowLists(){return [this.state.cp.rows,this.state.orders.rows];}};
  vm.createContext(context);
  context.refreshRowsEverywhere=ids=>{calls.push(['refreshBatch',[...ids]]);ids.forEach(id=>context.refreshRowEverywhere(id));};
  vm.runInContext(block('function turknorm(','// ================= LICENSE ROYALTY'),context);
  context.window.BLOrderLinePeerIndex=require('../public/order-line-peer-index');
  vm.runInContext(block('function orderLinePeerOwner(','function syncOrderLinePeersFromCpRow('),context);
  vm.runInContext(block('function openNotesEditor(','function clearRowNote('),context);
  vm.runInContext(block('function overviewOrderNoteText(','function overviewNoteTimestamp('),context);
  vm.runInContext(block('function overviewNoteEditTarget(','function openOverviewNoteOrderInCp('),context);
  return {context,calls,modal,elements,open(id=1,key='Notes'){context.openNotesEditor(id,key);},async save(value){elements.get('.noteEditorArea').value=value;await elements.get('.notesEditorSave').events.click();}};
}
test('Overview edits all matching own note fields in the clicked group; unrelated fields stay intact',async()=>{
  const one=row(1,'100'),two=row(2,'200',{Notes:'',_notesBy:'','Ek Not':'old',_ekNotBy:'me'}),other=row(3,'300');
  const h=harness([one,two,other]);h.context.openOverviewNoteEditor({note:'old',rows:[one,two]});assert.equal(h.modal.dataset.uiMigrated,'note-editor');await h.save('revised');
  assert.equal(one.Notes,'revised');assert.equal(two['Ek Not'],'revised');assert.equal(one['Ek Not'],'private');assert.equal(other.Notes,'old');
  const items=h.calls.find(c=>c[0]==='write')[1].items;assert.equal(items.length,2);assert.deepEqual(items.map(i=>i.patch.notes),[{Notes:'revised'},{EkNot:'revised'}]);
  assert.equal(h.context.state.orders.rows[0].Notes,'revised','preview projections update too');
  assert.equal(h.calls.filter(c=>c[0]==='renderOrders').length,1,'successful save refreshes Orders once');
  assert.ok(h.modal.removed,'successful save closes the editor');
});
test('save resolves the canonical order again after a refresh reuses display ids',async()=>{
  const original=row(1,'100'),h=harness([original]);h.open();
  const replacement=row(9,'100'),reused=row(1,'999');h.context.state.cp.rows=[reused,replacement];await h.save('revised');
  assert.equal(replacement.Notes,'revised');assert.equal(reused.Notes,'old');assert.equal(original.Notes,'old');
  assert.equal(h.calls.find(c=>c[0]==='undo')[1].id,9);
});
test('save waits for acknowledgement, prevents duplicate submits and keeps the draft on failure',async()=>{
  const one=row(1,'100'),h=harness([one]);let reject;
  h.context.enqueueOverrideMutation=()=>new Promise((_,no)=>{reject=no;});h.open();
  const saving=h.save('draft');await new Promise(setImmediate);
  assert.equal(one.Notes,'old');assert.ok(h.elements.get('.notesEditorSave').disabled);assert.ok(!h.modal.removed);
  await h.save('draft');reject(new Error('offline'));await saving;
  assert.equal(one.Notes,'old');assert.ok(!h.modal.removed);assert.equal(h.elements.get('.noteEditorArea').value,'draft');assert.equal(h.elements.get('.notesEditorSave').disabled,false);
  assert.ok(h.calls.some(c=>c[0]==='toast'));
  assert.equal(h.calls.filter(c=>c[0]==='renderOrders').length,0,'failed save cannot render an acknowledged state');
});
test('changed, missing and view-only targets cannot be silently overwritten',async()=>{
  for(const change of [r=>r.Notes='remote edit',r=>r._canEdit=false,(_r,h)=>h.context.state.cp.rows=[]]){
    const one=row(1,'100'),h=harness([one]);h.open();change(one,h);await h.save('draft');
    assert.equal(h.calls.filter(c=>c[0]==='write').length,0);assert.ok(!h.modal.removed);
  }
});
test('server authors and timestamps become the immediate preview source of truth',async()=>{
  const one=row(1,'100'),h=harness([one]);h.context.enqueueOverrideMutation=async()=>({ok:true,updated:1,overrides:{notesmap:{'100|DEMO|01':{Notes:'revised',NotesBy:'me',NotesByName:'Demo User',NotesAt:'2026-10-20T10:00:00.000Z',EkNot:'private',EkNotBy:'other'}}}});
  h.open();await h.save('revised');assert.equal(one._notesAt,'2026-10-20T10:00:00.000Z');assert.equal(one._notesBy,'me');assert.equal(one._ekNotBy,'other');assert.ok(h.modal.removed);
});
test('cancel and unchanged text never write; local file mode still saves in memory',async()=>{
  const h=harness([row(1,'100')]);h.open();await h.save('old');assert.equal(h.calls.length,0);assert.ok(h.modal.removed);
  const local=harness([row(1,'100')],false);local.open();await local.save('local');assert.equal(local.context.state.cp.rows[0].Notes,'local');assert.equal(local.calls.filter(c=>c[0]==='write').length,0);
});

test('composite own notes and a single combined field edit as one group without leaving the old preview',async()=>{
  const one=row(1,'100',{Notes:'first','Ek Not':'second',_ekNotBy:'me'}),two=row(2,'200',{Notes:'first\nsecond','Ek Not':''});
  const h=harness([one,two]);h.context.openOverviewNoteEditor({note:'first\nsecond',rows:[one,two]});
  await h.save('updated full note');
  assert.equal(h.context.overviewOrderNoteText(one),'updated full note');assert.equal(h.context.overviewOrderNoteText(two),'updated full note');
  assert.equal(one['Ek Not'],'');assert.equal(one._ekNotBy,'');assert.equal(h.calls.filter(c=>c[0]==='write').length,1);
});
test('local-file edits preserve both notes and existing authors in overrides',async()=>{
  const h=harness([row(1,'100')],false);h.open();await h.save('revised');
  const saved=h.context.state.overrides.notesmap['100|DEMO|01'];assert.equal(saved.Notes,'revised');assert.equal(saved.EkNot,'private');assert.equal(saved.EkNotBy,'other');
});

test('group save refuses a concurrent change in a field whose planned text would be unchanged',async()=>{
  const one=row(1,'100',{Notes:'first','Ek Not':'second',_ekNotBy:'me'}),h=harness([one]);
  h.context.openOverviewNoteEditor({note:'first\nsecond',rows:[one]});one.Notes='remote change';await h.save('first');
  assert.equal(h.calls.filter(c=>c[0]==='write').length,0);assert.equal(one.Notes,'remote change');assert.equal(one['Ek Not'],'second');assert.ok(!h.modal.removed);
});
test('same order code with a different colour or model is never updated by identity',async()=>{
  const one=row(1,'100'),colour=row(2,'100',{'C.Code':'02'}),model=row(3,'100',{'Model Name':'OTHER'}),h=harness([one,colour,model]);
  h.open();await h.save('revised');assert.equal(one.Notes,'revised');assert.equal(colour.Notes,'old');assert.equal(model.Notes,'old');
});

test('a note dialog cannot write after its user changes',async()=>{
 const one=row(1,'100'),h=harness([one]);h.open();h.context.state.currentUser={id:'other'};await h.save('draft');
 assert.equal(one.Notes,'old');assert.equal(h.calls.filter(c=>c[0]==='write').length,0);assert.ok(!h.modal.removed);assert.equal(h.elements.get('.noteEditorArea').value,'draft');
});

test('a late note response cannot populate another user projection through a reused canonical key',async()=>{
 const one=row(1,'100'),h=harness([one]);let acknowledge;h.context.enqueueOverrideMutation=()=>new Promise(resolve=>{acknowledge=resolve;});h.open();const saving=h.save('draft');await new Promise(setImmediate);
 const current=row(1,'100',{Notes:'other user'});h.context.state.currentUser={id:'other'};h.context.state.cp.rows=[current];h.context.state.orders.rows=[{...current}];acknowledge({ok:true,updated:1});await saving;
 assert.equal(current.Notes,'other user');assert.equal(h.context.state.orders.rows[0].Notes,'other user');assert.ok(!h.modal.removed);assert.equal(h.elements.get('.noteEditorArea').value,'draft');
});
