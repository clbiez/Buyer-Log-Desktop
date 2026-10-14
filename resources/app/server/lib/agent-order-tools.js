'use strict';
/* Office order editor (contract v2). Adapter to the native order override
   service (db.patchOrderOverride) through the same server adapter the legacy
   app.order.update tool uses: identity, IAM edit right and shared-owner fields
   are checked by snapshotOrder; the write is CAS-bound to the orders revision,
   read back, and its exact prior override entry is archived as an owner/job/
   step-bound inverse artifact. No second business rule exists here. */
const {object,string,array}=require('./agent-capability-contract'),{error,hash}=require('./agent-office-store'),Inverse=require('./agent-native-inverse-artifact');
const {NOTE_AUTHOR_FIELDS}=require('../db');
const TOOL_ID='cp.order.update',BATCH_TOOL_ID='cp.orders.update.batch',COLUMNS_TOOL_ID='cp.notecolumns.update',BATCH_MAX=50;
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
  if(Boolean(patch.model)!==Boolean(patch.ccode))throw error('OFFICE_ORDER_IDENTITY',409);
  return {patch,fields};
}
// Native adapter codes become Office codes with TR/EN texts.
const NATIVE_CODES={ORDER_FORBIDDEN:['OFFICE_TOOL_FORBIDDEN',403],ORDER_SHARED_OWNER_ONLY:['OFFICE_ORDER_SHARED_OWNER',403]};
async function nativeCall(work){try{return await work();}catch(err){const mapped=NATIVE_CODES[err&&err.code];if(mapped)throw error(mapped[0],mapped[1]);throw err;}}
function registerOrderTools(registry,deps){
  const mutate=(ctx,work)=>{if(!deps.withAgentMutation)throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.withAgentMutation(ctx,work);};
  async function read(args,ctx){
    ctx.assertAuthority?.();
    const {patch,fields}=patchOf(args),snapshot=await nativeCall(()=>deps.snapshotOrder(ctx.ownerId,ctx.profile,args.orderCode,patch));
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
        const selector={model:p.patch.model,ccode:p.patch.ccode};
        const result=await nativeCall(()=>deps.updateOrder(ctx.ownerId,ctx.profile,args.orderCode,p.patch,p.revision,{noteColumnDefsRevision:p.patch.noteColumns?p.receipt.noteColumnDefsRevision:undefined}));
        if(result.verified!==true)throw error('OFFICE_ORDER_VERIFY_FAILED',409);
        // The inverse is bound to the exact post-effect state of the line, which
        // also covers peer edits that reach the overlay without a local revision.
        const afterMaps=hash(JSON.stringify(deps.currentOrderMaps(args.orderCode,selector)));
        return {verified:true,data:{orderCode:args.orderCode,revision:result.revision,fields:p.fields},
          rollbackToken:{artifactId,orderCode:args.orderCode,selector,expectedRevision:result.revision,afterMaps}};
      });
    },
    restore:(token,ctx)=>mutate(ctx,async()=>{
      const bound=Inverse.restore(ctx,TOOL_ID,token);
      if(hash(JSON.stringify(deps.currentOrderMaps(bound.orderCode,bound.selector)))!==token.afterMaps)throw error('OFFICE_PREVIEW_CHANGED',409);
      const result=await nativeCall(()=>deps.restoreOrder(ctx.ownerId,ctx.profile,bound.orderCode,bound.before,bound.expectedRevision,bound.selector));
      if(result.verified!==true)throw error('OFFICE_ORDER_VERIFY_FAILED',409);
      return {verified:true,revision:result.revision};
    })});

  /* Multi-line edit: each line passes the same identity/IAM/shared-owner/
     note-column checks as a single edit; all lines are written in one native
     batch (one orders revision) and undone together in one write. */
  const lineKey=entry=>[entry.orderCode,String(entry.model||'').trim(),String(entry.ccode||'').trim()].join('|');
  const lineView=line=>({orderCode:line.orderCode,patch:line.patch,fields:line.fields});
  const batchPreview={...object({revision:count,lines:array({...object({orderCode:{type:'integer',minimum:1},patch:patchSchema,fields:preview.properties.fields}),required:['orderCode','patch','fields']},BATCH_MAX)}),required:['revision','lines']};
  async function readBatch(args,ctx){
    ctx.assertAuthority?.();
    const lines=args.entries.map(entry=>({orderCode:entry.orderCode,...patchOf(entry)}));
    if(new Set(args.entries.map(lineKey)).size!==lines.length)throw error('OFFICE_TASK_INVALID',422);
    const snapshots=await nativeCall(()=>deps.snapshotOrders(ctx.ownerId,ctx.profile,lines.map(line=>({orderCode:line.orderCode,patch:line.patch}))));
    if(new Set(snapshots.map(snap=>snap.revision)).size!==1)throw error('OFFICE_PREVIEW_CHANGED',409);
    ctx.assertAuthority?.();
    return {revision:snapshots[0].revision,lines:lines.map((line,i)=>({...line,receipt:snapshots[i].patch}))};
  }
  registry.registerCapability({id:BATCH_TOOL_ID,module:'cp',operation:'UPDATE',risk:'write',areas:['cp'],agentAreas:['cp'],
    label:{tr:'Birden çok sipariş satırını birlikte düzenle',en:'Edit several order lines together'},
    dataScope:'explicit current-IAM-editable CP order lines; native batch order override service',
    inputSchema:{...object({entries:{...array(inputSchema,BATCH_MAX),minItems:1}}),required:['entries']},
    outputSchema:{...object({verified:{enum:[true]},data:{...object({revision:count,lines:count}),required:['revision','lines']},rollbackToken:{type:'object'}}),required:['verified','data','rollbackToken']},
    dryRunOutputSchema:{...object({verified:{enum:[true]},preview:batchPreview,fingerprint:string(64)}),required:['verified','preview','fingerprint']},
    read:readBatch,publicPreview:snapshot=>({revision:snapshot.revision,lines:snapshot.lines.map(lineView)}),
    apply:async(args,ctx,p)=>{
      const artifactId=await Inverse.archive(ctx,BATCH_TOOL_ID,{lines:p.lines.map(line=>line.receipt)});
      return mutate(ctx,async()=>{
        const withColumns=p.lines.some(line=>line.patch.noteColumns);
        const result=await nativeCall(()=>deps.updateOrders(ctx.ownerId,ctx.profile,p.lines.map(line=>({orderCode:line.orderCode,patch:line.patch})),p.revision,{noteColumnDefsRevision:withColumns?p.lines[0].receipt.noteColumnDefsRevision:undefined}));
        if(result.verified!==true)throw error('OFFICE_ORDER_VERIFY_FAILED',409);
        const lines=p.lines.map(line=>({orderCode:line.orderCode,selector:{model:line.patch.model,ccode:line.patch.ccode}}));
        const afterMaps=hash(JSON.stringify(lines.map(line=>deps.currentOrderMaps(line.orderCode,line.selector))));
        return {verified:true,data:{revision:result.revision,lines:lines.length},rollbackToken:{artifactId,lines,expectedRevision:result.revision,afterMaps}};
      });
    },
    restore:(token,ctx)=>mutate(ctx,async()=>{
      const bound=Inverse.restore(ctx,BATCH_TOOL_ID,token),receipts=bound.before&&bound.before.lines||[];
      if(!Array.isArray(token.lines)||receipts.length!==token.lines.length)throw error('OFFICE_ROLLBACK_INVALID',409);
      if(hash(JSON.stringify(token.lines.map(line=>deps.currentOrderMaps(line.orderCode,line.selector))))!==token.afterMaps)throw error('OFFICE_PREVIEW_CHANGED',409);
      const result=await nativeCall(()=>deps.restoreOrders(ctx.ownerId,ctx.profile,token.lines.map((line,i)=>({orderCode:line.orderCode,selector:line.selector,before:receipts[i]})),token.expectedRevision));
      if(result.verified!==true)throw error('OFFICE_ORDER_VERIFY_FAILED',409);
      return {verified:true,revision:result.revision};
    })});

  /* Note-column definitions (CP › Add Column): the full shared list, as the
     native editor saves it. A removed column's values are pruned natively;
     the inverse restores the exact prior list and those values, and is refused
     once a value was entered in a column the inverse would remove. */
  const columnSpec={...object({id:{...string(40),pattern:'^[A-Za-z0-9_-]{1,40}$'},label:{...string(80),minLength:1,pattern:'\\S'},labelTr:string(80),labelEn:string(80),group:string(40)}),required:['label']};
  const columnView={...object({id:string(40),label:string(80),labelTr:string(80),labelEn:string(80),group:string(40)}),required:['id','label']};
  const idList=array(string(40),40);
  const columnsPreview={...object({revision:count,columns:array(columnView,40),added:idList,removed:idList,changed:idList,removedValueLines:count}),required:['revision','columns','added','removed','changed','removedValueLines']};
  const labelKey=value=>String(value||'').replace(/\s+/g,' ').trim().toLocaleLowerCase('tr');
  async function readColumns(args,ctx){
    ctx.assertAuthority?.();
    const current=deps.noteColumns.snapshot([]),byLabel=new Map(current.defs.map(def=>[labelKey(def.label),def.id]));
    const wanted=args.columns.map(column=>({...column,id:column.id||byLabel.get(labelKey(column.label))||'note_'+hash('note-column:'+labelKey(column.label)).slice(0,8)}));
    const next=deps.noteColumns.normalize(wanted);
    // The native normalizer drops duplicates silently; an approval must not.
    if(next.length!==wanted.length||next.some((def,i)=>def.id!==wanted[i].id))throw error('OFFICE_TASK_INVALID',422);
    const before=new Map(current.defs.map(def=>[def.id,def])),after=new Set(next.map(def=>def.id));
    const added=next.filter(def=>!before.has(def.id)).map(def=>def.id),removed=current.defs.filter(def=>!after.has(def.id)).map(def=>def.id);
    const changed=next.filter(def=>before.has(def.id)&&JSON.stringify(before.get(def.id))!==JSON.stringify(def)).map(def=>def.id);
    if(!added.length&&!removed.length&&!changed.length&&JSON.stringify(current.defs.map(def=>def.id))===JSON.stringify(next.map(def=>def.id)))throw error('OFFICE_TASK_INVALID',422);
    const pruned=deps.noteColumns.snapshot(removed);
    ctx.assertAuthority?.();
    return {revision:current.revision,columns:next,added,removed,changed,removedValueLines:Object.keys(pruned.values).length,before:current.defs,removedValues:pruned.values};
  }
  registry.registerCapability({id:COLUMNS_TOOL_ID,module:'cp',operation:'UPDATE',risk:'write',areas:['cp'],agentAreas:['cp'],
    label:{tr:'Not sütunu tanımlarını düzenle',en:'Edit note column definitions'},
    dataScope:'shared CP/Orders note-column definitions; values of removed columns',
    inputSchema:{...object({columns:array(columnSpec,40)}),required:['columns']},
    outputSchema:{...object({verified:{enum:[true]},data:{...object({revision:count,columns:count}),required:['revision','columns']},rollbackToken:{type:'object'}}),required:['verified','data','rollbackToken']},
    dryRunOutputSchema:{...object({verified:{enum:[true]},preview:columnsPreview,fingerprint:string(64)}),required:['verified','preview','fingerprint']},
    read:readColumns,publicPreview:({before,removedValues,...view})=>view,
    apply:async(_args,ctx,p)=>{
      const artifactId=await Inverse.archive(ctx,COLUMNS_TOOL_ID,{defs:p.before,values:p.removedValues});
      return mutate(ctx,()=>{
        // No await between this check and the native write.
        const now=deps.noteColumns.snapshot(p.removed);
        if(now.revision!==p.revision||JSON.stringify(now.values)!==JSON.stringify(p.removedValues))throw error('OFFICE_PREVIEW_CHANGED',409);
        const saved=deps.noteColumns.replace(ctx.profile,p.columns,p.revision);
        if(JSON.stringify(saved.columns)!==JSON.stringify(p.columns))throw error('OFFICE_ORDER_VERIFY_FAILED',409);
        return {verified:true,data:{revision:saved.revision,columns:saved.columns.length},rollbackToken:{artifactId,expectedRevision:saved.revision,added:p.added,removed:p.removed}};
      });
    },
    restore:(token,ctx)=>mutate(ctx,()=>{
      const bound=Inverse.restore(ctx,COLUMNS_TOOL_ID,token),before=bound.before||{};
      const now=deps.noteColumns.snapshot(token.added||[]);
      if(now.revision!==token.expectedRevision||Object.keys(now.values).length)throw error('OFFICE_PREVIEW_CHANGED',409);
      const saved=deps.noteColumns.restore(ctx.profile,before,token.expectedRevision);
      const back=deps.noteColumns.snapshot(token.removed||[]);
      if(JSON.stringify(saved.columns)!==JSON.stringify(before.defs)||JSON.stringify(back.values)!==JSON.stringify(before.values||{}))throw error('OFFICE_ORDER_VERIFY_FAILED',409);
      return {verified:true,revision:saved.revision};
    })});
}
module.exports={registerOrderTools,TOOL_ID,BATCH_TOOL_ID,COLUMNS_TOOL_ID};
