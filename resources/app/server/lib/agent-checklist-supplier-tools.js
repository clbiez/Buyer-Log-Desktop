'use strict';
/* Supplier checklist workbook import for Office (CP › Checklist › Supplier
   Excel). The uploaded workbook is read with the same parser the CP import
   button uses (checklist-supplier-sync parseSupplierWorkbook), applicability
   comes from the same CP decision engines (analyzeOrder + evaluateOrder) and
   the write is the native applyEntries with source "supplier_excel", so the
   export-time conflict gate (baseAt) keeps newer Buyer Log answers. Rows the
   owner may not edit are skipped and counted. The inverse is the exact prior
   answer/tombstone of every touched key, bound to the owner/job/step.
   cp.checklist.supplier.export builds the supplier workbook with the same
   builder as CP › Checklist › Excel (buildSupplierWorkbook): scoped orders,
   the same decisions and answers, model images from the local image store,
   sheet protection and meta. The file is an Office output (download). */
const ExcelJS=require('../../public/vendor/exceljs.min.js');
const Sync=require('../../public/checklist-supplier-sync');
const Rules=require('../../public/cp-rules-engine'),CP=require('../../public/cp-readiness-engine');
const {object,string,array}=require('./agent-capability-contract'),{error,hash}=require('./agent-office-store');
const native=require('./checklist-supplier-store'),artifacts=require('./agent-artifact-store'),Inverse=require('./agent-native-inverse-artifact');
const {plmEvidenceFor}=require('./cp-agent-tools');
const TOOL_ID='cp.checklist.supplier.import';
const SAMPLE=50;
const req=p=>({...object(p),required:Object.keys(p)}),text=string(),count={type:'integer',minimum:0},ok={enum:[true]},sha={...string(64),pattern:'^[a-f0-9]{64}$'},nullable=s=>({anyOf:[{type:'null'},s]});
const artifactId={...string(32),pattern:'^[a-f0-9]{32}$'};
const counts=req({entries:count,updates:count,pending:count,expectedConflicts:count,blank:count,invalid:count,notApplicable:count,formulaCells:count,staleRows:count,forbidden:count});
const change=req({key:text,orderKey:text,itemId:text,itemLabel:text,state:text,beforeState:nullable(text),expectedConflict:{type:'boolean'}});
const preview=req({artifact:req({id:artifactId,name:text,sha256:sha,bytes:count}),revision:count,sourceRevision:text,exportedAt:text,counts,changes:array(change,SAMPLE),sampled:{type:'boolean'}});
const inverse=req({ownerId:text,expectedRevision:count,artifactId});

function registerChecklistSupplierTools(registry,deps){
  const base={module:'cp',areas:['cp'],agentAreas:['cp'],capabilities:['CP.VIEW','CP.EDIT'],dataScope:'uploaded Buyer Log supplier checklist workbook; current scoped CP orders the owner may edit'};
  const assert=(ctx,source)=>{ctx.assertAuthority();if(source!==undefined&&deps.sourceRevision(ctx.profile)!==source)throw error('OFFICE_PREVIEW_CHANGED',409);};
  const mutate=(ctx,work)=>{if(typeof deps.withAgentMutation!=='function')throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.withAgentMutation(ctx,work);};
  async function writable(ctx,keys,source){const allowed=await deps.authorizedOrders(ctx.profile,{write:true});assert(ctx,source);if(keys&&keys.some(key=>key.startsWith('@option:')||!allowed.has(key)))throw error('OFFICE_TOOL_FORBIDDEN',403);return allowed;}

  async function parse(args,ctx){
    const sourceRevision=deps.sourceRevision(ctx.profile);
    const {meta:file,buffer}=artifacts.read(ctx.profile,args.artifactId,'workbook');
    const workbook=new ExcelJS.Workbook();
    try{await workbook.xlsx.load(buffer);}catch(_){throw error('OFFICE_SUPPLIER_WORKBOOK_INVALID',422);}
    const data=await deps.data(ctx.profile);assert(ctx,sourceRevision);
    const allowed=await writable(ctx,null,sourceRevision);
    const rules=Rules.mergeWithDefaults(data.personalRules||[],data.deletedRuleIds||[]),preparedRules=Rules.prepareEvaluation(rules);
    const plmEvidence=data.plmEvidence||plmEvidenceFor(data.samples?.models);
    const catalog=new Map(rules.filter(rule=>rule.kind==='checklist'&&rule.enabled!==false).map(rule=>[rule.id,{id:rule.id,tr:rule.tr||rule.name||rule.id,en:rule.en||rule.name||rule.id}]));
    const analyses=new Map();
    for(const row of data.cpRows||[]){const analysis=CP.analyzeOrder(row,{transitRules:data.transitRules||[],settings:data.settings||{},today:data.today});if(analysis&&analysis.orderKey)analyses.set(analysis.orderKey,analysis);}
    const applicable=new Map();
    const applies=(item,analysis)=>{
      let ids=applicable.get(analysis.orderKey);
      if(!ids){ids=new Set(Rules.evaluateOrder(analysis,{rules,preparedRules,answers:data.checklist?.answers||{},plmEvidence,checklistEnabled:data.checklistEnabled!==false,today:data.today}).customItems.map(item=>item.id));applicable.set(analysis.orderKey,ids);}
      return ids.has(item.id);
    };
    let parsed;
    // The effect time is stamped at apply; the preview binding stays stable.
    try{parsed=Sync.parseSupplierWorkbook(workbook,{analysisFor:key=>analyses.get(key)||null,catalog,applies,answers:data.checklist?.answers||{},english:args.language==='en',customStatuses:data.customStatuses||[],at:'1970-01-01T00:00:00.000Z'});}
    catch(err){if(err&&err.code==='CHECKLIST_WORKBOOK_INVALID')throw error('OFFICE_SUPPLIER_WORKBOOK_INVALID',422);throw err;}
    const store=native._read(),before={},byKey=new Map();let forbidden=0;
    for(const entry of parsed.entries){
      if(!allowed.has(entry.orderKey)){forbidden++;continue;}
      const key=native.answerKey(entry.orderKey,entry.itemId);
      // A repeated row for the same answer keeps the last value, as the native write does.
      byKey.delete(key);byKey.set(key,entry);
      if(!before[key])before[key]={answer:store.answers[key]||null,tombstone:store.tombstones[key]||null};
    }
    const entries=[...byKey.values()];
    if(!entries.length)throw error('OFFICE_SUPPLIER_IMPORT_EMPTY',409);
    const exportedAt=parsed.meta.exportedAt||'';
    const view=entries.map(entry=>{
      const key=native.answerKey(entry.orderKey,entry.itemId),prior=before[key].answer||before[key].tombstone,priorAt=prior?String(prior.at||''):'';
      return {key,orderKey:entry.orderKey,itemId:entry.itemId,itemLabel:String(entry.itemLabel||''),state:entry.state,beforeState:prior?String(prior.state||''):null,expectedConflict:Boolean(exportedAt&&priorAt&&priorAt>exportedAt)};
    });
    assert(ctx,sourceRevision);
    return {artifact:{id:file.id,name:String(file.name||''),sha256:file.sha256,bytes:file.bytes},revision:store.revision,sourceRevision,exportedAt,
      counts:{entries:entries.length,updates:entries.filter(e=>e.state!=='open').length,pending:entries.filter(e=>e.state==='open').length,expectedConflicts:view.filter(v=>v.expectedConflict).length,...parsed.counts,forbidden},
      changes:view.slice(0,SAMPLE),sampled:view.length>SAMPLE,entries,before};
  }
  const publicPreview=s=>({artifact:s.artifact,revision:s.revision,sourceRevision:s.sourceRevision,exportedAt:s.exportedAt,counts:s.counts,changes:s.changes,sampled:s.sampled});

  registry.registerCapability({...base,id:TOOL_ID,operation:'IMPORT',risk:'write',
    label:{tr:'Tedarikçi checklist Excel\'ini içe aktar',en:'Import supplier checklist workbook'},
    inputSchema:{...object({artifactId,language:{enum:['tr','en']}}),required:['artifactId']},
    dryRunOutputSchema:req({verified:ok,fingerprint:sha,preview}),
    outputSchema:req({verified:ok,outcome:{enum:['completed','partial']},data:req({revision:count,updated:count,cleared:count,skipped:count,conflicts:count,changed:count}),rollbackToken:inverse}),
    read:parse,publicPreview,
    apply:async(args,ctx,s)=>{assert(ctx,s.sourceRevision);
      const orderKeys=[...new Set(s.entries.map(e=>e.orderKey))];
      const artifactId=await Inverse.archive(ctx,TOOL_ID,{entries:s.before,orderKeys});
      await writable(ctx,orderKeys,s.sourceRevision);
      return mutate(ctx,()=>{assert(ctx,s.sourceRevision);
        const at=new Date().toISOString(),entries=s.entries.map(entry=>({...entry,at}));
        const expected=new Map(entries.map(entry=>[native.answerKey(entry.orderKey,entry.itemId),entry.state]));
        const receipt=(result,own)=>{
          const exact=result.changedKeys.every(key=>{const stored=own.entries[key].answer||own.entries[key].tombstone;return stored&&stored.state===expected.get(key)&&stored.source==='supplier_excel';});
          if(!exact||result.updated+result.cleared!==result.changedKeys.length)throw error('OFFICE_RULE_VERIFY_FAILED',409);
          const partial=result.skipped+result.conflicts>0||s.counts.forbidden+s.counts.invalid+s.counts.notApplicable+s.counts.formulaCells+s.counts.staleRows>0;
          return {verified:true,outcome:partial?'partial':'completed',data:{revision:result.revision,updated:result.updated,cleared:result.cleared,skipped:result.skipped,conflicts:result.conflicts,changed:result.changedKeys.length},
            rollbackToken:{ownerId:ctx.ownerId,expectedRevision:result.revision,artifactId}};
        };
        return native.applyEntries(entries,ctx.profile,{source:'supplier_excel',expectedRevision:s.revision,reserveWrites:2,assertAuthority:()=>assert(ctx,s.sourceRevision),receipt});
      });
    },
    restore:async(token,ctx)=>{if(token.ownerId!==ctx.ownerId)throw error('OFFICE_ROLLBACK_INVALID',403);
      const before=Inverse.restore(ctx,TOOL_ID,token).before,sourceRevision=deps.sourceRevision(ctx.profile);
      await writable(ctx,before.orderKeys,sourceRevision);
      return mutate(ctx,()=>{assert(ctx,sourceRevision);
        return native.restoreEntries({entries:before.entries,expectedRevision:token.expectedRevision},ctx.profile,{reserveWrites:1,assertAuthority:()=>assert(ctx,sourceRevision),
          receipt:(restored,own)=>{if(Object.entries(before.entries).some(([key,entry])=>hash(JSON.stringify(own.entries[key]))!==hash(JSON.stringify(entry))))throw error('OFFICE_RULE_VERIFY_FAILED',409);return restored;}});});}});
}
const EXPORT_ID='cp.checklist.supplier.export';
const Checklist=require('../../public/cp-checklist-engine'),reportOutput=require('./agent-report-output-contract');
const IMAGE_BUDGET=40*1024*1024;
const COLUMN_IDS=['image','order','plm','model','colour','supplier','exfactory','season','buyer','buyerGroup','category','license'];
const DEFAULT_COLUMNS=['image','order','plm','model','colour','supplier','exfactory'];
// The builder reads the language and custom statuses from one module-level
// context; builds are serialized so concurrent exports cannot mix them.
let buildQueue=Promise.resolve();
function serialized(work){const next=buildQueue.then(work,work);buildQueue=next.catch(()=>{});return next;}
function catalogItem(rule){return {id:rule.id,tr:rule.tr||rule.name||rule.id,en:rule.en||rule.name||rule.id,questionTr:rule.questionTr||rule.name||rule.id,questionEn:rule.questionEn||rule.name||rule.id,builtIn:rule.builtIn===true,approvalScope:rule.approvalScope==='option'?'option':'order',
  evidenceFields:{reportNumber:Boolean(rule.evidenceFields&&rule.evidenceFields.reportNumber),actualDate:Boolean(rule.evidenceFields&&rule.evidenceFields.actualDate),attachments:Boolean(rule.evidenceFields&&rule.evidenceFields.attachments)}};}
function registerChecklistSupplierExport(registry,deps){
  const exportPreview=req({orders:count,missing:count,items:count,supplier:text,language:{enum:['tr','en']},columns:array({enum:COLUMN_IDS},COLUMN_IDS.length),withImages:{type:'boolean'},sourceRevision:text});
  async function plan(args,ctx){
    const sourceRevision=deps.sourceRevision(ctx.profile);
    const data=await deps.data(ctx.profile);ctx.assertAuthority();
    const allowed=await deps.authorizedOrders(ctx.profile,{write:false});ctx.assertAuthority();
    if(deps.sourceRevision(ctx.profile)!==sourceRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
    const rules=Rules.mergeWithDefaults(data.personalRules||[],data.deletedRuleIds||[]),preparedRules=Rules.prepareEvaluation(rules);
    const plmEvidence=data.plmEvidence||plmEvidenceFor(data.samples?.models);
    const items=rules.filter(rule=>rule.kind==='checklist'&&rule.enabled!==false).map(catalogItem);
    if(!items.length)throw error('OFFICE_SUPPLIER_EXPORT_EMPTY',409);
    const wanted=new Set(args.orderKeys),rows=[],analyses=new Map(),byRow=new Map();
    for(const row of data.cpRows||[]){
      const analysis=CP.analyzeOrder(row,{transitRules:data.transitRules||[],settings:data.settings||{},today:data.today});
      if(!analysis||!wanted.has(analysis.orderKey)||!allowed.has(analysis.orderKey)||analyses.has(analysis.orderKey))continue;
      analyses.set(analysis.orderKey,analysis);byRow.set(row,analysis);rows.push(row);
    }
    if(!rows.length)throw error('OFFICE_SUPPLIER_EXPORT_EMPTY',409);
    const columns=args.columns&&args.columns.length?['order',...args.columns.filter(id=>id!=='order')]:DEFAULT_COLUMNS.slice();
    const answers=data.checklist?.answers||{},applicable=new Map();
    const applies=(item,analysis)=>{let ids=applicable.get(analysis.orderKey);
      if(!ids){ids=new Set(Rules.evaluateOrder(analysis,{rules,preparedRules,answers,plmEvidence,checklistEnabled:data.checklistEnabled!==false,today:data.today}).customItems.map(item=>item.id));applicable.set(analysis.orderKey,ids);}
      return ids.has(item.id);};
    // Same answer lookup as the CP export: order answer, approved reusable
    // option answer, then an approved PLM milestone for built-in items.
    const answerFor=(item,analysis)=>{
      const own=answers[Checklist.answerKey(analysis.orderKey,item.id)];if(own)return own;
      if(item.approvalScope==='option'){const key=Checklist.optionAnswerKey(analysis,item.id),reusable=key&&answers[key];if(reusable&&Checklist.normalizeStatus(reusable.state)==='approved')return reusable;}
      if(!Checklist.Components.parseItem(item.id)&&item.builtIn){try{const evidence=plmEvidence(analysis,item.id);if(evidence&&evidence.state==='approved')return {state:'approved',at:evidence.date||'',by:'PLM',source:'plm'};}catch(_){}}
      return null;};
    const binding={rows:hash(JSON.stringify(rows)),answers:hash(JSON.stringify([...analyses.keys()].sort().map(key=>Object.entries(answers).filter(([k])=>k.startsWith(key+'::')).sort(([a],[b])=>a.localeCompare(b))))),items:hash(JSON.stringify(items))};
    const snapshot={orders:rows.length,missing:args.orderKeys.length-rows.length,items:items.length,supplier:supplierName(rows),language:args.language==='en'?'en':'tr',columns,withImages:columns.includes('image'),sourceRevision,binding};
    Object.defineProperty(snapshot,'build',{value:{rows,items,byRow,applies,answerFor,answers,customStatuses:data.customStatuses||[]},enumerable:false});
    return snapshot;
  }
  const supplierName=rows=>{const names=new Set(rows.map(row=>String(row['Sub-Manufacturer']||row.Manufacturer||'').trim()).filter(Boolean));return names.size===1?[...names][0]:'';};
  registry.registerCapability({module:'cp',areas:['cp'],agentAreas:['cp'],capabilities:['CP.VIEW'],id:EXPORT_ID,operation:'EXPORT',risk:'write',
    label:{tr:'Tedarikçi checklist Excel\'ini oluştur',en:'Create supplier checklist workbook'},
    dataScope:'explicit current scoped CP order keys; checklist decisions and answers; model images from the local image store',
    inputSchema:{...object({orderKeys:{...array({...string(300),minLength:1},500),minItems:1,uniqueItems:true},language:{enum:['tr','en']},columns:{...array({enum:COLUMN_IDS},COLUMN_IDS.length),uniqueItems:true}}),required:['orderKeys']},
    outputSchema:reportOutput.outputSchema,dryRunOutputSchema:req({verified:ok,fingerprint:sha,preview:exportPreview}),
    read:plan,publicPreview:({binding,...view})=>view,
    apply:(args,ctx,p)=>serialized(async()=>{
      ctx.assertAuthority();
      const b=p.build,requestId=hash(ctx.input.officeJobId+':'+ctx.input.officeStepId);
      // Embedded images are bounded per workbook; rows past the budget keep an empty image cell.
      let imageBytes=0;
      const prepareImage=async row=>{if(!p.withImages||!deps.rowImage)return null;const image=deps.rowImage(row);if(!image)return null;const bytes=Math.ceil(image.dataUrl.length*3/4);if(imageBytes+bytes>IMAGE_BUDGET)return null;imageBytes+=bytes;return image;};
      const built=await Sync.buildSupplierWorkbook({ExcelJS,rows:b.rows,items:b.items,language:p.language,customStatuses:b.customStatuses,columnIds:p.columns,
        analysisFor:row=>b.byRow.get(row)||null,itemApplies:b.applies,answerFor:b.answerFor,answers:b.answers,
        prepareImage});
      ctx.assertAuthority();
      const service=deps.outputService();
      const record=service.store.save(ctx.ownerId,{buffer:Buffer.from(built.buffer),title:built.filename.replace(/_\d{4}-\d{2}-\d{2}\.xlsx$/,''),format:'xlsx',template:'buyer-log-supplier-checklist',templateLabel:p.language==='en'?'Buyer Log supplier checklist':'Buyer Log tedarikçi checklist',requestId});
      const saved=service.get(ctx.ownerId,record.id);
      if(!saved||saved.requestId!==requestId||saved.format!=='xlsx')throw error('OFFICE_OUTPUT_INVALID',409);
      return reportOutput.fileResult(saved);
    })});
}
module.exports={registerChecklistSupplierTools,registerChecklistSupplierExport,TOOL_ID,EXPORT_ID};
