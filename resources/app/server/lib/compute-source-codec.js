'use strict';
// Süreç ömrüyle sınırlı worker kopyası; kalıcı iş verisi formatı değildir.
// v8, ISO biçimli metni Date'e dönüştürmeden referans ilişkilerini korur.
const v8=require('node:v8'),crypto=require('node:crypto');
const checksum=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function failure(code){
  const messages={COMPUTE_SOURCE_OWNER_MISMATCH:['Kaynak sahibi uyuşmuyor.','Source owner mismatch.'],COMPUTE_STALE_GENERATION:['Kaynak sürümü değişti.','Source generation changed.'],COMPUTE_SOURCE_CORRUPT:['Kaynak kopyası doğrulanamadı.','Source replica could not be verified.']};
  const [tr,en]=messages[code];return Object.assign(Error(`${tr} / ${en}`),{code,errorEn:en});
}
function encode({ownerId,generation,source}){
  if(!ownerId||!generation)throw failure('COMPUTE_SOURCE_CORRUPT');
  const bytes=v8.serialize({version:1,ownerId:String(ownerId),generation:String(generation),source});
  return {bytes,checksum:checksum(bytes)};
}
function decode(bytes,expected){
  if(!expected||!expected.checksum||checksum(bytes)!==expected.checksum)throw failure('COMPUTE_SOURCE_CORRUPT');
  let value;try{value=v8.deserialize(bytes);}catch{throw failure('COMPUTE_SOURCE_CORRUPT');}
  if(!value||value.version!==1||!value.source)throw failure('COMPUTE_SOURCE_CORRUPT');
  if(value.ownerId!==String(expected.ownerId))throw failure('COMPUTE_SOURCE_OWNER_MISMATCH');
  if(value.generation!==String(expected.generation))throw failure('COMPUTE_STALE_GENERATION');
  return value.source;
}
module.exports={encode,decode};
