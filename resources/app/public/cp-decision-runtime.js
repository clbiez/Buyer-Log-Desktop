(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLCpDecisionRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Session-only, weak row references. Authority/data/rule/day revisions are
  // provided by the canonical caller; nothing is persisted across users.
  function create(options){
    let cache=new WeakMap(),key=null;
    const now=options.now||(()=>performance.now());
    const yieldTask=options.yieldTask||(()=>new Promise(resolve=>setTimeout(resolve,0)));
    const current=()=>String(options.contextKey());
    function begin(){const next=current();if(next!==key){cache=new WeakMap();key=next;}return next;}
    function row(value,context){
      let analysis=cache.get(value);
      if(!analysis){analysis=options.analyzeRow(value,context);cache.set(value,analysis);}
      return analysis;
    }
    function compute(rows,context){begin();return options.summarize(rows.map(value=>row(value,context)),context);}
    async function computeAsync(rows,context){
      const expected=begin(),analyses=[];
      let start=now();
      for(let i=0;i<rows.length;i++){
        if(current()!==expected)return null;
        analyses.push(row(rows[i],context));
        if(now()-start>=8){await yieldTask();start=now();}
      }
      if(current()!==expected)return null;
      return options.summarize(analyses,context);
    }
    return {compute,computeAsync};
  }
  return {create};
});
