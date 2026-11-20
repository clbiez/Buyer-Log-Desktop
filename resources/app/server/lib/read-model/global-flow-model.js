'use strict';
/* Küresel Akış Haritası okuma modeli (#1075, WS2b).
 *
 * Girdi: kullanıcının Backlog harita projeksiyonu (compute-tasks buildBacklog
 * 'export' + mapProjection; /api/backlog-export?projection=global-flow ile aynı
 * gzip JSON baytları). Kapsam/yetki süzmesi o projeksiyonda yapılmıştır; burada
 * satır eklenmez.
 * Çıktı: public/overview-global-flow.js encodeReadModelRecords sözleşmesi —
 * haritanın parsiyel kayıtları, sütunlu biçimde. Normalleştirme tarayıcıdaki
 * AYNI modülle yapılır (mantık iki kez yazılmaz). Öncelik alanları istemcideki
 * ortak CP öncelik dizinine bağlı olduğundan ham girdileriyle taşınır ve
 * istemcide hydrateReadModelRecords ile çözülür.
 *
 * Bu modül yalnız okuma modeli işçisinde (read-model-worker.js) yüklenir:
 * tarayıcı modüllerinin globalThis kayıtları ana olay döngüsünü kirletmez.
 */
const zlib=require('node:zlib');
const {performance}=require('node:perf_hooks');
globalThis.BLCanonicalFields=globalThis.BLCanonicalFields||require('../canonical-fields');
// Tarayıcıda bu motorlar window global'idir; normalleştirme aynı globalleri okur.
require('../../../public/business-rules');
require('../../../public/order-decision-engine');
require('../../../public/backlog-delivery-engine');
const flow=require('../../../public/overview-global-flow');

function decodeExport(buffer){
  const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer instanceof ArrayBuffer?new Uint8Array(buffer):buffer);
  return JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
}
// Saf: ayrıştırılmış Backlog harita projeksiyonu → kayıt yükü (nesne).
function buildRecordsPayload(exportValue){
  const value=exportValue&&typeof exportValue==='object'?exportValue:{};
  const rows=Array.isArray(value.rows)?value.rows:[];
  return flow.encodeReadModelRecords(rows,'backlog',{sourceRevision:value.sourceRevision==null?null:value.sourceRevision});
}
// İşçi görevi: gzip projeksiyon → gzip kayıt yükü.
function execute(payload){
  const started=performance.now();
  const decoded=decodeExport(payload&&payload.buffer);
  const parsedMs=performance.now()-started;
  const model=buildRecordsPayload(decoded);
  const normalizeMs=performance.now()-started-parsedMs;
  const json=Buffer.from(JSON.stringify(model));
  const gzip=zlib.gzipSync(json,{level:4});
  return {buffer:new Uint8Array(gzip.buffer,gzip.byteOffset,gzip.byteLength),uncompressedBytes:json.length,
    count:model.count,timing:{parseMs:parsedMs,normalizeMs,totalMs:performance.now()-started,rows:Array.isArray(decoded.rows)?decoded.rows.length:0}};
}
module.exports={decodeExport,buildRecordsPayload,execute,VERSION:flow.READ_MODEL_VERSION};
