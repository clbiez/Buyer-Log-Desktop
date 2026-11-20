'use strict';
/* WS1 (#1073): sorgu gerçek compute-pool işçi iş parçacığında çalışır; ana
   olay döngüsü yalnız sıkıştırılmış projeksiyonu bir kez aktarır. */
const test=require('node:test'),assert=require('node:assert/strict');
const zlib=require('node:zlib');
const {createComputePool}=require('../server/lib/compute-pool');
const {readModelPoolOptions}=require('../server/lib/read-model/read-model-pool');
const {createReadModelService}=require('../server/lib/read-model/read-model-service');
const {threadId}=require('node:worker_threads');

test('read model queries execute in the pool worker and reuse the worker dataset',async()=>{
  const options=readModelPoolOptions({BL_READ_MODEL_MEMORY_MB:'256'});
  assert.equal(options.maxWorkers,1);assert.equal(options.memoryBudgetBytes,256*1024*1024);
  const pool=createComputePool(options);
  try{
    const rows=Array.from({length:500},(_,i)=>({_id:i,Season:['S6','W6'][i%2],'Order Quantity':i,'Ex-factory':`2026-0${1+i%9}-1${i%9}`,_canEdit:i%3===0}));
    const buffer=zlib.gzipSync(Buffer.from(JSON.stringify({rows})));
    const threads=[];let loads=0;
    const service=createReadModelService({
      guard:{capture:()=>({key:'["u1"]',assertResponse(){},assertBuild(){}})},
      loadProjection:async()=>({value:{buffer,uncompressedBytes:buffer.length*10},manifest:{activeGeneration:'g',modules:{cp:{checksum:'abc'}}},release(){},assertResponse(){}}),
      runCompute:async(task,payload,opts)=>{if(payload.buffer)loads++;const lease=await pool.run(task,payload,opts);threads.push(lease.metrics.threadId);return lease;},
    });
    const query={version:1,filters:[{key:'Season',op:'eq',value:'W6'}],sort:{key:'Order Quantity',dir:-1},limit:3,fields:['Order Quantity','Ex-factory'],aggregates:{sums:['Order Quantity']}};
    const first=JSON.parse((await service.query({},'cp',query)).body);
    assert.deepEqual(first.rows.map(row=>row['Order Quantity']),[499,497,495]);
    assert.equal(first.total,250);
    assert.equal(first.aggregates.sums['Order Quantity'],rows.filter(row=>row.Season==='W6').reduce((sum,row)=>sum+row['Order Quantity'],0));
    assert.match(first.rows[0]['Ex-factory'],/^2026-\d{2}-\d{2}$/);
    await service.query({},'cp',{...query,limit:4});
    assert.equal(loads,1,'second query uses the worker-resident dataset');
    assert.ok(threads.length===3&&threads.every(id=>Number.isInteger(id)&&id!==threadId),'every query ran off the main thread');
    assert.equal(pool.stats().leasedOutputBytes,0,'leases released');
  }finally{await pool.close();}
});
