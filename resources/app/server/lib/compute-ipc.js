'use strict';
const v8=require('node:v8'),threads=require('node:worker_threads');
// Yalnız encoder'ın sahip olduğu yeni tampon tüketilir. Havuzlu, paylaşılmış,
// kesilmiş veya transfer durumu doğrulanamayan tampon güvenli biçimde kopyalanır.
function takeEncodedBuffer(bytes){
  if(bytes.buffer instanceof ArrayBuffer&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength
    &&typeof threads.isMarkedAsUntransferable==='function'&&!threads.isMarkedAsUntransferable(bytes.buffer))return bytes.buffer;
  return Uint8Array.from(bytes).buffer;
}
function serializeForTransfer(value){return takeEncodedBuffer(v8.serialize(value));}
module.exports={takeEncodedBuffer,serializeForTransfer};
