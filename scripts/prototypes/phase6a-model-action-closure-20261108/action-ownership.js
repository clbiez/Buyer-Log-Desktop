// Private lexical helpers for app-main.js; no window export or authority token.
const _cpModelLoadRequests=new WeakMap(),_cpModelLoadReceipts=new WeakMap(),_cpModelLoadConsumed=new WeakSet();
function cpModelActionConfiguration(){
  return JSON.stringify({items:modelConnState.items,revision:modelConnState.revision,supported:modelConnState.supported,exportFolder:modelConnState.exportFolder});
}
function captureCpModelAction(valid=()=>true){
  const profile=state.currentUser,userContext=window.BL_USER_CONTEXT;
  const actor=profile?.id,contextActor=userContext?.id,tab=currentActiveTab();
  const session=_ordersUiSessionEpoch,finite=ordersConfigurationLifecycleInvolved();
  const definitionSet=CP_MODEL_COLUMN_DEFS,definitions=JSON.stringify(definitionSet);
  let epoch=_ordersProjectionSourceEpoch,configuration=cpModelActionConfiguration();
  const assertAt=(wantedEpoch,wantedConfiguration)=>{
    if(state.currentUser!==profile||window.BL_USER_CONTEXT!==userContext||profile?.id!==actor||userContext?.id!==contextActor
      ||currentActiveTab()!==tab||_ordersUiSessionEpoch!==session||_ordersProjectionSourceEpoch!==wantedEpoch
      ||ordersConfigurationLifecycleInvolved()!==finite||CP_MODEL_COLUMN_DEFS!==definitionSet||JSON.stringify(CP_MODEL_COLUMN_DEFS)!==definitions
      ||cpModelActionConfiguration()!==wantedConfiguration||valid()!==true)throw ordersFullActionError('ORDERS_FULL_STALE');
    if(window.BLCanAccessArea?.('orders')===false)throw ordersFullActionError('ORDERS_FULL_FORBIDDEN');
    _ordersRequireFullSynchronousRead();
  };
  const action={
    assert(){assertAt(epoch,configuration);},
    // Only the actual callee can issue this receipt. Consume before checking it.
    consume(request){
      if(_cpModelLoadConsumed.has(request))throw ordersFullActionError('ORDERS_FULL_STALE');
      _cpModelLoadConsumed.add(request);
      const receipt=_cpModelLoadReceipts.get(request);_cpModelLoadReceipts.delete(request);
      if(!receipt){action.assert();return;}
      if(receipt.action!==action||receipt.startEpoch!==epoch||receipt.before!==configuration
        ||receipt.session!==session||receipt.revision!==request.revision)throw ordersFullActionError('ORDERS_FULL_STALE');
      assertAt(receipt.endEpoch,receipt.after);
      epoch=receipt.endEpoch;configuration=receipt.after;
    },
    request(revision){
      action.assert();
      const request=Object.freeze({revision});
      _cpModelLoadRequests.set(request,{action,startEpoch:epoch,before:configuration,session,
        beforeApply(next){
          action.assert();
          // A read/preflight retains the real loader's refresh behavior, but
          // receives no receipt to rebind the old UI command. The refreshed
          // config is available to a new explicit action after cancellation.
          if(revision!=null&&next.revision!==revision)
            throw ordersFullActionError('ORDERS_FULL_STALE');
        },
        beforeCommit(intent){assertAt(intent.epoch,configuration);},
        applied(intent){
          if(revision==null)return;
          // Bind to the callee's validated end, never a freshly captured epoch.
          _cpModelLoadReceipts.set(request,Object.freeze({action,startEpoch:epoch,endEpoch:intent.epoch,
            before:configuration,after:cpModelActionConfiguration(),session,revision}));
        }});
      return request;
    },
  };
  action.assert();return Object.freeze(action);
}
async function loadCpModelActionConfiguration(action,revision=null){
  const request=action.request(revision);
  try{await modelConnLoad(request);action.consume(request);action.assert();}
  finally{_cpModelLoadRequests.delete(request);_cpModelLoadReceipts.delete(request);}
}
