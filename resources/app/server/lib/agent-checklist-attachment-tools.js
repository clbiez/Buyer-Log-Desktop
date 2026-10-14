'use strict';
/* Checklist evidence attachments for Office: list the attachments on scoped
   order answers and remove an attachment from an answer. Removal is the same
   answer write the CP checklist UI performs (native applyEntries with the
   answer's attachment list minus the removed item; state, note, report number
   and dates are kept). The stored file is not deleted: the answer history
   still references it, which the native deleteAttachment rule also requires,
   so the inverse can restore the exact prior answer. Adding evidence stays in
   the existing test-report import tools. */
const {object,string,array}=require('./agent-capability-contract'),{error,hash}=require('./agent-office-store'),native=require('./checklist-supplier-store'),Inverse=require('./agent-native-inverse-artifact');
const req=p=>({...object(p),required:Object.keys(p)}),text=string(),id={...string(300),minLength:1},itemId={...string(160),minLength:1},count={type:'integer',minimum:0},ok={enum:[true]},sha={...string(64),pattern:'^[a-f0-9]{64}$'};
const attachmentId={...string(32),pattern:'^[a-f0-9]{32}$'};
const meta=req({id:attachmentId,filename:text,originalName:text,mimeType:text,size:count,addedAt:text,exists:{type:'boolean'}});
const answer=req({key:text,orderKey:text,itemId:text,state:text,attachments:array(meta,40)});
const readResult=req({verified:ok,data:req({revision:count,fingerprint:sha,answers:array(answer,1000)})});
const removal=req({orderKey:id,itemId,attachmentId});
const preview=req({revision:count,sourceRevision:text,changes:array(req({key:text,attachmentId,filename:text,remaining:count}),100)});
const inverse=req({ownerId:text,expectedRevision:count,artifactId:attachmentId});
const publicMeta=item=>({id:String(item.id),filename:String(item.filename||''),originalName:String(item.originalName||''),mimeType:String(item.mimeType||''),size:Number(item.size)||0,addedAt:String(item.addedAt||''),exists:Boolean(native.getAttachmentPath(item.id))});

function registerChecklistAttachmentTools(registry,deps){
  const base={module:'cp',areas:['cp'],agentAreas:['cp'],capabilities:['CP.VIEW'],dataScope:'checklist evidence attachments of explicit current scoped order keys'};
  const assert=(ctx,source)=>{ctx.assertAuthority();if(source!==undefined&&deps.sourceRevision(ctx.profile)!==source)throw error('OFFICE_PREVIEW_CHANGED',409);};
  async function authorized(ctx,keys,write,source){const allowed=await deps.authorizedOrders(ctx.profile,{write});assert(ctx,source);if(keys.some(key=>key.startsWith('@option:')||!allowed.has(key)))throw error('OFFICE_TOOL_FORBIDDEN',403);}
  const mutate=(ctx,work)=>{if(typeof deps.withAgentMutation!=='function')throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.withAgentMutation(ctx,work);};

  registry.registerCapability({...base,id:'cp.checklist.attachments.read',operation:'READ',risk:'read',label:{tr:'Checklist eklerini oku',en:'Read checklist attachments'},
    inputSchema:{...object({orderKeys:{...array(id,100),minItems:1,uniqueItems:true},itemId}),required:['orderKeys']},outputSchema:readResult,dryRunOutputSchema:readResult,
    read:async(args,ctx)=>{const source=deps.sourceRevision(ctx.profile);await authorized(ctx,args.orderKeys,false,source);
      const store=native._read(),keys=new Set(args.orderKeys);
      const answers=Object.values(store.answers).filter(r=>keys.has(r?.orderKey)&&(!args.itemId||r.itemId===args.itemId)&&(r.attachments||[]).length)
        .sort((a,b)=>native.answerKey(a.orderKey,a.itemId).localeCompare(native.answerKey(b.orderKey,b.itemId)))
        .map(r=>({key:native.answerKey(r.orderKey,r.itemId),orderKey:r.orderKey,itemId:r.itemId,state:String(r.state||''),attachments:(r.attachments||[]).map(publicMeta)}));
      assert(ctx,source);
      return {revision:store.revision,fingerprint:hash(JSON.stringify({revision:store.revision,answers})),answers};}});

  registry.registerCapability({...base,capabilities:[...base.capabilities,'CP.EDIT'],id:'cp.checklist.attachment.remove',operation:'DELETE',risk:'write',
    label:{tr:'Checklist cevabından eki kaldır',en:'Remove attachment from checklist answer'},
    inputSchema:{...object({entries:{...array(removal,100),minItems:1}}),required:['entries']},
    dryRunOutputSchema:req({verified:ok,fingerprint:sha,preview}),
    outputSchema:req({verified:ok,data:req({revision:count,removed:count,changedKeys:array(text,100)}),rollbackToken:inverse}),
    publicPreview:s=>({revision:s.revision,sourceRevision:s.sourceRevision,changes:s.changes}),
    read:async(args,ctx)=>{const sourceRevision=deps.sourceRevision(ctx.profile);await authorized(ctx,args.entries.map(e=>e.orderKey),true,sourceRevision);
      const store=native._read(),before={},next={},seen=new Set();
      const changes=args.entries.map(e=>{
        const key=native.answerKey(e.orderKey,e.itemId),current=next[key]||store.answers[key];
        if(e.orderKey.trim()!==e.orderKey||e.itemId.trim()!==e.itemId||e.itemId.includes('::')||seen.has(key+'|'+e.attachmentId))throw error('OFFICE_TASK_INVALID',422);
        seen.add(key+'|'+e.attachmentId);
        const item=current&&(current.attachments||[]).find(a=>a.id===e.attachmentId);
        if(!item)throw error('OFFICE_NOT_FOUND',404);
        if(!before[key])before[key]={answer:store.answers[key]||null,tombstone:store.tombstones[key]||null};
        next[key]={...current,attachments:current.attachments.filter(a=>a.id!==e.attachmentId)};
        return {key,attachmentId:e.attachmentId,filename:String(item.filename||''),remaining:next[key].attachments.length};
      });
      assert(ctx,sourceRevision);
      return {revision:store.revision,sourceRevision,changes,before,next};},
    apply:async(args,ctx,s)=>{assert(ctx,s.sourceRevision);
      const artifactId=await Inverse.archive(ctx,'cp.checklist.attachment.remove',{entries:s.before,orderKeys:[...new Set(args.entries.map(e=>e.orderKey))]});
      await authorized(ctx,args.entries.map(e=>e.orderKey),true,s.sourceRevision);
      return mutate(ctx,()=>{assert(ctx,s.sourceRevision);
        // The answer is rewritten with its own state and evidence; only the attachment list changes.
        const entries=Object.values(s.next).map(r=>({orderKey:r.orderKey,itemId:r.itemId,state:r.state,note:r.note||'',reportNumber:r.reportNumber||'',actualDate:r.actualDate||'',loadDate:r.loadDate||null,supplier:r.supplier||'',itemLabel:r.itemLabel||'',attachments:r.attachments}));
        const receipt=(result,own)=>{
          const removed=args.entries.filter(e=>!(own.entries[native.answerKey(e.orderKey,e.itemId)].answer?.attachments||[]).some(a=>a.id===e.attachmentId)).length;
          const kept=Object.entries(s.next).every(([key,r])=>own.entries[key].answer&&own.entries[key].answer.state===r.state&&JSON.stringify(own.entries[key].answer.attachments.map(a=>a.id))===JSON.stringify(r.attachments.map(a=>a.id)));
          if(result.skipped||result.conflicts||removed!==args.entries.length||!kept)throw error('OFFICE_RULE_VERIFY_FAILED',409);
          return {verified:true,data:{revision:result.revision,removed,changedKeys:result.changedKeys},rollbackToken:{ownerId:ctx.ownerId,expectedRevision:result.revision,artifactId}};};
        return native.applyEntries(entries,ctx.profile,{source:'buyer_log',expectedRevision:s.revision,reserveWrites:2,assertAuthority:()=>assert(ctx,s.sourceRevision),receipt});});},
    restore:async(token,ctx)=>{if(token.ownerId!==ctx.ownerId)throw error('OFFICE_ROLLBACK_INVALID',403);
      const before=Inverse.restore(ctx,'cp.checklist.attachment.remove',token).before,sourceRevision=deps.sourceRevision(ctx.profile);
      await authorized(ctx,before.orderKeys,true,sourceRevision);
      return mutate(ctx,()=>{assert(ctx,sourceRevision);
        return native.restoreEntries({entries:before.entries,expectedRevision:token.expectedRevision},ctx.profile,{reserveWrites:1,assertAuthority:()=>assert(ctx,sourceRevision),
          receipt:(restored,own)=>{if(Object.entries(before.entries).some(([key,entry])=>hash(JSON.stringify(own.entries[key]))!==hash(JSON.stringify(entry))))throw error('OFFICE_RULE_VERIFY_FAILED',409);return restored;}});});}});
}
module.exports={registerChecklistAttachmentTools};
