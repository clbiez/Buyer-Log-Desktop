'use strict';
const {hash,error,text}=require('./agent-office-store');
const {validateUpload}=require('./lcwai/lcwai-files');
function attachEvidence(service,deps){
 async function resolve(profile,raw,read=false){
  const state=await service.state(profile),ids=[...new Set(raw.profileIds||[])];if(!ids.length||ids.length>4)throw error('OFFICE_TASK_INVALID');
  const participants=ids.map(id=>{const p=state.profiles.find(a=>a.id===id);if(!p)throw error('OFFICE_NOT_FOUND',404);return p;});const scope=require('./agent-office-service').scopeOf(raw.scope);
  if(!scope.orderCode&&!scope.plmId)throw error('OFFICE_EVIDENCE_SCOPE_REQUIRED');
  const areas=[...new Set(participants.flatMap(p=>p.areas))].filter(a=>service.allowedAreas(profile).includes(a));
  const choices=await deps.getEvidenceAttachments(profile,scope,areas),selected=[...new Set(Array.isArray(raw.attachmentIds)?raw.attachmentIds:[])];if(selected.length>5)throw error('OFFICE_EVIDENCE_LIMIT',413);
  const files=[];
  for(const id of selected){const item=choices.find(c=>c.id===id);if(!item)throw error('OFFICE_EVIDENCE_FORBIDDEN',403);if(item.size>19*1024*1024)throw error('OFFICE_EVIDENCE_LIMIT',413);const file=validateUpload(await deps.readEvidenceAttachment(item));if(file.size>19*1024*1024)throw error('OFFICE_EVIDENCE_LIMIT',413);files.push({id:item.id,file,hash:require('crypto').createHash('sha256').update(file.buffer).digest('hex'),sources:item.sources});}
  const task=text(raw.task||'',4000),metadata=files.map(({id,file,hash,sources})=>({id,name:file.fileName,size:file.size,hash,sources}));
  const plan={profileIds:ids,scope,task,selected:metadata,choices:choices.map(({id,name,size,sources})=>({id,name,size,sources})),uploadCalls:files.length,analysisCalls:files.length?1:0,bytes:files.reduce((sum,f)=>sum+f.file.size,0),sourceChanges:false};
  const fingerprint=hash(JSON.stringify({plan,agents:participants.map(p=>[p.id,p.revision,p.areas]),authorization:deps.userAccess.profileById?.(profile.id)||profile}));
  return read?{plan:{...plan,fingerprint},files}:{...plan,fingerprint};
 }
 async function run(profile,raw,onProgress){const {plan,files}=await resolve(profile,raw,true);if(!plan.task||!files.length||raw.confirmed!==true||raw.fingerprint!==plan.fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
  return service.run(profile,{profileIds:plan.profileIds,scope:plan.scope,task:plan.task,lang:raw.lang,signal:raw.signal},onProgress,{files:files.map(f=>f.file),evidenceAttachments:plan.selected.map(f=>({id:'attachment:'+f.id,name:f.name,size:f.size,contentHash:f.hash,sources:f.sources,origin:'source-document',confidence:'UNVERIFIED'}))});}
 return{evidencePreview:(p,r)=>resolve(p,r),runEvidence:run};
}
module.exports={attachEvidence};
