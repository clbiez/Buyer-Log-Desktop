'use strict';
const v8=require('node:v8'),{performance}=require('node:perf_hooks');
// Tek V8 akışı nesne/Date kimliğini korur. Her writeValue en fazla 256 satır
// işler; aralarda gerçek event-loop turu ve güncel generation kontrolü vardır.
async function encodeAuthority(authority,{assertCurrent=()=>{},yieldControl=()=>new Promise(setImmediate)}={}){
  assertCurrent();const serializer=new v8.Serializer();let sliceStarted=performance.now(),paramsSerializeMs=0,maxSerializeSliceMs=0,paramsChunks=0;
  serializer.writeHeader();serializer.writeUint32(1);
  let records=[],units=0;
  function timing(){const elapsed=performance.now()-sliceStarted;paramsSerializeMs+=elapsed;maxSerializeSliceMs=Math.max(maxSerializeSliceMs,elapsed);}
  async function flush(){
    if(!records.length)return;
    serializer.writeValue(records);paramsChunks++;records=[];units=0;timing();
    await yieldControl();assertCurrent();sliceStarted=performance.now();
  }
  for(const code of Object.keys(authority)){
    const rows=authority[code];
    if(!Array.isArray(rows)||!rows.length){
      records.push([code,true,rows,Array.isArray(rows)]);units++;
      if(units===256)await flush();
      continue;
    }
    for(let offset=0;offset<rows.length;){
      const count=Math.min(256-units,rows.length-offset);
      records.push([code,offset===0,rows.slice(offset,offset+count),true]);units+=count;offset+=count;
      if(units===256)await flush();
    }
  }
  await flush();assertCurrent();serializer.writeValue(null);
  const bytes=Uint8Array.from(serializer.releaseBuffer()).buffer;timing();
  return {bytes,paramsSerializeMs,maxSerializeSliceMs,paramsChunks};
}
function decodeAuthority(bytes){
  const reader=new v8.Deserializer(Buffer.from(bytes));reader.readHeader();
  if(reader.readUint32()!==1)throw Error('Invalid authority encoding');
  const authority={};let records;
  while((records=reader.readValue())!==null){
    for(const [code,first,rows,array] of records){
      if(first)Object.defineProperty(authority,code,{value:rows,enumerable:true,writable:true,configurable:true});
      else if(array)authority[code].push(...rows);
    }
  }
  return authority;
}
module.exports={encodeAuthority,decodeAuthority};
