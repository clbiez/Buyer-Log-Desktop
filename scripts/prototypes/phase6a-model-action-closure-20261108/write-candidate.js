async function writeCpModelColumn(sourceId, cpColumn, action=null){
  const intent=captureOrdersConfigurationIntent();
  const profile=state.currentUser,userContext=window.BL_USER_CONTEXT,actor=profile?.id,contextActor=userContext?.id;
  const command=JSON.stringify(cpColumn);
  if(ordersProjectionIsThin())await ensureOrdersFullForAction('orders.model-column.write');
  assertOrdersConfigurationIntent(intent);
  if(state.currentUser!==profile||window.BL_USER_CONTEXT!==userContext||profile?.id!==actor||userContext?.id!==contextActor
    ||JSON.stringify(cpColumn)!==command)throw ordersFullActionError('ORDERS_FULL_STALE');
  _ordersRequireFullSynchronousRead();
  action=action||captureCpModelAction();
  action.assert();
  // Keep the command captured before any await, including direct callers.
  const assertCommand=()=>{
    action.assert();
    if(JSON.stringify(cpColumn)!==command)throw ordersFullActionError('ORDERS_FULL_STALE');
  };
  await loadCpModelActionConfiguration(action);
  assertCommand();
  const source=(modelConnState.items||[]).find(item=>item&&item.id===sourceId);
  if(!source)throw new Error(appLang==='en'?'Connection not found':'Bağlantı bulunamadı');
  const res=await fetch(`/api/data-management/source/${encodeURIComponent(sourceId)}`,{
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({cpColumn:JSON.parse(command),expectedSourceRevision:source.configRevision||''})});
  assertCommand();
  const data=await res.json().catch(()=>({}));
  assertCommand();
  if(!res.ok||!data.ok)throw new Error(data.error||res.statusText);
  // Missing/unknown revision cannot justify an epoch transition. Unchanged
  // legacy callees still return the same items reference and need no receipt.
  const revision=Number.isSafeInteger(data.revision)&&data.revision>=0?data.revision:null;
  await loadCpModelActionConfiguration(action,revision);
  assertCommand();
  return modelConnState.items;
}
