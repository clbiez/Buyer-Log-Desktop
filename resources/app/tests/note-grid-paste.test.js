'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadAppMainFunctions}=require('./helpers/app-main-functions');
const Grid=require('../public/grid-clipboard');

test('CP accepts both note fields and keeps view-only rows protected',()=>{
  const {cpPasteTarget}=loadAppMainFunctions(['cpPasteTarget'],{});
  for(const k of ['Notes','Ek Not']){
    assert.equal(cpPasteTarget({_id:1},{k,type:'text'}),'note');
    assert.equal(cpPasteTarget({_id:1,_canEdit:false},{k,type:'text'}),null);
  }
});
test('Orders paste resolves every CP-editable column through canonical CP identities',()=>{
  const cp={_id:5,canonical:'a'},display={_id:99,canonical:'a',_canEdit:false};
  const {ordersPasteTarget}=loadAppMainFunctions(['ordersPasteTarget','cpPasteTarget'],{
    state:{cp:{rows:[cp]}},
    orderLinePeerRows:(_table,row)=>row.canonical==='a'?[cp]:[],
    BLRevision:{isAutomaticExFactory:()=>false},
    window:{BLOrderImportanceUI:{pasteResolve:()=>({ok:true,value:''})}},
  });
  assert.equal(ordersPasteTarget(display,{k:'Notes',type:'text'}),'note');
  assert.equal(ordersPasteTarget(display,{k:'Supp. FOB',type:'moneyEdit'}),'suppfob');
  assert.equal(ordersPasteTarget(display,{k:'Ex-factory',type:'exfactory'}),'exfactory');
  assert.equal(ordersPasteTarget(display,{k:'Retail Date',type:'retailEdit'}),'retail');
  assert.equal(ordersPasteTarget(display,{k:'Del. Type',type:'deltype'}),'deltype');
  assert.equal(ordersPasteTarget(display,{k:'Importance',type:'importance'}),'importance');
  assert.equal(ordersPasteTarget(display,{k:'note_x',type:'text',noteCustom:true}),'text');
  // Hesaplanan/kaynak alanlar ve Orders'a özel durum sütunu yazılmaz.
  assert.equal(ordersPasteTarget(display,{k:'Order Qty',type:'int'}),null);
  assert.equal(ordersPasteTarget(display,{k:'Active/Inactive',type:'active'}),null);
  // Ortak alan yetkisi asıl CP satırından gelir.
  cp._canEditShared=false;
  assert.equal(ordersPasteTarget(display,{k:'Supp. FOB',type:'moneyEdit'}),null);
  assert.equal(ordersPasteTarget(display,{k:'Notes',type:'text'}),'note');
  delete cp._canEditShared;
  assert.equal(ordersPasteTarget({...display,canonical:'missing'},{k:'Notes',type:'text'}),null);
  cp._canEdit=false;
  assert.equal(ordersPasteTarget(display,{k:'Notes',type:'text'}),null);
});
test('note paste replaces stale rich HTML and undo records both values',()=>{
  for(const key of ['Notes','Ek Not']){
    const row={_id:1,[key]:'old',[key+'Html']:'<b>old</b>'},history=[],synced=[];
    const {commitCpEditor}=loadAppMainFunctions(['commitCpEditor'],{
      window:{},state:{cp:{rows:[row]}},isAreaFrozen:()=>false,resolveCpEditorRow:()=>row,
      editableValuesEqual:(a,b)=>a===b,markDirty:()=>{},pushUndo:action=>history.push(action),
      syncOrderLinePeersFromCpRow:(_row,keys)=>synced.push(keys),refreshRowEverywhere:()=>{},
    });
    assert.equal(commitCpEditor({dataset:{id:'1',key,kind:'note'},value:'new'}),true);
    assert.equal(row[key],'new');assert.equal(row[key+'Html'],'');
    assert.deepEqual(JSON.parse(JSON.stringify(history[0].fields)),[
      {key,prev:'old',next:'new'},{key:key+'Html',prev:'<b>old</b>',next:''},
    ]);
    assert.deepEqual(Array.from(synced[0]),[key,key+'Html']);
  }
});
test('note fill plans include all selected rows and skip read-only rows',()=>{
  const {cpPasteTarget,cpPasteValue}=loadAppMainFunctions(['cpPasteTarget','cpPasteValue'],{});
  const rows=[{_id:1},{_id:2,_canEdit:false},{_id:3}],columns=[{k:'Notes',type:'text'},{k:'Ek Not',type:'text'}];
  const plan=Grid.planPaste({text:'copied',rows,columns,range:{startRow:0,endRow:2,startColumn:0,endColumn:1},target:cpPasteTarget,parse:cpPasteValue});
  assert.equal(plan.ops.length,4);assert.equal(plan.readonly,2);
  assert.ok(plan.ops.every(op=>op.target==='note'&&op.value==='copied'));
});
test('Orders routes the note transaction by canonical line, never by its display ID',async()=>{
  const canonical={_id:5},display={_id:99},calls=[];
  const {applyOrdersGridPaste}=loadAppMainFunctions(['applyOrdersGridPaste'],{
    state:{cp:{rows:[canonical]}},
    isAreaFrozen:()=>false,orderLinePeerRows:()=>[canonical],cpPasteTarget:()=> 'note',
    applyCpGridPaste:(plan,range)=>{calls.push({plan,range});return {ok:true};},
  });
  const range={startRow:0,endRow:0,startColumn:0,endColumn:0};
  const result=await applyOrdersGridPaste({ops:[{row:display,column:{k:'Notes'},target:'note',value:'new'}]},range);
  assert.equal(result.ok,true);assert.equal(calls[0].plan.ops[0].row,canonical);
  assert.equal(calls[0].plan.clipboardModule,'orders');assert.equal(calls[0].range,range);
});
test('Orders cannot paste when its canonical target disappears or its area is frozen',async()=>{
  for(const frozen of [false,true]){
    let writes=0;const toasts=[];
    const {applyOrdersGridPaste}=loadAppMainFunctions(['applyOrdersGridPaste'],{
      state:{cp:{rows:[]}},appLang:'tr',showToast:message=>toasts.push(message),
      isAreaFrozen:()=>frozen,orderLinePeerRows:()=>[],
      applyCpGridPaste:()=>{writes++;},
    });
    assert.equal((await applyOrdersGridPaste({ops:[{row:{_id:99},column:{k:'Notes'},target:'note',value:'draft'}]},{})).ok,false);
    assert.equal(writes,0);
    if(!frozen)assert.match(toasts[0],/1 salt-okunur/);
  }
});
test('Orders skips rows missing from CP or whose permission changed, and writes the rest',async()=>{
  const a={_id:5,canonical:'a'},b={_id:6,canonical:'b',_canEditShared:false},calls=[];
  const fns=loadAppMainFunctions(['applyOrdersGridPaste','cpPasteTarget'],{
    state:{cp:{rows:[a,b]}},isAreaFrozen:()=>false,
    BLRevision:{isAutomaticExFactory:()=>false},
    orderLinePeerRows:(_t,row)=>row.canonical==='a'?[a]:row.canonical==='b'?[b]:[],
    applyCpGridPaste:plan=>{calls.push(plan);return {ok:true};},
  });
  const column={k:'Supp. FOB',type:'moneyEdit'};
  const ops=[{canonical:'a'},{canonical:'b'},{canonical:'gone'}].map((row,i)=>({row:{_id:90+i,...row},column,target:'suppfob',value:'2'}));
  assert.equal((await fns.applyOrdersGridPaste({ops,readonly:1},{})).ok,true);
  assert.equal(calls[0].ops.length,1);assert.equal(calls[0].ops[0].row,a);
  assert.equal(calls[0].readonly,3);assert.equal(calls[0].clipboardModule,'orders');
});
test('personal note columns paste into the private store, never the shared order row',async()=>{
  const store=new Map(),renders=[],commits=[],toasts=[];
  const notes={readValue:(id,line)=>store.get(id+'|'+line)||'',writeValue:(id,line,value)=>{store.set(id+'|'+line,String(value));return String(value);}};
  const row={_id:1,_canEdit:false,'Order Code':'OC1'};
  const fns=loadAppMainFunctions(['cpPasteTarget','applyCpGridPaste','applyPersonalNotePaste'],{
    window:{BLPersonalNoteColumns:notes,BL_USER_CONTEXT:{id:'u1'}},appLang:'tr',
    state:{cp:{rows:[row]},orders:null},lineKeyOfRow:r=>'1|'+r['Order Code'],
    renderCP:()=>renders.push('cp'),renderOrders:()=>renders.push('orders'),
    showToast:message=>toasts.push(message),commitCpEditor:()=>{commits.push(1);return true;},
  });
  const column={k:'personal_note_x',type:'text',personalNote:true};
  // Görüntüleme yetkili satırda da kişisel not yazılabilir (hücre düzenlemesiyle aynı).
  assert.equal(fns.cpPasteTarget(row,column),'personalNote');
  const result=await fns.applyCpGridPaste({ops:[{row,column,target:'personalNote',value:'benim notum'}]},{});
  assert.equal(result.ok,true);assert.equal(result.changed,1);
  assert.equal(store.get('personal_note_x|1|OC1'),'benim notum');
  assert.equal(row.personal_note_x,undefined,'ortak satır nesnesine kopyalanmamalı');
  assert.equal(commits.length,0);assert.deepEqual(renders,['cp']);
  assert.match(toasts[0],/1 kişisel not güncellendi/);
});
test('Orders loads canonical permissions on demand when CP has not been opened',async()=>{
  const state={cp:null},canonical={_id:5,canonical:'a'},display={_id:99,canonical:'a',_canEdit:false};
  let writes=0,loads=0;
  const fns=loadAppMainFunctions(['ordersPasteTarget','cpPasteTarget','applyOrdersGridPaste'],{
    state,isAreaFrozen:()=>false,orderLinePeerRows:()=>state.cp?[canonical]:[],
    ensureCpLoaded:async()=>{loads++;state.cp={rows:[canonical]};return true;},
    applyCpGridPaste:()=>{writes++;return {ok:true};},
  });
  const column={k:'Notes',type:'text'};
  assert.equal(fns.ordersPasteTarget(display,column),'note');
  assert.equal((await fns.applyOrdersGridPaste({ops:[{row:display,column,target:'note',value:'copied'}]},{})).ok,true);
  assert.equal(loads,1);assert.equal(writes,1);
});
