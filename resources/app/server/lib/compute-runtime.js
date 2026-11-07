'use strict';
// Sunucu, veri projeksiyonları, FX ve Office aynı süreç havuzunu paylaşır.
let service;
function getComputeService(){
  if(!service){
    const root=require('../user-data').TEMP_ROOT;
    require('node:fs').mkdirSync(root,{recursive:true});
    service=require('./compute-service').createComputeService({root});
  }
  return service;
}
async function closeComputeService(){if(service)await service.close();}
module.exports={getComputeService,closeComputeService};
