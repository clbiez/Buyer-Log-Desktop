'use strict';

const {parentPort,workerData}=require('node:worker_threads');
const zlib=require('node:zlib');
const {promisify}=require('node:util');
const parse=require('./lib/parse');
const canonicalFields=require('./lib/canonical-fields');

const gzip=promisify(zlib.gzip);
const CATALOG_FIELDS={category:'category',mag:'mag',mmyg:'mmyg',buyingGroup:'buyingGroup',buyer:'buyer',season:'season',license:'license',licensor:'licensor',country:'country',line:'line',productMainDefinition:'productDescription'};
const COLLECTION_CATALOG_SCHEMA_VERSION=2;
function dateOnly(value){const p=n=>String(n).padStart(2,'0');return `${value.getFullYear()}-${p(value.getMonth()+1)}-${p(value.getDate())}`;}
function dateSafeReplacer(key,value){const raw=this&&this[key];return raw instanceof Date?dateOnly(raw):value;}
function catalogs(rows){
  const buckets=Object.fromEntries(Object.keys(CATALOG_FIELDS).map(key=>[key,new Map()]));
  for(const row of rows||[])for(const [key,canonicalId] of Object.entries(CATALOG_FIELDS)){
    const raw=canonicalFields.value(row,'overview',canonicalId);
    const value=String(raw==null?'':raw).trim();if(!value)continue;
    const identity=value.toLocaleUpperCase('tr-TR').replace(/[^A-Z0-9ÇĞİÖŞÜ]+/g,'');if(identity&&!buckets[key].has(identity))buckets[key].set(identity,value);
  }
  return Object.fromEntries(Object.entries(buckets).map(([key,values])=>[key,[...values.values()].sort((a,b)=>a.localeCompare(b,'tr-TR',{numeric:true,sensitivity:'base'}))]));
}
async function main(){
  const started=Date.now(),data=workerData||{},editable=new Set((data.editableOrderCodes||[]).map(String));
  const projected=data.shared
    ?parse.buildSharedOrderProjectionRowsFromASAS(data.ordersSource,data.ordersAntrepo,data.overrides)
    :{cp:parse.buildCPRowsFromASAS(data.cpSource,data.cpAntrepo,data.overrides),orders:parse.buildOrdersRowsFromASAS(data.ordersSource,data.ordersAntrepo,data.overrides)};
  const orderSummary=data.orderSummaryAllowed?parse.buildOrderSummaryRowsFromASAS(data.cpSource,data.cpAntrepo,data.overrides):[];
  const overview=data.orderSummaryAllowed?parse.buildOverviewSummaryRowsFromASAS(data.cpSource,data.overrides):[];
  projected.cp.forEach(row=>{row._canEdit=editable.has(String(row['Order Code']));});
  projected.orders.forEach(row=>{row._canEdit=false;});orderSummary.forEach(row=>{row._canEdit=editable.has(String(row['Order Code']));});
  const values={cp:{rows:projected.cp,cpModelColumns:data.cpModelColumns||[]},overview:{rows:overview},orders:{rows:projected.orders,orderSummary},'collection-catalog':{catalogs:catalogs(projected.orders.length?projected.orders:overview),catalogSchemaVersion:COLLECTION_CATALOG_SCHEMA_VERSION}};
  const compressed={},transfer=[];
  for(const [module,value] of Object.entries(values)){
    const json=Buffer.from(JSON.stringify(value,dateSafeReplacer),'utf8'),gz=await gzip(json,{level:4}),copy=Uint8Array.from(gz);
    compressed[module]={buffer:copy.buffer,uncompressedBytes:json.length};transfer.push(copy.buffer);
  }
  parentPort.postMessage({ok:true,compressed,metrics:{workerMs:Date.now()-started,cpRows:projected.cp.length,ordersRows:projected.orders.length,orderSummaryRows:orderSummary.length}},transfer);
}
main().catch(error=>parentPort.postMessage({ok:false,error:String(error&&error.stack||error)}));

