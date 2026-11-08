(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLOrdersFullPromotion=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const LIMITS=Object.freeze({maxFullBytes:128*1024*1024,maxRows:50000,maxIdentityString:1024});
  const ID_KEYS=Object.freeze(['ownerId','sessionId','sourceId','generation','accessHash','scopeHash','module','planHash','fullProjectionChecksum','fullByteLength','rowCount']);
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function error(code){return Object.assign(new Error(code),{code});}
  function aborted(){return Object.assign(error('ORDERS_FULL_ABORTED'),{name:'AbortError'});}
  function identity(value,limits=LIMITS){
    if(!record(value)||ID_KEYS.some(key=>!own(value,key)))throw error('ORDERS_FULL_IDENTITY');
    for(const key of ID_KEYS){
      if(['fullByteLength','rowCount'].includes(key)){
        if(!Number.isSafeInteger(value[key])||value[key]<0)throw error('ORDERS_FULL_IDENTITY');
      }else if(typeof value[key]!=='string'||!value[key]||value[key].length>LIMITS.maxIdentityString)throw error('ORDERS_FULL_IDENTITY');
    }
    if(value.module!=='orders'||!/^[a-f0-9]{64}$/.test(value.fullProjectionChecksum)||value.fullByteLength<1)throw error('ORDERS_FULL_IDENTITY');
    if(value.fullByteLength>limits.maxFullBytes||value.rowCount>limits.maxRows)throw error('ORDERS_FULL_TOO_LARGE');
    return Object.freeze(Object.fromEntries(ID_KEYS.map(key=>[key,value[key]])));
  }
  const keyOf=value=>JSON.stringify(ID_KEYS.map(key=>value[key]));
  function revision(value){return typeof value==='string'||Number.isSafeInteger(value);}
  function readState(value){
    if(!record(value)||!['thin','full'].includes(value.kind)||!Array.isArray(value.rows)||!Array.isArray(value.selectedRows)
      ||!revision(value.mutationRevision)||!revision(value.selectionRevision)||typeof value.dirty!=='boolean')throw error('ORDERS_FULL_STATE');
    if(value.dirty)throw error('ORDERS_FULL_DIRTY');
    return value;
  }
  function ordinals(values,count){
    if(!Array.isArray(values)||values.length!==count)throw error('ORDERS_FULL_ORDINAL');
    const seen=new Set();
    for(const value of values){if(!Number.isSafeInteger(value)||value<0||value>=count||seen.has(value))throw error('ORDERS_FULL_ORDINAL');seen.add(value);}
    return values;
  }
  function selectedOrdinals(rows,selected,ordinalByRow){
    if(!Array.isArray(selected))throw error('ORDERS_FULL_SELECTION');
    return selected.map(row=>{if(!ordinalByRow.has(row))throw error('ORDERS_FULL_SELECTION');return ordinalByRow.get(row);});
  }
  async function digest(bytes){
    const subtle=globalThis.crypto?.subtle||(typeof require==='function'?require('node:crypto').webcrypto.subtle:null);
    if(!subtle)throw error('ORDERS_FULL_CRYPTO_UNAVAILABLE');
    return Array.from(new Uint8Array(await subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
  }
  async function readDecodedBytes(response,{maxDecodedBytes,signal}={}){
    if(!Number.isSafeInteger(maxDecodedBytes)||maxDecodedBytes<1||maxDecodedBytes>LIMITS.maxFullBytes)throw error('ORDERS_FULL_LIMIT');
    if(signal?.aborted)throw aborted();
    if(!response?.body||typeof response.body.getReader!=='function')throw error('ORDERS_FULL_STREAM');
    const reader=response.body.getReader();let total=0,cancelled=false;
    const cancel=()=>{if(cancelled)return;cancelled=true;try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};
    const onAbort=()=>cancel();signal?.addEventListener('abort',onAbort,{once:true});
    try{
      if(signal?.aborted)throw aborted();
      // Allocate only the already admitted exact decoded length. Retaining a
      // list of arbitrary 1-byte chunks would evade byte limits via overhead.
      const bytes=new Uint8Array(maxDecodedBytes);
      for(;;){
        const part=await reader.read();if(signal?.aborted)throw aborted();
        if(part.done)break;
        if(!(part.value instanceof Uint8Array)||part.value.byteLength>maxDecodedBytes-total)throw error('ORDERS_FULL_BYTES');
        bytes.set(part.value,total);
        total+=part.value.byteLength;
      }
      if(total!==maxDecodedBytes)throw error('ORDERS_FULL_BYTES');
      return bytes;
    }catch(failure){cancel();throw failure;}
    finally{signal?.removeEventListener('abort',onAbort);reader.releaseLock();}
  }
  function create({snapshot,fetchFull,normalize,publish,isCurrent,maxFullBytes=LIMITS.maxFullBytes,maxRows=LIMITS.maxRows}={}){
    if([snapshot,fetchFull,normalize,publish,isCurrent].some(fn=>typeof fn!=='function')||publish.constructor?.name==='AsyncFunction')throw error('ORDERS_FULL_CALLBACK');
    if(!Number.isSafeInteger(maxFullBytes)||maxFullBytes<1||maxFullBytes>LIMITS.maxFullBytes
      ||!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>LIMITS.maxRows)throw error('ORDERS_FULL_LIMIT');
    const limits=Object.freeze({maxFullBytes,maxRows});
    let flight=null;
    function capture(){
      const state=readState(snapshot());
      // The established ordinary full source is already authoritative. Preserve
      // the exact state/row references; no new metadata, clone or fetch is needed.
      if(state.kind==='full')return {state,full:true};
      const id=identity(state.identity,limits),rows=state.rows;
      if(rows.length!==id.rowCount||!Array.isArray(state.requiredKeys)||state.requiredKeys.some(key=>typeof key!=='string'||!key)
        ||new Set(state.requiredKeys).size!==state.requiredKeys.length)throw error('ORDERS_FULL_STATE');
      const originalOrdinals=ordinals(state.ordinals,id.rowCount).slice(),ordinalByRow=new WeakMap();
      rows.forEach((row,index)=>{if(!record(row)||ordinalByRow.has(row))throw error('ORDERS_FULL_ROW');ordinalByRow.set(row,originalOrdinals[index]);});
      const selected=state.selectedRows.slice(),selectedIndexes=selectedOrdinals(rows,selected,ordinalByRow);
      return {state,id,key:keyOf(id),rows,originalOrdinals,ordinalByRow,selected,selectedIndexes,
        requiredKeys:Object.freeze([...new Set(state.requiredKeys)]),mutationRevision:state.mutationRevision,selectionRevision:state.selectionRevision};
    }
    function assertCaptured(captured){
      const current=readState(snapshot());
      if(current.kind!=='thin'||current.rows!==captured.rows||keyOf(identity(current.identity,limits))!==captured.key
        ||current.mutationRevision!==captured.mutationRevision||current.selectionRevision!==captured.selectionRevision
        ||current.rows.length!==captured.originalOrdinals.length||!Array.isArray(current.ordinals)||current.ordinals.length!==captured.originalOrdinals.length
        ||!Array.isArray(current.requiredKeys)||current.requiredKeys.length!==captured.requiredKeys.length
        ||current.requiredKeys.some(key=>!captured.requiredKeys.includes(key))
        ||current.rows.some((row,index)=>captured.ordinalByRow.get(row)!==captured.originalOrdinals[index]||current.ordinals[index]!==captured.originalOrdinals[index])
        ||current.selectedRows.length!==captured.selected.length||current.selectedRows.some((row,index)=>row!==captured.selected[index])
        ||isCurrent(captured.state,captured.id)!==true)throw error('ORDERS_FULL_STALE');
      return current;
    }
    function stop(entry){
      if(entry.cancelled||entry.finished)return;
      entry.cancelled=true;entry.controller.abort();if(flight===entry)flight=null;
    }
    function alive(entry){
      if(entry.cancelled||!entry.subscribers.size)throw aborted();
      assertCaptured(entry.captured);
    }
    function finish(entry,failure,result){
      entry.finished=true;if(flight===entry)flight=null;
      for(const subscriber of entry.subscribers){subscriber.signal?.removeEventListener('abort',subscriber.abort);failure?subscriber.reject(failure):subscriber.resolve(result);}
      entry.subscribers.clear();
    }
    function publicationGuard(state){
      const expectedRows=state.rows,mutationRevision=state.mutationRevision,selectionRevision=state.selectionRevision;
      // Fetch admission caps must not reject an already loaded ordinary full
      // module. Its identity shape remains validated, without new allocations.
      const guardLimits={maxFullBytes:Number.MAX_SAFE_INTEGER,maxRows:Number.MAX_SAFE_INTEGER};
      const expectedIdentity=state.identity?identity(state.identity,guardLimits):null,selected=state.selectedRows.slice();
      return ()=>{
        const live=readState(snapshot());
        if(live.kind!=='full'||live.rows!==expectedRows||live.mutationRevision!==mutationRevision
          ||live.selectionRevision!==selectionRevision||live.selectedRows.length!==selected.length
          ||live.selectedRows.some((row,index)=>row!==selected[index])||isCurrent(state,expectedIdentity)!==true)throw error('ORDERS_FULL_STALE');
        if(expectedIdentity&&keyOf(identity(live.identity,guardLimits))!==keyOf(expectedIdentity))throw error('ORDERS_FULL_STALE');
        return live;
      };
    }
    async function execute(entry){
      const captured=entry.captured;
      alive(entry);
      const response=await fetchFull(captured.id,{signal:entry.controller.signal,maxDecodedBytes:captured.id.fullByteLength});
      alive(entry);
      if(!response||keyOf(identity(response.identity,limits))!==captured.key)throw error('ORDERS_FULL_IDENTITY');
      if(!(response.bytes instanceof Uint8Array)||response.bytes.byteLength!==captured.id.fullByteLength)throw error('ORDERS_FULL_BYTES');
      // Own the verification bytes: an adapter cannot change its response buffer
      // between the digest await and JSON.parse. No full-row baseline is cloned.
      const bytes=new Uint8Array(response.bytes);
      if(await digest(bytes)!==captured.id.fullProjectionChecksum)throw error('ORDERS_FULL_CHECKSUM');
      alive(entry);
      let payload;
      try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw error('ORDERS_FULL_PAYLOAD');}
      if(!record(payload)||!Array.isArray(payload.rows)||payload.rows.length!==captured.id.rowCount)throw error('ORDERS_FULL_PAYLOAD');
      // Intern key shapes, retaining presence only, not a second full data graph.
      const shapes=new Map(),rowShapes=[];
      for(const row of payload.rows){
        if(!record(row)||captured.requiredKeys.some(key=>!own(row,key)))throw error('ORDERS_FULL_PRESENCE');
        const keys=Object.keys(row).sort(),shapeKey=JSON.stringify(keys);
        if(!shapes.has(shapeKey))shapes.set(shapeKey,Object.freeze(keys));
        rowShapes.push(shapes.get(shapeKey));
      }
      const fullOrdinals=Array.from({length:payload.rows.length},(_,index)=>index);
      const normalized=await normalize(payload.rows,{identity:captured.id,ordinals:Object.freeze(fullOrdinals),signal:entry.controller.signal});
      alive(entry);
      if(!record(normalized)||!Array.isArray(normalized.rows)||normalized.rows.length!==captured.id.rowCount)throw error('ORDERS_FULL_NORMALIZE');
      ordinals(normalized.ordinals,captured.id.rowCount);
      const byOrdinal=new Map(),seenRows=new WeakSet();
      normalized.rows.forEach((row,index)=>{
        const ordinal=normalized.ordinals[index];
        if(!record(row)||seenRows.has(row)||captured.ordinalByRow.has(row)||rowShapes[ordinal].some(key=>!own(row,key)))throw error('ORDERS_FULL_PRESENCE');
        seenRows.add(row);byOrdinal.set(ordinal,row);
      });
      const candidate={...captured.state,kind:'full',identity:captured.id,rows:normalized.rows,ordinals:normalized.ordinals.slice(),
        selectedRows:captured.selectedIndexes.map(ordinal=>byOrdinal.get(ordinal)),dirty:false};
      const assertCurrent=()=>alive(entry);
      assertCurrent();
      // Trusted adapter contract: synchronous compare-and-swap of the module
      // pointer + selected references. No await/render/save inside this callback.
      if(publish(candidate,{expected:captured.state,assertCurrent})!==candidate)throw error('ORDERS_FULL_PUBLICATION');
      const assertPublished=publicationGuard(candidate);
      const result={state:candidate,rows:candidate.rows,selectedRows:candidate.selectedRows,assertCurrent:assertPublished,
        remapRows(originalRows){
          assertPublished();
          if(!Array.isArray(originalRows))throw error('ORDERS_FULL_SELECTION');
          return originalRows.map(row=>{if(!captured.ordinalByRow.has(row))throw error('ORDERS_FULL_SELECTION');return byOrdinal.get(captured.ordinalByRow.get(row));});
        }};
      return Object.freeze(result);
    }
    function ensure({signal}={}){
      if(signal!=null&&(typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))return Promise.reject(error('ORDERS_FULL_SIGNAL'));
      if(signal?.aborted)return Promise.reject(aborted());
      let captured;
      try{
        captured=capture();
        if(captured.full){
          if(isCurrent(captured.state,captured.state.identity)!==true)throw error('ORDERS_FULL_STALE');
          const assertPublished=publicationGuard(captured.state);
          return Promise.resolve(Object.freeze({state:captured.state,rows:captured.state.rows,selectedRows:captured.state.selectedRows,
            assertCurrent:assertPublished,remapRows:rows=>{assertPublished();return rows;}}));
        }
        assertCaptured(captured);
      }catch(failure){return Promise.reject(failure);}
      if(flight&&(flight.captured.key!==captured.key||flight.captured.rows!==captured.rows
        ||flight.captured.mutationRevision!==captured.mutationRevision||flight.captured.selectionRevision!==captured.selectionRevision)){
        const previous=flight;stop(previous);finish(previous,error('ORDERS_FULL_STALE'));
      }
      let entry=flight;
      if(!entry){
        entry={captured,controller:new AbortController(),subscribers:new Set(),cancelled:false,finished:false};flight=entry;
        // Attach subscribers before dispatch. Last cancellation in this turn
        // therefore prevents even the queued fetch from being submitted.
        queueMicrotask(()=>{if(!entry.cancelled)void execute(entry).then(value=>finish(entry,null,value),failure=>finish(entry,failure));});
      }
      return new Promise((resolve,reject)=>{
        const subscriber={resolve,reject,signal,abort:null};
        subscriber.abort=()=>{if(!entry.subscribers.delete(subscriber))return;signal?.removeEventListener('abort',subscriber.abort);reject(aborted());if(!entry.subscribers.size)stop(entry);};
        entry.subscribers.add(subscriber);signal?.addEventListener('abort',subscriber.abort,{once:true});
        if(signal?.aborted)subscriber.abort();
      });
    }
    return Object.freeze({ensure});
  }
  return Object.freeze({create,readDecodedBytes,LIMITS});
});
