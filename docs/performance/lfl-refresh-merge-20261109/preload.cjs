'use strict';
// Test-only instrumentation, enabled solely by the isolated benchmark child.
const {performance}=require('node:perf_hooks'),http=require('node:http');
let pools=[],maxGap=0,last=performance.now(),peakRss=0,peakHeap=0,startCpu=process.cpuUsage();
const sample=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last-5);last=now;const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);},5);sample.unref();
const pool=require(process.cwd()+'/server/lib/compute-pool'),create=pool.createComputePool;
pool.createComputePool=options=>{const p=create({...options,memoryBudgetBytes:Number(process.env.LFL_BENCH_BUDGET)*1024*1024,maxWorkers:1});pools.push(p);return p;};
const emit=http.Server.prototype.emit;
http.Server.prototype.emit=function(event,req,res,...rest){
 if(event==='request'&&req.url.startsWith('/__lfl_bench/')){
  if(req.url.endsWith('/reset')){maxGap=0;last=performance.now();peakRss=process.memoryUsage().rss;peakHeap=process.memoryUsage().heapUsed;startCpu=process.cpuUsage();}
  if(req.url.endsWith('/gc'))global.gc?.();
  const result={memory:process.memoryUsage(),peakRss,peakHeap,maxGapMs:maxGap,cpu:process.cpuUsage(startCpu),pools:pools.map(p=>p.stats())};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return true;
 }
 return emit.call(this,event,req,res,...rest);
};
require(process.cwd()+'/server/server');
