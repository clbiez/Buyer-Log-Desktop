/* Canonical CP engines only; no network, storage, credentials or user cache. */
'use strict';
importScripts('business-rules.js','order-decision-engine.js','backlog-delivery-engine.js','cp-readiness-engine.js');
let context, analyses=[], rowCache=new Map();
self.onmessage=function(event){
  const {id,type,payload}=event.data;
  const started=performance.now();
  try{
    let result;
    if(type==='begin'){context=payload;analyses=[];rowCache=new Map();result=true;}
    else if(type==='batch'){
      result=payload.map(entry=>{
        if(rowCache.has(entry.reference))return rowCache.get(entry.reference);
        const analysis=entry.analysis || self.BLCpReadinessEngine.analyzeOrder(entry.row,context);
        rowCache.set(entry.reference,analysis);return analysis;
      });
      analyses.push(...result);
    }else if(type==='summary'){
      const model=self.BLCpReadinessEngine.summarizeAnalyses(analyses,context);
      const indices=new Map(analyses.map((analysis,index)=>[analysis,index]));
      const loadingItems=Object.fromEntries(Object.entries(model.loadingPlan).map(([key,bucket])=>[key,bucket.items.map(analysis=>indices.get(analysis))]));
      result={model,loadingItems,groups:Object.fromEntries(Object.entries(model.priorityGroups).map(([key,list])=>[key,list.map(analysis=>indices.get(analysis))]))};
      analyses=[];context=null;rowCache.clear();
    }else throw new Error('CP_WORKER_MESSAGE');
    self.postMessage({id,ok:true,result,executionMs:performance.now()-started});
  }catch(_){analyses=[];context=null;rowCache.clear();self.postMessage({id,ok:false,error:'CP_WORKER_FAILED'});}
};
