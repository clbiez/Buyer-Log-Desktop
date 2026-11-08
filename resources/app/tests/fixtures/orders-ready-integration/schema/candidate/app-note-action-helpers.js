// App-local private declarations, not authority or a second revision store.
function ordersNoteActionStamp(kind){
  try{
    // Name-clash validation uses the actual current CP key/label catalog too.
    const names=CP_COLS.map(column=>[column.k,column.label]);
    if(kind==='shared')return JSON.stringify([CP_NOTE_COLUMN_DEFS_REVISION,CP_NOTE_COLUMN_DEFS,names]);
    const notes=window.BLPersonalNoteColumns,store=window.BLStorage;
    return JSON.stringify([notes?.definitions?.()||[],store?store.getItem('lcw.personalOrderNotes.definitions.v1'):null,names]);
  }catch(_){return null;}
}
function captureOrdersNoteAction(kind){
  return {kind,intent:captureOrdersConfigurationIntent(),profile:state.currentUser,userContext:window.BL_USER_CONTEXT,
    actor:String(state.currentUser?.id),contextActor:String(window.BL_USER_CONTEXT?.id),page:activeProfilePage(),
    notes:window.BLPersonalNoteColumns,store:window.BLStorage,stamp:ordersNoteActionStamp(kind)};
}
function assertOrdersNoteActionSource(action){
  assertOrdersConfigurationIntent(action.intent);
  if(action.profile!==state.currentUser||action.userContext!==window.BL_USER_CONTEXT
    ||action.actor!==String(state.currentUser?.id)||action.contextActor!==String(window.BL_USER_CONTEXT?.id)
    ||action.page!==activeProfilePage()||(action.kind==='personal'&&(action.notes!==window.BLPersonalNoteColumns||action.store!==window.BLStorage)))
    throw ordersFullActionError('ORDERS_FULL_STALE');
  _ordersRequireFullSynchronousRead();
}
function assertOrdersNoteAction(action){
  assertOrdersNoteActionSource(action);
  if(action.stamp===null||action.stamp!==ordersNoteActionStamp(action.kind))throw ordersFullActionError('ORDERS_FULL_STALE');
}
function acknowledgeOrdersNoteAction(action){
  // Acknowledge only the known successful definition revision. The original
  // profile/source/session intent is never recaptured or advanced for our write.
  assertOrdersNoteActionSource(action);action.stamp=ordersNoteActionStamp(action.kind);
  if(action.stamp===null)throw ordersFullActionError('ORDERS_FULL_STALE');
}
