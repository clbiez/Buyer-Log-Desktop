'use strict';
const Rules=require('../../public/cp-rules-engine');
const CP=require('../../public/cp-readiness-engine');
const Dates=require('../../public/date-dimension');
const canonical=require('./canonical-fields');
const Samples=require('../../public/plm-sample-requests-engine');
const {hash,error}=require('./agent-office-store');
const string=maxLength=>({type:'string',maxLength});
const object=properties=>({type:'object',properties,additionalProperties:false});
const ruleSchema={...object({id:string(120),kind:{enum:['priority','checklist']},name:string(160),nameEn:string(160),formula:string(4000),target:{enum:Rules.SEVERITY},approvalScope:{enum:['order','option']}}),required:['id','kind','name','nameEn','formula']};
const weeklySchema={...object({date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},recipientMode:{enum:['manufacturer','general']},groupId:string(120),subject:string(200),body:string(4000),language:{enum:['tr','en']}}),required:['date','recipientMode','subject','body','language']};
const count={type:'number',minimum:0},anyObject={type:'object'},list=items=>({type:'array',items});
const receipt={type:'object',required:['value'],properties:{value:{type:'string'}},additionalProperties:true};
const message={type:'object',required:['to','subject','body','rows'],properties:{to:list(string(320)),cc:list(string(320)),bcc:list(string(320)),subject:string(400),body:string(4000),rows:count,groupId:string(120),groupName:string(300),language:{enum:['tr','en']},filename:string(250)},additionalProperties:false};
const ruleOutput={...object({rule:anyObject,matched:count,quantity:count,sample:list(anyObject),revision:string(64),sourceRevision:{type:'string'},operation:{enum:['CREATE','UPDATE']},fingerprint:string(64),scope:{type:'string'},verified:{type:'boolean'}}),required:['rule','matched','quantity','sample','revision','sourceRevision','operation','fingerprint','scope','verified']};
const weeklyOutput={...object({range:anyObject,matched:count,sample:list(anyObject),sourceRevision:{type:'string'},mail:{...object({messages:list(message),unresolved:list({}),sendAvailable:{enum:[false]}}),required:['messages','unresolved','sendAvailable']},fingerprint:string(64),verified:{type:'boolean'},sendAvailable:{enum:[false]}}),required:['range','matched','sample','sourceRevision','mail','fingerprint','verified','sendAvailable']};
const saveOutput={...object({verified:{type:'boolean'},ruleId:string(120),scope:{type:'string'},entries:{type:'object',additionalProperties:receipt},rollbackToken:{...object({kind:{enum:['priority','checklist']},key:{type:'string'},before:{},after:receipt}),required:['kind','key','before','after']}}),required:['verified','ruleId','scope','entries','rollbackToken']};
const draftOutput={...object({emails:list({...message,required:[...message.required,'filename']}),unresolved:list({}),verified:{type:'boolean'},matched:count,sendAvailable:{enum:[false]}}),required:['emails','unresolved','verified','matched','sendAvailable']};

function fieldCatalog(data,excludeId='') {
  const rules=Rules.mergeWithDefaults(data.personalRules||[],data.deletedRuleIds||[]);
  return Object.values(Rules.fieldCatalog(data.cpRows||[],{checklistItems:rules.filter(r=>r.kind==='checklist'),priorityRules:rules.filter(r=>r.kind==='priority'),excludeId})).flat();
}
function normalizeRule(raw,data) {
  if(!raw.name.trim()||!raw.nameEn.trim())throw error('OFFICE_RULE_LABEL_REQUIRED',422);
  const existing=Rules.mergeWithDefaults(data.personalRules||[],data.deletedRuleIds||[]).find(r=>r.id===raw.id);
  if(existing&&existing.kind!==raw.kind)throw error('OFFICE_RULE_KIND_CHANGED',409);
  const rule=Rules.normalizeRule({...existing,...raw,enabled:true,mode:'formula',expressionVersion:Rules.EXPRESSION_VERSION,tr:raw.name,en:raw.nameEn,questionTr:raw.name,questionEn:raw.nameEn});
  const validation=Rules.validateRule(rule,{fields:fieldCatalog(data,rule.id).map(f=>f.id)});
  if(!validation.valid)throw error('OFFICE_RULE_INVALID',422);
  const rules=Rules.mergeWithDefaults(data.personalRules||[],data.deletedRuleIds||[]).filter(r=>r.id!==rule.id).concat(rule);
  if(Rules.findCycle(rule,rules).length||Rules.danglingReferences(rule,rules).length)throw error('OFFICE_RULE_DEPENDENCY',422);
  return {rule,rules};
}
// Reuse the PLM milestone/stage engines, restricted to the visible CP models.
function plmEvidenceFor(models={}) {
  const cache=new Map();
  return (analysis,itemId)=>{
    const row=analysis.sourceRow,id=Samples.numericId(canonical.normalizedValue(row,'cp','plmId'));
    if(!cache.has(id))cache.set(id,models[id]?Samples.summarizeMilestones(models[id].requests):null);
    const stage=!Samples.isPostProductionStage(analysis.stage)&&Number(canonical.normalizedValue(row,'cp','shipmentQuantity'))>0?'SHIPPED':analysis.stage;
    return Samples.evidenceFor(Samples.applyOrderStage(cache.get(id),stage),itemId);
  };
}
async function rulePreview(adapter,args,ctx) {
  const data=await adapter.data(ctx.profile),snapshot=adapter.ruleSnapshot(ctx.profile,args.rule.kind);
  const {rule,rules}=normalizeRule(args.rule,data),preparedRules=Rules.prepareEvaluation(rules);
  let matched=0,quantity=0;const sample=[],plmEvidence=data.plmEvidence||plmEvidenceFor(data.samples?.models);
  for(const row of data.cpRows||[]){
    const analysis=CP.analyzeOrder(row,{transitRules:data.transitRules||[],settings:data.settings||{},today:data.today});
    const evaluation=Rules.evaluateOrder(analysis,{rules,preparedRules,answers:data.checklist?.answers||{},plmEvidence,checklistEnabled:data.checklistEnabled!==false,today:data.today});
    const hit=rule.kind==='checklist'?evaluation.customItems.some(r=>r.id===rule.id):evaluation.ruleState[rule.id]==='matched';
    if(hit){matched++;quantity+=analysis.qty||0;if(sample.length<5)sample.push(canonical.project(row,'cp',['orderCode','modelName','colourCode','exFactory']));}
  }
  const fingerprint=hash(JSON.stringify({rule,snapshot,data,day:CP.defaultOrdinal(new Date())}));
  return {rule,matched,quantity,sample,revision:snapshot.hash,sourceRevision:data.sourceRevision,operation:(data.personalRules||[]).some(r=>r.id===rule.id)?'UPDATE':'CREATE',fingerprint,scope:'owner-personal-cp-rules',verified:true};
}
async function weeklySelection(adapter,args,ctx) {
  const data=await adapter.data(ctx.profile),calendar=adapter.calendar();
  if(!calendar.configured||!calendar.calendar)throw error('OFFICE_MERCH_REQUIRED',409);
  Dates.setMerchCalendar(calendar.calendar);
  const range=Dates.businessWeekRange(args.date);
  if(!range)throw error('OFFICE_MERCH_DATE_OUTSIDE',422);
  const rows=(data.cpRows||[]).filter(row=>{const date=Dates.toISO(Dates.parseDate(canonical.value(row,'cp','exFactory')));return date&&date>=range.start&&date<=range.end;});
  if(rows.length>5000)throw error('OFFICE_DRAFT_CAPACITY',413);
  if(!rows.length)throw error('OFFICE_WEEK_EMPTY',409);
  const mail=await adapter.mail(ctx.profile,args,rows,true);
  const fingerprint=hash(JSON.stringify({args,range,calendar,rows,mail}));
  return {rows,preview:{range,matched:rows.length,sample:rows.slice(0,5).map(row=>canonical.project(row,'cp',['orderCode','modelName','colourCode','exFactory'])),sourceRevision:data.sourceRevision,mail,fingerprint,verified:true,sendAvailable:false}};
}
function registerCpTools(register,adapter) {
  const meta=(id,operation,risk,inputSchema,rollbackable=false)=>({id,label:id,module:'cp',operation,category:'app',kind:'app',area:'cp',areas:id.startsWith('cp.weekly')?['cp','automations']:['cp'],risk,approval:risk==='write',rollbackable,contractVersion:1,executionScope:'office-durable-job',inputSchema,outputSchema:id==='cp.rule.save'?saveOutput:id==='cp.weekly.draft'?draftOutput:id==='cp.rule.preview'?ruleOutput:weeklyOutput,dryRunOutputSchema:id.startsWith('cp.rule')?ruleOutput:weeklyOutput,dataScope:'current-owner-and-current-IAM-visible-CP',preview:id.endsWith('save')?'cp.rule.preview':id.endsWith('draft')?'cp.weekly.preview':id,validation:'JSON-schema + existing deterministic Buyer Log engines',audit:'AGENT_CP_TOOL',idempotency:'Office durable job reservation; never auto-replay an interrupted effect',retry:risk==='read'?'bounded-read-only':'manual-reconciliation',rollback:rollbackable?'restore exact personal entry only if current entry matches effect receipt':'unsupported',approvalBinding:'owner + agent revision + normalized args + live source/recipient snapshot hash'});
  register(meta('cp.rule.preview','READ','read',{...object({rule:ruleSchema}),required:['rule']}),(args,ctx)=>rulePreview(adapter,args,ctx));
  register(meta('cp.rule.save','CREATE/UPDATE','write',{...object({rule:ruleSchema,fingerprint:string(64)}),required:['rule','fingerprint']},true),async(args,ctx)=>{
    const preview=await rulePreview(adapter,args,ctx);
    if(preview.fingerprint!==args.fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(ctx.dryRun)return preview;
    await adapter.authorize?.(ctx,args);
    ctx.assertAuthority?.();
    adapter.assertRevision?.(ctx.profile,preview.sourceRevision);
    const snapshot=adapter.ruleSnapshot(ctx.profile,preview.rule.kind);
    if(snapshot.hash!==preview.revision)throw error('OFFICE_PREVIEW_CHANGED',409);
    return adapter.saveRule(ctx.profile,preview.rule,snapshot);
  },(token,ctx)=>adapter.restoreRule(ctx.profile,token));
  register(meta('cp.weekly.preview','READ','read',weeklySchema),async(args,ctx)=>(await weeklySelection(adapter,args,ctx)).preview);
  register(meta('cp.weekly.draft','EXPORT','write',{...weeklySchema,properties:{...weeklySchema.properties,fingerprint:string(64)},required:[...weeklySchema.required,'fingerprint']}),async(args,ctx)=>{
    const {fingerprint,...selection}=args;
    const {rows,preview}=await weeklySelection(adapter,selection,ctx);
    if(preview.fingerprint!==fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(ctx.dryRun)return preview;
    await adapter.authorize?.(ctx,args);
    ctx.assertAuthority?.();
    adapter.assertRevision?.(ctx.profile,preview.sourceRevision);
    const result=await adapter.mail(ctx.profile,selection,rows,false,preview.mail);
    return {...result,verified:adapter.verifyMail(result,ctx.profile),matched:rows.length,sendAvailable:false};
  });
}
module.exports={registerCpTools,fieldCatalog,ruleSchema,weeklySchema,plmEvidenceFor};
