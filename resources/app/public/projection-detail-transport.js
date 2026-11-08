(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLProjectionDetailTransport=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TOKEN_KEYS=['ownerId','actorId','module','sourceGeneration','sourceRevision','moduleInputKey',
    'sourceProjectionKey','accessHash','contextHash','planRevision','requestGeneration'];
  const MAX_RESPONSE_BYTES=4*1024*1024,MAX_REQUEST_BYTES=64*1024;
  const failure=code=>Object.assign(new Error(code),{code});
  const bytes=value=>new TextEncoder().encode(value).byteLength;
  function createDetailFetcher({fetchImpl,isCurrent}={}){
    if(typeof fetchImpl!=='function'||typeof isCurrent!=='function')throw failure('INVALID_DETAIL_OPTIONS');
    function live(token,signal){
      if(signal?.aborted)throw Object.assign(failure('ABORTED'),{name:'AbortError'});
      if(isCurrent(token)!==true)throw failure('STALE_CONTEXT');
    }
    function admitted(request){
      const token=request?.token,records=request?.records,maxBytes=request?.maxBytes;
      if(!token||!['cp','orders'].includes(token.module)||Object.keys(token).length!==TOKEN_KEYS.length
        ||!TOKEN_KEYS.every(key=>Object.hasOwn(token,key)&&typeof token[key]==='string'&&token[key].length>0&&token[key].length<=512)
        ||!Array.isArray(records)||!records.length||records.length>128
        ||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_RESPONSE_BYTES)throw failure('INVALID_DETAIL_REQUEST');
      const seen=new Set();
      for(const record of records){
        if(!record||Object.keys(record).length!==2||!Number.isSafeInteger(record.ordinal)||record.ordinal<0
          ||seen.has(record.ordinal)||typeof record.handle!=='string'||record.handle.length<1||record.handle.length>512)
          throw failure('INVALID_DETAIL_REQUEST');
        seen.add(record.ordinal);
      }
      const body=JSON.stringify({token,records,maxBytes});
      if(bytes(body)>MAX_REQUEST_BYTES)throw failure('INVALID_DETAIL_REQUEST');
      return {token,body,maxBytes};
    }
    async function readBounded(response,limit,token,signal){
      // Fetch exposes decoded bytes. Compressed Content-Length cannot bound the
      // decoded body, and response.json()/arrayBuffer() allocate before a check.
      if(typeof response.body?.getReader!=='function')throw failure('DETAIL_STREAM_UNAVAILABLE');
      const reader=response.body.getReader(),decoder=new TextDecoder();let total=0,text='',complete=false;
      try{
        while(true){
          live(token,signal);
          const item=await reader.read();live(token,signal);
          if(item.done){complete=true;break;}
          if(!(item.value instanceof Uint8Array))throw failure('INVALID_DETAIL_STREAM');
          total+=item.value.byteLength;
          if(total>limit)throw failure('DETAIL_RESPONSE_TOO_LARGE');
          text+=decoder.decode(item.value,{stream:true});
        }
        text+=decoder.decode();live(token,signal);
        return JSON.parse(text);
      }finally{
        if(!complete)try{await reader.cancel();}catch(_){}
        reader.releaseLock();
      }
    }
    return async function fetchDetails(request){
      const {token,body,maxBytes}=admitted(request);live(token,request.signal);
      const response=await fetchImpl(`/api/page-projection/${token.module}/details`,{
        method:'POST',credentials:'same-origin',cache:'no-store',signal:request.signal,
        headers:{'Content-Type':'application/json','Accept':'application/json'},body,
      });
      const payload=await readBounded(response,response.ok?maxBytes:Math.min(maxBytes,16384),token,request.signal);
      live(token,request.signal);
      if(!response.ok){
        const error=failure(typeof payload?.code==='string'?payload.code:'DETAIL_HTTP_FAILED');
        error.statusCode=response.status;
        if(typeof payload?.error==='string')error.message=payload.error;
        if(typeof payload?.errorEn==='string')error.errorEn=payload.errorEn;
        throw error;
      }
      // The coordinator validates profile, token, exact record coverage and
      // view/full compatibility before normalization or publication.
      return payload;
    };
  }
  return {createDetailFetcher};
});
