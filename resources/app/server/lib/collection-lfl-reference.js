'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const Engine=require('../../public/collection-lfl-engine');
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
// Durable, scoped summaries. Ordinary reads never replace a successful snapshot.
// No order rows, source refreshes, timers or shared writes.
// Schema 5 adds per-production-country partial sums so buyer country rules can exclude countries.
const SCHEMA=5,LEGACY_SCHEMA=4;
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
function sameSummaries(saved,rebuilt){
  const byKey=new Map(rebuilt.map(item=>[item.key,item]));
  return saved.every(item=>{const next=byKey.get(item.key);return Boolean(next)&&close(next.quantity,item.quantity)&&close(next.average,item.average)&&next.count===item.count&&next.orderCount===item.orderCount&&(next.unidentifiedCount||0)===(item.unidentifiedCount||0);});
}
function createReferenceCache({directory}){
  const memory=new Map(),pending=new Map();
  function remember(id,snapshot){
    if(memory.size>=32&&!memory.has(id))memory.delete(memory.keys().next().value);
    memory.set(id,snapshot);return snapshot;
  }
  async function read({identity}){
    const id=digest(identity);
    if(memory.has(id))return memory.get(id);
    try{
      const saved=JSON.parse(await fs.readFile(path.join(directory,id+'.json'),'utf8'));
      // Schema 4 (no country sums) stays readable: it is upgraded only from an available, complete source.
      if((saved.schema===SCHEMA||saved.schema===LEGACY_SCHEMA)&&typeof saved.version==='string'&&Array.isArray(saved.references)&&saved.references.length)return remember(id,saved);
    }catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
    return null;
  }
  async function get({identity,version,loadRows,buildReferences,assertCurrent=()=>{},rebuild=false}){
    const id=digest(identity),file=path.join(directory,id+'.json'),revision=String(version);
    // Serialize publication per identity, including requests for different source versions.
    const previous=pending.get(id);
    if(previous){
      if(previous.version===revision&&previous.rebuild===rebuild)return previous.task;
      await previous.task.catch(()=>{});return get({identity,version,loadRows,buildReferences,assertCurrent,rebuild});
    }
    const task=(async()=>{
      const saved=await read({identity});
      if(saved&&!rebuild&&saved.schema===SCHEMA)return saved;
      // A legacy upgrade is never a refresh: any source problem keeps the saved values.
      const upgrade=Boolean(saved&&!rebuild);
      // Upgrade only from the same source revision; newer source data still needs an explicit refresh.
      if(upgrade&&saved.version!==revision)return saved;
      let references,calculatedAt;
      try{
        if(buildReferences){calculatedAt=new Date().toISOString();references=await buildReferences();}
        else{const sourceRows=await loadRows();calculatedAt=new Date().toISOString();references=Engine.buildReferences(sourceRows);}
        await assertCurrent();
      }catch(error){if(upgrade)return saved;throw error;}
      const snapshot={schema:SCHEMA,version:revision,calculatedAt:upgrade?saved.calculatedAt:calculatedAt,references};
      const keys=new Set(snapshot.references.map(item=>item.key));
      // An upgrade must reproduce every saved summary exactly; a same-key but smaller source keeps the saved values.
      if(upgrade&&!sameSummaries(saved.references,snapshot.references))return saved;
      const removedCount=saved?saved.references.filter(item=>!keys.has(item.key)).length:0;
      if(upgrade&&removedCount)return saved;
      if(!snapshot.references.length){
        // An empty explicit refresh never replaces saved references.
        if(saved)throw Object.assign(new Error('LFL kaynağı boş; kayıtlı referanslar korundu. / The LFL source is empty; saved references were preserved.'),{code:'LFL_REFERENCE_INCOMPLETE',statusCode:409});
        // Empty first reads are retryable; they are never a durable reference.
        return snapshot;
      }
      // An explicit refresh adopts the current non-empty source. Groups that left the source
      // (cancelled orders, moved in-store months, retired seasons, narrower filters) are dropped
      // and reported, instead of blocking every later refresh and order detail.
      const temp=file+'.'+crypto.randomUUID()+'.tmp';
      try{await assertCurrent();await fs.mkdir(directory,{recursive:true});await fs.writeFile(temp,JSON.stringify(snapshot));await assertCurrent();await fs.rename(temp,file);}
      catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error;}
      remember(id,snapshot);
      // The count describes this refresh only; it is not part of the durable snapshot.
      return removedCount?{...snapshot,removedCount}:snapshot;
    })();
    pending.set(id,{version:revision,rebuild,task});
    try{return await task;}finally{pending.delete(id);}
  }
  return {get,read};
}
module.exports={createReferenceCache};
