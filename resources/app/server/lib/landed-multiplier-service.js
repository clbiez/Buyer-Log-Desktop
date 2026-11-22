'use strict';
const {hash,error}=require('./operation-utils');
const Vehicles=require('../../public/landed-vehicle-standards');
// Vasıtaya göre standart (byVehicle) boşsa parmak izine girmez: eski kayıtların
// parmak izi ve Office önizleme/geri alma sözleşmesi değişmez. Anahtarlar sıralanır.
const vehicleTable=value=>{const table=Vehicles.normalizeByVehicle(value&&value.byVehicle),keys=Object.keys(table).sort();return keys.length?Object.fromEntries(keys.map(key=>[key,table[key]])):undefined;};
const fingerprint=value=>hash(JSON.stringify({tr:value.tr,overseas:value.overseas,byVehicle:vehicleTable(value)}));
// The native PUT range is shared by HTTP and Office; no pricing engine is copied.
// byVehicle yoksa (eski istemci) sonuçta da YOKTUR: yazımda kayıtlı değer korunur.
// Açık {} ise vasıta standartları temizlenir.
function validateMultipliers(raw){
 const tr=Number(raw?.tr),overseas=Number(raw?.overseas);
 if(!Number.isFinite(tr)||tr<=0||tr>10||!Number.isFinite(overseas)||overseas<=0||overseas>10)throw error('LANDED_MULTIPLIERS_INVALID',400);
 if(raw.byVehicle===undefined)return {tr,overseas};
 const checked=Vehicles.validateByVehicle(raw.byVehicle);
 if(!checked.ok)throw error('LANDED_MULTIPLIERS_INVALID',400);
 return {tr,overseas,byVehicle:checked.value};
}
/* Yazılacak nihai değer. preserve: alan gelmediyse kayıtlı vasıta standardı korunur
   (çok kullanıcılı ortamda eski sürüm istemcinin PUT'u veriyi silmesin). Geri
   almada (restore) preserve kapalıdır: önceki kayıt birebir geri gelir. */
function resolveMultipliers(next,current,preserve){
 const merged=preserve&&next.byVehicle===undefined?{...next,byVehicle:current&&current.byVehicle}:next;
 const table=vehicleTable(merged);
 return {tr:merged.tr,overseas:merged.overseas,...(table?{byVehicle:table}:{})};
}
function createLandedMultiplierService({db}){
 const read=()=>{const value=db.loadOverrides();return {multipliers:db.normalizeLandedMultipliers(value.landedMultipliers),revision:Number(value._revisions.landedMultipliers)||0,documentRevision:value._revision};};
 const capacity=(value,reserve=2)=>{if(![value.revision,value.documentRevision].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER-reserve))throw error('OFFICE_RESOURCE_REVISION_INVALID',409);};
 const snapshot=ctx=>db.mutateSharedResource('landedMultipliers',()=>{ctx.assertAuthority?.();const {documentRevision,...value}=read();return value;});
 const preview=(raw,ctx)=>db.mutateSharedResource('landedMultipliers',()=>{
  ctx.assertAuthority?.();const before=read(),next=resolveMultipliers(validateMultipliers(raw),before.multipliers,true);capacity(before);
  const vehicleStandardsChanged=JSON.stringify(vehicleTable(before.multipliers)||{})!==JSON.stringify(vehicleTable(next)||{});
  return {multipliers:before.multipliers,revision:before.revision,fingerprint:fingerprint(before.multipliers),next,impact:{shared:true,trDefaultChanged:before.multipliers.tr!==next.tr,overseasDefaultChanged:before.multipliers.overseas!==next.overseas,vehicleStandardsChanged,explicitRowFactorsChanged:false,storedPricesChanged:false,recordImpactAvailable:false,recalculates:['Collection TR landed','Collection overseas landed',...(vehicleStandardsChanged?['TR/YD landed status']:[])]}};
 });
 async function commit(requested,expected,ctx,reserve=2,preserve=true){
  return db.mutateSharedResource('landedMultipliers',async lease=>{
   ctx.assertAuthority?.();const current=read();capacity(current,reserve);
   // Koru kuralı kilit İÇİNDE uygulanır: eşzamanlı bir vasıta yazımı ezilmez.
   const next=resolveMultipliers(requested,current.multipliers,preserve);
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
 const restore=(before,expected,ctx)=>{if(fingerprint(db.normalizeLandedMultipliers(before))!==fingerprint(before))throw error('OFFICE_ROLLBACK_INVALID',409);return commit(before,expected,ctx,1,false);};
 return {snapshot,preview,replace,restore};
}
module.exports={createLandedMultiplierService,validateMultipliers,fingerprint};
