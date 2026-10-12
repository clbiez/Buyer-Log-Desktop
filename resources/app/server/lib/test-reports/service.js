'use strict';
// The UI import and Quality Agent use the same intake/commit entrypoints.
const extract=require('./extract');
const store=require('./store');
const staging=require('./staging');
const checklist=require('../checklist-supplier-store');
const Engine=require('../../../public/test-report-engine');
const text=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const fail=(code,statusCode=400)=>Object.assign(new Error(code),{code,statusCode});
const MIME={pdf:'application/pdf',msg:'application/vnd.ms-outlook',eml:'message/rfc822'};
const sessionFingerprint=session=>require('../agent-office-store').hash(JSON.stringify({reports:session.reports,files:[...session.files].map(([id,file])=>({id,name:file.name,hash:file.hash,kind:file.kind}))}));
function createService({authorizedOrders,audit=()=>{}}) {
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
      session.setReports(out.reports);session.setAiCandidates(out.files);
      return {ok:true,sessionId:session.id,expiresAfterMs:staging.TTL_MS,files:out.files.map(f=>({name:f.name,kind:f.kind,status:f.status,format:f.format,warnings:f.warnings,talepNos:f.reports.map(r=>r.talepNo),ai:f.ai?.eligible?{uploadId:f.ai.uploadId,uploadName:f.ai.uploadName,mailText:f.ai.mailText,mailDate:f.ai.mailDate}:null})),reports:out.reports};
    }catch(err){staging.dropSession(session.id);throw err;}
  }
  async function prepareCommit(profile,body) {
    const allowed=await authorizedOrders(profile,{write:true}),session=sessionFor(profile,body.sessionId);
    const byTalep=new Map(session.reports.filter(r=>r.talepNo).map(r=>[r.talepNo,r]));
    const items=(Array.isArray(body.items)?body.items:[]).map(raw=>{
      const report=byTalep.get(text(raw?.talepNo,20));if(!report)throw fail('TEST_REPORT_UNKNOWN');
      const orderKey=text(raw.orderKey),authoritative=allowed.get(orderKey);if(!authoritative)throw fail('TEST_REPORT_ORDER_FORBIDDEN',403);
      return {report,orderKey,itemId:text(raw.itemId,160),context:{...(raw.context&&typeof raw.context==='object'?raw.context:{}),...authoritative}};
    });
    return {session,items,sessionFingerprint:sessionFingerprint(session)};
  }
  async function commit(profile,body,options={}) {
    const {session,items,sessionFingerprint:fingerprint}=await prepareCommit(profile,body);
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
      options.assertAuthority?.();return store.commit(items,body.typeMap||{},profile,attach,options);
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
  return {parse,prepareCommit,commit,acceptAi,extractAi,sessionFor};
}
module.exports={createService,sessionFingerprint};
