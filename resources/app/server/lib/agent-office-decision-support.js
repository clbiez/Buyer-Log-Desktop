'use strict';
const fields=require('./canonical-fields');
const Prices=require('../../public/price-supplier-insights-engine');
const project=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
const supplierKeys=['key','name','volume','previousVolume','share','previousShare','volumeChange','price','previousPrice','models','priceLevel','priceChange','priceChangeCoverage','records','previousRecords','status','volumeDelta'];
const groupKeys=['key','name','volume','previousVolume','records','price','models','index','groupShare','priceChange'];
const aggregateSupplier=value=>({...project(value,supplierKeys),groups:(value.groups||[]).slice(0,8).map(g=>project(g,groupKeys)),omittedGroups:Math.max(0,(value.groups||[]).length-8)});
const aggregateMovers=value=>({up:value.up.map(aggregateSupplier),down:value.down.map(aggregateSupplier),...(value.count===undefined?{}:{count:value.count})});
function historicalPrices(rows,updatedAt) {
 const observations=(rows||[]).map(row=>{const value=field=>fields.value(row,'lfl',field);const currency=String(value('currency')||'').toUpperCase();return{manufacturer:value('manufacturer'),country:value('country'),classification:value('category'),season:value('season'),buyingGroup:value('buyerGroup'),mag:value('mag'),mmyg:value('mmyg'),quantity:value('orderQuantity'),modelKey:value('plmId')||value('modelName'),rowId:value('orderCode'),currency:currency||'UNVERIFIED',price:currency?Number(value('fob'))||null:null};});
 const dataset=Prices.prepare(observations),periods=Prices.defaultPeriods(Prices.seasons(dataset));
 return dataset.currencies.filter(c=>c!=='UNVERIFIED').map(currency=>{const model=Prices.analyze(dataset,{...periods,currency,minSample:2});return{currency,...periods,hasComparison:model.hasComparison,totals:model.totals,suppliers:model.manufacturers.slice(0,100).map(aggregateSupplier),omittedSuppliers:Math.max(0,model.manufacturers.length-100),priceMovers:aggregateMovers(Prices.priceMovers(model)),volumeMovers:aggregateMovers(Prices.volumeMovers(model)),sources:[{source:'LFL',id:'lfl:'+currency,updatedAt:updatedAt||null}],origin:'deterministic',unavailable:['actual-arrival-date'],unverifiedCurrencyRows:observations.filter(o=>o.currency==='UNVERIFIED').length};});
}
function supplierHistory(orders,rows) {
 const index=new Map();
 for(const order of orders){const values=order.dimensions||{},name=String(values.manufacturer||''),season=String(values.season||''),key=name.toLocaleUpperCase('tr-TR')+'|'+season;
  if(!index.has(key))index.set(key,{name,season,orderKeys:new Set(),orders:0,atRisk:0,late:0,qualityTested:0,qualityRejected:0,dateRevisionCount:0,quantity:0,unknownDelivery:0});const item=index.get(key);if(item.orderKeys.has(order.orderKey))continue;item.orderKeys.add(order.orderKey);item.orders++;item.quantity+=Math.max(0,Number(values.orderQuantity)||0);item.atRisk+=Number(order.analysis.deliveryOutcome==='AT_RISK');item.late+=Number(['EXPECTED_LATE','ALREADY_LATE'].includes(order.analysis.deliveryOutcome));item.unknownDelivery+=Number(order.analysis.deliveryOutcome==='UNKNOWN');item.dateRevisionCount+=Number(order.analysis.dateSync.differences.length>0);
  const tested=order.evidence.some(e=>['approved','rejected'].includes(e.testState)),rejected=order.evidence.some(e=>e.testState==='rejected');item.qualityTested+=Number(tested);item.qualityRejected+=Number(rejected);
 }
 return [...index.values()].map(({orderKeys,...item})=>({...item,qualityRejectionRate:item.qualityTested?item.qualityRejected/item.qualityTested:null,deliveryRiskRate:item.orders?(item.atRisk+item.late)/item.orders:null,interpretation:'observed-order-risk-not-otif',actualOnTimeRate:null}));
}
function collectionPipeline(rows,orders) {
 const groups=new Map(),linked=new Map();for(const order of orders){const key=String(order.identity.plmId||'')+'|'+String(order.identity.colourCode||'').toUpperCase();if(!linked.has(key))linked.set(key,[]);linked.get(key).push(order);}
 const snapshots=[];for(let i=0;i<(rows||[]).length;i++){const row=rows[i],values=fields.project(row,'collection'),season=String(values.season||''),status=String(values.orderStatus||''),key=season+'|'+status;if(!groups.has(key))groups.set(key,{season,status,options:0,linkedOrders:0,atRisk:0,approvalConflicts:0,missingSupplier:0});const item=groups.get(key);item.options++;const matches=linked.get(String(values.plmId||'')+'|'+String(values.colourCode||'').toUpperCase())||[];item.linkedOrders+=matches.length;item.atRisk+=matches.filter(o=>['CRITICAL','HIGH'].includes(o.analysis.priority)).length;item.approvalConflicts+=matches.reduce((n,o)=>n+o.findings.filter(f=>f.code.startsWith('APPROVAL_CONFLICT_')).length,0);item.missingSupplier+=Number(!values.manufacturer);snapshots.push({key:'collection:'+String(row.id||row._id||[values.plmId,values.colourCode,i].join('|')),values,origin:'Collection',evidence:[]});}
 return {groups:[...groups.values()],snapshots};
}
module.exports={historicalPrices,supplierHistory,collectionPipeline};
