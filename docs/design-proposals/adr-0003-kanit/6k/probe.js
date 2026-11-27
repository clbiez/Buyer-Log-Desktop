const {Worker,isMainThread,parentPort}=require('worker_threads');
if(isMainThread){const w=new Worker(__filename,{resourceLimits:{maxOldGenerationSizeMb:1024}});w.on('message',m=>{console.log(JSON.stringify(m));if(m.done)w.terminate();});}
else{const v8=require('v8');const out=[];let keep=[];
 for(let round=0;round<4;round++){let garbage=[];for(let i=0;i<300000;i++)garbage.push({a:'x'.repeat(50)+i,b:[i,i+1,i+2]});keep=garbage.slice(0,1000);garbage=null;
  const m=process.memoryUsage();out.push(Math.round(m.heapUsed/1e6));}
 const h=v8.getHeapStatistics();parentPort.postMessage({heapUsedMB:out,limitMB:Math.round(h.heap_size_limit/1e6),execArgv:process.execArgv,nodeOptions:process.env.NODE_OPTIONS||null,done:true});}
