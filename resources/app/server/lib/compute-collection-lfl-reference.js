'use strict';
const zlib=require('node:zlib'),{promisify}=require('node:util');
const gunzip=promisify(zlib.gunzip),MAX_SUMMARY_BYTES=16*1024*1024;
function stale(){return Object.assign(Error('Kaynak sürümü değişti. / Source generation changed.'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});}
function createComputedCollectionReferenceSource({compute,guard,userAccess,calendar}){
 return async function read(req){
  await userAccess.prepareComputeAccessContext();
  const captures=['koleksiyon','lfl'].map(area=>guard.capture(req,area)),profile=captures[0].profile;
  const assertCurrent=()=>{for(const captured of captures){captured.assertBuild();captured.assertResponse();}};
  const service=compute(),descriptor=await service.collectionLflSource(profile.id);
  assertCurrent();const params={access:userAccess.computeAccessContext(profile),calendar:calendar()};
  const assertSource=async()=>{
   assertCurrent();const current=await service.collectionLflSource(profile.id);assertCurrent();
   if(current.generation!==descriptor.generation)throw stale();
  };
  let info,lease;
  try{await assertSource();lease=await service.runCollectionLfl('collection-lfl-source-info',descriptor,params);await assertSource();info=lease.value;}
  finally{lease?.release();}
  return {id:String(profile.id),version:info.available?info.version:null,assertCurrent:assertSource,assertResponse:assertCurrent,
   async buildReferences(){
    let result;
    try{
     await assertSource();result=await service.runCollectionLfl('collection-lfl-references',descriptor,params);await assertSource();
     const raw=await gunzip(Buffer.from(result.value.buffer),{maxOutputLength:MAX_SUMMARY_BYTES});assertCurrent();
     const summary=JSON.parse(raw.toString('utf8'));await assertSource();
     if(!Array.isArray(summary.references))throw Object.assign(Error('Invalid LFL summary'),{code:'COMPUTE_JOB_INVALID',statusCode:500});
     return summary.references;
    }finally{result?.release();}
   }};
 };
}
module.exports={createComputedCollectionReferenceSource};
