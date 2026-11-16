/* Siparişler öncelik worker'ı: yalnız kanonik saf motorlar; ağ, depolama,
   kimlik bilgisi veya kullanıcı önbelleği yok. Kontrol listesi kapalıdır. */
'use strict';
let ready=false,session=null;
try{
  importScripts('chronological-values.js','business-rules.js','canonical-fields.js','order-decision-engine.js','backlog-delivery-engine.js',
    'cp-readiness-engine.js','checklist-components-engine.js','cp-checklist-engine.js','cp-rules-engine.js','orders-priority-engine.js');
  ready=true;
}catch(_){/* Ana iş parçacığı aynı motorla parça parça hesaba düşer. */}
self.onmessage=function(event){
  const {id,type,payload}=event.data||{};
  const started=performance.now();
  if(!ready){self.postMessage({id,ok:false,error:'ORDERS_PRIORITY_WORKER_IMPORT_FAILED'});return;}
  try{
    let result;
    if(type==='begin'){session=self.BLOrdersPriorityEngine.createSession(payload);result={ruleCount:session.ruleCount};}
    else if(type==='batch'){if(!session)throw new Error('ORDERS_PRIORITY_NO_SESSION');result=session.evaluateBatch(payload);}
    else if(type==='end'){session=null;result=true;}
    else throw new Error('ORDERS_PRIORITY_MESSAGE');
    self.postMessage({id,ok:true,result,executionMs:performance.now()-started});
  }catch(error){session=null;self.postMessage({id,ok:false,error:String(error&&error.message||error)});}
};
