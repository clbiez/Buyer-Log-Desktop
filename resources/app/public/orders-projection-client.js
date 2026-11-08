(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('node:util').types.isProxy);
  else root.BLOrdersProjectionClient=factory(null);
})(typeof globalThis!=='undefined'?globalThis:this,function(isProxy){
  'use strict';
  // Inactive transport library. Runtimes, capture and fetch are injected; this
  // module installs no storage, UI, authority policy or script loader.
  // readCurrent/captureCold are trusted root adapters, not completeness proofs.
  // Root must include quick-filter group dependencies or retain ordinary full.
  const PROFILE='orders-ready-model-v1';
  const TOKEN=['ownerId','actorId','module','sourceGeneration','sourceRevision','moduleInputKey','sourceProjectionKey','accessHash','contextHash','planRevision','requestGeneration'];
  const HEADERS=['Binding-Version','Owner-B64','Actor-B64','Access-Hash','Page-Context-Sha256','Broad-Context-Sha256','Guard-Sha256','Cache-Generation','Full-Gzip-Sha256'];
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
  const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const text=v=>typeof v==='string'&&v.length>0&&v.length<=512;
  function plain(value){
    check(value&&typeof value==='object'&&!(isProxy&&isProxy(value))&&!Array.isArray(value)
      &&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'UNKNOWN_CAPTURE');
    for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);
      check(typeof key==='string'&&key.length<=512&&d.enumerable&&own(d,'value'),'UNKNOWN_CAPTURE');}
    return value;
  }
  function exact(value,keys){plain(value);check(Object.keys(value).length===keys.length&&keys.every(k=>own(value,k)),'UNKNOWN_CAPTURE');}
  function copy(value,state={nodes:0,chars:0,ancestors:new WeakSet()},depth=0){
    check(++state.nodes<=50000&&depth<=24,'CAPTURE_BUDGET');
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='string'){state.chars+=value.length;check(value.length<=65536&&state.chars<=262144,'CAPTURE_BUDGET');return value;}
    if(typeof value==='number'){check(Number.isFinite(value),'UNKNOWN_CAPTURE');return value;}
    check(value&&typeof value==='object'&&!(isProxy&&isProxy(value))&&!state.ancestors.has(value),'UNKNOWN_CAPTURE');
    const array=Array.isArray(value);if(!array)plain(value);
    const keys=Reflect.ownKeys(value);
    if(array){check(Object.getPrototypeOf(value)===Array.prototype&&value.length<=4096&&keys.length===value.length+1,'UNKNOWN_CAPTURE');
      for(let i=0;i<value.length;i++)check(own(value,String(i)),'UNKNOWN_CAPTURE');}
    const out=array?[]:{};state.ancestors.add(value);
    try{for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(value,key);
      check(typeof key==='string'&&d.enumerable&&own(d,'value'),'UNKNOWN_CAPTURE');
      Object.defineProperty(out,key,{value:copy(d.value,state,depth+1),enumerable:true});}}
    finally{state.ancestors.delete(value);}return Object.freeze(out);
  }
  const encode=value=>{
    const bytes=new TextEncoder().encode(value);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  };
  function identity(headers){
    check(headers&&typeof headers.get==='function','MISSING_FULL_IDENTITY');
    const result={};for(const name of HEADERS){const value=headers.get('X-Orders-'+name);
      check(typeof value==='string'&&value.length>0&&value.length<=1024,'MISSING_FULL_IDENTITY');result[name]=value;}
    check(result['Binding-Version']==='1'&&/^[A-Za-z0-9_-]{1,100}$/.test(result['Cache-Generation']),'BAD_FULL_IDENTITY');
    for(const name of ['Access-Hash','Page-Context-Sha256','Broad-Context-Sha256','Guard-Sha256','Full-Gzip-Sha256'])check(hash(result[name]),'BAD_FULL_IDENTITY');
    return Object.freeze(result);
  }
  function create({finiteApi,compiler,schemaApi,formulaColumns,readCurrent,settleOnFull,sha256,captureCold,waitCold}){
    check(finiteApi&&compiler&&typeof compiler.compileSchema==='function'&&schemaApi&&typeof schemaApi.read==='function'
      &&formulaColumns&&typeof formulaColumns.definitions==='function'&&typeof settleOnFull==='function'
      &&typeof readCurrent==='function'&&typeof sha256==='function','ACTUAL_RUNTIMES_REQUIRED');
    let baseline=null,epoch=0;const requests=new WeakMap();
    function cold(){
      check(typeof captureCold==='function'&&typeof waitCold==='function','FIRST_FULL_REQUIRED');
      const evidence=copy(captureCold());exact(evidence,['reads']);
      check(Array.isArray(evidence.reads)&&evidence.reads.length>0&&evidence.reads.length<=4096,'UNKNOWN_FORMULA_STORAGE');
      for(const item of evidence.reads){exact(item,['source','key','raw']);check(text(item.source)&&typeof item.key==='string'&&item.key.length>0,'UNKNOWN_FORMULA_STORAGE');
        check(item.raw===null||(typeof item.raw==='string'&&(()=>{const v=JSON.parse(item.raw);return Array.isArray(v)&&v.length===0;})()),'COLD_FORMULAS_PRESENT');}
      check(formulaColumns.definitions('orders').length===0,'COLD_FORMULAS_PRESENT');return JSON.stringify(evidence);
    }
    function current(){
      const input=copy(readCurrent());
      exact(input,['actorId','ownerId','allowed','hydrated','columns','modelDefinitions','hiddenKeys','filterKeys','sortKeys','ruleKeys','operationKeys','settings','formulaStorage']);
      check(input.allowed===true&&input.hydrated===true&&text(input.actorId)&&text(input.ownerId),'UNREADY_CLIENT');
      check(input.formulaStorage===null||typeof input.formulaStorage==='string','UNKNOWN_FORMULA_STORAGE');
      const stored=input.formulaStorage===null?[]:JSON.parse(input.formulaStorage);
      check(Array.isArray(stored)&&stored.length<=30&&stored.every(d=>d&&d.id&&d.label),'UNKNOWN_FORMULA_STORAGE');
      check(JSON.stringify(stored)===JSON.stringify(formulaColumns.definitions('orders')),'UNKNOWN_FORMULA_STORAGE');
      check(JSON.stringify(input).length<=262144,'CAPTURE_BUDGET');return input;
    }
    async function metadata(value){
      const m=copy(value);exact(m,['mode','profile','token','schema','schemaChecksum','guardStamp','planHashVersion']);
      exact(m.token,TOKEN);check(TOKEN.every(k=>text(m.token[k]))&&m.token.module==='orders'
        &&m.mode==='schema'&&m.profile===PROFILE&&m.planHashVersion===1&&hash(m.schemaChecksum)&&hash(m.guardStamp),'UNKNOWN_SERVER_SCHEMA');
      const schema=schemaApi.read(m.schema,'orders');
      check(schema.status==='known'&&JSON.stringify(schema)===JSON.stringify(m.schema)
        &&await sha256(JSON.stringify(schema))===m.schemaChecksum,'UNKNOWN_SERVER_SCHEMA');
      check(new TextEncoder().encode(JSON.stringify(m)).length<=65536&&schema.rowCount<=50000,'CAPTURE_BUDGET');return m;
    }
    function context(m,c){
      check(c.ownerId===m.token.ownerId&&c.actorId===m.token.actorId,'CLIENT_IDENTITY_CHANGED');
      check(JSON.stringify(c.modelDefinitions)===JSON.stringify(m.schema.modelColumns),'MODEL_DEFINITIONS_CHANGED');
      // These constants name the reviewed adapters. They are neither a receipt
      // nor proof: actual full settlement or the actual empty-formula cold
      // capture is required; these strings cannot establish either condition.
      const present=new Set(m.schema.rowKeys),known=keys=>keys.filter(k=>present.has(k));
      // A complete producer schema proves absent literal lookups remain absent.
      // No row sample is used, and formula resolution still fails closed.
      return {token:m.token,schema:m.schema,columns:c.columns,hiddenKeys:c.hiddenKeys,
        filterKeys:known(c.filterKeys),sortKeys:known(c.sortKeys),ruleKeys:known(c.ruleKeys),operationKeys:known(c.operationKeys),
        guards:finiteApi.GUARDS,fullBeforeUse:finiteApi.BARRIERS};
    }
    function assertCapture(receipt){
      check(baseline===receipt.base&&epoch===receipt.epoch&&JSON.stringify(current())===receipt.stamp,'ORDERS_FULL_STALE');
      if(receipt.base.coldStamp!==undefined)check(cold()===receipt.base.coldStamp,'ORDERS_FULL_STALE');
    }
    async function bind(m,headers){
      const id=identity(headers),t=m.token;
      check(id['Owner-B64']===encode(t.ownerId)&&id['Actor-B64']===encode(t.actorId)
        &&id['Access-Hash']===t.accessHash&&id['Guard-Sha256']===m.guardStamp
        &&id['Page-Context-Sha256']===await sha256(t.contextHash)&&id['Cache-Generation']===t.sourceGeneration,'ORDERS_FULL_STALE');
      return id;
    }
    // Private parser boundary: the caller owns bounded decoded bytes and passes
    // their sole JSON.parse result before hydration. Full UI capture/mutation
    // barriers and nonempty-formula activation remain integration obligations.
    async function initializeFull({metadata:before,afterMetadata,headers,fullWire,rawText}){
      baseline=null;const ticket=++epoch;let started=false,settled=false;
      try{
        const m=await metadata(before),after=await metadata(afterMetadata);
        check(JSON.stringify(m)===JSON.stringify(after),'SOURCE_CHANGED_DURING_FULL');
        const id=await bind(m,headers);plain(fullWire);
        check(!own(fullWire,'profile')&&!own(fullWire,'projection')&&typeof rawText==='string'&&rawText.length<=134217728,'NOT_ORDINARY_FULL');
        const rawBytes=new TextEncoder().encode(rawText).length;check(rawBytes>0&&rawBytes<=134217728,'FULL_SIZE');
        const rawSha=await sha256(rawText);check(hash(rawSha),'BAD_FULL_IDENTITY');
        // Private parser boundary: fullWire MUST be the sole JSON.parse(rawText)
        // result, before legacy hydration. Never serialize/copy the row graph.
        started=true;await settleOnFull(fullWire,m.schema.modelColumns);settled=true;
        const c=current(),plan=compiler.compile(fullWire,context(m,c));check(plan.supported,'FULL_CLOSURE_UNPROVEN');
        check(epoch===ticket,'ORDERS_FULL_STALE');
        baseline=Object.freeze({m,id,rawSha,rawBytes,stamp:JSON.stringify(c)});
        return Object.freeze({mode:'full-initialized',settled:true});
      }catch(error){if(epoch===ticket)baseline=null;if(started&&!settled)throw error;
        return Object.freeze({mode:'full',reason:error.code||'UNKNOWN_CAPTURE',settled});}
    }
    async function prepare(value,nonce){
      try{
        const ticket=epoch;
        if(!baseline){
          check(typeof waitCold==='function','FIRST_FULL_REQUIRED');await waitCold();check(epoch===ticket,'ORDERS_FULL_STALE');
          const m=await metadata(value),c=current(),coldStamp=cold();context(m,c);check(epoch===ticket,'ORDERS_FULL_STALE');
          // Actual definitions/storage are empty: migrateReferences returns
          // before constructing a row sample. No full source is needed to
          // migrate zero entries. Bootstrap registry still must match exactly.
          baseline=Object.freeze({m,id:null,rawSha:null,rawBytes:null,stamp:JSON.stringify(c),coldStamp});
        }
        const base=baseline;
        const m=await metadata(value);check(JSON.stringify(m)===JSON.stringify(base.m),'SOURCE_CHANGED');
        const c=current(),stamp=JSON.stringify(c);check(stamp===base.stamp,'SETTINGS_CHANGED');
        const plan=compiler.compileSchema(context(m,c));check(plan.supported,'OPEN_CLOSURE');
        check(plan.omittedKeys.length>0&&plan.omittedKeys.length<=64&&plan.omittedKeys.every(k=>k.startsWith('__CPX_')),'NO_FINITE_OMISSION');
        check(typeof nonce==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(nonce),'BAD_NONCE');
        const planHash=await sha256(JSON.stringify(['orders-ready-http-plan-v1',TOKEN.map(k=>m.token[k]),m.schemaChecksum,m.guardStamp,plan.omittedKeys]));
        const receipt={base,epoch:ticket,stamp,plan,nonce,planHash};assertCapture(receipt);
        const request=Object.freeze({mode:'ready',body:Object.freeze({token:m.token,requestNonce:nonce,omittedModelKeys:plan.omittedKeys,planHash})});
        requests.set(request,receipt);return request;
      }catch(error){return Object.freeze({mode:'full',reason:error.code||'UNKNOWN_CAPTURE'});}
    }
    async function accept(request,{headers,payload,rawText}){
      const r=requests.get(request);check(r,'UNOWNED_REQUEST');assertCapture(r);
      const id=await bind(r.base.m,headers);if(r.base.id)check(JSON.stringify(id)===JSON.stringify(r.base.id),'ORDERS_FULL_STALE');
      check(headers.get('X-Orders-Request-Nonce')===r.nonce,'ORDERS_FULL_STALE');plain(payload);
      const mode=headers.get('X-Orders-View-Mode');
      if(mode==='full'){
        check(!own(payload,'profile')&&!own(payload,'projection')&&typeof rawText==='string'&&rawText.length<=134217728,'ORDERS_FULL_STALE');
        const rawBytes=new TextEncoder().encode(rawText).length;check(rawBytes>0&&rawBytes<=134217728,'FULL_SIZE');
        if(r.base.rawSha)check(rawBytes===r.base.rawBytes&&await sha256(rawText)===r.base.rawSha,'ORDERS_FULL_STALE');
        check(compiler.compile(payload,context(r.base.m,current())).supported,'FULL_CLOSURE_UNPROVEN');
      }else{
        check(mode==='ready'&&payload.profile===PROFILE&&headers.get('X-Orders-Plan-Hash')===r.planHash,'ORDERS_FULL_STALE');
        const p=copy(payload.projection);exact(p,['schemaVersion','module','schema','omittedKeys','viewInfo']);
        check(p.schemaVersion===1&&p.module==='orders'&&JSON.stringify(p.schema)===JSON.stringify(r.base.m.schema)
          &&JSON.stringify(p.omittedKeys)===JSON.stringify(r.plan.omittedKeys),'ORDERS_FULL_STALE');
        exact(p.viewInfo,['ownerId','actorId','sourceKey','sourceGeneration','accessHash','planEpoch','fullJsonSha256','fullJsonBytes']);
        const t=r.base.m.token,v=p.viewInfo;
        check(v.ownerId===t.ownerId&&v.actorId===t.actorId&&v.sourceKey===t.sourceProjectionKey&&v.sourceGeneration===t.sourceGeneration
          &&v.accessHash===t.accessHash&&v.planEpoch===0&&hash(v.fullJsonSha256)&&Number.isSafeInteger(v.fullJsonBytes)&&v.fullJsonBytes>0&&v.fullJsonBytes<=134217728
          &&(!r.base.rawSha||(v.fullJsonSha256===r.base.rawSha&&v.fullJsonBytes===r.base.rawBytes)),'ORDERS_FULL_STALE');
        check(Array.isArray(payload.rows)&&payload.rows.length===r.base.m.schema.rowCount,'ORDERS_FULL_STALE');
        // fields is the complete retained union, never a per-row required set.
        // Validate every row without rebuilding it: preserve order and sparse
        // presence, duplicate business IDs, own __proto__, null, false and zero.
        const allowed=new Set(r.plan.fields),union=new Set();
        for(const row of payload.rows)for(const key of Object.keys(plain(row))){check(allowed.has(key),'LATE_OR_OMITTED_RAW_KEY');union.add(key);}
        check(r.plan.fields.every(k=>union.has(k)),'MISSING_RETAINED_RAW_KEY');
      }
      assertCapture(r);
      const parent=mode==='ready'?Object.freeze({token:r.base.m.token,fullGzipChecksum:id['Full-Gzip-Sha256'],guardStamp:r.base.m.guardStamp,
        pageContextSha256:id['Page-Context-Sha256'],broadContextSha256:id['Broad-Context-Sha256'],planHash:r.planHash,
        fullJsonSha256:payload.projection.viewInfo.fullJsonSha256,fullJsonBytes:payload.projection.viewInfo.fullJsonBytes,
        rowCount:r.base.m.schema.rowCount}):null;
      return Object.freeze({mode,payload,parent,assertCurrent:()=>assertCapture(r)});
    }
    return Object.freeze({initializeFull,prepare,accept,invalidate(){baseline=null;epoch++;}});
  }
  function createFetchFull({promotionApi,fetch,sha256Bytes,live}){
    check(promotionApi&&typeof promotionApi.readDecodedBytes==='function'&&[fetch,sha256Bytes,live].every(v=>typeof v==='function'),'ACTUAL_RUNTIMES_REQUIRED');
    return async(expected,{signal,maxDecodedBytes})=>{
      const assertNotAborted=()=>{if(signal?.aborted)throw Object.assign(Error('ORDERS_FULL_ABORTED'),{code:'ORDERS_FULL_ABORTED',name:'AbortError'});};
      assertNotAborted();
      const start=live();check(start&&typeof start.assertCurrent==='function','ORDERS_FULL_STALE');
      const stampOf=value=>JSON.stringify([value.token,value.fullGzipChecksum,value.guardStamp,value.sessionId,value.planHash,value.pageContextSha256,value.broadContextSha256]);
      const stamp=stampOf(start);
      const current=()=>{const now=live();check(now&&typeof now.assertCurrent==='function'
        &&stampOf(now)===stamp,'ORDERS_FULL_STALE');
        now.assertCurrent();return now;};
      const actual=current();check(actual.sessionId===expected.sessionId&&actual.planHash===expected.planHash,'ORDERS_FULL_STALE');
      check(typeof actual.nonce==='function','BAD_NONCE');const nonce=actual.nonce();check(typeof nonce==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(nonce),'BAD_NONCE');
      const response=await fetch('/api/page-projection/orders/full-parent',{method:'POST',cache:'no-store',signal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify({token:actual.token,requestNonce:nonce,
          fullGzipChecksum:actual.fullGzipChecksum,guardStamp:actual.guardStamp})});
      const cancel=()=>{try{Promise.resolve(response.body?.cancel()).catch(()=>{});}catch(_){}};
      try{
        assertNotAborted();current();check(response.ok&&response.status===200,'ORDERS_FULL_STALE');const h=response.headers,id=identity(h),t=actual.token;
        const rawBytes=h.get('X-Orders-Full-Json-Bytes'),rowCount=h.get('X-Orders-Full-Row-Count');
        check(/^[1-9][0-9]{0,8}$/.test(rawBytes||'')&&Number(rawBytes)<=134217728
          &&/^(0|[1-9][0-9]{0,4})$/.test(rowCount||'')&&Number(rowCount)<=50000,'BAD_FULL_IDENTITY');
        check(h.get('X-Orders-View-Mode')==='full'&&h.get('X-Orders-Request-Nonce')===nonce
          &&id['Owner-B64']===encode(t.ownerId)&&id['Actor-B64']===encode(t.actorId)
          &&id['Access-Hash']===t.accessHash&&id['Guard-Sha256']===actual.guardStamp
          &&id['Cache-Generation']===t.sourceGeneration&&id['Full-Gzip-Sha256']===actual.fullGzipChecksum
          &&h.get('X-Orders-Source-Projection-Key-B64')===encode(t.sourceProjectionKey)
          &&h.get('X-Orders-Module-Input-Key-B64')===encode(t.moduleInputKey)
          &&h.get('X-Orders-Source-Revision')===t.sourceRevision,'ORDERS_FULL_STALE');
        check(expected.ownerId===t.ownerId&&expected.sourceId===t.sourceProjectionKey&&expected.generation===t.sourceGeneration
          &&expected.accessHash===t.accessHash&&expected.scopeHash===actual.guardStamp&&expected.module==='orders'
          &&expected.fullByteLength===Number(rawBytes)&&expected.rowCount===Number(rowCount)&&maxDecodedBytes===Number(rawBytes),'ORDERS_FULL_STALE');
        // Retain/check both independent context headers from the accepted ready
        // response, including the broader context which token.contextHash isn't.
        check(id['Page-Context-Sha256']===actual.pageContextSha256&&id['Broad-Context-Sha256']===actual.broadContextSha256,'ORDERS_FULL_STALE');
        const bytes=await promotionApi.readDecodedBytes(response,{maxDecodedBytes:Number(rawBytes),signal});assertNotAborted();current();
        const rawSha=await sha256Bytes(bytes);assertNotAborted();current();check(hash(rawSha),'BAD_FULL_IDENTITY');
        // Derive response evidence from headers + owned raw bytes. The gzip
        // checksum pins the parent transport; it is not this raw JSON digest.
        // The promotion helper independently compares and hashes its own copy.
        return {bytes,identity:{ownerId:t.ownerId,sessionId:current().sessionId,sourceId:t.sourceProjectionKey,
          generation:id['Cache-Generation'],accessHash:id['Access-Hash'],scopeHash:id['Guard-Sha256'],module:'orders',
          planHash:current().planHash,fullProjectionChecksum:rawSha,fullByteLength:bytes.byteLength,rowCount:Number(rowCount)}};
      }catch(error){cancel();throw error;}
    };
  }
  return Object.freeze({create,identity,createFetchFull});
});
