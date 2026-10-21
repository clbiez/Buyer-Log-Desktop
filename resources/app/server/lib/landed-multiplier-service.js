'use strict';
const {hash,error}=require('./operation-utils');
const fingerprint=value=>hash(JSON.stringify({tr:value.tr,overseas:value.overseas}));
// The native PUT range is shared by HTTP and Office; no pricing engine is copied.
function validateMultipliers(raw){
 const tr=Number(raw?.tr),overseas=Number(raw?.overseas);
 if(!Number.isFinite(tr)||tr<=0||tr>10||!Number.isFinite(overseas)||overseas<=0||overseas>10)throw error('LANDED_MULTIPLIERS_INVALID',400);
 return {tr,overseas};
}
function createLandedMultiplierService({db}){
 const read=()=>{const value=db.loadOverrides();return {multipliers:db.normalizeLandedMultipliers(value.landedMultipliers),revision:Number(value._revisions.landedMultipliers)||0,documentRevision:value._revision};};
 const capacity=(value,reserve=2)=>{if(![value.revision,value.documentRevision].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER-reserve))throw error('OFFICE_RESOURCE_REVISION_INVALID',409);};
 const snapshot=ctx=>db.mutateSharedResource('landedMultipliers',()=>{ctx.assertAuthority?.();const {documentRevision,...value}=read();return value;});
 const preview=(raw,ctx)=>db.mutateSharedResource('landedMultipliers',()=>{
  ctx.assertAuthority?.();const before=read(),next=validateMultipliers(raw);capacity(before);
  return {multipliers:before.multipliers,revision:before.revision,fingerprint:fingerprint(before.multipliers),next,impact:{shared:true,trDefaultChanged:before.multipliers.tr!==next.tr,overseasDefaultChanged:before.multipliers.overseas!==next.overseas,explicitRowFactorsChanged:false,storedPricesChanged:false,recordImpactAvailable:false,recalculates:['Collection TR landed','Collection overseas landed']}};
 });
 async function commit(next,expected,ctx,reserve=2){
  return db.mutateSharedResource('landedMultipliers',async lease=>{
   ctx.assertAuthority?.();const current=read();capacity(current,reserve);
   if(expected?.revision!=null&&current.revision!==Number(expected.revision))throw new db.RevisionConflictError('Landed çarpanları',expected.revision,current.revision,'landedMultipliers');
   if(expected?.fingerprint&&fingerprint(current.multipliers)!==expected.fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
   // The native writer checks current IAM at the actual journal boundary.
   // Its source CAS is separate from our own optimistic revision increment.
   const saved=db.replaceLandedMultipliers(next,current.revision,{...lease,assertAuthority:()=>ctx.assertAuthority?.()});await lease.commit();
   const actual=read();if(actual.revision!==saved.revision||fingerprint(actual.multipliers)!==fingerprint(next))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);
   // Preserve the already-authorized commit receipt even if access is revoked
   // immediately after it. Office separately gates publication/downstream work.
   return {verified:true,multipliers:saved.multipliers,revision:saved.revision,fingerprint:fingerprint(saved.multipliers)};
  });
 }
 const replace=(raw,expected,ctx={})=>commit(validateMultipliers(raw),expected,ctx);
 const restore=(before,expected,ctx)=>{if(fingerprint(db.normalizeLandedMultipliers(before))!==fingerprint(before))throw error('OFFICE_ROLLBACK_INVALID',409);return commit(before,expected,ctx,1);};
 return {snapshot,preview,replace,restore};
}
module.exports={createLandedMultiplierService,validateMultipliers,fingerprint};
