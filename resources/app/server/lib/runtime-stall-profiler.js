'use strict';
const path=require('node:path');
function createStallProfiler({log=()=>{},samplingUs=5000,windowMs=60000,dir=null,keep=3}={}){
  let worker,running=false,windowStart=0,busy=false,closed=false,closing=false,failed=false,serial=0;
  const pending=new Map();
  function unavailable(){
    if(failed)return;failed=true;running=false;
    for(const entry of pending.values()){clearTimeout(entry.timer);entry.resolve(null);}pending.clear();
    log('[RUNTIME] stall-profiler unavailable');
    void worker?.terminate();
  }
  try{
    const {Worker}=require('node:worker_threads');
    worker=new Worker(path.join(__dirname,'runtime-stall-profiler-worker.js'),{execArgv:[],workerData:{buyerLogStallProfiler:true,dir,keep,samplingUs},resourceLimits:{maxOldGenerationSizeMb:128}});
    worker.on('message',message=>{
      const entry=pending.get(message?.id);if(!entry)return;
      pending.delete(message.id);clearTimeout(entry.timer);
      if(message.ok!==true){entry.resolve(null);unavailable();return;}
      // Only scalar state and bounded summary lines cross the worker boundary.
      if(typeof message.running!=='boolean'||!Array.isArray(message.logs)||message.logs.length>24
        ||message.logs.some(line=>typeof line!=='string'||line.length>16384)
        ||Object.keys(message).some(key=>!['id','ok','running','logs'].includes(key))){entry.resolve(null);unavailable();return;}
      for(const line of message.logs)log(line);entry.resolve(message);
      if(!pending.size&&!closing)worker.unref();
    });
    worker.on('error',unavailable);worker.once('exit',()=>{if(!closing&&!closed)unavailable();});worker.unref();
  }catch(_){unavailable();return null;}
  function request(operation,payload){
    if(failed||closed||(closing&&operation!=='close'))return Promise.resolve(null);
    const id=++serial;worker.ref();
    return new Promise(resolve=>{
      const timer=setTimeout(unavailable,15000);timer.unref();pending.set(id,{resolve,timer});
      try{worker.postMessage({id,operation,payload});}catch(_){unavailable();}
    });
  }
  async function start(){const result=await request('start');running=result?.running===true;windowStart=Date.now();return running;}
  async function rotate(){
    if(!running||busy||Date.now()-windowStart<windowMs)return;
    busy=true;try{const result=await request('rotate');running=result?.running===true;windowStart=Date.now();}finally{busy=false;}
  }
  async function capture(blockedMs){
    if(!running||busy)return;
    busy=true;try{const result=await request('capture',{blockedMs});running=result?.running===true;windowStart=Date.now();}finally{busy=false;}
  }
  async function stop(){
    if(closed||closing)return;closing=true;running=false;
    try{await request('close');}finally{closed=true;running=false;for(const entry of pending.values()){clearTimeout(entry.timer);entry.resolve(null);}pending.clear();worker.ref();await worker.terminate();}
  }
  return {start,rotate,capture,stop};
}
module.exports={createStallProfiler};
