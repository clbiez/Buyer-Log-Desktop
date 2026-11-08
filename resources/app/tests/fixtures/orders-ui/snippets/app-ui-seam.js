// New proposed private declarations; none is an existing product export.
let _ordersUiCommandGate=null;
function ordersUiChange(tableKey,reason,lane,inspect,change){
  if(tableKey!=='orders'||!ordersProjectionIsThin())return change(null);
  const api=window.BLOrdersUiCommand;
  if(!api){showToast(ordersFullActionError('ORDERS_FULL_STALE').message,{kind:'error'});return Promise.resolve(false);}
  if(!_ordersUiCommandGate)_ordersUiCommandGate=api.create({
    isThin:ordersProjectionIsThin,activeTab:()=>currentActiveTab(),
    captureSource:()=>{
      const controller=_ordersFullViewControllers.get(state.orders);
      if(!controller||typeof controller.captureUiSource!=='function')throw ordersFullActionError('ORDERS_FULL_STALE');
      return controller.captureUiSource();
    },
    ensureFull:reason=>ensureOrdersFullForAction(reason),
    onError:error=>showToast(ordersFullActionError(error?.code==='ORDERS_FULL_FORBIDDEN'?'ORDERS_FULL_FORBIDDEN':'ORDERS_FULL_STALE').message,{kind:'error'}),
  });
  return _ordersUiCommandGate.run({reason,lane,inspect,change});
}
function ordersUiIntent(nodes,read,extra){return window.BLOrdersUiCommand.intent(nodes,read,extra);}
function ordersUiControlsIntent(){
  const ids=['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason'];
  const nodes=ids.map(id=>document.getElementById(id));
  return ordersUiIntent(nodes,()=>nodes.map(node=>node&&node.value),()=>ids.every((id,i)=>document.getElementById(id)===nodes[i]));
}
function ordersUiPanelIntent(panel,extraNodes=[]){
  const nodes=[...panel.querySelectorAll('input,select,textarea')],targets=[panel,...extraNodes];
  return ordersUiIntent([...targets,...nodes],()=>[...nodes,...extraNodes].map(node=>[node.value,node.checked,node.dataset?.id||'',node.dataset?.dir||'']),
    ()=>{const live=[...panel.querySelectorAll('input,select,textarea')];return _openFilterPanel===panel&&live.length===nodes.length&&live.every((node,index)=>node===nodes[index]);});
}
window.BLOrdersUiChange=ordersUiChange;
