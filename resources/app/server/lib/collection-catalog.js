'use strict';
const canonicalFields=require('./canonical-fields');
const BLBusinessRules=require('../../public/business-rules');

const COLLECTION_CATALOG_FIELDS=Object.freeze({
  category:'Category',mag:'Merch Alt Grup Kod',mmyg:'Merch Marka Yaş Grup Kod',
  buyingGroup:'Buyer Grup (TR)',buyer:'Buyer',manufacturer:'Manufacturer',season:'Season',
  license:'License',licensor:'Licensor',country:'Country',line:'Line',productMainDefinition:'Ürün Ana Tanım',
});
const COLLECTION_CATALOG_CANONICAL_FIELDS=Object.freeze({
  category:'category',mag:'mag',mmyg:'mmyg',buyingGroup:'buyingGroup',buyer:'buyer',manufacturer:'manufacturer',
  season:'season',license:'license',licensor:'licensor',country:'country',line:'line',productMainDefinition:'productDescription',
});
// Mevcut sunucu v3 sözleşmesi: manufacturer ve ASAS productDescription dahil.
const COLLECTION_CATALOG_SCHEMA_VERSION=3;
const ENTRIES=Object.entries(COLLECTION_CATALOG_FIELDS).map(([key,field])=>[key,field,COLLECTION_CATALOG_CANONICAL_FIELDS[key]]);
function collectionCatalogsComplete(catalogs){
  return Boolean(catalogs&&typeof catalogs==='object'&&ENTRIES.every(([key])=>Array.isArray(catalogs[key])));
}
function collectionCatalogProjectionComplete(data){
  return Boolean(data&&Number(data.catalogSchemaVersion)===COLLECTION_CATALOG_SCHEMA_VERSION&&collectionCatalogsComplete(data.catalogs));
}
function buildCollectionCatalogs(orderRows){
  const buckets=Object.fromEntries(ENTRIES.map(([key])=>[key,new Map()]));
  for(const row of Array.isArray(orderRows)?orderRows:[]){
    for(const [key,field,canonicalId] of ENTRIES){
      const rawValue=canonicalId?canonicalFields.value(row,'overview',canonicalId):(row&&row[field]);
      const value=String(rawValue==null?'':rawValue).trim();if(!value)continue;
      const identity=canonicalFields.token(value).replace(/\s+/g,'');
      if(identity&&!buckets[key].has(identity))buckets[key].set(identity,value);
    }
  }
  return Object.fromEntries(ENTRIES.map(([key])=>[key,[...buckets[key].values()].sort(BLBusinessRules.compareChronologicalValues)]));
}
module.exports={COLLECTION_CATALOG_FIELDS,COLLECTION_CATALOG_CANONICAL_FIELDS,COLLECTION_CATALOG_SCHEMA_VERSION,collectionCatalogsComplete,collectionCatalogProjectionComplete,buildCollectionCatalogs};
