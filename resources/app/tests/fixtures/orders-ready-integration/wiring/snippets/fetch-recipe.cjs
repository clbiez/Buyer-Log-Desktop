'use strict';
// Exact named-function recipe only; no whole-app fixture or arbitrary drift.
const crypto=require('node:crypto');
const BASE_APP='ee50b8b649e5c2797470d13feb919ea5befc5f03d15823b4ae34d5f08363d04b';
function patch(source,extractFunction){
 if(crypto.createHash('sha256').update(source).digest('hex')!==BASE_APP)throw Error('wiring baseline app SHA mismatch');
 const old=extractFunction(source,'fetchOrdersProjection');
 const counter='  const generation=++projectionRequestGeneration.orders;';
 if(old.split(counter).length!==2)throw Error('exact Orders generation declaration missing');
 const tail=old.slice(old.indexOf(counter)+counter.length,-1);
 const next=old.slice(0,old.indexOf(counter)+counter.length)+`
  if(_ordersReadyProjectionLoader&&options.fullOnly!==true&&!ordersProjectionMustLoadFull()&&ordersReadyFirstSliceEligible()){
    const ordinary=async()=>{${tail}};
    const result=await _ordersReadyProjectionLoader.load(options,ordinary);
    if(generation!==projectionRequestGeneration.orders)return {cancelled:true};
    return result.cancelled?result:{...result,generation};
  }`+tail+'}';
 if(next.replace(next.slice(next.indexOf('\n  if(_ordersReadyProjectionLoader'),next.indexOf('  }'+tail)+3),'')!==old)throw Error('full branch restoration failed');
 return source.replace(old,next);
}
module.exports={BASE_APP,patch};
