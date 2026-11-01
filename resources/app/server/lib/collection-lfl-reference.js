'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const Engine=require('../../public/collection-lfl-engine');
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
// Derived, local-only summaries. No order rows, source refreshes, timers or shared writes.
function createReferenceCache({directory}){
  const memory=new Map(),pending=new Map();
  async function get({identity,version,loadRows,rebuild=false}){
    const id=digest(identity),file=path.join(directory,id+'.json'),revision=String(version),requestKey=id+':'+revision;
    if(pending.has(requestKey))return pending.get(requestKey);
    if(!rebuild&&memory.get(id)?.version===revision)return memory.get(id);
    const task=(async()=>{
      if(!rebuild){try{const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved.schema===4&&saved.version===revision&&Array.isArray(saved.references)){memory.set(id,saved);return saved;}}catch(_){} }
      const snapshot={schema:4,version:revision,calculatedAt:new Date().toISOString(),references:Engine.buildReferences(await loadRows())};
      // Persistence is best effort: an unwritable cache must not block Price.
      const temp=file+'.'+crypto.randomUUID()+'.tmp';
      try{await fs.mkdir(directory,{recursive:true});await fs.writeFile(temp,JSON.stringify(snapshot));await fs.rename(temp,file);}catch(_){await fs.rm(temp,{force:true}).catch(()=>{});}
      if(memory.size>=32)memory.delete(memory.keys().next().value);
      memory.set(id,snapshot);return snapshot;
    })();
    pending.set(requestKey,task);
    try{return await task;}finally{pending.delete(requestKey);}
  }
  return {get};
}
module.exports={createReferenceCache};
