(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.BLOrdersReadyLoad=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const stale=()=>Object.assign(Error('ORDERS_FULL_STALE'),{code:'ORDERS_FULL_STALE'});
  const cancel=response=>{try{Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch(_){};};
  function create({eligible,captureLease,isLeaseCurrent,runtime,fetch,nonce}){
    if([eligible,captureLease,isLeaseCurrent,runtime,fetch,nonce].some(fn=>typeof fn!=='function'))throw stale();
    async function load(options,ordinary){
      if(typeof ordinary!=='function')throw stale();
      // Ordinary owns its existing parsing/fallback/error behavior. Disabled,
      // CPX0, fullOnly and unknown first-slice captures never open the runtime.
      try{if(options?.fullOnly===true||eligible()!==true)return ordinary();}catch(_){return ordinary();}
      let lease,live,rt,response;
      const invalidate=()=>{try{if(typeof rt?.client?.invalidate==='function')rt.client.invalidate();}catch(_){}};
      const full=()=>{invalidate();return ordinary();};
      try{
        lease=captureLease();
        live=()=>{try{return !options?.signal?.aborted&&isLeaseCurrent(lease)===true;}catch(_){return false;}};
        const current=()=>{if(!live())throw stale();return true;};
        current();rt=await runtime();current();
        if(!rt||typeof rt.client?.prepare!=='function'||typeof rt.client?.accept!=='function'
          ||typeof rt.client?.invalidate!=='function'||typeof rt.ownedJson?.read!=='function'
          ||typeof rt.ownedJson?.owns!=='function'||typeof rt.readMetadata!=='function')return full();
        // readMetadata delegates the root-owned readSchema method; read stays
        // the rows reader. Both receipts must belong to the same real instance.
        response=await fetch('/api/page-projection/orders/schema',{cache:'no-store',signal:options?.signal});current();
        if(response?.ok!==true||response.status!==200){cancel(response);return full();}
        const schemaWire=await rt.readMetadata(response,{signal:options?.signal,current,maxBytes:65536});current();
        if(!rt.ownedJson.owns(schemaWire)||schemaWire.mode!=='schema')throw stale();
        const metadata=schemaWire.payload;
        if(metadata?.mode!=='schema')return full();
        const request=await rt.client.prepare(metadata,nonce());current();
        if(request?.mode!=='ready')return full();
        response=await fetch('/api/page-projection/orders/ready',{method:'POST',cache:'no-store',signal:options?.signal,
          headers:{'Content-Type':'application/json'},body:JSON.stringify(request.body)});current();
        const mode=response?.headers?.get('X-Orders-View-Mode');
        if(mode!=='ready'&&mode!=='full'){cancel(response);return full();}
        const wire=await rt.ownedJson.read(response,{signal:options?.signal,current});current();
        if(!rt.ownedJson.owns(wire)||wire.mode!==mode)throw stale();
        // A ready-cache MISS is the real server's immediate ordinary full.
        // Reuse its owned parse; do not await the background build, repeat GET,
        // or run the finite accept scan over all full model values.
        if(mode==='full'){invalidate();return {payload:wire.payload};}
        const accepted=await rt.client.accept(request,wire);current();accepted.assertCurrent();
        if(accepted.mode!=='ready'||eligible()!==true)return full();
        return {payload:accepted.payload,accepted};
      }catch(error){
        cancel(response);invalidate();
        // A stale owner/profile/session must not publish even an ordinary full
        // from this old flight. The actual app's flight guard also checks this.
        if(options?.signal?.aborted||(live&&!live()))return {cancelled:true};
        return ordinary();
      }
    }
    return Object.freeze({load});
  }
  return Object.freeze({create});
});
