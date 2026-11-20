'use strict';
/* Okuma modeli için ayrı, küçük compute-pool örneği. Paylaşılan compute
   işçisi (workers/compute-worker.js) bu WS'nin sahipliğinde değildir; aynı
   havuz motoru (bellek bütçesi, kuyruk, zaman aşımı, iptal) kendi işçi
   dosyasıyla kullanılır. Varsayılan tek işçi: çözülmüş veri kümesi önbelleği
   tek kopya kalır. Boştayken işçi unref edilir; süreç kapanışını tutmaz. */
const path=require('node:path'),os=require('node:os');
const {createComputePool}=require('../compute-pool');
const MiB=1024*1024;
let pool=null;
function readModelPoolOptions(env=process.env){
  const mb=Number(env.BL_READ_MODEL_MEMORY_MB);
  return {workerFile:path.join(__dirname,'read-model-worker.js'),maxWorkers:1,maxPending:32,timeoutMs:60000,
    // Varsayılan: 1 GiB veya makine belleğinin 1/4'ü (hangisi küçükse), en az 256 MiB.
    memoryBudgetBytes:Number.isFinite(mb)&&mb>=128&&mb<=4096?Math.floor(mb)*MiB:Math.max(256*MiB,Math.min(1024*MiB,Math.floor(os.totalmem()/4)))};
}
function getReadModelPool(){return pool||(pool=createComputePool(readModelPoolOptions()));}
async function closeReadModelPool(){const current=pool;pool=null;if(current)await current.close();}
module.exports={getReadModelPool,closeReadModelPool,readModelPoolOptions};
