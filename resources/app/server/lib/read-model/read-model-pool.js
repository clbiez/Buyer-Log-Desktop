'use strict';
/* Okuma modeli için ayrı, küçük compute-pool örneği. Paylaşılan compute
   işçisi (workers/compute-worker.js) bu WS'nin sahipliğinde değildir; aynı
   havuz motoru (bellek bütçesi, kuyruk, zaman aşımı, iptal) kendi işçi
   dosyasıyla kullanılır. Varsayılan tek işçi: çözülmüş veri kümesi önbelleği
   tek kopya kalır. Boştayken işçi unref edilir; süreç kapanışını tutmaz.

   Kısa sorgu şeridi (#1071 WS7): havuz önceliği yalnız kuyruğu sıralar, süren
   işi kesmez. Tek işçide CP hesaplanmış sütun / Genel Bakış gibi saniyeler süren
   bir iş çalışırken kullanıcının açtığı Siparişler sorgusu (işçide ~10 ms) o işin
   bitmesini bekliyordu. Siparişler veri kümesi sorguları bu yüzden aynı işçi
   dosyasını çalıştıran ayrı, tek işçili bir havuza gider. Siparişler veri kümesini
   başka görev kullanmaz: veri kümesi ana işçiden şeride taşınır, kopyalanmaz.
   Görev kodu, projeksiyon baytları ve nesil anahtarı aynıdır; yalnız iş parçacığı
   değişir (işçi genelindeki iş takvimi gibi durum iş başına kurulur, şeritler
   arasında paylaşılmaz). Anahtar: BL_READ_MODEL_QUERY_LANE=0 tek havuza döner. */
const path=require('node:path'),os=require('node:os');
const {createComputePool}=require('../compute-pool');
const MiB=1024*1024;
let pool=null,lanePool=null;
// Şeride giren görevler: yalnız veri kümesi üzerinde çalışan saf sorgular. CP sorgusu
// (read-model-cp-query) hesaplanmış sütun önbelleğine bağlı olduğundan ana işçide kalır.
const QUERY_LANE_TASKS=Object.freeze(new Set(['read-model-query','read-model-orders-facets']));
const QUERY_LANE_MODULES=Object.freeze(new Set(['orders']));
function queryLaneEnabled(env=process.env){return String(env.BL_READ_MODEL_QUERY_LANE??'1')!=='0';}
function usesQueryLane(task,module){return QUERY_LANE_TASKS.has(task)&&QUERY_LANE_MODULES.has(module);}
function readModelPoolOptions(env=process.env){
  const mb=Number(env.BL_READ_MODEL_MEMORY_MB);
  return {workerFile:path.join(__dirname,'read-model-worker.js'),maxWorkers:1,maxPending:32,timeoutMs:60000,
    // Varsayılan: 1 GiB veya makine belleğinin 1/4'ü (hangisi küçükse), en az 256 MiB.
    memoryBudgetBytes:Number.isFinite(mb)&&mb>=128&&mb<=4096?Math.floor(mb)*MiB:Math.max(256*MiB,Math.min(1024*MiB,Math.floor(os.totalmem()/4)))};
}
function getReadModelPool(){return pool||(pool=createComputePool(readModelPoolOptions()));}
// Şerit ilk Siparişler sorgusunda kurulur (açılış maliyeti yok); bütçe ana havuzla aynı kuraldır.
function getReadModelQueryLanePool(){return lanePool||(lanePool=createComputePool(readModelPoolOptions()));}
async function closeReadModelPool(){
  const current=[pool,lanePool].filter(Boolean);pool=null;lanePool=null;
  await Promise.all(current.map(p=>p.close()));
}
module.exports={getReadModelPool,getReadModelQueryLanePool,closeReadModelPool,readModelPoolOptions,queryLaneEnabled,usesQueryLane,QUERY_LANE_TASKS};
