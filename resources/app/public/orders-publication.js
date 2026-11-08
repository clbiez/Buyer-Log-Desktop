(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.BLOrdersPublication=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const fail=code=>{throw Object.assign(Error(code),{code});};
  const check=(ok,code='ORDERS_FULL_STALE')=>{if(!ok)fail(code);};
  const isPromise=value=>value&&typeof value.then==='function';
  const sync=(fn,...args)=>{const result=fn(...args);if(isPromise(result)){Promise.resolve(result).catch(()=>{});fail('ORDERS_PUBLICATION_ASYNC');}return result;};
  function create({state,controllers,accepted,fname,getAccepted,setAccepted,sourceNow,promotionApi,clientApi,uiApi,
    fetch,sha256Bytes,nonce,normalizeDates,afterPricing,invalidateOrders}){
    const callbacks=[getAccepted,setAccepted,sourceNow,fetch,sha256Bytes,nonce,normalizeDates,afterPricing,invalidateOrders];
    check(callbacks.every(fn=>typeof fn==='function'),'ORDERS_PUBLICATION_CALLBACK');
    check([setAccepted,normalizeDates,afterPricing,invalidateOrders].every(fn=>fn.constructor?.name!=='AsyncFunction'),'ORDERS_PUBLICATION_ASYNC');
    check(promotionApi?.create&&clientApi?.createFetchFull&&uiApi?.createPrivateSource&&controllers instanceof WeakMap,'ORDERS_PUBLICATION_RUNTIME');
    check(accepted?.mode==='ready'&&accepted.parent&&typeof accepted.assertCurrent==='function'&&typeof fname==='string','ORDERS_PUBLICATION_RECEIPT');
    for(const key of ['orders','ordersSelected']){
      const d=Object.getOwnPropertyDescriptor(state,key);check(d&&Object.prototype.hasOwnProperty.call(d,'value')&&d.writable===true,'ORDERS_PUBLICATION_STATE');
    }
    // Real app selections are display IDs, not row references. This first slice
    // never guesses their mapping; only the same actual empty Set is admitted.
    const previous=state.orders,selected=state.ordersSelected,previousAccepted=getAccepted();
    check(previous===null&&selected instanceof Set&&selected.size===0&&previousAccepted==null,'ORDERS_FULL_SELECTION');
    const parent=Object.freeze({...accepted.parent,token:Object.freeze({...accepted.parent.token})});
    const source=sourceNow();
    check(source&&Object.isFrozen(source)&&source.allowed===true&&Number.isSafeInteger(source.sessionEpoch)
      &&Number.isSafeInteger(source.sourceEpoch),'ORDERS_PUBLICATION_SOURCE');
    const entries=Object.entries(source);
    check(entries.length>0&&entries.length<=32&&entries.every(([,v])=>['string','number','boolean'].includes(typeof v)),'ORDERS_PUBLICATION_SOURCE');
    const expected={actorId:parent.token.actorId,ownerId:parent.token.ownerId,sourceId:parent.token.sourceProjectionKey,
      generation:parent.token.sourceGeneration,sourceRevision:parent.token.sourceRevision,moduleInputKey:parent.token.moduleInputKey,
      accessHash:parent.token.accessHash,guardStamp:parent.guardStamp,fullGzipChecksum:parent.fullGzipChecksum,
      rawJsonSha256:parent.fullJsonSha256,planHash:parent.planHash};
    check(Object.entries(expected).every(([key,value])=>source[key]===value),'ORDERS_PUBLICATION_SOURCE');
    const sessionId='orders-ui-session:'+source.sessionEpoch;
    const identity=Object.freeze({ownerId:parent.token.ownerId,sessionId,sourceId:parent.token.sourceProjectionKey,
      generation:parent.token.sourceGeneration,accessHash:parent.token.accessHash,scopeHash:parent.guardStamp,module:'orders',
      planHash:parent.planHash,fullProjectionChecksum:parent.fullJsonSha256,fullByteLength:parent.fullJsonBytes,rowCount:parent.rowCount});
    function assertSource(){
      const now=sourceNow();
      check(now&&Object.isFrozen(now)&&Object.keys(now).length===entries.length
        &&entries.every(([key,value])=>Object.prototype.hasOwnProperty.call(now,key)&&now[key]===value));
    }
    function assertSelection(){check(state.ordersSelected===selected&&selected.size===0,'ORDERS_FULL_SELECTION');}
    function beforeReady(){assertSource();assertSelection();check(state.orders===previous&&getAccepted()===previousAccepted);accepted.assertCurrent();}
    function freshRows(rows){
      check(Array.isArray(rows)&&rows.length===parent.rowCount,'ORDERS_FULL_STATE');
      const fresh=rows.map(row=>{
        check(row&&typeof row==='object'&&!Array.isArray(row),'ORDERS_FULL_ROW');const out={...row};
        // Actual normalizeCPDates writes arrival/handover inside each segment.
        // Copy that affected closure; unrelated nested values are not copied.
        if(Array.isArray(row._logisticSegments))out._logisticSegments=row._logisticSegments.map(segment=>{
          check(segment&&typeof segment==='object'&&!Array.isArray(segment),'ORDERS_FULL_ROW');return {...segment};
        });
        return out;
      });
      // Match actual ensureOrdersLoaded: normalize first, then assign the flag.
      // This preserves every native added key's insertion order, with only one
      // row clone. An already present flag keeps its original key position.
      sync(normalizeDates,fresh);
      for(let index=0;index<fresh.length;index++){
        check(Object.keys(rows[index]).every(key=>Object.prototype.hasOwnProperty.call(fresh[index],key)),'ORDERS_FULL_PRESENCE');
        fresh[index]._canEdit=false;
      }
      return fresh;
    }
    beforeReady();const rows=freshRows(accepted.payload.rows);beforeReady();
    const view={fname,rows},ordinals=rows.map((_,index)=>index);
    // Interface revisions reflect existing private source/session epochs. They
    // do not authorize edits or certify an ungated in-place row writer as clean.
    let frame={view,rows,rowRefs:rows.slice(),native:{kind:'thin',rows,ordinals,selectedRows:[],identity,requiredKeys:[],
      mutationRevision:source.sourceEpoch,selectionRevision:source.sessionEpoch,dirty:false}};
    let published=false,lastFull=null;
    const after=new WeakMap();
    function assertLive(){
      assertSource();assertSelection();check(published&&state.orders===frame.view&&state.orders.rows===frame.rows&&getAccepted()===accepted);
    }
    function snapshot(){
      assertLive();assertRows();return frame.native;
    }
    function assertRows(){check(frame.view.rows===frame.rows&&frame.rows.length===frame.rowRefs.length&&frame.rows.every((row,index)=>row===frame.rowRefs[index]));}
    const fetchFull=clientApi.createFetchFull({promotionApi,fetch,sha256Bytes,live:()=>{
      assertLive();return {...parent,sessionId,nonce,assertCurrent:assertLive};
    }});
    const native=promotionApi.create({snapshot,fetchFull,
      normalize:(fullRows,{ordinals:fullOrdinals,signal})=>{
        check(!signal?.aborted);assertLive();const normalized=freshRows(fullRows);assertLive();
        return {rows:normalized,ordinals:[...fullOrdinals]};
      },isCurrent:()=>{assertLive();return true;},
      publish:(next,{expected:old,assertCurrent})=>{
        assertCurrent();assertLive();check(frame.native===old);
        const fullView={...frame.view,rows:next.rows},oldView=frame.view;
        // No await, save, pricing, event or render in this publication boundary.
        // Existing synchronous wide-read gates see this full view as unsettled
        // until post hooks complete. Native snapshot remains kind:'full'.
        controllers.set(fullView,controller);
        frame={view:fullView,rows:next.rows,rowRefs:next.rows.slice(),native:next};
        state.orders=fullView;state.ordersSelected=selected;controllers.delete(oldView);return next;
      }});
    const ui=uiApi.createPrivateSource({moduleNow:()=>state.orders,sourceNow:()=>{assertSource();return sourceNow();},lastFull:()=>lastFull});
    function postPublish(full){
      full.assertCurrent();
      if(!after.has(full.rows)){
        const status={error:null,settled:false};after.set(full.rows,status);
        // Once per published row array, including simultaneous subscribers and
        // failures. A committed full source is never rolled back into thin.
        try{sync(afterPricing,full.rows);}catch(error){status.error=error;}
        try{sync(invalidateOrders);}catch(error){if(!status.error)status.error=error;}
      }
      const status=after.get(full.rows);if(status.error)throw status.error;
      full.assertCurrent();
      if(!status.settled){check(controllers.get(frame.view)===controller);controllers.delete(frame.view);status.settled=true;}
      lastFull=full;return full;
    }
    const controller=Object.freeze({ensure:async options=>postPublish(await native.ensure(options)),captureUiSource:()=>ui.capture()});
    function publishReady(){
      check(!published);beforeReady();assertRows();controllers.set(view,controller);
      try{
        // Trusted lexical setter only. All fallible preparation happened while
        // the view was private; the actual state properties are plain data.
        sync(setAccepted,accepted);assertSource();assertSelection();assertRows();check(state.orders===previous&&getAccepted()===accepted);
        state.orders=view;state.ordersSelected=selected;published=true;return view;
      }catch(error){
        controllers.delete(view);if(state.orders===previous&&getAccepted()===accepted)sync(setAccepted,previousAccepted);throw error;
      }
    }
    return Object.freeze({view,controller,accepted,publishReady});
  }
  return Object.freeze({create});
});
