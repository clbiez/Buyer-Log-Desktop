'use strict';
/* Okuma modeli saf sorgu motoru (#1073). DOM'suz, HTTP'siz: girdi kullanıcı
   kapsamına göre önceden süzülmüş projeksiyon satırları + sorgu tanımı, çıktı
   pencere/toplam/toplamlar. Filtre ve sıralama semantiği istemciyle ortak
   public/read-model-query.js modülündedir; burada iki kez yazılmaz. */
const zlib=require('node:zlib');
const shared=require('../../../public/read-model-query');
const {stringifyWithDates}=require('../json-dates');
const MODULES=Object.freeze({cp:'cp',orders:'orders',overview:'overview'});
const pad=n=>String(n).padStart(2,'0');
// Projeksiyon ile aynı yerel gün biçimi (compute-tasks projectionDate).
const dateOnly=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function prepareDataset(value){
  const rows=Array.isArray(value)?value:Array.isArray(value&&value.rows)?value.rows:[];
  return {rows:shared.normalizeRows(rows),haystacks:new WeakMap()};
}
function decodeDataset(buffer){
  const json=zlib.gunzipSync(Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer));
  return {...prepareDataset(JSON.parse(json.toString('utf8'))),bytes:json.length};
}
function executeQuery(dataset,rawQuery){
  const query=shared.validateQuery(rawQuery);
  return shared.runQuery(dataset.rows,query,{haystacks:dataset.haystacks});
}
function serializeResult(result){return stringifyWithDates(result,dateOnly);}
module.exports={MODULES,prepareDataset,decodeDataset,executeQuery,serializeResult,validateQuery:shared.validateQuery,signature:shared.signature,QUERY_VERSION:shared.QUERY_VERSION,LIMITS:shared.LIMITS};
