'use strict';
/* Office adapter for the native Preset Share (user menu › Preset Sharing):
   Focus/Extended presets, column layout, created columns, Horizon filters,
   views and filter profiles. The requesting owner only ever writes to their
   own workspace; the source user's record is read only. The same
   preset-share plan/commit service is used; no second merge rule exists.
   The inverse is the exact prior state of every touched key and profile
   store, bound to the owner/job/step and refused if anything changed after
   the effect. */
const crypto=require('node:crypto');
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store'),Inverse=require('./agent-native-inverse-artifact');
const {SHARE_ITEM_IDS,profileDigest}=require('./preset-share');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value===undefined?null:value)).digest('hex');
const userId={...string(160),minLength:1,pattern:'^[^\\s]+$'};
const itemIds={...array({enum:[...SHARE_ITEM_IDS]},SHARE_ITEM_IDS.length),minItems:1,uniqueItems:true};
const count={type:'integer',minimum:0};
const keyList=array(string(300),5000);
const user=object({id:string(160),name:string(200),title:string(200),role:string(200)});
const shareItem=object({id:{enum:[...SHARE_ITEM_IDS]},labelTr:string(200),labelEn:string(200),hintTr:string(400),hintEn:string(400),defaultSelected:{type:'boolean'},count,pages:array(string(80),200),profileCount:count});
const readOutput={...object({verified:{enum:[true]},data:object({users:array(user,2000),sourceUserId:string(160),items:array(shareItem,SHARE_ITEM_IDS.length)})}),required:['verified','data']};
const applyPreview={...object({sourceUserId:string(160),sourceName:string(200),mode:{enum:['MERGE','REPLACE']},items:array({enum:[...SHARE_ITEM_IDS]},SHARE_ITEM_IDS.length),changed:{type:'boolean'},setKeys:keyList,removedKeys:keyList,profiles:array({enum:['views','filters']},2)}),required:['sourceUserId','mode','items','changed','setKeys','removedKeys','profiles']};

function registerPresetTools(registry,deps){
  const base={module:'overview',areas:['overview'],agentAreas:['overview'],dataScope:'requesting owner personal presentation preferences only; source user record read-only; no permissions, data scope or applied Horizon snapshot'};
  const mutate=(ctx,work)=>{if(!deps.withAgentMutation)throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.withAgentMutation(ctx,work);};
  const owner=ctx=>{ctx.assertAuthority?.();if(!ctx.profile||ctx.ownerId!==ctx.profile.id)throw error('OFFICE_TOOL_FORBIDDEN',403);};
  const source=(ctx,id)=>{const profile=deps.sourceProfile(id);if(!profile)throw error('OFFICE_NOT_FOUND',404);if(profile.id===ctx.profile.id)throw error('OFFICE_TASK_INVALID',422);return profile;};
  registry.registerCapability({...base,id:'presets.share.read',operation:'READ',risk:'read',
    label:{tr:'Paylaşılabilir ön ayarları oku',en:'Read shareable presets'},
    inputSchema:object({sourceUserId:userId}),outputSchema:readOutput,dryRunOutputSchema:readOutput,
    read:async(args,ctx)=>{owner(ctx);
      if(!args.sourceUserId)return {users:deps.users(ctx.profile),sourceUserId:'',items:[]};
      const from=source(ctx,args.sourceUserId);return {users:[],sourceUserId:from.id,items:deps.presetShare.preview(from.id)};}});

  async function plan(args,ctx){
    owner(ctx);const from=source(ctx,args.sourceUserId);
    const planned=deps.presetShare.plan({sourceUserId:from.id,targetUserId:ctx.profile.id,items:args.items,mode:args.mode});
    const currentProfiles=Object.fromEntries(Object.keys(planned.nextProfiles).map(kind=>[kind,profileDigest(planned.previousProfiles[kind])]));
    ctx.assertAuthority?.();
    // Fingerprint inputs: the exact keys, values and the target's current state.
    // Profile copies carry a fresh updatedAt per plan, so the time stamp is not
    // part of the binding; the plan itself is attached non-enumerably and is
    // therefore excluded from the hashed snapshot.
    const stable=Object.fromEntries(Object.entries(planned.nextProfiles).map(([kind,store])=>[kind,{...store,items:(store.items||[]).map(({updatedAt,...item})=>item)}]));
    const snapshot={sourceName:deps.displayName(from),
      binding:{source:planned.source,mode:planned.mode,items:planned.items,set:digest(planned.set),remove:[...planned.remove].sort(),targetEntries:digest(planned.targetEntries),profiles:currentProfiles,next:digest(stable)}};
    Object.defineProperty(snapshot,'planned',{value:planned,enumerable:false});
    return snapshot;
  }
  const publicPreview=snapshot=>{const p=snapshot.planned;return {sourceUserId:p.source,sourceName:snapshot.sourceName,mode:p.mode,items:p.items,changed:Object.keys(p.set).length+p.remove.length+Object.keys(p.nextProfiles).length>0,setKeys:Object.keys(p.set).sort(),removedKeys:[...p.remove].sort(),profiles:Object.keys(p.nextProfiles).sort()};};
  registry.registerCapability({...base,id:'presets.share.apply',operation:'UPDATE',risk:'write',
    label:{tr:'Başka kullanıcının ön ayarlarını al',en:'Take another user\'s presets'},
    inputSchema:{...object({sourceUserId:userId,items:itemIds,mode:{enum:['MERGE','REPLACE']}}),required:['sourceUserId','items','mode']},
    outputSchema:{...object({verified:{enum:[true]},data:applyPreview,rollbackToken:{type:'object'}}),required:['verified','data']},
    dryRunOutputSchema:{...object({verified:{enum:[true]},preview:applyPreview,fingerprint:string(64)}),required:['verified','preview','fingerprint']},
    read:plan,publicPreview,
    apply:async(args,ctx,snapshot)=>{
      const p=snapshot.planned,view=publicPreview(snapshot);
      if(!view.changed)return {verified:true,data:view};
      const artifactId=await Inverse.archive(ctx,'presets.share.apply',{entries:p.targetEntries,profiles:p.previousProfiles});
      return mutate(ctx,async()=>{
        const result=deps.presetShare.commit(p,{expectedEntries:p.targetEntries,expectedProfiles:snapshot.binding.profiles,assertAuthority:ctx.assertAuthority});
        const after=deps.presetShare.storedEntries(ctx.profile.id,[...Object.keys(p.set),...p.remove]);
        const verified=Object.entries(p.set).every(([key,value])=>after[key]&&after[key].value===value)&&p.remove.every(key=>!after[key]);
        if(!verified||result.changed!==true)throw error('OFFICE_PRESET_VERIFY_FAILED',409);
        const profiles=Object.keys(p.nextProfiles).length?deps.loadProfiles(ctx.profile.id):{};
        return {verified:true,data:view,rollbackToken:{artifactId,nativeUndoCreatedAt:result.createdAt||null,afterEntries:Object.fromEntries([...Object.keys(p.set),...p.remove].map(key=>[key,digest(after[key]||null)])),afterProfiles:Object.fromEntries(Object.keys(p.nextProfiles).map(kind=>[kind,profileDigest(profiles[kind])]))}};
      });
    },
    restore:(token,ctx)=>mutate(ctx,async()=>{
      owner(ctx);const bound=Inverse.restore(ctx,'presets.share.apply',token),before=bound.before||{};
      const current=Object.keys(token.afterProfiles||{}).length?deps.loadProfiles(ctx.profile.id):{};
      for(const [kind,hash]of Object.entries(token.afterProfiles||{}))if(profileDigest(current[kind])!==hash)throw error('OFFICE_PREVIEW_CHANGED',409);
      // The token keeps only digests of the post-effect entries; the current
      // entries must still be exactly those, and the write is CAS-bound to them.
      const live=deps.presetShare.storedEntries(ctx.profile.id,Object.keys(token.afterEntries||{})),expectedEntries={};
      for(const [key,hash]of Object.entries(token.afterEntries||{})){if(digest(live[key]||null)!==hash)throw error('OFFICE_PREVIEW_CHANGED',409);expectedEntries[key]=live[key]||null;}
      const set={},remove=[];
      for(const [key,entry]of Object.entries(before.entries||{})){if(entry)set[key]=entry.value;else remove.push(key);}
      deps.applyEntryChanges(ctx.profile.id,set,remove,{expectedEntries,assertAuthority:ctx.assertAuthority});
      if(Object.keys(before.profiles||{}).length)deps.restoreProfiles(ctx.profile.id,before.profiles);
      const now=deps.presetShare.storedEntries(ctx.profile.id,Object.keys(before.entries||{}));
      const verified=Object.entries(before.entries||{}).every(([key,entry])=>entry?now[key]&&now[key].value===entry.value:!now[key]);
      if(!verified)throw error('OFFICE_PRESET_VERIFY_FAILED',409);
      if(token.nativeUndoCreatedAt)deps.presetShare.discardUndo(ctx.profile.id,token.nativeUndoCreatedAt);
      return {verified:true};
    })});
}
module.exports={registerPresetTools};
