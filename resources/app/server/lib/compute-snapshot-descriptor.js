'use strict';
const fs=require('node:fs/promises'),crypto=require('node:crypto');
const {snapshotPath}=require('./model-snapshot');
const MiB=1024*1024;
// The readonly LFL lane follows both the content and metadata sidecars. It does
// not advance the published ASAS replica or hydrate the main-thread model.
async function collectionLflDescriptor(ownerId){
 const owner=String(ownerId||'');if(!owner)throw Object.assign(Error('Source owner required'),{code:'COMPUTE_SOURCE_OWNER_MISMATCH',statusCode:403});
 const file=snapshotPath(owner),tags=[];let rawBytes=0;
 for(const suffix of ['', '.bak', '.meta.json', '.meta.json.bak']){
  let handle;
  try{
   handle=await fs.open(file+suffix,'r');const stat=await handle.stat();
   tags.push([suffix,stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino,stat.mode]);
   if((suffix===''||suffix==='.bak')&&stat.isFile()&&stat.size>=4){
    const head=Buffer.alloc(2),tail=Buffer.alloc(4);await handle.read(head,0,2,0);
    const result=await handle.read(tail,0,4,stat.size-4);
    if(head[0]===0x1f&&head[1]===0x8b&&result.bytesRead===4)rawBytes=Math.max(rawBytes,tail.readUInt32LE(0));
   }
  }catch(error){if(error.code!=='ENOENT')throw error;tags.push([suffix,null]);}
  finally{await handle?.close();}
 }
 const generation='collection-lfl:'+crypto.createHash('sha256').update(JSON.stringify([owner,file,tags])).digest('hex');
 return Object.freeze({ownerId:owner,generation,bytes:Math.max(64*MiB,rawBytes*4),loadedAt:null});
}
async function assertCollectionLflDescriptor(descriptor){
 const current=await collectionLflDescriptor(descriptor?.ownerId);
 if(descriptor?.replicaFile||current.generation!==descriptor?.generation||current.bytes!==descriptor?.bytes)throw Object.assign(Error('Kaynak sürümü değişti. / Source generation changed.'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});
}
module.exports={collectionLflDescriptor,assertCollectionLflDescriptor};
