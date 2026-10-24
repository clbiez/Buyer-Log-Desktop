(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLContextualCommands=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Metadata only until run(). Native actions retain their own server authority.
  function create({snapshot,actions,onUnavailable=()=>{},changedLabel=()=> 'Selection changed'}={}){
    function commands(){
      const captured=snapshot();if(!captured)return [];
      return actions.filter(action=>!action.when||action.when(captured)).map(action=>{
        const reason=action.guard?.(captured)||'';
        const current=()=>{const value=snapshot();if(!value||value.token!==captured.token){onUnavailable(changedLabel());return null;}const blocked=action.guard?.(value);if(blocked){onUnavailable(blocked);return null;}return value;};
        return {id:'context.'+action.id,label:action.label(captured),hint:reason||action.hint?.(captured)||captured.label||'',keywords:action.keywords||'',group:action.group?.(captured)||captured.group||'',disabled:Boolean(reason),reason,
          async run(){let value=current();if(!value)return false;if(action.prepare)await action.prepare(value);value=current();if(!value)return false;return action.run(value);}
        };
      });
    }
    return Object.freeze({commands});
  }
  return Object.freeze({create});
});
