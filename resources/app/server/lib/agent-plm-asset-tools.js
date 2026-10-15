'use strict';
/* PLM assets already stored in Buyer Log, for Office (no CoreNectum call):
   - collection.plm.bom.read: the normalized BOM/artwork summary saved by PLM Sync
     (same store as /api/plm-sync/bom/*), summary fields only;
   - collection.plm.techsheet.status: whether a technical sheet is on file per PLM
     ID (same ownership resolver as /api/plm-sync/model-files/status), computed on
     a copy so a read never migrates the file index.
   - collection.plm.techsheet.download: EXECUTE, approval-gated. Runs the same
     technical sheet download as Collection › PLM Sync › Technical sheet (one
     PLM job, the owner's own PLM session, same store write) and awaits the job
     through the native-operation poller. A downloaded sheet replaces the
     earlier PLM sheet of that model (user uploads are kept), so the step
     declares no rollback.
   - collection.plm.images.import / collection.plm.samples.sync: EXECUTE,
     approval-gated. The same route handlers as Collection › PLM Sync (model
     images, sample requests) run in-process with the owner's profile through
     agent-native-route-runs and are awaited by the poller. Manual images are
     never overwritten; neither step declares a rollback (a PLM refresh). */
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store');
const req=p=>({...object(p),required:Object.keys(p)}),ok={enum:[true]},count={type:'integer',minimum:0},sha={...string(64),pattern:'^[a-f0-9]{64}$'};
const plmIds={...array({...string(80),minLength:1},200),minItems:1,uniqueItems:true};
const text=(value,max)=>String(value==null?'':value).slice(0,max);
const bom=object({plmId:string(80),styleId:string(80),isSetStyle:{type:'boolean'},fetchedAt:{type:['string','null'],maxLength:80},sourceModifiedDate:{type:['string','null'],maxLength:80},
  fabric:string(2000),summary:string(4000),fabricSummary:string(4000),artworkSummary:string(4000),hasPrint:{type:'boolean'},totalPrintCount:{type:'integer',minimum:0},
  placementSummary:string(2000),techniqueSummary:string(2000),componentCount:{type:'integer',minimum:0},setComponentCount:{type:'integer',minimum:0},needsAi:{type:'boolean'},fullCoverage:string(40)});
const bomOutput={...object({verified:{enum:[true]},data:{...object({entries:array(bom,200),missing:array(string(80),200),revision:{type:'integer',minimum:0},updatedAt:{type:['string','null'],maxLength:80}}),required:['entries','missing']}}),required:['verified','data']};
const status=object({plmId:string(80),status:{enum:['ready','conflict','stale','missing']},hasTechnicalSheet:{type:'boolean'},languages:array(string(8),10),conflictCode:string(60)});
const statusOutput={...object({verified:{enum:[true]},data:{...object({items:array(status,200)}),required:['items']}}),required:['verified','data']};
function registerPlmAssetTools(registry,deps){
  registry.registerCapability({id:'collection.plm.bom.read',module:'koleksiyon',operation:'READ',risk:'read',areas:[],anyAreas:['koleksiyon','cp','orders'],agentAnyAreas:['collection','cp','orders'],
    label:{tr:'Kayıtlı PLM BOM özetini oku',en:'Read stored PLM BOM summary'},
    dataScope:'BOM/artwork summaries already saved by PLM Sync; no PLM request',
    inputSchema:{...object({plmIds}),required:['plmIds']},outputSchema:bomOutput,dryRunOutputSchema:bomOutput,
    read:async(args,ctx)=>{ctx.assertAuthority?.();
      const store=deps.bomStore.load(),entries=[],missing=[];
      for(const raw of args.plmIds){const id=deps.normalizePlmId(raw);const entry=id&&store.models&&store.models[id];if(!entry){missing.push(text(raw,80));continue;}
        entries.push({plmId:entry.plmId,styleId:entry.styleId,isSetStyle:Boolean(entry.isSetStyle),fetchedAt:entry.fetchedAt||null,sourceModifiedDate:entry.sourceModifiedDate||null,
          fabric:text(entry.fabric,2000),summary:text(entry.summary,4000),fabricSummary:text(entry.fabricSummary,4000),artworkSummary:text(entry.artworkSummary,4000),hasPrint:Boolean(entry.hasPrint),
          totalPrintCount:Number(entry.totalPrintCount)||0,placementSummary:text(entry.placementSummary,2000),techniqueSummary:text(entry.techniqueSummary,2000),
          componentCount:(entry.components||[]).length,setComponentCount:(entry.setComponents||[]).length,needsAi:Boolean(entry.needsAi),fullCoverage:text(entry.fullCoverage,40)});}
      return {entries,missing,revision:Number(store._revision)||0,updatedAt:store._updatedAt||null};}});
  registry.registerCapability({id:'collection.plm.techsheet.status',module:'koleksiyon',operation:'READ',risk:'read',areas:['koleksiyon'],agentAreas:['collection'],
    label:{tr:'PLM teknik föy durumunu oku',en:'Read PLM technical sheet status'},
    dataScope:'technical sheet metadata in the model files index; no PLM request and no index migration',
    inputSchema:{...object({plmIds}),required:['plmIds']},outputSchema:statusOutput,dryRunOutputSchema:statusOutput,
    read:async(args,ctx)=>{ctx.assertAuthority?.();
      const index=JSON.parse(JSON.stringify(deps.readModelFilesIndex()||[]));
      const {statusByPlmId}=deps.ownership.resolveTechnicalSheetOwnership(index,args.plmIds,{fileExists:deps.fileExists});
      return {items:Object.entries(statusByPlmId).map(([plmId,s])=>({plmId,status:s.status,hasTechnicalSheet:Boolean(s.hasTechnicalSheet),languages:(s.languages||[]).map(String),conflictCode:s.conflict?String(s.conflict.code||''):''}))};}});
  // EXECUTE: technical sheet download through the owner's PLM session.
  const jobId={...string(100),minLength:1,pattern:'^[A-Za-z0-9_.:-]{1,100}$'},language={enum:['tr','en']};
  const operationRef=req({id:jobId,kind:{enum:['plm-technical-sheet']},language});
  const jobView=req({jobId,status:string(20),phase:string(120),total:count,processed:count,succeeded:count,failed:count});
  const sheetItem=req({plmId:string(80),styleLinked:{type:'boolean'},currentStatus:{enum:['ready','conflict','stale','missing']}});
  const execPreview=req({language,items:array(sheetItem,200),requested:count,withoutStyleLink:count,running:{type:'boolean'},canStart:{type:'boolean'},
    impact:req({ownerPlmSession:ok,replacesEarlierPlmSheet:ok,keepsUserUploads:ok,rollback:{enum:['unavailable']}})});
  const execPending=req({verified:ok,completionPending:{enum:['native-operation']},operation:operationRef,job:jobView});
  const execData=req({jobId,language,requested:count,downloaded:count,saved:count,failed:count,failedItems:array(req({plmId:string(80),code:string(80)}),200)});
  const execDone={...req({verified:ok,operation:operationRef,data:execData}),properties:{verified:ok,operation:operationRef,data:execData,outcome:{enum:['partial']}}};
  const execOutput={...object({verified:ok,completionPending:{enum:['native-operation']},operation:operationRef,job:jobView,data:execData,outcome:{enum:['partial']}}),required:['verified','operation'],anyOf:[execPending,execDone]};
  const ownerOnly=ctx=>{ctx.assertAuthority?.();if(!ctx.profile||ctx.ownerId!==ctx.profile.id)throw error('OFFICE_TOOL_FORBIDDEN',403);};
  const owner=ctx=>{ownerOnly(ctx);if(!deps.technicalSheets)throw error('OFFICE_SOURCE_UNAVAILABLE',503);};
  const publicJob=(id,job)=>({jobId:String(id),status:text(job&&job.status,20),phase:text(job&&job.phase,120),total:Number(job&&job.total)||0,processed:Number(job&&job.processed)||0,succeeded:Number(job&&job.succeeded)||0,failed:Number(job&&job.failed)||0});
  function sheetPreview(args,ctx){owner(ctx);
    const lang=args.language||'en',items=deps.technicalSheets.prepare(args.plmIds.map(plmId=>({plmId})));
    if(!items.length)throw error('OFFICE_TASK_INVALID',422);
    const index=JSON.parse(JSON.stringify(deps.readModelFilesIndex()||[]));
    const {statusByPlmId}=deps.ownership.resolveTechnicalSheetOwnership(index,items.map(item=>item.plmId),{fileExists:deps.fileExists});
    const running=Boolean(deps.technicalSheets.running(ctx.profile));owner(ctx);
    // styleIds bind the approval to the exact PLM styles; not shown in the preview.
    return {styleIds:items.map(item=>item.styleId||''),language:lang,items:items.map(item=>({plmId:item.plmId,styleLinked:Boolean(item.styleId),currentStatus:statusByPlmId[item.plmId]?.status||'missing'})),requested:items.length,
      withoutStyleLink:items.filter(item=>!item.styleId).length,running,canStart:!running,impact:{ownerPlmSession:true,replacesEarlierPlmSheet:true,keepsUserUploads:true,rollback:'unavailable'}};
  }
  // Known native failures keep their meaning; anything else stays a failed operation.
  const failureCode=run=>{const code=String(run.errorCode||'');
    if(run.job&&run.job.status==='cancelled'||code==='PLM_JOB_CANCELLED')return 'OFFICE_NATIVE_OPERATION_CANCELLED';
    if(/^CORENECTUM_(API_TOKEN_(REQUIRED|INVALID|INVALID_FORMAT)|LOGIN_REQUIRED)$/.test(code))return 'OFFICE_PLM_SESSION_REQUIRED';
    if(code==='OFFICE_PREVIEW_CHANGED'||code==='OFFICE_TOOL_FORBIDDEN')return code;
    return 'OFFICE_NATIVE_OPERATION_FAILED';};
  const ack=(lang,started)=>({verified:true,completionPending:'native-operation',operation:{id:String(started.jobId),kind:'plm-technical-sheet',language:lang},job:publicJob(started.jobId,started.job)});
  registry.registerCapability({id:'collection.plm.techsheet.download',module:'koleksiyon',operation:'EXECUTE',risk:'write',areas:['koleksiyon'],agentAreas:['collection'],
    label:{tr:'PLM teknik föylerini indir ve sonucu bekle',en:'Download PLM technical sheets and await the result'},
    dataScope:'owner PLM session; technical sheets of the given PLM IDs in the model files store; existing PLM job',
    inputSchema:{...object({plmIds,language}),required:['plmIds']},outputSchema:execOutput,dryRunOutputSchema:req({verified:ok,fingerprint:sha,preview:execPreview}),publicPreview:({styleIds,...p})=>p,
    read:async(args,ctx)=>sheetPreview(args,ctx),
    apply:async(args,ctx,p)=>{if(!p.canStart)throw error('OFFICE_OPERATION_IN_PROGRESS',409);
      if(!deps.withAgentMutation)throw error('OFFICE_APPROVAL_REQUIRED',403);
      return deps.withAgentMutation(ctx,async()=>{const now=sheetPreview(args,ctx);
        if(!now.canStart)throw error('OFFICE_OPERATION_IN_PROGRESS',409);
        if(JSON.stringify([now.styleIds,now.items.map(i=>i.plmId)])!==JSON.stringify([p.styleIds,p.items.map(i=>i.plmId)]))throw error('OFFICE_PREVIEW_CHANGED',409);
        const items=deps.technicalSheets.prepare(args.plmIds.map(plmId=>({plmId})));
        return ack(p.language,deps.technicalSheets.start(ctx.profile,items,p.language,{assertAuthority:ctx.assertAuthority}));});},
    poll:async(receipt,ctx)=>{owner(ctx);
      const run=deps.technicalSheets.run(ctx.profile,receipt.operation.id);
      if(!run)throw error('OFFICE_NATIVE_RECEIPT_INVALID',409);
      if(!run.done)return {verified:true,completionPending:'native-operation',operation:receipt.operation,job:publicJob(receipt.operation.id,run.job)};
      if(run.errorCode||!run.result)throw error(failureCode(run),409);
      const r=run.result,failedItems=(r.failedItems||[]).slice(0,200).map(item=>({plmId:text(item&&item.plmId,80),code:text(item&&item.code,80)}));
      // A model that could not be downloaded or stored makes the step partial.
      return {verified:true,...((r.failedItems||[]).length?{outcome:'partial'}:{}),operation:receipt.operation,data:{jobId:String(receipt.operation.id),language:r.language==='tr'?'tr':'en',requested:Number(r.requested)||0,downloaded:Number(r.downloaded)||0,saved:Number(r.saved)||0,failed:(r.failedItems||[]).length,failedItems}};}});
  // EXECUTE: model images and sample requests through the existing route handlers.
  const plmItem={...object({plmId:{...string(80),minLength:1},colourCode:string(40),colour:string(80)}),required:['plmId']};
  const failedList=array(req({plmId:string(80),code:string(80)}),200);
  const failedOf=items=>(Array.isArray(items)?items:[]).slice(0,200).map(item=>({plmId:text(item&&item.plmId,80),code:text(item&&item.code,80)}));
  function routeCapability(spec){
    const opRef=req({id:jobId,kind:{enum:[spec.kind]}});
    const pending=req({verified:ok,completionPending:{enum:['native-operation']},operation:opRef,job:jobView});
    const done={...req({verified:ok,operation:opRef,data:spec.data}),properties:{verified:ok,operation:opRef,data:spec.data,outcome:{enum:['partial']}}};
    const outputSchema={...object({verified:ok,completionPending:{enum:['native-operation']},operation:opRef,job:jobView,data:spec.data,outcome:{enum:['partial']}}),required:['verified','operation'],anyOf:[pending,done]};
    const runs=()=>{if(!deps.routeRuns||!spec.handler())throw error('OFFICE_SOURCE_UNAVAILABLE',503);return deps.routeRuns;};
    const view=(args,ctx)=>{ownerOnly(ctx);const running=Boolean(runs().running(ctx.profile,spec.jobKind));const p=spec.preview(args,ctx);ownerOnly(ctx);return {...p,running,canStart:!running};};
    registry.registerCapability({id:spec.id,module:'koleksiyon',operation:'EXECUTE',risk:'write',areas:spec.areas,agentAreas:spec.agentAreas,label:spec.label,dataScope:spec.dataScope,
      inputSchema:spec.inputSchema,outputSchema,dryRunOutputSchema:req({verified:ok,fingerprint:sha,preview:spec.previewSchema}),publicPreview:p=>p,
      read:async(args,ctx)=>view(args,ctx),
      apply:async(args,ctx,p)=>{if(!p.canStart)throw error('OFFICE_OPERATION_IN_PROGRESS',409);
        if(!deps.withAgentMutation)throw error('OFFICE_APPROVAL_REQUIRED',403);
        return deps.withAgentMutation(ctx,async()=>{const now=view(args,ctx);
          if(!now.canStart)throw error('OFFICE_OPERATION_IN_PROGRESS',409);
          if(JSON.stringify({...now,running:false,canStart:true})!==JSON.stringify({...p,running:false,canStart:true}))throw error('OFFICE_PREVIEW_CHANGED',409);
          const started=runs().start(ctx.profile,spec.handler(),spec.body(args),{assertAuthority:ctx.assertAuthority});
          return {verified:true,completionPending:'native-operation',operation:{id:started.jobId,kind:spec.kind},job:publicJob(started.jobId,started.job)};});},
      poll:async(receipt,ctx)=>{ownerOnly(ctx);
        const run=runs().run(ctx.profile,receipt.operation.id);
        if(!run)throw error('OFFICE_NATIVE_RECEIPT_INVALID',409);
        if(!run.done)return {verified:true,completionPending:'native-operation',operation:receipt.operation,job:publicJob(receipt.operation.id,run.job)};
        const body=run.body||{};
        if(run.statusCode>=400||body.ok!==true)throw error(require('./agent-native-route-runs').officeCode(body.code,run.job&&run.job.status==='cancelled'),409);
        const data=spec.result(String(receipt.operation.id),body);
        return {verified:true,...(spec.partial(body,data)?{outcome:'partial'}:{}),operation:receipt.operation,data};}});
  }
  const imageData=req({jobId,mode:{enum:['missing','all']},requested:count,saved:count,downloaded:count,missing:count,failed:count,manualPreserved:count,failedItems:failedList});
  routeCapability({id:'collection.plm.images.import',kind:'plm-images',data:imageData,jobKind:'plm-images',areas:['koleksiyon'],agentAreas:['collection'],
    label:{tr:'PLM model görsellerini al ve sonucu bekle',en:'Import PLM model images and await the result'},
    dataScope:'owner PLM session; model images of the given PLM IDs/colours in the model image store; manual images are never overwritten',
    handler:()=>deps.imageImport,
    inputSchema:{...object({items:{...array(plmItem,200),minItems:1},mode:{enum:['missing','all']}}),required:['items']},
    previewSchema:req({mode:{enum:['missing','all']},items:array(req({plmId:string(80),colourCode:string(40)}),200),requested:count,running:{type:'boolean'},canStart:{type:'boolean'},
      impact:req({ownerPlmSession:ok,keepsManualImages:ok,refreshesAutomaticImages:{type:'boolean'},rollback:{enum:['unavailable']}})}),
    preview:args=>{const items=[];const seen=new Set();
      for(const item of args.items){const plmId=deps.normalizePlmId(item.plmId);if(!plmId)throw error('OFFICE_TASK_INVALID',422);const key=plmId+'|'+String(item.colourCode||'').trim()+'|'+String(item.colour||'').trim().toUpperCase();if(seen.has(key))continue;seen.add(key);items.push({plmId,colourCode:String(item.colourCode||'').trim()});}
      const mode=args.mode==='all'?'all':'missing';
      return {mode,items,requested:items.length,impact:{ownerPlmSession:true,keepsManualImages:true,refreshesAutomaticImages:mode==='all',rollback:'unavailable'}};},
    body:args=>({items:args.items.map(item=>({plmId:deps.normalizePlmId(item.plmId),colourCode:String(item.colourCode||'').trim(),colour:String(item.colour||'').trim()})),mode:args.mode==='all'?'all':'missing',scope:'koleksiyon',overwriteManual:false}),
    result:(id,body)=>({jobId:id,mode:body.mode==='all'?'all':'missing',requested:Number(body.requested)||0,saved:Number(body.imagesSaved)||0,downloaded:Number(body.imagesDownloaded)||0,missing:Number(body.imagesMissing)||0,failed:Number(body.imagesFailed)||0,manualPreserved:Number(body.manualPreserved)||0,failedItems:failedOf(body.imageFailedItems||body.failedItems)}),
    partial:(body,data)=>data.failed>0||data.missing>0||(body.status&&body.status!=='completed')});
  const sampleData=req({jobId,checked:count,synced:count,withRequests:count,requestCount:count,notFound:count,failed:count,failedItems:failedList});
  routeCapability({id:'collection.plm.samples.sync',kind:'plm-requests',data:sampleData,jobKind:'plm-requests',areas:[],anyAreas:['koleksiyon','cp','orders'],agentAreas:['collection'],
    label:{tr:'PLM numune taleplerini yenile ve sonucu bekle',en:'Refresh PLM sample requests and await the result'},
    dataScope:'owner PLM session; sample requests of the given PLM IDs in the shared sample request store',
    handler:()=>deps.sampleSync,
    inputSchema:{...object({plmIds,scope:{enum:['koleksiyon','cp']}}),required:['plmIds']},
    previewSchema:req({scope:{enum:['koleksiyon','cp']},plmIds:array(string(80),200),requested:count,running:{type:'boolean'},canStart:{type:'boolean'},
      impact:req({ownerPlmSession:ok,replacesStoredRequestsOfTheseModels:ok,rollback:{enum:['unavailable']}})}),
    preview:args=>{const ids=[...new Set(args.plmIds.map(id=>deps.normalizePlmId(id)))];if(ids.some(id=>!id))throw error('OFFICE_TASK_INVALID',422);
      return {scope:args.scope==='cp'?'cp':'koleksiyon',plmIds:ids,requested:ids.length,impact:{ownerPlmSession:true,replacesStoredRequestsOfTheseModels:true,rollback:'unavailable'}};},
    body:args=>({plmIds:[...new Set(args.plmIds.map(id=>deps.normalizePlmId(id)))],scope:args.scope==='cp'?'cp':'koleksiyon'}),
    result:(id,body)=>({jobId:id,checked:Number(body.checked)||0,synced:Number(body.synced)||0,withRequests:Number(body.withRequests)||0,requestCount:Number(body.requestCount)||0,notFound:(body.notFound||[]).length,failed:(body.failed||[]).length,
      failedItems:failedOf([...(body.failed||[]),...(body.notFound||[]).map(plmId=>({plmId,code:'PLM_NOT_FOUND'}))])}),
    partial:(_body,data)=>data.failed+data.notFound>0});
}
module.exports={registerPlmAssetTools};
