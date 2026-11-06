'use strict';
// Görünüm kapsamı her işte kalır. Kod düzenleme/sahiplik dizinleri yalnız
// onları gerçekten tüketen hesaplara gider; canlı HTTP kapıları değişmez.
function accessForTask(context,task,parts={}){
  if(!context)return context;
  let authority=true;
  if(task.startsWith('backlog-')||['source-info','projection-plan','cp-image-registry'].includes(task))authority=false;
  else if(task==='projection-envelope')authority=parts.legacyModule==='cp'&&context.systemRole!=='moderator';
  else if(task==='cp-shared-edit-codes')authority=context.systemRole!=='moderator';
  else if(task==='projections'){
    const modules=parts.modules||['cp','orders','overview','order-summary','collection-catalog'];
    const editing=!context.manageAll&&(modules.includes('cp')||modules.includes('order-summary'));
    const shared=context.systemRole!=='moderator'&&(parts.legacyModule==='cp'||(parts.sharedHints&&modules.includes('cp')));
    authority=editing||shared;
  }
  return authority?context:{...context,authority:{},ownershipProfiles:[]};
}
module.exports={accessForTask};
