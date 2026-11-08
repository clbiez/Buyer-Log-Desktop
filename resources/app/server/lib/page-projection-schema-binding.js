'use strict';
// Optional producer metadata bound to the existing strict module-schema reader.
// No disk/cache/worker or authorization state is owned by this module.
const crypto=require('node:crypto'),{types}=require('node:util');
const MAX_ENTRY_BYTES=65536,MAX_RAW=128*1024*1024,MAX_GZIP=64*1024*1024;
const MODULES=Object.freeze(['cp','orders']);
const PIN_KEYS=['ownerId','contextHash','sourceProjectionKey','moduleInputKey','fullChecksum','uncompressedBytes','compressedBytes'];
const ENTRY_KEYS=['version','module','pin','schema','schemaChecksum'];
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function plain(value){
  if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  return Reflect.ownKeys(value).every(key=>{
    const d=Object.getOwnPropertyDescriptor(value,key);
    return typeof key==='string'&&d.enumerable&&own(d,'value');
  });
}
function field(value,key){return plain(value)&&own(value,key)?Object.getOwnPropertyDescriptor(value,key).value:undefined;}
function exact(value,keys){return plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>own(value,key));}
function text(value){return typeof value==='string'&&value.length>0&&value.length<=1024;}
function hash(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function safeJsonPrototypes(){return !Object.getOwnPropertyDescriptor(Object.prototype,'toJSON')&&!Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');}
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function bytes(buffer,rawBytes){
  return !types.isProxy(buffer)&&Buffer.isBuffer(buffer)&&buffer.length>=18&&buffer.length<=MAX_GZIP
    &&buffer[0]===31&&buffer[1]===139&&buffer[2]===8&&Number.isSafeInteger(rawBytes)&&rawBytes>0&&rawBytes<=MAX_RAW
    &&buffer.readUInt32LE(buffer.length-4)===rawBytes;
}
function pinCopy(value,bound){
  const keys=bound?[...PIN_KEYS,'generation']:PIN_KEYS;
  if(!exact(value,keys))return null;
  for(const key of ['ownerId','contextHash','sourceProjectionKey','moduleInputKey'])if(!text(value[key]))return null;
  if(!hash(value.fullChecksum)||!Number.isSafeInteger(value.uncompressedBytes)||value.uncompressedBytes<1||value.uncompressedBytes>MAX_RAW
    ||!Number.isSafeInteger(value.compressedBytes)||value.compressedBytes<18||value.compressedBytes>MAX_GZIP)return null;
  if(bound&&(typeof value.generation!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value.generation)))return null;
  return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
function same(a,b,keys){return a&&b&&keys.every(key=>a[key]===b[key]);}
function manifestPin(manifest,ownerId,module){
  if(!MODULES.includes(module)||field(manifest,'schemaVersion')!==2)return null;
  const meta=field(field(manifest,'modules'),module);
  return pinCopy({ownerId,contextHash:field(manifest,'contextHash'),
    sourceProjectionKey:field(field(manifest,'sourceProjectionKeys'),module),moduleInputKey:field(field(manifest,'moduleInputKeys'),module),
    fullChecksum:field(meta,'checksum'),uncompressedBytes:field(meta,'uncompressedBytes'),compressedBytes:field(meta,'bytes'),
    generation:field(manifest,'activeGeneration')},true);
}
function create({schemaApi}){
  if(!schemaApi||typeof schemaApi.read!=='function')throw TypeError('Existing strict module schema reader required');
  function entryCopy(value,module,bound){
    try{
      if(!safeJsonPrototypes())return null;
      if(!MODULES.includes(module)||!exact(value,ENTRY_KEYS)||value.version!==1||value.module!==module||!hash(value.schemaChecksum))return null;
      const pin=pinCopy(value.pin,bound);if(!pin)return null;
      // Existing reader rejects getters/proxies/cycles/unknown/non-JSON and owns
      // a <=64 KiB copy. Do not JSON.stringify caller metadata before this gate.
      const schema=schemaApi.read(value.schema,module);if(schema.status!=='known')return null;
      if(digest(JSON.stringify(schema))!==value.schemaChecksum)return null;
      const result={version:1,module,pin,schema,schemaChecksum:value.schemaChecksum};
      return Buffer.byteLength(JSON.stringify(result))<=MAX_ENTRY_BYTES?freeze(result):null;
    }catch(_){return null;}
  }
  function snapshotPrepared(catalog){
    const result={};
    if(!plain(catalog)||Object.keys(catalog).some(module=>!MODULES.includes(module)))return freeze(result);
    for(const module of MODULES){const value=field(catalog,module),entry=entryCopy(value,module,false);if(entry)result[module]=entry;}
    return freeze(result);
  }
  function prepare(input){
    const result={};
    if(!plain(input)||Object.keys(input).some(key=>!['ownerId','contextHash','sourceProjectionKeys','moduleInputKeys','projections','moduleSchemas'].includes(key)))return freeze(result);
    const {ownerId,contextHash,sourceProjectionKeys,moduleInputKeys,projections,moduleSchemas}=input;
    if(!safeJsonPrototypes()||!text(ownerId)||!text(contextHash)||!plain(projections)||!plain(moduleSchemas))return freeze(result);
    for(const module of MODULES){
      const input=field(projections,module),schema=schemaApi.read(field(moduleSchemas,module),module);
      if(schema.status!=='known'||!plain(input))continue;
      const buffer=field(input,'buffer'),uncompressedBytes=field(input,'uncompressedBytes');
      if(!bytes(buffer,uncompressedBytes))continue;
      const candidate={version:1,module,pin:{ownerId,contextHash,sourceProjectionKey:field(sourceProjectionKeys,module),
        moduleInputKey:field(moduleInputKeys,module),fullChecksum:digest(buffer),uncompressedBytes,compressedBytes:buffer.length},
        schema,schemaChecksum:digest(JSON.stringify(schema))};
      const entry=entryCopy(candidate,module,false);if(entry)result[module]=entry;
    }
    return freeze(result);
  }
  function bindCommitted(manifest,prepared,ownerId){
    const result={},snapshot=snapshotPrepared(prepared);
    for(const module of MODULES){
      const candidate=snapshot[module],current=manifestPin(manifest,ownerId,module);
      if(!candidate||!same(candidate.pin,current,PIN_KEYS))continue;
      const entry=entryCopy({...candidate,pin:current},module,true);if(entry)result[module]=entry;
    }
    return result; // only newly produced metadata; never imports an old generation
  }
  function retainCurrent(previous,next,ownerId){
    const result={};
    for(const module of MODULES){
      const entry=entryCopy(field(field(previous,'moduleSchemas'),module),module,true);
      const desired=entryCopy(field(field(next,'moduleSchemas'),module),module,true);
      const oldPin=manifestPin(previous,ownerId,module),nextPin=manifestPin(next,ownerId,module);
      if(entry&&desired&&entry.schemaChecksum===desired.schemaChecksum
        &&same(entry.pin,desired.pin,[...PIN_KEYS,'generation'])&&same(entry.pin,oldPin,[...PIN_KEYS,'generation'])
        &&same(entry.pin,nextPin,[...PIN_KEYS,'generation']))result[module]=entry;
    }
    return result; // extra.moduleSchemas cannot reintroduce a dropped entry
  }
  function drop(catalog,module){
    const result={};
    for(const name of MODULES)if(name!==module){const entry=entryCopy(field(catalog,name),name,true);if(entry)result[name]=entry;}
    return result;
  }
  function readCurrent(input){
    try{
      if(!plain(input)||Object.keys(input).some(key=>!['ownerId','module','manifest','cached'].includes(key)))return null;
      const {ownerId,module,manifest,cached}=input;
      if(!MODULES.includes(module)||!plain(cached)||field(cached,'fallback')!==false||field(cached,'module')!==module)return null;
      const pin=manifestPin(manifest,ownerId,module),cachedPin=manifestPin(field(cached,'manifest'),ownerId,module);
      const entry=entryCopy(field(field(manifest,'moduleSchemas'),module),module,true);
      if(!pin||!entry||!same(entry.pin,pin,[...PIN_KEYS,'generation'])||!same(pin,cachedPin,[...PIN_KEYS,'generation']))return null;
      const meta=field(cached,'meta'),buffer=field(cached,'buffer');
      if(!plain(meta)||meta.checksum!==pin.fullChecksum||meta.uncompressedBytes!==pin.uncompressedBytes||meta.bytes!==pin.compressedBytes
        ||!bytes(buffer,pin.uncompressedBytes)||buffer.length!==pin.compressedBytes||digest(buffer)!==pin.fullChecksum)return null;
      // Bound + frozen own copy, never a reference into a caller or loaded manifest.
      return entry;
    }catch(_){return null;}
  }
  function preparedKey(catalog){return digest(JSON.stringify(snapshotPrepared(catalog)));}
  return Object.freeze({prepare,snapshotPrepared,preparedKey,bindCommitted,retainCurrent,drop,readCurrent});
}
module.exports=Object.freeze({create,MAX_ENTRY_BYTES});
