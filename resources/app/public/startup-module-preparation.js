(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLStartupPreparation=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MODULES=['koleksiyon','cp','orders','backlog'];
  const STATUSES=new Set(['pending','loading','ready','error']);
  const INTENT_TTL_MS=30000;
  function create({readHistory=()=>({}),writeHistory=()=>{},now=Date.now,onChange=()=>{}}={}){
    const states=Object.fromEntries(MODULES.map(module=>[module,{status:'pending',error:''}]));
    const history={},intents=new Map();let sequence=0;
    try{
      const saved=readHistory();
      if(saved&&typeof saved==='object'&&!Array.isArray(saved))for(const module of MODULES){
        const at=Number(saved[module]);
        if(Number.isFinite(at)&&at>=0)history[module]=Math.min(at,now());
      }
    }catch(_){}
    const snapshot=()=>Object.fromEntries(MODULES.map(module=>[module,{...states[module]}]));
    function setStatus(module,status,error=''){
      if(!MODULES.includes(module)||!STATUSES.has(status))return false;
      const reason=status==='error'?String(error||'LOAD_FAILED').slice(0,120):'';
      if(states[module].status===status&&states[module].error===reason)return false;
      states[module]={status,error:reason};onChange(snapshot());return true;
    }
    function noteIntent(module){
      if(!MODULES.includes(module))return false;
      intents.set(module,{at:now(),sequence:++sequence});return true;
    }
    function noteOpened(module){
      if(!noteIntent(module))return false;
      history[module]=now();
      try{writeHistory({...history});}catch(_){}
      return true;
    }
    function takeNext(queue){
      if(!Array.isArray(queue)||!queue.length)return undefined;
      const at=now();
      const intentRank=module=>{const intent=intents.get(module);return intent&&at>=intent.at&&at-intent.at<=INTENT_TTL_MS?intent.sequence:0;};
      let best=0;
      for(let i=1;i<queue.length;i++){
        const candidate=queue[i].module,current=queue[best].module;
        const difference=intentRank(candidate)-intentRank(current)||((history[candidate]||0)-(history[current]||0));
        if(difference>0)best=i;
      }
      return queue.splice(best,1)[0];
    }
    return Object.freeze({snapshot,setStatus,noteIntent,noteOpened,takeNext});
  }
  return Object.freeze({create});
});
