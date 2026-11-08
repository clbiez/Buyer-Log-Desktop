(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOrdersOwnedJson=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Private transport boundary. Own exact bounded decoded bytes and their sole
  // JSON.parse result before hydration. Ownership is not an authority grant;
  // the projection client still verifies the server binding and every row.
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  const check=(ok,code)=>{if(!ok)fail(code);};
  const abort=()=>{throw Object.assign(new Error('Aborted'),{name:'AbortError',code:'ABORT_ERR'});};
  function create({promotionApi,sha256Bytes,maxDecodedBytes=134217728,maxRows=50000}={}){
    check(promotionApi&&typeof promotionApi.readDecodedBytes==='function'&&typeof sha256Bytes==='function','ORDERS_JSON_RUNTIME');
    check(Number.isSafeInteger(maxDecodedBytes)&&maxDecodedBytes>0&&maxDecodedBytes<=134217728
      &&Number.isSafeInteger(maxRows)&&maxRows>0&&maxRows<=50000,'ORDERS_JSON_LIMIT');
    const owned=new WeakSet();
    async function readKind(kind,response,{signal,current}={}){
      const live=()=>{
        if(signal?.aborted)abort();
        check(typeof current==='function','ORDERS_JSON_GUARD');
        const value=current();
        if(value&&typeof value.then==='function'){
          try{Promise.resolve(value).catch(()=>{});}catch(_){}
          fail('ORDERS_JSON_GUARD');
        }
        check(value===true,'ORDERS_FULL_STALE');
      };
      const cancel=()=>{try{Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch(_){}};
      try{
        live();
        check(response?.ok===true&&response.status===200&&typeof response.headers?.get==='function','ORDERS_JSON_RESPONSE');
        const schema=kind==='schema',headers=response.headers,mode=schema?'schema':headers.get('X-Orders-View-Mode');
        check(schema||mode==='full'||mode==='ready','ORDERS_JSON_MODE');
        check(/^application\/json(?:\s*;|$)/i.test(headers.get('Content-Type')||''),'ORDERS_JSON_CONTENT_TYPE');
        const declared=schema?headers.get('X-Orders-Schema-Json-Bytes')
          :(headers.get('X-Orders-View-Json-Bytes')??(mode==='full'?headers.get('X-Orders-Full-Json-Bytes'):null));
        check(/^[1-9][0-9]{0,8}$/.test(declared||''),'ORDERS_JSON_LENGTH');
        const length=Number(declared);check(Number.isSafeInteger(length)&&length<=Math.min(maxDecodedBytes,schema?65536:134217728),'ORDERS_JSON_LENGTH');
        const bytes=await promotionApi.readDecodedBytes(response,{maxDecodedBytes:length,signal});live();
        check(bytes instanceof Uint8Array&&bytes.byteLength===length,'ORDERS_FULL_BYTES');
        const rawSha256=await sha256Bytes(bytes);live();
        check(typeof rawSha256==='string'&&/^[a-f0-9]{64}$/.test(rawSha256),'ORDERS_JSON_DIGEST');
        let rawText,payload;
        try{rawText=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(_){fail('ORDERS_JSON_UTF8');}
        try{payload=JSON.parse(rawText);}catch(_){fail('ORDERS_JSON_SYNTAX');}
        check(payload&&typeof payload==='object'&&!Array.isArray(payload),'ORDERS_JSON_PAYLOAD');
        if(schema)check(payload.mode==='schema'&&!Object.prototype.hasOwnProperty.call(payload,'rows'),'ORDERS_JSON_MODE');
        else{
          check(Array.isArray(payload.rows)&&payload.rows.length<=maxRows,'ORDERS_JSON_PAYLOAD');
          if(mode==='ready')check(payload.profile==='orders-ready-model-v1','ORDERS_JSON_MODE');
          else check(!Object.prototype.hasOwnProperty.call(payload,'profile')&&!Object.prototype.hasOwnProperty.call(payload,'projection'),'ORDERS_JSON_MODE');
        }
        live();
        const result=Object.freeze({payload,rawText,rawSha256,decodedBytes:length,mode,headers});
        owned.add(result);return result;
      }catch(error){cancel();throw error;}
    }
    return Object.freeze({read:(response,options)=>readKind('rows',response,options),
      readSchema:(response,options)=>readKind('schema',response,options),
      owns:receipt=>Boolean(receipt&&typeof receipt==='object'&&owned.has(receipt))});
  }
  return Object.freeze({create});
});
