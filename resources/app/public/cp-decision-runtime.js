(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLCpDecisionRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Weak row references and context revisions are session-only. Worker instances
  // exist for one job and are destroyed before another authority can reuse them.
  function create(options){
    let cache=new WeakMap(),key=null,active=null,disposed=false;
    const jobs=new WeakMap(),waiting=[];
    const now=options.now||(()=>performance.now());
    const yieldTask=options.yieldTask||(()=>new Promise(resolve=>setTimeout(resolve,0)));
    const yieldWorkerTask=options.yieldTask||(()=>typeof globalThis.scheduler?.yield==='function'
      ? globalThis.scheduler.yield() : yieldTask());
    const current=()=>String(options.contextKey());
    const stats={completed:0,failed:0,cancelled:0,workerJobs:0,fallbackJobs:0,lastQueueMs:0,lastExecutionMs:0,lastDurationMs:0,maxRoundTripMs:0};
    function begin(){const next=current();if(next!==key){cache=new WeakMap();key=next;active?.cancel();}return next;}
    function row(value,context){
      let analysis=cache.get(value);
      if(!analysis){analysis=options.analyzeRow(value,context);cache.set(value,analysis);}
      return analysis;
    }
    function compute(rows,context){begin();return options.summarize(rows.map(value=>row(value,context)),context);}
    async function cooperative(rows,context,expected){
      const analyses=[];let start=now();
      for(let i=0;i<rows.length;i++){
        if(disposed||current()!==expected)return null;
        analyses.push(row(rows[i],context));
        if(now()-start>=8){await yieldTask();start=now();}
      }
      if(disposed||current()!==expected)return null;
      return options.summarize(analyses,context);
    }
    async function inWorker(rows,context,expected){
      const worker=options.workerFactory(),analyses=[],references=new WeakMap();
      let nextReference=0;
      let pending=null,id=0,executionMs=0,fatalError=null;
      const cancel=()=>{fatalError=new Error('CP_WORKER_CANCELLED');if(pending){pending.reject(fatalError);pending=null;}};
      active={cancel};
      worker.onmessage=event=>{
        const message=event.data;
        if(!pending||message?.id!==pending.id)return;
        const next=pending;pending=null;
        executionMs+=Number(message.executionMs)||0;
        stats.maxRoundTripMs=Math.max(stats.maxRoundTripMs,now()-next.started);
        message.ok?next.resolve(message.result):next.reject(new Error('CP_WORKER_FAILED'));
      };
      worker.onerror=event=>{event?.preventDefault?.();fatalError=new Error('CP_WORKER_FAILED');if(pending){pending.reject(fatalError);pending=null;}};
      worker.onmessageerror=worker.onerror;
      const send=(type,payload)=>new Promise((resolve,reject)=>{
        if(fatalError){reject(fatalError);return;}
        pending={id:++id,resolve,reject,started:now()};
        try{worker.postMessage({id,type,payload});}catch(error){pending=null;reject(error);}
      });
      const started=now();
      const watchdog=setInterval(()=>{if(disposed||current()!==expected||now()-started>120000)cancel();},16);
      // Loading importScripts is network work; it must not monopolize the queue.
      const startupTimer=setTimeout(cancel,Math.max(1,Number(options.workerStartTimeoutMs)||10000));
      try{
        await send('begin',context);
        clearTimeout(startupTimer);
        for(let offset=0;offset<rows.length;offset+=128){
          if(disposed||current()!==expected)return null;
          const batch=rows.slice(offset,offset+128);
          const cached=batch.map(value=>cache.get(value));
          const result=await send('batch',batch.map((value,index)=>{
            if(!references.has(value))references.set(value,++nextReference);
            const reference=references.get(value);
            return cached[index]?{reference,analysis:cached[index]}:{reference,row:value};
          }));
          if(disposed||current()!==expected)return null;
          for(let i=0;i<result.length;i++){
            const analysis=cache.get(batch[i])||result[i];
            if(!cache.has(batch[i])){Object.defineProperty(analysis,'sourceRow',{value:batch[i],enumerable:false});cache.set(batch[i],analysis);}
            analyses.push(analysis);
          }
          // Bound structured-clone work on the UI thread to one batch per task.
          await yieldWorkerTask();
        }
        const result=await send('summary',null);
        if(disposed||current()!==expected)return null;
        for(const [bucket,indices] of Object.entries(result.loadingItems)){
          Object.defineProperty(result.model.loadingPlan[bucket],'items',{value:indices.map(index=>analyses[index]),enumerable:false});
        }
        Object.defineProperty(result.model,'orders',{value:analyses,enumerable:false});
        Object.defineProperty(result.model,'priorityGroups',{value:Object.fromEntries(Object.entries(result.groups).map(([group,indices])=>[group,indices.map(index=>analyses[index])])),enumerable:false});
        stats.lastExecutionMs=executionMs;stats.workerJobs++;
        return result.model;
      }finally{clearTimeout(startupTimer);clearInterval(watchdog);worker.terminate();worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;active=null;}
    }
    async function run(job){
      const started=now();stats.lastQueueMs=started-job.queuedAt;
      try{
        if(disposed||current()!==job.expected){stats.cancelled++;return null;}
        let result;
        if(typeof options.workerFactory==='function'&&job.rows.length>=128&&typeof job.context?.dateOrdinal!=='function'){
          try{result=await inWorker(job.rows,job.context,job.expected);}
          catch(_){
            if(disposed||current()!==job.expected){stats.cancelled++;return null;}
            stats.failed++;stats.fallbackJobs++;result=await cooperative(job.rows,job.context,job.expected);
          }
        }else{stats.fallbackJobs++;result=await cooperative(job.rows,job.context,job.expected);}
        result?stats.completed++:stats.cancelled++;
        return result;
      }finally{stats.lastDurationMs=now()-started;}
    }
    let draining=false;
    async function drain(){
      if(draining)return;draining=true;
      try{while(waiting.length){const job=waiting.shift();try{job.resolve(await run(job));}catch(error){job.reject(error);}}}
      finally{draining=false;}
    }
    function computeAsync(rows,context){
      const expected=begin(),previous=jobs.get(rows);
      if(previous?.expected===expected)return previous.promise;
      if(disposed)return Promise.resolve(null);
      // Callers can retry null results. Yield on admission pressure so retries
      // cannot starve worker messages in a self-sustaining microtask loop.
      if(waiting.length>=8)return yieldTask().then(()=>null);
      const job={rows,context,expected,queuedAt:now()};
      job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
      jobs.set(rows,job);waiting.push(job);drain();
      const cleanup=()=>{if(jobs.get(rows)===job)jobs.delete(rows);};job.promise.then(cleanup,cleanup);
      return job.promise;
    }
    function dispose(){disposed=true;active?.cancel();cache=new WeakMap();while(waiting.length)waiting.shift().resolve(null);}
    return {compute,computeAsync,dispose,getStats:()=>({...stats,active:!!active,queued:waiting.length})};
  }
  return {create};
});
