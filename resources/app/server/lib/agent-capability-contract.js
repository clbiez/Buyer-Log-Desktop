'use strict';
const {hash,error}=require('./agent-office-store');
const {validate}=require('./agent-tool-schema');
const object=properties=>({type:'object',properties,additionalProperties:false});
const string=maxLength=>({type:'string',maxLength});
const array=(items,maxItems=1000)=>({type:'array',items,maxItems});
const resultSchema={type:'object',required:['verified'],properties:{verified:{enum:[true]}},additionalProperties:true};

// A capability is an adapter to an existing application service. No code,
// URL, SQL or service function name is accepted from the caller or model.
function register(registerTool,spec,authorize) {
  if(!spec.id||!spec.module||!spec.inputSchema||typeof spec.read!=='function'||spec.risk!=='read'&&typeof spec.apply!=='function')throw new TypeError('Incomplete capability contract');
  if((spec.capabilities||[]).some(code=>!require('./iam-core').PERMISSION_CODES.has(code)))throw new TypeError('Unknown IAM capability');
  if(spec.grantScope&&spec.grantScope!=='collection-editor')throw new TypeError('Unknown native resource grant');
  const effect=spec.risk!=='read',schema=effect?{...spec.inputSchema,properties:{...spec.inputSchema.properties,fingerprint:string(64)}}:spec.inputSchema;
  const meta={...spec,contractVersion:2,category:'app',kind:'app',area:spec.areas?.[0]||'',areas:spec.areas||[],approval:effect,rollbackable:!!spec.restore,
    inputSchema:schema,outputSchema:spec.outputSchema||resultSchema,dryRunOutputSchema:spec.dryRunOutputSchema||resultSchema,executionScope:'office-durable-job',
    dataScope:spec.dataScope||'current-owner-and-live-IAM',preview:'same-tool-dryRun',validation:'schema + existing application service',audit:'AGENT_CAPABILITY_TOOL',
    idempotency:'durable step reservation and verified receipt; no blind effect retry',retry:effect?'reconcile':'bounded-read-only',
    rollback:spec.restore?'revision-bound inverse through existing service':'unsupported',approvalBinding:'owner + device + current IAM + agent revision + normalized args + source snapshot'};
  if(spec.poll)meta.completion='verified native acknowledgement waits for actual result; existing Office queue polls only';
  for(const key of ['read','apply','restore','poll'])delete meta[key];
  registerTool(meta,async(raw,ctx)=>{
    const {fingerprint,...args}=raw;validate(spec.inputSchema,args);
    const snapshot=await spec.read(args,ctx);ctx.assertAuthority();
    const currentHash=hash(JSON.stringify({toolId:spec.id,version:2,args,snapshot}));
    if(!effect){if(!ctx.dryRun&&ctx.input?.officeJobId){if(typeof authorize!=='function')throw error('OFFICE_APPROVAL_REQUIRED',403);await authorize(ctx,raw);ctx.assertAuthority();}return {verified:true,data:snapshot};}
    if(ctx.dryRun)return {verified:true,preview:snapshot,fingerprint:currentHash};
    if(currentHash!==fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(typeof authorize!=='function')throw error('OFFICE_APPROVAL_REQUIRED',403);
    await authorize(ctx,raw);ctx.assertAuthority();
    const result=await spec.apply(args,ctx,snapshot);validate(spec.outputSchema||resultSchema,result);
    return result;
  },spec.restore?async(token,ctx)=>spec.restore(token,ctx):null);
}
function allowed(tool,profile,access) {
  return !!tool?.contractVersion&&!!profile&&profile.enabled!==false&&(tool.areas||[tool.area]).filter(Boolean).every(area=>access.hasArea(profile,area))&&
    (!tool.anyAreas||tool.anyAreas.some(area=>access.hasArea(profile,area)))&&(tool.permissions||[]).every(key=>access.hasPermission?.(profile,key))&&(tool.capabilities||[]).every(key=>access.hasCapability?.(profile,key))&&
    (!tool.grantScope||tool.grantScope==='collection-editor'&&access.effectiveCollectionAccess?.(profile)?.some(item=>item.level==='edit'));
}
module.exports={register,allowed,object,string,array,resultSchema};
