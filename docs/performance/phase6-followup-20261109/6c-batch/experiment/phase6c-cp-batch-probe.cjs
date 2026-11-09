'use strict';
// Isolated synthetic store/WAL probe. APP argument permits pinned Main controls.
const fs = require('node:fs'), fsp = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const app = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-6c-probe-'));
for (const [name, dir] of Object.entries({ BUYER_LOG_SERVER_DATA_ROOT:'server', BUYER_LOG_DATA_ROOT:'app', BUYER_LOG_LOCAL_DATA_ROOT:'local' })) {
  process.env[name] = path.join(root, dir); fs.mkdirSync(process.env[name], {recursive:true});
}
const db = require(path.join(app, 'server/db'));
const { createLocalDb } = require(path.join(app, 'server/lib/local-db'));
const { createDeltaStore } = require(path.join(app, 'server/lib/delta-store'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sample = { rows:[], app, runtime:process.versions, platform:process.platform, root };
(async () => {
  const local = createLocalDb(path.join(root, 'local', 'probe.db')); await local.ensure();
  const errors = [], store = createDeltaStore({localDb:local, onError:(stage,error)=>errors.push({stage,code:error.code,message:error.message}), onTrace:()=>{}});
  await store.hydrate(); db.attachDeltaStore(store);
  const original = { open:fsp.open, mkdir:fsp.mkdir, stringify:JSON.stringify };
  let counters, peak, gap, last, timer;
  fsp.open = async (...args) => {
    const handle = await original.open(...args);
    if (counters && String(args[0]).endsWith('.wal') && args[1] === 'a') {
      counters.walOpen++;
      const sync = handle.sync.bind(handle), write = handle.writeFile.bind(handle);
      handle.sync = async (...a) => { counters.fsync++; return sync(...a); };
      handle.writeFile = async (...a) => { counters.walBytes += Buffer.byteLength(a[0]); return write(...a); };
    }
    return handle;
  };
  fsp.mkdir = async (...args) => { if (counters && String(args[0]).endsWith('.write-lock')) counters.lease++; return original.mkdir(...args); };
  JSON.stringify = function (...args) { if (counters) counters.serialize++; return original.stringify.apply(this,args); };
  for (const count of [1,100,1000]) for (const phase of ['cold','warm']) {
    const items = Array.from({length:count},(_,i)=>({orderCode:810000+i,patch:{notes:{Notes:`synthetic-${phase}-${i}`},dates:i%2?{retailDate:'2026-12-01'}:{inStoreDate:'2026-12-15'},shortage:i%2===0}}));
    counters = {walOpen:0,fsync:0,walBytes:0,lease:0,serialize:0}; peak = process.memoryUsage(); gap = 0; last = performance.now();
    timer = setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;const m=process.memoryUsage();for(const k of ['rss','heapUsed'])peak[k]=Math.max(peak[k],m[k]);},1);
    const cpu = process.cpuUsage(), start = performance.now();
    const ack = db.patchOrderOverrides(items,null,null,{actor:{id:'synthetic-owner'}}), ackMs = performance.now()-start;
    await store.flush();
    const totalMs = performance.now()-start, cpuUsed = process.cpuUsage(cpu), memory = process.memoryUsage();
    clearInterval(timer); gap=Math.max(gap,performance.now()-last);for(const k of ['rss','heapUsed'])peak[k]=Math.max(peak[k],memory[k]);
    const physical = counters; counters = null;
    const state = await local.read(), replay = await createLocalDb(local.file).read();
    const cpEvents = state.journal.filter(e=>e.entityType==='cp-order');
    sample.rows.push({count,phase,fixtureHash:hash(items),ackMs,totalMs,cpuMs:(cpuUsed.user+cpuUsed.system)/1000,eventLoopGapMs:gap,peakRss:peak.rss,peakHeap:peak.heapUsed,physical,updated:ack.updated,cpEvents:cpEvents.length,businessHash:hash(Object.fromEntries(Object.entries(replay.records).filter(([k])=>k.startsWith('cp-order:')).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).filter(([f])=>!f.startsWith('_')))]))),replayEqual:hash(state)===hash(replay)});
  }
  sample.errors=errors; db.attachDeltaStore(null);
  fsp.open=original.open;fsp.mkdir=original.mkdir;JSON.stringify=original.stringify;
  console.log(JSON.stringify(sample,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
