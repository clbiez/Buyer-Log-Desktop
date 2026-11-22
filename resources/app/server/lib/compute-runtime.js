'use strict';
// Sunucu, veri projeksiyonları, FX ve Office aynı süreç havuzunu paylaşır.
let service,localSourceProvider=null;
// Sunucu, bellekteki aynı sürüm kaynağını kapasite yoluna verir (bkz. compute-service localSourceFor).
function setLocalSourceProvider(fn){localSourceProvider=typeof fn==='function'?fn:null;}
function getComputeService(){
  if(!service){
    const root=require('../user-data').TEMP_ROOT;
    require('node:fs').mkdirSync(root,{recursive:true});
    service=require('./compute-service').createComputeService({root,localSourceFor:(owner,descriptor)=>localSourceProvider?.(owner,descriptor)||null});
  }
  return service;
}
async function closeComputeService(){if(service)await service.close();}
function retireComputeSource(ownerId){service?.retireSource(ownerId);}
module.exports={getComputeService,closeComputeService,retireComputeSource,setLocalSourceProvider};
