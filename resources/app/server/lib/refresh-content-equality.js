'use strict';
// Exact source equality without hashing the whole dataset. JSON.stringify of an
// array/object is the concatenation of its members' JSON in order, so comparing
// member by member is equivalent to comparing the full JSON text (and to the
// former sha256 digest of it) — but a changed refresh stops at the first
// differing row instead of serialising and hashing both datasets.
function sameJson(a,b){
  if(a===b)return true;
  if(Array.isArray(a)||Array.isArray(b)){
    if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
    for(let i=0;i<a.length;i++){if(a[i]!==b[i]&&JSON.stringify(a[i]??null)!==JSON.stringify(b[i]??null))return false;}
    return true;
  }
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return JSON.stringify(a??null)===JSON.stringify(b??null);
  const keysA=Object.keys(a),keysB=Object.keys(b);
  if(keysA.length!==keysB.length)return JSON.stringify(a)===JSON.stringify(b);
  for(let i=0;i<keysA.length;i++){
    const key=keysA[i];if(key!==keysB[i])return JSON.stringify(a)===JSON.stringify(b);
    if(a[key]!==b[key]&&JSON.stringify(a[key])!==JSON.stringify(b[key]))return false;
  }
  return true;
}
function unchangedRefreshSummary(oldOrders,oldAntrepo,newOrders,newAntrepo){
  if(!sameJson(oldOrders,newOrders)||!sameJson(oldAntrepo,newAntrepo))return null;
  // Status/matching/date rules are applied equally to both sides of a refresh
  // comparison. Exact source equality therefore implies no source delta.
  const count=new Set(oldOrders.map(row=>`${row.ocode}|${row.colour}`.toUpperCase())).size;
  return {oldOrderCount:count,newOrderCount:count,newlyAppeared:0,disappeared:0,statusChanged:0,qtyChangedOrders:0,kalanDelta:0,
    asasChangedOrders:0,antrepoChangedOrders:0,asasChangeCount:0,antrepoChangeCount:0,hasChanges:false,details:[],reusedComparison:true};
}
module.exports={unchangedRefreshSummary,sameJson};
