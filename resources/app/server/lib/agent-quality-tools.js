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
  const base={module:'cp',areas:['cp'],agentAreas:['cp'],capabilities:['CP.VIEW']};
  const reportAuthority=(ctx,records)=>{ctx.assertAuthority();for(const previous of Object.values(records)){const permission=previous.report||previous.link?'CP.EDIT':'CP.CREATE';if(!deps.userAccess?.hasCapability(ctx.profile,permission))throw error('OFFICE_TOOL_FORBIDDEN',403);}};
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
    const matches=session.reports.flatMap(report=>{
      return Engine.matchReportScopes(report,rows,{fields:{orderCode:'orderCode',model:'modelName',colourCode:'colourCode',colour:'colour'},keyOf:row=>row.key}).map(({scope,match})=>{
      if(scope?.requiresReview && match.level==='exact'){match.level='partial';match.reason='additionalOrder';}
      return {talepNo:report.talepNo,report,scopeOrderCode:scope?.orderCode||null,requiresReview:!!scope?.requiresReview,scopeEvidence:scope?.evidence||null,outcome:Engine.reportOutcome(report),level:match.level,reason:match.reason,candidates:match.candidates.map(c=>({orderKey:c.key,identity:allowed.get(c.key),model:c.model,colour:c.colour}))};
      });
    });
    if(deps.sourceRevision&&sourceRevision!==deps.sourceRevision(profile))throw error('OFFICE_PREVIEW_CHANGED',409);
    return {sessionId,sessionFingerprint:require('./test-reports/service').sessionFingerprint(session),...(sourceRevision?{sourceRevision}:{}),reportRevision:reports.read().revision,matches,itemCatalog:[...Checklist.ITEMS,...checklist.publicPayload().definitions].map(item=>({id:item.id,tr:item.tr||item.name,en:item.en||item.name})),suggestedItems:matches.filter(m=>m.level==='exact').map(m=>({talepNo:m.talepNo,orderKey:m.candidates[0].orderKey,itemId})),unresolved:matches.filter(m=>m.level!=='exact').map(m=>m.talepNo)};
  }
  registry.registerCapability({...base,id:'quality.inspect',label:{tr:'Test belgelerini eşleştir',en:'Match test documents'},operation:'READ',risk:'read',outputSchema:Output.readOutput,dryRunOutputSchema:Output.readOutput,inputSchema:{...object({sessionId:string(32),itemId:string(160)}),required:['sessionId']},read:async(args,ctx)=>Output.inspection(await inspect(ctx.profile,args.sessionId,args.itemId))});
  registry.registerCapability({...base,anyCapabilities:['CP.CREATE','CP.EDIT'],permissionPolicy:'CP.CREATE for new native reports; CP.EDIT for existing report/link; rechecked inside native commit and inverse leases',id:'quality.commit',label:{tr:'Onaylı test raporlarını aktar',en:'Import approved test reports'},operation:'IMPORT',risk:'write',outputSchema:Output.commitResult,dryRunOutputSchema:Output.dry(Output.commitPreview),publicPreview:Output.commitPreviewSummary,inputSchema:{...object({sessionId:string(32),items:picks}),required:['sessionId','items']},read:async(args,ctx)=>{
    if(!args.items.length)throw error('OFFICE_QUALITY_MATCH_REQUIRED',409);
    const preview=await inspect(ctx.profile,args.sessionId),before=reports.read(),seen=new Set();
    for(const item of args.items) {
      const target=[item.talepNo,item.orderKey].join('::');
      if(seen.has(target)||!itemKnown(item.itemId))throw error('OFFICE_TASK_INVALID',422);seen.add(target);
      if(Engine.reportLinks(before.links[item.talepNo]).some(link=>!preview.matches.some(m=>m.talepNo===item.talepNo&&m.candidates.some(c=>c.orderKey===link.orderKey))))throw error('OFFICE_TOOL_FORBIDDEN',403);
      const match=preview.matches.find(m=>m.talepNo===item.talepNo&&m.candidates.some(c=>c.orderKey===item.orderKey));
      if(!match?.candidates.some(c=>c.orderKey===item.orderKey))throw error('OFFICE_QUALITY_MATCH_REQUIRED',409);
      if(match.level!=='exact'&&item.confirmMatch!==true)throw error('OFFICE_QUALITY_MATCH_REQUIRED',409);
    }
    await service.prepareCommit(ctx.profile,args);
    const records=Object.fromEntries(args.items.map(item=>[item.talepNo,{report:before.reports[item.talepNo]||null,link:before.links[item.talepNo]||null}]));reportAuthority(ctx,records);return {...preview,selected:args.items,records};
  },apply:async(args,ctx,preview)=>{
    const rollback=await backup(ctx,'quality-report-before',{records:preview.records});
    const result=await service.commit(ctx.profile,args,{expectedRevision:preview.reportRevision,expectedSessionFingerprint:preview.sessionFingerprint,assertAuthority:()=>{sourceAuthority(ctx,preview);reportAuthority(ctx,preview.records);},withCommitGuard:work=>guard(ctx,work)});
    if(result.results.length!==args.items.length||!args.items.every(i=>result.results.some(r=>r.talepNo===i.talepNo&&r.orderKey===i.orderKey&&r.itemId===i.itemId)))throw error('OFFICE_QUALITY_VERIFY_FAILED',409);
    return Output.commitSummary(result,{...rollback,expectedRevision:result.revision});
  },restore:async(token,ctx)=>{
    token=inverse(ctx,token,'quality-report-before');
    const inverseSource={sourceRevision:deps.sourceRevision?.(ctx.profile)};
    const allowed=await authorizedOrders(ctx.profile,{write:true}),current=reports.read();
    if(Object.entries(token.records).some(([id,previous])=>!Engine.reportLinks(current.links[id]).length||Engine.reportLinks(current.links[id]).concat(Engine.reportLinks(previous.link)).some(link=>!allowed.has(link.orderKey))))throw error('OFFICE_TOOL_FORBIDDEN',403);
    sourceAuthority(ctx,inverseSource);reportAuthority(ctx,token.records);return guard(ctx,()=>reports.restore(token,ctx.profile,{assertAuthority:()=>{sourceAuthority(ctx,inverseSource);reportAuthority(ctx,token.records);},withDependencies:applyInverse=>require('./shared-file-transaction').withFileLeaseSync(checklist.FILE,()=>{
      sourceAuthority(ctx,inverseSource);
      const source=reports.read(),answers=checklist._read();
      for(const id of Object.keys(token.records)) {
        for(const link of Engine.reportLinks(source.links[id])) {
        const key=checklist.answerKey(link.orderKey,link.itemId),entry=answers.answers[key]||answers.tombstones[key],fileIds=new Set((link.files||source.reports[id]?.dosyalar||[]).map(file=>file.attachmentId).filter(Boolean));
        if(entry?.reportNumber?.split(/,\s*/).includes(id)||entry?.attachments?.some(file=>fileIds.has(file.id)))throw error('OFFICE_TASK_DEPENDENCY',409);
        }
      }
      return applyInverse();
    })}),true);
  }});
  registry.registerCapability({...base,capabilities:['CP.VIEW','CP.EDIT'],id:'quality.checklist.apply',label:{tr:'Test sonucunu checkliste işle',en:'Apply test outcomes to checklist'},operation:'UPDATE',risk:'write',outputSchema:Output.checklistResult,dryRunOutputSchema:Output.dry(Output.checklistPreview),publicPreview:Output.checklistSummary,inputSchema:{...object({items:picks}),required:['items']},read:async(args,ctx)=>{
    if(!args.items.length)throw error('OFFICE_TASK_INVALID',422);
    const sourceRevision=deps.sourceRevision?.(ctx.profile);
    const allowed=await authorizedOrders(ctx.profile,{write:true}),source=reports.read(),target=checklist._read(),groups=new Map();
    for(const item of args.items) {
      if(!allowed.has(item.orderKey)||!itemKnown(item.itemId)||!Engine.reportLinks(source.links[item.talepNo]).some(link=>link.orderKey===item.orderKey&&link.itemId===item.itemId))throw error('OFFICE_TOOL_FORBIDDEN',403);
      groups.set(checklist.answerKey(item.orderKey,item.itemId),item);
    }
    const entries=[...groups].map(([key,item])=>{
      const linked=Object.entries(source.links).flatMap(([id,stored])=>{const link=Engine.reportLinks(stored).find(l=>l.orderKey===item.orderKey&&l.itemId===item.itemId);return link?[{...source.reports[id],dosyalar:link.files||source.reports[id].dosyalar}]:[];});
      const outcome=Engine.deriveStepStatus(linked),previous=target.answers[key]||target.tombstones[key];
      return {orderKey:item.orderKey,itemId:item.itemId,state:outcome.state,loadDate:previous?.loadDate||null,supplier:previous?.supplier||'',itemLabel:previous?.itemLabel||'',reportNumber:linked.map(r=>r.talepNo).join(', '),attachments:[...new Map([...(previous?.attachments||[]),...linked.flatMap(r=>(r.dosyalar||[]).filter(f=>f.attachmentId).map(f=>({id:f.attachmentId,filename:f.ad,originalName:f.ad,mimeType:'application/octet-stream',size:f.boyut,addedAt:r.guncelleme})))].map(f=>[f.id,f])).values()]};
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
      return checklist.applyEntries(preview.entries,ctx.profile,{source:'test_report',expectedRevision:preview.checklistRevision,reserveWrites:2,assertAuthority:()=>sourceAuthority(ctx,preview),receipt:(result,own)=>{
        const expected=new Map(preview.entries.map(e=>[checklist.answerKey(e.orderKey,e.itemId),e.state]));
        if(result.changedKeys.length!==result.updated+result.cleared||result.changedKeys.some(key=>!expected.has(key)||(own.entries[key]?.answer||own.entries[key]?.tombstone)?.state!==expected.get(key)))throw error('OFFICE_QUALITY_VERIFY_FAILED',409);
        return Output.checklistReceipt(result,{...rollback,expectedRevision:result.revision});
      }});
    }));
    return result;
  },restore:async(token,ctx)=>{
    token=inverse(ctx,token,'quality-checklist-before');
    const inverseSource={sourceRevision:deps.sourceRevision?.(ctx.profile)};
    const allowed=await authorizedOrders(ctx.profile,{write:true});if(Object.values(token.entries).some(previous=>{const entry=previous.answer||previous.tombstone;return entry&&!allowed.has(entry.orderKey);}))throw error('OFFICE_TOOL_FORBIDDEN',403);
    // The receipt also contains keys for previously absent answers.
    if(Object.keys(token.entries).some(key=>!allowed.has(key.slice(0,key.lastIndexOf('::')))))throw error('OFFICE_TOOL_FORBIDDEN',403);
    sourceAuthority(ctx,inverseSource);return guard(ctx,()=>checklist.restoreEntries(token,ctx.profile,{reserveWrites:1,assertAuthority:()=>sourceAuthority(ctx,inverseSource),receipt:(result,own)=>{if(!require('node:util').isDeepStrictEqual(own.entries,token.entries))throw error('OFFICE_QUALITY_VERIFY_FAILED',409);return result;}}),true);
  }});
  if(mail)registry.registerCapability({...base,areas:['cp','automations'],capabilities:['CP.VIEW','CP.EXPORT'],id:'quality.fail.drafts',label:{tr:'Fail için üretici mail taslakları',en:'Manufacturer mail drafts for Fail'},operation:'EXPORT',risk:'write',outputSchema:Output.draftResult,dryRunOutputSchema:Output.dry(Output.mailPreview),publicPreview:Output.mailSummary,inputSchema:{...object({talepNos:array(string(20),100),subject:string(200),body:string(4000),language:{enum:['tr','en']}}),required:['talepNos','subject','body','language']},read:async(args,ctx)=>{
    const sourceRevision=deps.sourceRevision?.(ctx.profile);
    const allowed=await authorizedOrders(ctx.profile),source=reports.read(),keys=new Set();
    for(const id of args.talepNos){const links=Engine.reportLinks(source.links[id]),report=source.reports[id];if(!links.length||links.some(link=>!allowed.has(link.orderKey)))throw error('OFFICE_TOOL_FORBIDDEN',403);if(Engine.reportOutcome(report).code==='fail')links.forEach(link=>keys.add(link.orderKey));}
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
