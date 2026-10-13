'use strict';
const {object,string,array}=require('./agent-capability-contract');
const {error}=require('./agent-office-store');
const reports=require('./test-reports/store');
const checklist=require('./checklist-supplier-store');
const Engine=require('../../public/test-report-engine');
const Checklist=require('../../public/cp-checklist-engine');
const CP=require('../../public/cp-readiness-engine');
const canonical=require('./canonical-fields');
const Output=require('./agent-quality-output-contract'),artifacts=require('./agent-artifact-store'),zlib=require('node:zlib');
const itemSchema={...object({talepNo:string(20),orderKey:string(300),itemId:string(160),confirmMatch:{type:'boolean'}}),required:['talepNo','orderKey','itemId']};
const picks=array(itemSchema,100);
function registerQualityTools(registry,deps) {
  const {service,authorizedOrders,dataset,mail}=deps;
  const base={module:'cp',areas:['cp'],agentAreas:['cp']};
  const guard=(ctx,work,restore=false)=>{ctx.assertAuthority();const run=restore?deps.restoreGuard:deps.guard;if(typeof run!=='function')throw error('OFFICE_APPROVAL_REQUIRED',403);return run(ctx,work);};
  const sourceAuthority=(ctx,preview)=>{ctx.assertAuthority();if(deps.sourceRevision&&preview.sourceRevision!==deps.sourceRevision(ctx.profile))throw error('OFFICE_PREVIEW_CHANGED',409);};
  async function backup(ctx,kind,native){
    await guard(ctx);const frame={ownerId:ctx.ownerId,officeJobId:ctx.input.officeJobId,officeStepId:ctx.input.officeStepId,native};
    const bytes=Buffer.from(JSON.stringify(frame));if(bytes.length>256*1024*1024)throw error('OFFICE_ARTIFACT_LIMIT',413);
    const meta=await (deps.artifacts||artifacts).put(ctx.profile,zlib.gzipSync(bytes),'quality-before.json.gz',kind);
    if(!/^[a-f0-9]{32}$/.test(meta?.id))throw error('OFFICE_ARTIFACT_CHANGED',409);
    ctx.assertAuthority();return {artifactId:meta.id,kind};
  }
  function inverse(ctx,token,kind){
    if(!token.artifactId)return token; // Existing private persisted native receipts.
    if(token.kind!==kind)throw error('OFFICE_ROLLBACK_INVALID',409);
    const {buffer}=artifacts.read(ctx.profile,token.artifactId,kind);let frame;
    try{frame=JSON.parse(zlib.gunzipSync(buffer,{maxOutputLength:256*1024*1024}));}catch(_){throw error('OFFICE_ROLLBACK_INVALID',409);}
    if(frame.ownerId!==ctx.ownerId||frame.officeJobId!==ctx.input?.officeJobId||frame.officeStepId!==ctx.input?.officeStepId)throw error('OFFICE_ROLLBACK_INVALID',409);
    return {...frame.native,expectedRevision:token.expectedRevision};
  }
  const itemKnown=id=>!!Checklist.ITEM_BY_ID[id]||checklist.publicPayload().definitions.some(item=>item.id===id);
  async function inspect(profile,sessionId,itemId='tests') {
    const sourceRevision=deps.sourceRevision?.(profile);
    const session=service.sessionFor(profile,sessionId),allowed=await authorizedOrders(profile,{write:true});
    const rows=[...allowed].map(([key,context])=>({...context,key}));
    const matches=session.reports.map(report=>{
      const match=Engine.matchReport(report,rows,{fields:{orderCode:'orderCode',model:'modelName',colourCode:'colourCode',colour:'colour'},keyOf:row=>row.key});
      return {talepNo:report.talepNo,report,outcome:Engine.reportOutcome(report),level:match.level,reason:match.reason,candidates:match.candidates.map(c=>({orderKey:c.key,identity:allowed.get(c.key),model:c.model,colour:c.colour}))};
    });
    if(deps.sourceRevision&&sourceRevision!==deps.sourceRevision(profile))throw error('OFFICE_PREVIEW_CHANGED',409);
    return {sessionId,sessionFingerprint:require('./test-reports/service').sessionFingerprint(session),...(sourceRevision?{sourceRevision}:{}),reportRevision:reports.read().revision,matches,itemCatalog:[...Checklist.ITEMS,...checklist.publicPayload().definitions].map(item=>({id:item.id,tr:item.tr||item.name,en:item.en||item.name})),suggestedItems:matches.filter(m=>m.level==='exact').map(m=>({talepNo:m.talepNo,orderKey:m.candidates[0].orderKey,itemId})),unresolved:matches.filter(m=>m.level!=='exact').map(m=>m.talepNo)};
  }
  registry.registerCapability({...base,id:'quality.inspect',label:{tr:'Test belgelerini eşleştir',en:'Match test documents'},operation:'READ',risk:'read',outputSchema:Output.readOutput,dryRunOutputSchema:Output.readOutput,inputSchema:{...object({sessionId:string(32),itemId:string(160)}),required:['sessionId']},read:async(args,ctx)=>Output.inspection(await inspect(ctx.profile,args.sessionId,args.itemId))});
  registry.registerCapability({...base,id:'quality.commit',label:{tr:'Onaylı test raporlarını aktar',en:'Import approved test reports'},operation:'IMPORT',risk:'write',outputSchema:Output.commitResult,dryRunOutputSchema:Output.dry(Output.commitPreview),publicPreview:Output.commitPreviewSummary,inputSchema:{...object({sessionId:string(32),items:picks}),required:['sessionId','items']},read:async(args,ctx)=>{
    if(!args.items.length)throw error('OFFICE_QUALITY_MATCH_REQUIRED',409);
    const preview=await inspect(ctx.profile,args.sessionId),before=reports.read(),seen=new Set();
    for(const item of args.items) {
      if(seen.has(item.talepNo)||!itemKnown(item.itemId))throw error('OFFICE_TASK_INVALID',422);seen.add(item.talepNo);
      if(before.links[item.talepNo]&&!preview.matches.find(m=>m.talepNo===item.talepNo)?.candidates.some(c=>c.orderKey===before.links[item.talepNo].orderKey))throw error('OFFICE_TOOL_FORBIDDEN',403);
      const match=preview.matches.find(m=>m.talepNo===item.talepNo);
      if(!match?.candidates.some(c=>c.orderKey===item.orderKey))throw error('OFFICE_QUALITY_MATCH_REQUIRED',409);
      if(match.level!=='exact'&&item.confirmMatch!==true)throw error('OFFICE_QUALITY_MATCH_REQUIRED',409);
    }
    await service.prepareCommit(ctx.profile,args);
    return {...preview,selected:args.items,records:Object.fromEntries(args.items.map(item=>[item.talepNo,{report:before.reports[item.talepNo]||null,link:before.links[item.talepNo]||null}]))};
  },apply:async(args,ctx,preview)=>{
    const rollback=await backup(ctx,'quality-report-before',{records:preview.records});
    const result=await service.commit(ctx.profile,args,{expectedRevision:preview.reportRevision,expectedSessionFingerprint:preview.sessionFingerprint,assertAuthority:()=>sourceAuthority(ctx,preview),withCommitGuard:work=>guard(ctx,work)}),saved=reports.read();
    if(result.results.length!==args.items.length||!args.items.every(i=>saved.links[i.talepNo]?.orderKey===i.orderKey&&saved.links[i.talepNo]?.itemId===i.itemId))throw error('OFFICE_QUALITY_VERIFY_FAILED',409);
    return Output.commitSummary(result,{...rollback,expectedRevision:result.revision});
  },restore:async(token,ctx)=>{
    token=inverse(ctx,token,'quality-report-before');
    const inverseSource={sourceRevision:deps.sourceRevision?.(ctx.profile)};
    const allowed=await authorizedOrders(ctx.profile,{write:true}),current=reports.read();
    if(Object.entries(token.records).some(([id,previous])=>!allowed.has(current.links[id]?.orderKey)||(previous.link&&!allowed.has(previous.link.orderKey))))throw error('OFFICE_TOOL_FORBIDDEN',403);
    sourceAuthority(ctx,inverseSource);return guard(ctx,()=>reports.restore(token,ctx.profile,{assertAuthority:()=>sourceAuthority(ctx,inverseSource),withDependencies:applyInverse=>require('./shared-file-transaction').withFileLeaseSync(checklist.FILE,()=>{
      sourceAuthority(ctx,inverseSource);
      const source=reports.read(),answers=checklist._read();
      for(const id of Object.keys(token.records)) {
        const link=source.links[id],key=checklist.answerKey(link.orderKey,link.itemId),entry=answers.answers[key]||answers.tombstones[key],fileIds=new Set((source.reports[id]?.dosyalar||[]).map(file=>file.attachmentId).filter(Boolean));
        if(entry?.reportNumber?.split(/,\s*/).includes(id)||entry?.attachments?.some(file=>fileIds.has(file.id)))throw error('OFFICE_TASK_DEPENDENCY',409);
      }
      return applyInverse();
    })}),true);
  }});
  registry.registerCapability({...base,id:'quality.checklist.apply',label:{tr:'Test sonucunu checkliste işle',en:'Apply test outcomes to checklist'},operation:'UPDATE',risk:'write',outputSchema:Output.checklistResult,dryRunOutputSchema:Output.dry(Output.checklistPreview),publicPreview:Output.checklistSummary,inputSchema:{...object({items:picks}),required:['items']},read:async(args,ctx)=>{
    if(!args.items.length)throw error('OFFICE_TASK_INVALID',422);
    const sourceRevision=deps.sourceRevision?.(ctx.profile);
    const allowed=await authorizedOrders(ctx.profile,{write:true}),source=reports.read(),target=checklist._read(),groups=new Map();
    for(const item of args.items) {
      if(!allowed.has(item.orderKey)||!itemKnown(item.itemId)||source.links[item.talepNo]?.orderKey!==item.orderKey||source.links[item.talepNo]?.itemId!==item.itemId)throw error('OFFICE_TOOL_FORBIDDEN',403);
      groups.set(checklist.answerKey(item.orderKey,item.itemId),item);
    }
    const entries=[...groups].map(([key,item])=>{
      const linked=Object.entries(source.links).filter(([,link])=>link.orderKey===item.orderKey&&link.itemId===item.itemId).map(([id])=>source.reports[id]);
      const outcome=Engine.deriveStepStatus(linked),previous=target.answers[key]||target.tombstones[key];
      return {orderKey:item.orderKey,itemId:item.itemId,state:outcome.state,reportNumber:linked.map(r=>r.talepNo).join(', '),attachments:[...new Map([...(previous?.attachments||[]),...linked.flatMap(r=>(r.dosyalar||[]).filter(f=>f.attachmentId).map(f=>({id:f.attachmentId,filename:f.ad,originalName:f.ad,mimeType:'application/octet-stream',size:f.boyut,addedAt:r.guncelleme})))].map(f=>[f.id,f])).values()]};
    });
    if(deps.sourceRevision&&sourceRevision!==deps.sourceRevision(ctx.profile))throw error('OFFICE_PREVIEW_CHANGED',409);
    return {...(sourceRevision?{sourceRevision}:{}),reportRevision:source.revision,checklistRevision:target.revision,entries,before:Object.fromEntries([...groups.keys()].map(key=>[key,{answer:target.answers[key]||null,tombstone:target.tombstones[key]||null}]))};
  },apply:async(args,ctx,preview)=>{
    const rollback=await backup(ctx,'quality-checklist-before',{entries:preview.before});
    const allowed=await authorizedOrders(ctx.profile,{write:true});
    if(args.items.some(item=>!allowed.has(item.orderKey)))throw error('OFFICE_TOOL_FORBIDDEN',403);
    ctx.assertAuthority();if(deps.sourceRevision&&preview.sourceRevision!==deps.sourceRevision(ctx.profile))throw error('OFFICE_PREVIEW_CHANGED',409);
    const result=await guard(ctx,()=>require('./shared-file-transaction').withFileLeaseSync(reports.FILE,()=>{
      sourceAuthority(ctx,preview);
      if(reports.read().revision!==preview.reportRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
      return checklist.applyEntries(preview.entries,ctx.profile,{source:'test_report',expectedRevision:preview.checklistRevision,assertAuthority:()=>sourceAuthority(ctx,preview)});
    })),saved=checklist._read();
    if(result.skipped||result.conflicts||preview.entries.some(e=>(saved.answers[checklist.answerKey(e.orderKey,e.itemId)]||saved.tombstones[checklist.answerKey(e.orderKey,e.itemId)])?.state!==e.state))throw error('OFFICE_QUALITY_VERIFY_FAILED',409);
    return Output.checklistReceipt(result,{...rollback,expectedRevision:result.revision});
  },restore:async(token,ctx)=>{
    token=inverse(ctx,token,'quality-checklist-before');
    const inverseSource={sourceRevision:deps.sourceRevision?.(ctx.profile)};
    const allowed=await authorizedOrders(ctx.profile,{write:true});if(Object.values(token.entries).some(previous=>{const entry=previous.answer||previous.tombstone;return entry&&!allowed.has(entry.orderKey);}))throw error('OFFICE_TOOL_FORBIDDEN',403);
    // The receipt also contains keys for previously absent answers.
    if(Object.keys(token.entries).some(key=>!allowed.has(key.slice(0,key.lastIndexOf('::')))))throw error('OFFICE_TOOL_FORBIDDEN',403);
    sourceAuthority(ctx,inverseSource);return guard(ctx,()=>checklist.restoreEntries(token,ctx.profile,{assertAuthority:()=>sourceAuthority(ctx,inverseSource)}),true);
  }});
  if(mail)registry.registerCapability({...base,areas:['cp','automations'],id:'quality.fail.drafts',label:{tr:'Fail için üretici mail taslakları',en:'Manufacturer mail drafts for Fail'},operation:'EXPORT',risk:'write',outputSchema:Output.draftResult,dryRunOutputSchema:Output.dry(Output.mailPreview),publicPreview:Output.mailSummary,inputSchema:{...object({talepNos:array(string(20),100),subject:string(200),body:string(4000),language:{enum:['tr','en']}}),required:['talepNos','subject','body','language']},read:async(args,ctx)=>{
    const sourceRevision=deps.sourceRevision?.(ctx.profile);
    const allowed=await authorizedOrders(ctx.profile),source=reports.read(),keys=new Set();
    for(const id of args.talepNos){const link=source.links[id],report=source.reports[id];if(!link||!allowed.has(link.orderKey))throw error('OFFICE_TOOL_FORBIDDEN',403);if(Engine.reportOutcome(report).code==='fail')keys.add(link.orderKey);}
    if(!keys.size)throw error('OFFICE_QUALITY_NO_FAIL',409);
    const rows=(await dataset(ctx.profile)).filter(row=>keys.has(CP.analyzeOrder(row).orderKey));
    if(rows.length>5000)throw error('OFFICE_DRAFT_CAPACITY',413);
    const messages=mail(ctx.profile,{...args,recipientMode:'manufacturer'},rows,true);
    if((messages.messages?.length||0)>5000)throw error('OFFICE_DRAFT_CAPACITY',413);
    if(deps.sourceRevision&&sourceRevision!==deps.sourceRevision(ctx.profile))throw error('OFFICE_PREVIEW_CHANGED',409);
    return {reportRevision:source.revision,...(sourceRevision?{sourceRevision}:{}),talepNos:args.talepNos,messages,rows:rows.map(row=>canonical.project(row,'cp',canonical.moduleFields('cp')))};
  },apply:async(args,ctx,preview)=>{
    const rows=(await dataset(ctx.profile)).filter(row=>preview.rows.some(selected=>selected.orderCode==canonical.value(row,'cp','orderCode')&&selected.modelName==canonical.value(row,'cp','modelName')&&selected.colourCode==canonical.value(row,'cp','colourCode')));
    ctx.assertAuthority();
    if(JSON.stringify(rows.map(row=>canonical.project(row,'cp',canonical.moduleFields('cp'))))!==JSON.stringify(preview.rows)||deps.sourceRevision&&preview.sourceRevision!==deps.sourceRevision(ctx.profile))throw error('OFFICE_PREVIEW_CHANGED',409);
    const result=await guard(ctx,()=>require('./shared-file-transaction').withFileLeaseSync(reports.FILE,()=>{
      sourceAuthority(ctx,preview);
      if(reports.read().revision!==preview.reportRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
      return mail(ctx.profile,{...args,recipientMode:'manufacturer'},rows,false,preview.messages);
    }));
    if(!result.emails.length||!deps.verifyMail(result,ctx.profile))throw error('OFFICE_QUALITY_VERIFY_FAILED',409);
    return Output.draftSummary(result);
  }});
  return {inspect};
}
module.exports={registerQualityTools};
