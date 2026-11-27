// Electron (ELECTRON_RUN_AS_NODE) altında: işçi heap sınırı + read-model-worker retainedMetrics gerçek GC.
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
if(isMainThread){const w=new Worker(__filename,{workerData:{mod:process.argv[2]},resourceLimits:{maxOldGenerationSizeMb:1024}});w.on('message',m=>{console.log(JSON.stringify({versions:{node:process.versions.node,electron:process.versions.electron||null},execArgv:process.execArgv,...m}));w.terminate();});}
else{const {retainedMetrics}=require(workerData.mod);const v8=require('v8'),vm=require('vm');let g=[];for(let i=0;i<300000;i++)g.push({a:'x'.repeat(50)+i});g=null;
 const m=retainedMetrics(1,0,{enabled:true,state:{lastAt:-Infinity}});
 parentPort.postMessage({workerLimitMB:Math.round(v8.getHeapStatistics().heap_size_limit/1e6),gc:m.gcRecheck?{beforeMB:Math.round(m.gcRecheck.beforeBytes/1e6),afterMB:Math.round(m.retainedBytes/1e6),ms:Math.round(m.gcRecheck.gcMs)}:m,exposeGcLeft:vm.runInNewContext('typeof gc')});}
