'use strict';
// Paketlenmiş filtre kaynağı sabittir; HTTP girdisi dosya yolu seçemez.
const fs=require('node:fs'),oabStaticMetadata=require('./oab-static-metadata');
const MiB=1024*1024;
let cachedGeneration;
function metadataError(code){
 const messages={OAB_STATIC_METADATA_MISSING:['OAB filtre dosyası bulunamadı.','OAB filter metadata file was not found.'],COMPUTE_STALE_GENERATION:['OAB filtre sürümü değişti.','OAB filter metadata generation changed.'],COMPUTE_SOURCE_TOO_LARGE:['OAB filtre dosyası bellek bütçesini aşıyor.','OAB filter metadata exceeds the memory budget.']};
 const [tr,en]=messages[code];return Object.assign(Error(`${tr} / ${en}`),{code,errorEn:en,statusCode:code==='COMPUTE_STALE_GENERATION'?409:code==='COMPUTE_SOURCE_TOO_LARGE'?413:500});
}
async function descriptor(){
 let stat;try{stat=await fs.promises.stat(oabStaticMetadata.METADATA_FILE,{bigint:true});}catch{throw metadataError('OAB_STATIC_METADATA_MISSING');}
 const size=Number(stat.size);if(!stat.isFile()||!Number.isSafeInteger(size)||size<1||size>16*MiB)throw metadataError('COMPUTE_SOURCE_TOO_LARGE');
 return {size,tag:[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':')};
}
async function assertDescriptor(expected){
 let current;try{current=await descriptor();}catch{throw metadataError('COMPUTE_STALE_GENERATION');}
 if(!expected||current.tag!==expected.tag||current.size!==expected.size)throw metadataError('COMPUTE_STALE_GENERATION');
}
function buildResponse(operation,ref,generation){
 if(generation!==undefined&&generation!==cachedGeneration){oabStaticMetadata.clearCache();cachedGeneration=generation;}
 let key,options;
 if(operation==='seasons'){key='seasons';options=oabStaticMetadata.getSeasons();}
 else if(operation==='mag'){const seasonRef=ref;key='mag';options=oabStaticMetadata.getMag(seasonRef);}
 else if(operation==='buyer-groups'){const merchSubGroupRef=ref;key='buyerGroups';options=oabStaticMetadata.getBuyerGroups(merchSubGroupRef);}
 else throw Object.assign(Error('Geçersiz OAB filtre isteği. / Invalid OAB filter request.'),{code:'COMPUTE_JOB_INVALID',statusCode:400});
 const metadata=oabStaticMetadata.getInfo();
 return {ok:true,[key]:options,fromCache:true,source:'bundled-json',fetchedAt:metadata.generatedAt,metadata};
}
module.exports={descriptor,assertDescriptor,buildResponse};
