'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const Engine=require('../../public/collection-lfl-engine');
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
// Durable, scoped summaries. Ordinary reads never replace a successful snapshot.
// No order rows, source refreshes, timers or shared writes.
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
      if(saved.schema===4&&typeof saved.version==='string'&&Array.isArray(saved.references)&&saved.references.length)return remember(id,saved);
    }catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
    return null;
  }
  async function get({identity,version,loadRows,rebuild=false}){
    const id=digest(identity),file=path.join(directory,id+'.json'),revision=String(version);
    // Serialize publication per identity, including requests for different source versions.
    const previous=pending.get(id);
    if(previous){
      if(previous.version===revision&&previous.rebuild===rebuild)return previous.task;
      await previous.task.catch(()=>{});return get({identity,version,loadRows,rebuild});
    }
    const task=(async()=>{
      const saved=await read({identity});
      if(saved&&!rebuild)return saved;
      const snapshot={schema:4,version:revision,calculatedAt:new Date().toISOString(),references:Engine.buildReferences(await loadRows())};
      const keys=new Set(snapshot.references.map(item=>item.key));
      if(saved&&saved.references.some(item=>!keys.has(item.key))){
        throw Object.assign(new Error('LFL kaynağı eksik; kayıtlı referanslar korundu. / The LFL source is incomplete; saved references were preserved.'),{code:'LFL_REFERENCE_INCOMPLETE',statusCode:409});
      }
      // Empty first reads are retryable; they are never a durable reference.
      if(!snapshot.references.length)return snapshot;
      const temp=file+'.'+crypto.randomUUID()+'.tmp';
      try{await fs.mkdir(directory,{recursive:true});await fs.writeFile(temp,JSON.stringify(snapshot));await fs.rename(temp,file);}
      catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error;}
      return remember(id,snapshot);
    })();
    pending.set(id,{version:revision,rebuild,task});
    try{return await task;}finally{pending.delete(id);}
  }
  return {get,read};
}
module.exports={createReferenceCache};
