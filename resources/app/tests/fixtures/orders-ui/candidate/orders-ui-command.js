(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.BLOrdersUiCommand=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const stale=()=>Object.assign(Error('ORDERS_FULL_STALE'),{code:'ORDERS_FULL_STALE'});
  const check=ok=>{if(!ok)throw stale();};
  function intent(nodes,read,extra=()=>true){
    const captured=[...nodes],value=JSON.stringify(read());
    return ()=>captured.every(node=>node&&node.isConnected!==false)
      &&extra()===true&&JSON.stringify(read())===value;
  }
  function create({isThin,captureSource,ensureFull,activeTab,onError}){
    check([isThin,captureSource,ensureFull,activeTab,onError].every(v=>typeof v==='function'));
    const objects=new WeakMap(),versions=new Map();
    function run({reason,lane,inspect,change}){
      // Preserve the exact return value, exceptions and synchronous full body.
      if(!isThin())return change(null);
      try{
        const tab=activeTab(),source=captureSource(),valid=inspect();
        check(source&&typeof source.assertPending==='function'&&typeof source.assertPromoted==='function'&&typeof valid==='function');
        const key=lane||reason,bucket=key&&typeof key==='object'?objects:versions;
        const version=(bucket.get(key)||0)+1;bucket.set(key,version);
        source.assertPending();
        return Promise.resolve(ensureFull(reason)).then(()=>{
          if(bucket.get(key)!==version)return false; // Superseded typing is quiet.
          check(activeTab()===tab&&valid()===true);
          // This guard is source/session/module continuity, deliberately not
          // accepted.assertCurrent(), whose DOM/demand capture may now differ.
          const full=source.assertPromoted();check(!isThin()&&full&&typeof full.remapRows==='function');
          return change(full);
        }).catch(error=>{onError(error);return false;});
      }catch(error){onError(error);return Promise.resolve(false);}
    }
    return Object.freeze({run});
  }
  function createPrivateSource({moduleNow,sourceNow,lastFull}){
    check([moduleNow,sourceNow,lastFull].every(v=>typeof v==='function'));
    // sourceNow is a PRIVATE actual controller read of immutable parent token,
    // owner/actor/access + local session/source epoch. No DOM/filter/formulas.
    // It is a freshness comparison; the server/full helper still authorize and
    // verify the parent. This object never consumes flags or HTTP authority.
    function capture(){
      const before=moduleNow(),rows=before&&before.rows,source=sourceNow();
      check(before&&Array.isArray(rows)&&source&&Object.isFrozen(source)&&source.allowed===true
        &&typeof source.actorId==='string'&&source.actorId.length>0);
      const entries=Object.entries(source);check(entries.length>0&&entries.length<=32
        &&entries.every(([key,value])=>typeof key==='string'&&['string','number','boolean'].includes(typeof value)));
      const current=()=>{const live=sourceNow();check(live&&Object.isFrozen(live)&&Object.keys(live).length===entries.length
        &&entries.every(([key,value])=>Object.prototype.hasOwnProperty.call(live,key)&&live[key]===value));};
      return Object.freeze({
        assertPending(){current();check(moduleNow()===before&&before.rows===rows);},
        assertPromoted(){current();const receipt=lastFull(),live=moduleNow();
          check(receipt&&typeof receipt.assertCurrent==='function'&&live&&live!==before&&live.rows===receipt.rows);
          receipt.assertCurrent();return receipt;},
      });
    }
    return Object.freeze({capture});
  }
  return Object.freeze({create,intent,createPrivateSource});
});
