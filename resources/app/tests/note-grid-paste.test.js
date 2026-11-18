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
  const {applyOrdersGridPaste}=loadAppMainFunctions(['applyOrdersGridPaste','orderLinePeerOwner'],{
    window:{},
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
    const {applyOrdersGridPaste}=loadAppMainFunctions(['applyOrdersGridPaste','orderLinePeerOwner'],{
    window:{},
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
  const fns=loadAppMainFunctions(['applyOrdersGridPaste','cpPasteTarget','orderLinePeerOwner'],{
    window:{},
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
  const history=[];
  const fns=loadAppMainFunctions(['cpPasteTarget','applyCpGridPaste','applyPersonalNotePaste','renderPersonalNoteChanges',
    'cpBulkUniqueOperations','orderLinePeerOwner','notifyPersonalNotePaste','applyHistoryAction'],{
    isAreaFrozen:()=>false,pushUndo:action=>history.push(action),tableColumnLabel:(_table,column)=>column.k,
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
  assert.equal(history.length,1);
  fns.applyHistoryAction(history[0],'undo');
  assert.equal(store.get('personal_note_x|1|OC1'),'');
  fns.applyHistoryAction(history[0],'redo');
  assert.equal(store.get('personal_note_x|1|OC1'),'benim notum');
});
test('Orders loads canonical permissions on demand when CP has not been opened',async()=>{
  const state={cp:null},canonical={_id:5,canonical:'a'},display={_id:99,canonical:'a',_canEdit:false};
  let writes=0,loads=0;
  const fns=loadAppMainFunctions(['ordersPasteTarget','cpPasteTarget','applyOrdersGridPaste','orderLinePeerOwner'],{
    window:{},
    state,isAreaFrozen:()=>false,orderLinePeerRows:()=>state.cp?[canonical]:[],
    ensureCpLoaded:async()=>{loads++;state.cp={rows:[canonical]};return true;},
    applyCpGridPaste:()=>{writes++;return {ok:true};},
  });
  const column={k:'Notes',type:'text'};
  assert.equal(fns.ordersPasteTarget(display,column),'note');
  assert.equal((await fns.applyOrdersGridPaste({ops:[{row:display,column,target:'note',value:'copied'}]},{})).ok,true);
  assert.equal(loads,1);assert.equal(writes,1);
});

test('Orders Supp. FOB uses canonical identity and shared edit permissions when rendered',()=>{
  const canonical={_id:5,'Supp. FOB':2,_canEdit:true,_canEditShared:true};
  const display={_id:99,'Supp. FOB':2,_canEdit:false};
  const {cellHtml}=loadAppMainFunctions(['cellHtml'],{
    state:{cp:{rows:[canonical]}},orderLinePeerRows:()=>[canonical],
    appLang:'en',L:s=>s,escapeHtml:String,revisionInfo:()=>null,columnSchemaFor:()=>null,
    cpEditorIdentityAttributes:row=>' data-line-key="line-'+row._id+'" data-edit-owner="buyer"',
    CP_FABRIC_PLM_KEY:'fabric',toNum:Number,fmtMoneyPlain:String,isTurkeyCountry:()=>false,
    suppFobRuleMissing:()=>false,suppFobHoverText:()=>'',isSuppFobAutoCalculated:()=>false,
  });
  const column={k:'Supp. FOB',type:'moneyEdit'};
  assert.match(cellHtml(column,display,null,'orders',canonical),/data-id="5" data-line-key="line-5" data-edit-owner="buyer"/);
  assert.match(cellHtml(column,display,null,'orders',{...canonical,_canEditShared:false}),/viewOnlyCell/);
  assert.match(cellHtml(column,display,null,'orders',{...canonical,_canEdit:false}),/viewOnlyCell/);
  assert.match(cellHtml(column,display,null,'orders',null),/viewOnlyCell/);
  assert.equal(display._canEdit,false);
});

test('private note paste history keeps previous and next values and never writes after a user change',()=>{
  const values=new Map([['private|line','before']]);
  const user={id:'buyer'};
  const fn=loadAppMainFunctions(['applyPersonalNotePaste','applyHistoryAction','renderPersonalNoteChanges'],{
    state:{}, window:{BL_USER_CONTEXT:user,BLPersonalNoteColumns:{
      readValue:(id,line)=>values.get(id+'|'+line)||'',
      writeValue:(id,line,value)=>{values.set(id+'|'+line,value);return value;},
    }},lineKeyOfRow:()=> 'line',
  });
  const result=fn.applyPersonalNotePaste([{row:{},column:{k:'private'},value:'after'}],user.id);
  assert.equal(result.history.kind,'personalNote');
  fn.applyHistoryAction(result.history,'undo');
  assert.equal(values.get('private|line'),'before');
  fn.applyHistoryAction(result.history,'redo');
  assert.equal(values.get('private|line'),'after');
  user.id='another';
  fn.applyHistoryAction(result.history,'undo');
  assert.equal(values.get('private|line'),'after');
});

test('Orders never forwards a provisional paste whose canonical permission is denied after lazy load',async()=>{
  const state={cp:null},canonical={_id:5,_canEdit:false},display={_id:99,_canEdit:false};
  const {applyOrdersGridPaste,ordersPasteTarget}=loadAppMainFunctions(['applyOrdersGridPaste','ordersPasteTarget','cpPasteTarget','orderLinePeerOwner'],{
    window:{},
    state,appLang:'en',isAreaFrozen:()=>false,showToast(){},
    orderLinePeerRows:()=>state.cp?[canonical]:[],
    ensureCpLoaded:async()=>{state.cp={rows:[canonical]};return true;},
    applyCpGridPaste:()=>assert.fail('Unauthorised write'),
  });
  const column={k:'Notes',type:'text'};
  const target=ordersPasteTarget(display,column);
  assert.equal(target,'note');
  assert.equal((await applyOrdersGridPaste({ops:[{row:display,column,target,value:'copy'}]},{})).ok,false);
});

test('mixed paste previews both kinds of cell and attaches one private undo to the server-confirmed history',async()=>{
  const row={_id:5,'Order Code':1001,Notes:'shared before'};
  const user={id:'buyer'},histories=[],sent=[];
  let local='private before',preview;
  const history={kind:'batch',actions:[{id:5,lineKey:'line',fields:[{key:'Notes',prev:'shared before',next:'shared after'}]}]};
  const functions=loadAppMainFunctions(['applyCpGridPaste','applyPersonalNotePaste','cpBulkUniqueOperations','cpGridBulkTitle',
    'orderLinePeerOwner','renderPersonalNoteChanges','applyHistoryAction','applyCpBulkHistory'],{
    appLang:'en',state:{currentUser:user,cp:{rows:[row]},storeRevisions:{orders:2,suppFob:3}},
    window:{BL_USER_CONTEXT:user,BLPersonalNoteColumns:{
      readValue:()=>local,writeValue:(_id,_key,value)=>{local=value;return value;},
    },BLBulkOperations:{run:async spec=>{
      preview=spec.items;
      assert.equal(spec.guard(),true);
      const result=await spec.send();
      return {status:'accepted',outcomes:result.outcomes};
    }}},
    document:{activeElement:null},lineKeyOfRow:r=>r?'line':'',sameOrderLine:(a,b)=>a===b,
    isAreaFrozen:()=>false,tableColumnLabel:(_table,column)=>column.k,renderCP(){},managedEditorSnapshot:()=>null,
    settleOverrideWrites:async()=>{},cpPasteTarget:()=> 'note',cpBulkInFlight:false,bulkCpHistoryBusy:false,
    withCpBulkDraft:(_keys,apply)=>({value:apply()}),
    enqueueOverrideMutation:async(_scope,_url,request)=>{sent.push(JSON.parse(request.body));return {updated:1,revisions:{orders:4,suppFob:3}};},
    applyAcknowledgedCpDraft(){},cpBulkHistoryCurrent:()=>true,orderLinePeerRows:()=>[row],
    applyCpGridPasteConfirmed:plan=>{
      assert.equal(plan.ops.length,1);
      assert.equal(plan.ops[0].target,'note');
      return {ok:true,history};
    },
    pushUndo:action=>histories.push(action),
  });
  const ctx=functions.context;
  ctx.window.captureOverrideBatch=apply=>{
    apply();
    return {items:[{orderCode:1001,notes:'shared only'}],resolve(){},reject(){}};
  };
  const result=await functions.applyCpGridPaste({ops:[
    {row,column:{k:'Notes'},target:'note',value:'shared after'},
    {row,column:{k:'personal_note_demo'},target:'personalNote',value:'private after'},
  ]},{});
  assert.equal(result.ok,true);
  assert.equal(preview.length,2);
  assert.equal(local,'private after');
  assert.equal(histories.length,1);
  assert.equal(histories[0].actions.length,1);
  assert.equal(histories[0].personalNote.kind,'personalNote');
  assert.deepEqual(sent,[{items:[{orderCode:1001,notes:'shared only'}]}]);
  // Exercise the ACK boundary independently of the shared field formatter.
  ctx.syncOverridesFromRow=()=>{};
  const applyHistory=functions.applyHistoryAction;
  ctx.applyHistoryAction=(action,direction)=>{if(action.kind==='personalNote')applyHistory(action,direction);};
  assert.equal(await functions.applyCpBulkHistory(histories[0],'undo'),true);
  assert.equal(local,'private before');
  assert.equal(await functions.applyCpBulkHistory(histories[0],'redo'),true);
  assert.equal(local,'private after');
});

for(const kind of ['clear','fill'])test('private-only '+kind+' previews before it writes and cancels cleanly',async()=>{
  const user={id:'buyer'};
  let confirmed=false,writes=0;
  const fns=loadAppMainFunctions(['applyCpGridPaste','cpBulkUniqueOperations','cpGridBulkTitle','orderLinePeerOwner','applyPersonalNotePaste',
    'renderPersonalNoteChanges','notifyPersonalNotePaste'],{
    state:{},appLang:'en',lineKeyOfRow:()=> 'line',tableColumnLabel:(_table,column)=>column.k,
    isAreaFrozen:()=>false,showToast(){},pushUndo(){},
    window:{BL_USER_CONTEXT:user,BLPersonalNoteColumns:{readValue:()=> 'old',writeValue:(_id,_key,value)=>{writes++;return value;}},
      BLBulkOperations:{run:async spec=>{
        assert.equal(spec.localOnly,true);
        assert.equal(writes,0);
        assert.equal(spec.items[0].before,'old');
        return confirmed?spec.send():null;
      }}},
  });
  const plan={kind,ops:[{row:{},column:{k:'personal_note_demo'},target:'personalNote',value:kind==='clear'?'':'new'}]};
  assert.equal((await fns.applyCpGridPaste(plan,{})).ok,false);
  assert.equal(writes,0);
  confirmed=true;
  assert.equal((await fns.applyCpGridPaste(plan,{})).ok,true);
  assert.equal(writes,1);
});

test('managed Excel export does not invoke the personal note renderer or include its value',()=>{
  const {managedExcelExportRows}=loadAppMainFunctions(['managedExcelExportRows'],{
    document:{createElement:()=>({dataset:{},children:[{dataset:{}},{dataset:{}}]})},
    ordersCellHtml:(column,row)=>{assert.equal(column.k,'Notes');return '<td>'+row.Notes+'</td>';},
    cellHtml:()=>assert.fail('Orders must use its own export formatter'),
  });
  const [row]=managedExcelExportRows([{_id:5,Notes:'exportable'}],'orders',[
    {k:'Notes'},{k:'personal_note_demo',personalNote:true},
  ]);
  assert.equal(row.innerHTML,'<td>exportable</td><td></td>');
  assert.equal(row.children[1].dataset.key,'personal_note_demo');
});

test('a virtualized Orders cell mounts its editor with the canonical row before grid IDs are assigned',()=>{
  const display={_id:99},canonical={_id:5,_canEdit:true};
  const column={k:'Supp. FOB',type:'moneyEdit'};
  const table={_blRenderedRows:[display],_blRenderedColumns:[column]};
  const td={dataset:{r:'0',c:'0'},closest:()=>table,isConnected:true,classList:{contains:()=>false}};
  const calls=[];
  const {prepareOrdersCellEdit}=loadAppMainFunctions(['prepareOrdersCellEdit'],{
    state:{cp:{rows:[canonical]}},lineKeyOfRow:()=> 'line',orderLinePeerOwner:()=> 'buyer',
    isAreaFrozen:()=>false,orderLinePeerRows:()=>[canonical],cpPasteTarget:()=> 'suppfob',
    mountOrdersInput:(...args)=>calls.push(args),
    ensureCpLoaded:()=>assert.fail('CP is already loaded'),
  });
  assert.equal(prepareOrdersCellEdit(td,()=>true),true);
  assert.deepEqual(calls,[[td,display,column,canonical]]);
});
