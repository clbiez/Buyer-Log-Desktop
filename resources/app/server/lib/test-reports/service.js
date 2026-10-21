'use strict';
// The UI import and Quality Agent use the same intake/commit entrypoints.
const extract=require('./extract');
const store=require('./store');
const staging=require('./staging');
const checklist=require('../checklist-supplier-store');
const Engine=require('../../../public/test-report-engine');
const Assessment=require('../../../public/test-report-assessment');
const crypto=require('crypto');
const {redactSecrets,SECRET_KEY_RE}=require('../../../shared/secret-redaction');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function safeBusinessData(value) {
  if(typeof value==='string')return redactSecrets(value);
  if(Array.isArray(value))return value.map(safeBusinessData);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!SECRET_KEY_RE.test(key)).map(([key,val])=>[key,safeBusinessData(val)]));
  return value;
}
const text=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const fail=(code,statusCode=400)=>Object.assign(new Error(code),{code,statusCode});
const MIME={pdf:'application/pdf',msg:'application/vnd.ms-outlook',eml:'message/rfc822'};
const sessionFingerprint=session=>require('../agent-office-store').hash(JSON.stringify({reports:session.reports,assessment:session.assessment&&{snapshotId:session.assessment.packet.snapshotId,validated:session.assessment.validated},files:[...session.files].map(([id,file])=>({id,name:file.name,hash:file.hash,kind:file.kind}))}));
function createService({authorizedOrders,audit=()=>{},sourceRevision=()=>null,reviewContext=null}) {
  function assertReviewCurrent(profile,review) {
    if(review.sourceRevision!==sourceRevision(profile)||review.storeRevision!==store.read().revision)throw fail('TEST_REPORT_REVIEW_STALE',409);
  }
  function sessionFor(profile,id) {const session=staging.getSession(id,profile.id);if(!session)throw fail('TEST_REPORT_SESSION_EXPIRED',410);return session;}
  async function parse(profile,input,options={}) {
    if(!Array.isArray(input)||!input.length)throw fail('VALIDATION_ERROR');
    if(input.length>30)throw fail('TEST_REPORT_TOO_MANY_FILES',413);
    let bytes=0;
    const files=input.map(raw=>{
      const buffer=Buffer.from(String(raw?.base64||'').replace(/^data:[^;,]+;base64,/i,'').replace(/\s+/g,''),'base64');
      if(!buffer.length||buffer.length>40*1024*1024)throw fail('TEST_REPORT_FILE_SIZE',413);
      bytes+=buffer.length;return {name:text(raw?.name)||'file',buffer};
    });
    if(bytes>300*1024*1024)throw fail('TEST_REPORT_FILE_SIZE',413);
    const session=staging.createSession(profile.id,options);
    try {
      const out=await extract.processFiles(files,{stage:session.stage});
      session.setReports(out.reports);session.setSources(out.files.flatMap(file=>file.sources||[]));session.setAiCandidates(out.files);
      return {ok:true,sessionId:session.id,expiresAfterMs:staging.TTL_MS,files:out.files.map(f=>({name:f.name,kind:f.kind,status:f.status,format:f.format,warnings:f.warnings,talepNos:f.reports.map(r=>r.talepNo),ai:f.ai?.eligible?{uploadId:f.ai.uploadId,uploadName:f.ai.uploadName,mailText:f.ai.mailText,mailDate:f.ai.mailDate}:null})),reports:out.reports};
    }catch(err){staging.dropSession(session.id);throw err;}
  }
  async function prepareCommit(profile,body) {
    const allowed=await authorizedOrders(profile,{write:true}),session=sessionFor(profile,body.sessionId);
    if(session.assessment) {
      if(!session.assessment.validated||body.snapshotId!==session.assessment.packet.snapshotId)throw fail('TEST_REPORT_REVIEW_REQUIRED',409);
      const current=await authorizedOrders(profile,{write:false});
      if(digest([...current])!==session.assessment.authorityHash)throw fail('TEST_REPORT_REVIEW_STALE',409);
      assertReviewCurrent(profile,session.assessment);
    }
    const byTalep=new Map(session.reports.filter(r=>r.talepNo).map(r=>[r.talepNo,r]));
    const seen=new Set();
    const items=(Array.isArray(body.items)?body.items:[]).map(raw=>{
      const report=byTalep.get(text(raw?.talepNo,80));if(!report)throw fail('TEST_REPORT_UNKNOWN');
      const orderKey=text(raw.orderKey),authoritative=allowed.get(orderKey);if(!authoritative)throw fail('TEST_REPORT_ORDER_FORBIDDEN',403);
      const scopes=Engine.orderScopes(report),scope=scopes.find(s=>s.orderCode===Engine.normalizeOrderCode(authoritative.orderCode));
      if(scopes.length&&!scope)throw fail('TEST_REPORT_ORDER_MISMATCH',409);
      if(scope?.requiresReview&&raw.confirmMatch!==true)throw fail('TEST_REPORT_SCOPE_CONFIRMATION_REQUIRED',409);
      const key=[report.talepNo,orderKey].join('::');
      if(session.assessment) {
        const proposal=session.assessment.validated.assessments.find(item=>item.reportId===report.talepNo&&item.orderKey===orderKey&&(!item.step||item.step===raw.itemId));
        if(!proposal||proposal.blocked&&raw.confirmEvidence!==true)throw fail('TEST_REPORT_REVIEW_REQUIRED',409);
      }
      if(seen.has(key))throw fail('TEST_REPORT_DUPLICATE_TARGET',409);seen.add(key);
      return {report,orderKey,itemId:text(raw.itemId,160),review:session.assessment?{snapshotId:session.assessment.packet.snapshotId,scopeConfirmed:raw.confirmEvidence===true}:null,context:{...(raw.context&&typeof raw.context==='object'?raw.context:{}),...authoritative}};
    });
    const saved=store.read();
    if(items.some(item=>Engine.reportLinks(saved.links[item.report.talepNo]).some(link=>!allowed.has(link.orderKey))))throw fail('TEST_REPORT_SHARED_SCOPE_FORBIDDEN',403);
    return {session,items,authorizedOrderKeys:new Set(allowed.keys()),sessionFingerprint:sessionFingerprint(session)};
  }
  async function commit(profile,body,options={}) {
    const {session,items,authorizedOrderKeys,sessionFingerprint:fingerprint}=await prepareCommit(profile,body);
    if(options.expectedSessionFingerprint && options.expectedSessionFingerprint!==fingerprint)throw fail('TEST_REPORT_PREVIEW_CHANGED',409);
    const attach=(file,report,item)=>{
      const staged=file.stagingId?session.files.get(file.stagingId):null;if(!staged)return null;
      const c=item.context;
      return checklist.addAttachmentBuffer(staged.buffer,{filename:staged.name,mimeType:MIME[staged.kind]||'application/octet-stream',context:{orderCode:text(c.orderCode,60),plmId:text(c.plmId,60),modelName:text(c.modelName,120),colourCode:text(c.colourCode,60),checklistName:text(c.checklistName,120)||'Test',checklistStatus:text(c.checklistStatus,60)||report.talepNo}},profile);
    };
    options.assertAuthority?.();
    const apply=()=>staging.withSessionLease(body.sessionId,profile.id,()=>{
      const latest=sessionFor(profile,body.sessionId);
      if(sessionFingerprint(latest)!==fingerprint)throw fail('TEST_REPORT_PREVIEW_CHANGED',409);
      if(latest.assessment)assertReviewCurrent(profile,latest.assessment);
      options.assertAuthority?.();return store.commit(items,body.typeMap||{},profile,attach,{...options,authorizedOrderKeys});
    });
    // Native preparation can await order scope. Hold the Office guard only for
    // the synchronous native lease/write, never while loading that scope.
    const result=options.withCommitGuard?await options.withCommitGuard(apply):apply();
    for(const item of result.results)audit(profile,'TEST_REPORT_IMPORT',item.talepNo,{orderKey:item.orderKey,itemId:item.itemId,attachments:item.attachments.length,newDecisions:item.newDecisions,sources:(item.report.kaynaklar||[]).slice(0,6)});
    staging.dropSession(body.sessionId);return result;
  }
  function acceptAi(profile,body) {
    return staging.withSessionLease(body.sessionId,profile.id,()=>{
    const session=sessionFor(profile,body.sessionId),candidate=session.aiCandidates.get(text(body.fileName));if(!candidate)throw fail('TEST_REPORT_AI_NOT_CANDIDATE');
    const report=Engine.reportFromAiExtract(body.data,{fileName:body.fileName});report.dosyalar=candidate.files.map(f=>({...f}));
    if(report.talepNo)session.reports=Engine.groupReports(session.reports.concat([report]));
    staging.persistSession(session);audit(profile,'TEST_REPORT_AI_READ',report.talepNo||'-',{file:text(body.fileName,120),confidence:report.aiConfidence});
    return {ok:true,report:report.talepNo?session.reports.find(r=>r.talepNo===report.talepNo):report};
    });
  }
  async function prepareAssessment(profile,body) {
    const allowed=await authorizedOrders(profile,{write:false}),session=sessionFor(profile,body.sessionId);
    let cp=body.cp;
    if(!cp||!Array.isArray(cp.rows)||!cp.rows.length||cp.rowCount!==cp.rows.length)throw fail('TEST_REPORT_CP_INCOMPLETE',409);
    const keys=new Set(cp.rows.map(row=>row.key));
    if(keys.size!==cp.rows.length||cp.rows.some(row=>!allowed.has(row.key)||String(allowed.get(row.key).orderCode)!==row.orderCode)||[...allowed.keys()].some(key=>!keys.has(key)))throw fail('TEST_REPORT_CP_INCOMPLETE',409);
    const canonical=reviewContext?await reviewContext(profile):null;
    if(canonical) {
      const clientRows=new Map(cp.rows.map(row=>[row.key,row]));
      const states=row=>Object.fromEntries((row.checklist||[]).map(item=>[item.itemId,{state:item.answer?.state,source:item.answer?.source}]).sort(([a],[b])=>a.localeCompare(b)));
      if(canonical.cp.rows.length!==cp.rows.length||canonical.cp.rows.some(row=>{
        const client=clientRows.get(row.key);
        return !client||Object.entries(row.fields).some(([key,value])=>JSON.stringify(client.fields?.[key])!==JSON.stringify(value))||digest(states(client))!==digest(states(row));
      }))throw fail('TEST_REPORT_CP_INCOMPLETE',409);
      cp={...canonical.cp,clientDisplayTable:cp.displayTable};
    }
    const packet=safeBusinessData({protocol:Assessment.PROTOCOL,caseId:session.id,sources:session.sources||[],cp,
      checklistSteps:canonical?.checklistSteps||body.checklistSteps||[],checklistStatuses:canonical?.checklistStatuses||body.checklistStatuses||[],
      canonicalRules:canonical?.rules||null,
      previousBuyerLogExtraction:session.reports,previousApprovedReports:store.publicPayload(keys)});
    if(!packet.sources.length)throw fail('TEST_REPORT_EVIDENCE_MISSING',422);
    packet.snapshotId=digest(packet);
    const serialized=JSON.stringify(packet);
    if(Buffer.byteLength(serialized)>19*1024*1024)throw fail('TEST_REPORT_CONTEXT_TOO_LARGE',413);
    session.assessment={packet,authorityHash:digest([...allowed]),sourceRevision:sourceRevision(profile),storeRevision:packet.previousApprovedReports.revision,validated:null};
    staging.persistSession(session);return {ok:true,packet};
  }
  async function acceptAssessment(profile,body) {
    const allowed=await authorizedOrders(profile,{write:false});
    return staging.withSessionLease(body.sessionId,profile.id,()=>{
    const session=sessionFor(profile,body.sessionId),review=session.assessment;
    if(!review||review.packet.snapshotId!==body.snapshotId)throw fail('TEST_REPORT_REVIEW_STALE',409);
    if(digest([...allowed])!==review.authorityHash)throw fail('TEST_REPORT_REVIEW_STALE',409);
    assertReviewCurrent(profile,review);
    const validated=Assessment.validate(body.data,review.packet);
    if(!validated.ok)throw Object.assign(fail('TEST_REPORT_AI_CONTRACT_INVALID',422),{validationErrors:validated.errors});
    const reports=validated.assessments.map(item=>{
      const data={...item.extraction,talepNo:/^\d{4,8}$/.test(item.reportId)?item.reportId:'',siparisKodu:item.orderCode,
        genelSonuc:item.extraction.genelSonuc||item.labResult,confidence:'MEDIUM',explanation:item.summary};
      const report=Engine.reportFromAiExtract(data);
      // External laboratories may use a real alphanumeric report reference.
      // Keep that exact reference; never manufacture a numeric request number.
      report.talepNo=item.reportId;
      report.uyarilar=report.uyarilar.filter(w=>w.code!=='missingTalepNo');
      const ids=new Set(item.evidence.map(ref=>ref.sourceId));
      report.dosyalar=(session.sources||[]).filter(source=>ids.has(source.id)).map(source=>{
        const staged=session.files.get(source.fileId);return staged?{ad:source.name,tur:source.kind,boyut:staged.buffer.length,hash:source.hash,stagingId:source.fileId}:null;
      }).filter(Boolean);
      const evidence=item.evidence.map(ref=>{const source=review.packet.sources.find(source=>source.id===ref.sourceId);return {...ref,sourceName:source.name,sourceHash:source.hash};});
      report.aiAssessment={snapshotId:review.packet.snapshotId,orderKey:item.orderKey,step:item.step,status:item.status,scope:item.scope,evidence,component:item.component,labResult:item.labResult,commercialDecision:item.commercialDecision,summary:item.summary,risks:item.risks};
      return report;
    });
    session.reports=Engine.groupReports(reports);
    review.validated=validated;staging.persistSession(session);
    audit(profile,'TEST_REPORT_AI_REVIEW',session.id,{snapshotId:review.packet.snapshotId,sources:review.packet.sources.length,orders:review.packet.cp.rows.length,proposals:validated.assessments.length,unresolved:validated.unresolvedSourceIds.length});
    return {ok:true,reports:session.reports,assessment:validated,snapshotId:review.packet.snapshotId};
    });
  }
  async function extractAi(profile,sessionId,{engine,lang='tr',assertAuthority=()=>{}}) {
    const session=sessionFor(profile,sessionId),candidates=[...session.aiCandidates];
    if(candidates.length>5)throw fail('TEST_REPORT_AI_BATCH_LIMIT',413);
    const results=[];
    for(const [fileName,candidate] of candidates) {
      assertAuthority();
      const input={source:'test-report-extract',task:lang==='en'?'Extract the attached test report or result mail according to the schema.':'Ekli test raporunu veya sonuç mailini şemaya göre oku.',lang,context:{fileName,mailText:candidate.mailText||'',mailDate:candidate.mailDate||''}};
      const staged=candidate.uploadId?session.files.get(candidate.uploadId):null;
      const result=staged?await engine.askWithFiles(profile.id,{...input,files:[{buffer:staged.buffer,fileName:candidate.uploadName||fileName,contentType:staged.kind==='pdf'?'application/pdf':staged.kind==='image'?(staged.buffer[0]===0x89?'image/png':staged.buffer[0]===0xFF?'image/jpeg':'image/webp'):'text/plain'}]}):await engine.ask(profile.id,input);
      assertAuthority();if(!result.structured?.ok||!result.data)throw fail('TEST_REPORT_AI_CONTRACT_INVALID',422);
      results.push(acceptAi(profile,{sessionId,fileName,data:result.data}).report);
    }
    return {sessionId,reports:sessionFor(profile,sessionId).reports,aiCalls:results.length};
  }
  return {parse,prepareCommit,commit,acceptAi,extractAi,prepareAssessment,acceptAssessment,sessionFor};
}
module.exports={createService,sessionFingerprint};
