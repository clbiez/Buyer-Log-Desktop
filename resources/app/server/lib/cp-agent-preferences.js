'use strict';
const Rules=require('../../public/cp-rules-engine');
const CP=require('../../public/cp-readiness-engine');
const {hash,error}=require('./agent-office-store');
function createCpRulePreferences(preferences,userAccess) {
  function context(profile){
    // Assistant settings/answers are personal keys; only rule stores belong
    // to the inherited workspace categories supported by Buyer Log.
    const effective=preferences.load(profile.id).entries;
    const read=key=>{try{return effective[key]?.value?JSON.parse(effective[key].value):{};}catch(_){throw error('OFFICE_RULE_STORE_UNREADABLE',409);}};
    const assistant=read('lcw.cp.assistant.v1');
    return {settings:{...CP.DEFAULT_SETTINGS,targetType:assistant.settings?.targetType==='inStore'?'inStore':'retail'},checklistEnabled:assistant.checklistSettings?.enabled!==false,answers:read('lcw.cp.checklist.v1')};
  }
  function snapshot(profile,kind) {
    const key=`lcw.cp.rules.${kind}.v1`,personal=preferences.load(profile.id),effective=preferences.effectiveWorkspaceEntries(profile.id,userAccess.roleWorkspaceEntries?.(profile)||{});
    const entry=effective.entries[key],own=personal.entries[key]||null;
    let payload={version:kind==='checklist'?2:1,rules:[],deletedRuleIds:[]};
    if(entry?.value){try{payload=JSON.parse(entry.value);}catch(_){throw error('OFFICE_RULE_STORE_UNREADABLE',409);}}
    if(!payload||!Array.isArray(payload.rules))throw error('OFFICE_RULE_STORE_UNREADABLE',409);
    return {key,own,payload,rules:Rules.mergeWithDefaults(payload.rules,payload.deletedRuleIds||[]).filter(r=>r.kind===kind),hash:hash(JSON.stringify({own,entry,deletion:personal.deletions[key]||null}))};
  }
  function saveRule(profile,rule,before) {
    if(snapshot(profile,rule.kind).hash!==before.hash)throw error('OFFICE_PREVIEW_CHANGED',409);
    const rules=before.rules.filter(r=>r.id!==rule.id).concat(rule);
    if(rules.length>100)throw error('OFFICE_RULE_CAPACITY',413);
    const payload={...before.payload,version:rule.kind==='checklist'?2:1,rules,deletedRuleIds:(before.payload.deletedRuleIds||[]).filter(id=>id!==rule.id)};
    const saved=preferences.applyEntryChanges(profile.id,{[before.key]:JSON.stringify(payload)},[],{expectedEntries:{[before.key]:before.own}});
    if(saved.rejected.length)throw error('OFFICE_RULE_SAVE_FAILED',409);
    const after=snapshot(profile,rule.kind);
    if(JSON.stringify(after.rules.find(r=>r.id===rule.id))!==JSON.stringify(rule))throw error('OFFICE_RULE_VERIFY_FAILED',409);
    return {verified:true,ruleId:rule.id,scope:'owner-personal-cp-rules',entries:{[before.key]:saved.entries[before.key]},rollbackToken:{kind:rule.kind,key:before.key,before:before.own,after:saved.entries[before.key]}};
  }
  function restoreRule(profile,token) {
    if(token.key!==`lcw.cp.rules.${token.kind}.v1`)throw error('OFFICE_ROLLBACK_INVALID',422);
    const set=token.before?{[token.key]:token.before.value}:{},remove=token.before?[]:[token.key];
    const saved=preferences.applyEntryChanges(profile.id,set,remove,{expectedEntries:{[token.key]:token.after}});
    return {verified:true,restored:true,entries:token.before?{[token.key]:saved.entries[token.key]}:{},removed:remove};
  }
  return {ruleSnapshot:snapshot,saveRule,restoreRule,context};
}
module.exports={createCpRulePreferences};
