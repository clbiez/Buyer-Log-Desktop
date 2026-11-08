'use strict';
const fs=require('node:fs'),path=require('node:path'),{Worker}=require('node:worker_threads');
const out=process.argv[2],ref=process.argv[3]==='ref';
for(const [key,dir]of [['BUYER_LOG_LOCAL_DATA_ROOT','local'],['BUYER_LOG_DATA_ROOT','app'],['BUYER_LOG_SERVER_DATA_ROOT','server'],['BUYER_LOG_AUTH_DATA_ROOT','auth'],['BUYER_LOG_TEMP_ROOT','temp']])process.env[key]=path.join(out,dir);
const workers=[];class Observed extends Worker{constructor(...args){super(...args);workers.push(this);}}
const pool=require('/workspace/buyerlog-post-main-acceptance/resources/app/server/lib/compute-pool').createComputePool({WorkerClass:Observed});
(async()=>{
 const lease=await pool.run('health',{}, {ownerKey:'synthetic-health',generation:'g1',estimatedBytes:64*1024*1024,inputBytes:0});lease.release();
 const worker=workers[0];fs.writeFileSync(path.join(out,'before.json'),JSON.stringify({ref,api:typeof worker.getHeapStatistics,threadId:worker.threadId,pool:pool.stats()}));
 if(ref)worker.ref();
 try{const statistics=await worker.getHeapStatistics();fs.writeFileSync(path.join(out,'after.json'),JSON.stringify({ref,totalHeapSize:statistics.total_heap_size,threadId:worker.threadId}));}
 finally{if(ref)worker.unref();}
 await pool.close();fs.writeFileSync(path.join(out,'closed.json'),JSON.stringify(pool.stats()));
})().catch(error=>{fs.writeFileSync(path.join(out,'error.json'),JSON.stringify({message:error.message,stack:error.stack}));process.exitCode=1;});
