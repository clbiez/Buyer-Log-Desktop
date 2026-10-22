'use strict';
// The normal License Cards screen and agent adapters share this transaction.
// Profile/rate validation and discovery remain in the existing card engine.
const cards=require('./license-cards'),sync=require('./license-card-sync'),pricing=require('./resource-rule-service');
const {hash,error}=require('./operation-utils');
const clone=value=>JSON.parse(JSON.stringify(value));
function sectionSnapshot(overrides){return {revision:cards.revisionOf(overrides,'licenseCards'),pricingRevision:cards.revisionOf(overrides,'pricingRules'),fingerprint:hash(JSON.stringify({cards:cards.stateOf(overrides),rules:overrides.pricingRules||[]}))};}
function assertSnapshot(overrides,expected){if(expected && JSON.stringify(sectionSnapshot(overrides))!==JSON.stringify(expected))throw error('OFFICE_PREVIEW_CHANGED',409);}
function createLicenseCardService(deps){
 const load=()=>deps.loadOverrides({projectManufacturers:false}),validators=deps.pricing||pricing;
 const mutate=work=>deps.mutate?deps.mutate('licenseCards',work):work({commit:async()=>{}});
 const read=()=>cards.responseOf(load(),false);
 async function published(profile,change){if(!deps.publish)return Object.keys(load().licenseCardOutbox||{}).length>0;try{const result=await deps.publish(profile,change);return Boolean(result?.pending||result?.ok===false);}catch(_){return true;}}
 async function notify(profile,change,saved,context){await deps.changed?.(profile,'licenseCards',{revision:cards.revisionOf(saved,'licenseCards'),cardId:change.card?.id,added:change.added},context);if(change.rulesChanged)await deps.changed?.(profile,'pricingRules',{revision:cards.revisionOf(saved,'pricingRules'),changedLicenses:[...new Set((change.cards||[change.card]).map(card=>card.license))]},context);}
 async function discovery(profile,{assertAuthority}={}){
   assertAuthority?.();const rows=await deps.getDiscoveryRows(profile);assertAuthority?.();
   const sourceStamp=rows?.sourceStamp??deps.discoveryStamp?.(profile)??'';if(deps.discoveryStamp&&deps.discoveryStamp(profile)!==sourceStamp)throw error('OFFICE_PREVIEW_CHANGED',409);
   const current=load(),pairs=cards.discoverPairs(rows);
   const before=cards.stateOf(current),next=cards.appendDiscovered(current,pairs,'').overrides;
   return {snapshot:sectionSnapshot(current),pairs,sourceStamp,added:cards.stateOf(next).items.length-before.items.length,resolved:cards.stateOf(next).items.filter(card=>before.items.some(previous=>previous.id===card.id&&previous.licensor!==card.licensor)).map(card=>({id:card.id,license:card.license,licensor:card.licensor})),initialized:before.initialized};
 }
 async function discover(profile,{assertAuthority,expected,force=true,originClientId=''}={}){
   if(!force&&cards.stateOf(load()).initialized)return {saved:load(),added:0,syncPending:Object.keys(load().licenseCardOutbox||{}).length>0};
   const preview=expected||await discovery(profile,{assertAuthority});let change;
   const result=await mutate(async lease=>{
     assertAuthority?.();const current=load();if(!force&&cards.stateOf(current).initialized)return {saved:current,added:0,noEffect:true};
     const guard=()=>{assertAuthority?.();if(deps.discoveryStamp&&deps.discoveryStamp(profile)!==preview.sourceStamp)throw error('OFFICE_PREVIEW_CHANGED',409);};guard();assertSnapshot(load(),preview.snapshot);
     const imported=cards.appendDiscovered(current,preview.pairs),previous=new Map(cards.stateOf(current).items.map(card=>[card.id,JSON.stringify(card)]));
     change={cards:cards.stateOf(imported.overrides).items.filter(card=>previous.get(card.id)!==JSON.stringify(card)),initialized:true,lastImportedAt:cards.stateOf(imported.overrides).lastImportedAt,actorId:profile.id,added:imported.added};
     const staged=deps.publish?sync.stageChange(imported.overrides,change):imported.overrides;
     const saved=deps.saveOverrides(staged,Number(current._revision)||0,{...lease,assertAuthority:guard});await lease.commit();
     if(sectionSnapshot(load()).fingerprint!==sectionSnapshot(saved).fingerprint)throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);
     return {saved,added:imported.added};
   });
   if(result.noEffect)return {...result,syncPending:Object.keys(load().licenseCardOutbox||{}).length>0};
   const syncPending=await published(profile,change);await notify(profile,change,result.saved,{originClientId});return {...result,syncPending,resolved:preview.resolved?.length||0,discovered:preview.pairs?.length||0,sourceStamp:preview.sourceStamp||''};
 }
 function updatePreview(id,body){
   const current=load(),snapshot=sectionSnapshot(current),before=cards.stateOf(current).items.find(card=>card.id===id);
   const result=cards.updateCard(current,id,{...body,revision:snapshot.revision,pricingRevision:snapshot.pricingRevision},validators,before?.updatedAt||'');
   return {snapshot,card:result.card,rulesChanged:result.rulesChanged,rules:result.overrides.pricingRules||[]};
 }
 async function update(profile,id,body,{assertAuthority,expected,originClientId=''}={}){
   let change;
   const saved=await mutate(async lease=>{
     const guard=()=>{assertAuthority?.();};guard();assertSnapshot(load(),expected);const current=load(),result=cards.updateCard(current,id,body,validators);
     change={card:result.card,rulesChanged:result.rulesChanged,...(result.rulesChanged?{contracts:cards.responseOf(result.overrides,true).cards.find(card=>card.id===id).rules}:{}),initialized:cards.stateOf(result.overrides).initialized,lastImportedAt:cards.stateOf(result.overrides).lastImportedAt,actorId:profile.id};
     const staged=deps.publish?sync.stageChange(result.overrides,change):result.overrides,actual=deps.saveOverrides(staged,Number(current._revision)||0,{...lease,assertAuthority:guard});await lease.commit();
     if(sectionSnapshot(load()).fingerprint!==sectionSnapshot(actual).fingerprint)throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);return actual;
   });
   const syncPending=await published(profile,change);await notify(profile,change,saved,{originClientId});return {saved,card:change.card,rulesChanged:change.rulesChanged,syncPending};
 }
 // Process Studio may touch several trees. Validate every card before one durable write.
 async function updateAtlasBatch(profile,entries,{assertAuthority,originClientId=''}={}){
   if(!Array.isArray(entries)||!entries.length||entries.length>200||new Set(entries.map(e=>e?.id)).size!==entries.length)throw error('LICENSE_ATLAS_INVALID',400);
   let change;
   const saved=await mutate(async lease=>{
     const guard=()=>{assertAuthority?.();};guard();const current=load();let next=current;const changed=[],contractsByCard={};let rulesChanged=false;
     for(const entry of entries){
       if(!entry||typeof entry.id!=='string'||typeof entry.editToken!=='string'||!entry.processAtlas)throw error('LICENSE_ATLAS_INVALID',400);
       // Details and Atlas changes share one validated, optimistic transaction.
       const result=cards.updateCard(next,entry.id,{editToken:entry.editToken,profile:{...(entry.profile||{}),processAtlas:entry.processAtlas},...(Object.hasOwn(entry,'rules')?{rules:entry.rules}:{})},validators);
       next=result.overrides;changed.push(result.card);if(result.rulesChanged){rulesChanged=true;contractsByCard[entry.id]=cards.responseOf(next,true).cards.find(c=>c.id===entry.id).rules;}
     }
     next._revisions.licenseCards=cards.revisionOf(current,'licenseCards')+1;
     if(rulesChanged)next._revisions.pricingRules=cards.revisionOf(current,'pricingRules')+1;
     change={cards:changed,rulesChanged,contractsByCard,initialized:cards.stateOf(next).initialized,lastImportedAt:cards.stateOf(next).lastImportedAt,actorId:profile.id};
     const staged=deps.publish?sync.stageChange(next,change):next;
     const actual=deps.saveOverrides(staged,Number(current._revision)||0,{...lease,assertAuthority:guard});await lease.commit();
     if(sectionSnapshot(load()).fingerprint!==sectionSnapshot(actual).fingerprint)throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);return actual;
   });
   const syncPending=await published(profile,change);await notify(profile,change,saved,{originClientId});return {saved,syncPending,updated:change.cards.length};
 }
 function inverseSnapshot(id,includeRules){const current=load(),card=cards.stateOf(current).items.find(item=>item.id===id);if(!card)throw error('OFFICE_NOT_FOUND',404);return {card:clone(card),...(includeRules?{rules:clone(current.pricingRules||[])}:{})};}
 async function restore(profile,receipt,expected,{assertAuthority}={}){
   let change;
   const saved=await mutate(async lease=>{
     const guard=()=>{assertAuthority?.();};guard();assertSnapshot(load(),expected);const current=load(),state=clone(cards.stateOf(current)),index=state.items.findIndex(card=>card.id===receipt.card?.id);
     if(index<0||cards.pairKey(state.items[index].license,state.items[index].licensor)!==cards.pairKey(receipt.card.license,receipt.card.licensor))throw error('OFFICE_ROLLBACK_INVALID',409);
     // The receipt is an immutable owner artifact, never caller/model data.
     const card=sync.profileSnapshot(receipt.card);state.items[index]=clone(receipt.card);
     const next={...current,licenseCards:state,_revisions:{...current._revisions,licenseCards:cards.revisionOf(current,'licenseCards')+1}};
     if(receipt.rules){const pair=cards.pairKey(card.license,card.licensor),associated=receipt.rules.filter(rule=>cards.pairKey(rule.license,rule.licensor)===pair);cards.mergeRules(receipt.rules.filter(rule=>cards.pairKey(rule.license,rule.licensor)!==pair),cards.normalizeRules(associated,card,validators),card,validators);next.pricingRules=clone(receipt.rules);next._revisions.pricingRules=cards.revisionOf(current,'pricingRules')+1;}
     change={card,rulesChanged:!!receipt.rules,...(receipt.rules?{contracts:cards.responseOf(next,true).cards.find(item=>item.id===card.id).rules}:{}),initialized:state.initialized,lastImportedAt:state.lastImportedAt,actorId:profile.id};
     const staged=deps.publish?sync.stageChange(next,change):next,actual=deps.saveOverrides(staged,Number(current._revision)||0,{...lease,assertAuthority:guard});await lease.commit();
     if(sectionSnapshot(load()).fingerprint!==sectionSnapshot(actual).fingerprint)throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);return actual;
   });
   const syncPending=await published(profile,change);await notify(profile,change,saved);return {saved,syncPending};
 }
 // Licensor assignment and stage templates: one validated write, peers get every changed card.
 async function writeCards(profile,compute,{assertAuthority,originClientId=''}={}){
   let change;
   const saved=await mutate(async lease=>{
     const guard=()=>{assertAuthority?.();};guard();const current=load(),result=compute(current);
     change={cards:result.cards,rulesChanged:Boolean(result.rulesChanged),...(result.licensorMerges?{licensorMerges:result.licensorMerges}:{}),initialized:cards.stateOf(result.overrides).initialized,lastImportedAt:cards.stateOf(result.overrides).lastImportedAt,actorId:profile.id,...(result.stageTemplates?{stageTemplates:result.stageTemplates}:{})};
     const staged=deps.publish?sync.stageChange(result.overrides,change):result.overrides,actual=deps.saveOverrides(staged,Number(current._revision)||0,{...lease,assertAuthority:guard});await lease.commit();
     if(sectionSnapshot(load()).fingerprint!==sectionSnapshot(actual).fingerprint)throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);return actual;
   });
   const syncPending=await published(profile,change);await notify(profile,change,saved,{originClientId});return {saved,syncPending,cards:change.cards};
 }
 const setLicensor=(profile,id,body,opts)=>writeCards(profile,current=>{const r=cards.setLicensor(current,id,body);return {overrides:r.overrides,cards:[r.card]};},opts);
 const saveTemplate=(profile,body,opts)=>writeCards(profile,current=>{const r=cards.saveTemplate(current,body);return {overrides:r.overrides,cards:r.cards,stageTemplates:cards.templatesOf(r.overrides)};},opts);
 const setLicensorMerge=(profile,body,opts)=>writeCards(profile,current=>{const r=cards.setLicensorMerge(current,body);return {overrides:r.overrides,cards:[],rulesChanged:true,licensorMerges:cards.licensorMergesOf(r.overrides)};},opts);
 const deleteTemplate=(profile,id,body,opts)=>writeCards(profile,current=>{const r=cards.deleteTemplate(current,id,body);return {overrides:r.overrides,cards:r.cards,stageTemplates:cards.templatesOf(r.overrides)};},opts);
 return {read,discovery,discover,updatePreview,update,updateAtlasBatch,setLicensor,setLicensorMerge,saveTemplate,deleteTemplate,inverseSnapshot,restore,snapshot:()=>sectionSnapshot(load())};
}
module.exports={createLicenseCardService,sectionSnapshot};
