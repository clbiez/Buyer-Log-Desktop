'use strict';
const crypto=require('node:crypto');
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function unchangedRefreshSummary(oldOrders,oldAntrepo,newOrders,newAntrepo){
  if(digest(oldOrders)!==digest(newOrders)||digest(oldAntrepo)!==digest(newAntrepo))return null;
  // Status/matching/date rules are applied equally to both sides of a refresh
  // comparison. Exact source equality therefore implies no source delta.
  const count=new Set(oldOrders.map(row=>`${row.ocode}|${row.colour}`.toUpperCase())).size;
  return {oldOrderCount:count,newOrderCount:count,newlyAppeared:0,disappeared:0,statusChanged:0,qtyChangedOrders:0,kalanDelta:0,
    asasChangedOrders:0,antrepoChangedOrders:0,asasChangeCount:0,antrepoChangeCount:0,hasChanges:false,details:[],reusedComparison:true};
}
module.exports={unchangedRefreshSummary};
