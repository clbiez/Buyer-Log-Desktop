'use strict';
/* Office order editor (contract v2). Adapter to the native order override
   service (db.patchOrderOverride) through the same server adapter the legacy
   app.order.update tool uses: identity, IAM edit right and shared-owner fields
   are checked by snapshotOrder; the write is CAS-bound to the orders revision,
   read back, and its exact prior override entry is archived as an owner/job/
   step-bound inverse artifact. No second business rule exists here. */
const {object,string}=require('./agent-capability-contract'),{error}=require('./agent-office-store'),Inverse=require('./agent-native-inverse-artifact');
const {NOTE_AUTHOR_FIELDS}=require('../db');
const TOOL_ID='cp.order.update';
const DATE_FIELDS=['exFactory','retailDate','inStoreDate'];
const EDIT_FIELDS=['notes','dates','subManufacturer','licensor','delType','noteColumns','shortage'];
const count={type:'integer',minimum:0};
const shortageSchema={anyOf:[{type:'boolean'},{...object({marked:{type:'boolean'},qty:{type:'integer',minimum:0,maximum:10000000}}),required:['marked']}]};
const inputSchema={...object({
  orderCode:{type:'integer',minimum:1},model:string(160),ccode:string(80),
  notes:object(Object.fromEntries(NOTE_AUTHOR_FIELDS.map(spec=>[spec.field,string(10000)]))),
  subManufacturer:string(200),licensor:string(200),delType:string(80),
  dates:object(Object.fromEntries(DATE_FIELDS.map(key=>[key,{type:'string',pattern:'^(?:|\\d{4}-\\d{2}-\\d{2})$'}]))),
  noteColumns:{type:'object',additionalProperties:string(2000)},
  shortage:shortageSchema,
}),required:['orderCode']};
const patchSchema={...object(Object.fromEntries(Object.entries(inputSchema.properties).filter(([key])=>key!=='orderCode'))),additionalProperties:false};
const preview={...object({orderCode:{type:'integer',minimum:1},revision:count,patch:patchSchema,fields:{type:'array',items:{enum:EDIT_FIELDS},maxItems:EDIT_FIELDS.length}}),required:['orderCode','revision','patch','fields']};
const output={...object({verified:{enum:[true]},data:{...object({orderCode:{type:'integer',minimum:1},revision:count,fields:preview.properties.fields}),required:['orderCode','revision','fields']},rollbackToken:{type:'object'}}),required:['verified','data','rollbackToken']};

function patchOf(args){
  const patch={};
  for(const key of ['model','ccode',...EDIT_FIELDS])if(Object.hasOwn(args,key))patch[key]=args[key];
  for(const date of Object.values(patch.dates||{}))if(date&&(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw error('OFFICE_DATE_INVALID',422);
  const fields=EDIT_FIELDS.filter(key=>Object.hasOwn(patch,key));
  if(!fields.length||Object.hasOwn(patch,'notes')&&!Object.keys(patch.notes).length&&fields.length===1)throw error('OFFICE_TASK_INVALID',422);
  return {patch,fields};
}
function registerOrderTools(registry,deps){
  const mutate=(ctx,work)=>{if(!deps.withAgentMutation)throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.withAgentMutation(ctx,work);};
  async function read(args,ctx){
    ctx.assertAuthority?.();
    const {patch,fields}=patchOf(args),snapshot=await deps.snapshotOrder(ctx.ownerId,ctx.profile,args.orderCode,patch);
    ctx.assertAuthority?.();
    return {orderCode:args.orderCode,revision:snapshot.revision,patch,fields,receipt:snapshot.patch};
  }
  registry.registerCapability({id:TOOL_ID,module:'cp',operation:'UPDATE',risk:'write',areas:['cp'],agentAreas:['cp'],
    label:{tr:'Sipariş düzenlemesi (not, tarih, not sütunu, eksik adet)',en:'Edit order (notes, dates, note columns, shortage)'},
    dataScope:'one current-IAM-editable CP order line; native order override service',
    inputSchema,outputSchema:output,dryRunOutputSchema:{...object({verified:{enum:[true]},preview,fingerprint:string(64)}),required:['verified','preview','fingerprint']},
    read,publicPreview:snapshot=>({orderCode:snapshot.orderCode,revision:snapshot.revision,patch:snapshot.patch,fields:snapshot.fields}),
    apply:async(args,ctx,p)=>{
      const artifactId=await Inverse.archive(ctx,TOOL_ID,p.receipt);
      return mutate(ctx,async()=>{
        const result=await deps.updateOrder(ctx.ownerId,ctx.profile,args.orderCode,p.patch,p.revision);
        if(result.verified!==true)throw error('OFFICE_ORDER_VERIFY_FAILED',409);
        return {verified:true,data:{orderCode:args.orderCode,revision:result.revision,fields:p.fields},
          rollbackToken:{artifactId,orderCode:args.orderCode,selector:{model:p.patch.model,ccode:p.patch.ccode},expectedRevision:result.revision}};
      });
    },
    restore:(token,ctx)=>mutate(ctx,async()=>{
      const bound=Inverse.restore(ctx,TOOL_ID,token);
      const result=await deps.restoreOrder(ctx.ownerId,ctx.profile,bound.orderCode,bound.before,bound.expectedRevision,bound.selector);
      if(result.verified!==true)throw error('OFFICE_ORDER_VERIFY_FAILED',409);
      return {verified:true,revision:result.revision};
    })});
}
module.exports={registerOrderTools,TOOL_ID};
