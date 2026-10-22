'use strict';

// Only license-card profiles and their own contracts travel on the peer channel.
// Other working rules retain the Moderator Master publication policy.
const crypto = require('node:crypto');
const cards = require('./license-cards');
const COLLECTION = 'license-card';
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = id => /^license-[a-f0-9]{24}$/.test(String(id));
const TEMPLATES_ID = 'stage-templates';

function profileSnapshot(card) {
  if (!card || !validId(card.id) || !card.license || String(card.license).length > 200 || String(card.licensor || '').length > 200) throw new Error('LICENSE_CARD_SYNC_INVALID');
  const profile = Object.fromEntries([...Object.keys(cards.PROFILE_LIMITS), 'symbolDataUrl', 'processAtlas'].filter(key => Object.hasOwn(card, key)).map(key => [key, card[key]]));
  return { id:card.id, license:String(card.license), licensor:String(card.licensor || ''), ...cards.normalizeProfile(profile), createdAt:card.createdAt || '', updatedAt:card.updatedAt || '' };
}

function stageChange(overrides, change) {
  const outbox=clone(overrides.licenseCardOutbox || {});
  const stage=(id,fields)=>{outbox[id]={actorId:String(change.actorId||''),fields:{...(outbox[id]?.fields||{}),...fields}};};
  for(const card of change.cards||(change.card?[change.card]:[])){
    const fields={profile:profileSnapshot(card)};
    const contracts=change.contractsByCard?.[card.id]||change.contracts;
    if(contracts)fields.contracts={pair:cards.pairKey(card.license,card.licensor),rules:clone(contracts)};
    stage(card.id,fields);
  }
  if(change.initialized)stage('state',{initialized:true,lastImportedAt:change.lastImportedAt||null});
  // Stage templates travel as one record; clients without template support skip unknown ids.
  if(change.stageTemplates)stage(TEMPLATES_ID,{templates:clone(change.stageTemplates)});
  return {...overrides,licenseCardOutbox:outbox};
}

function replaceContracts(existing, incoming, card, deps){
  const pair=cards.pairKey(card.license,card.licensor),isPair=rule=>cards.pairKey(rule.license,rule.licensor)===pair;
  // A peer message is a complete snapshot; local card editing retains history
  // before publishing it. A deletion in the legacy calculator must also arrive.
  cards.mergeRules(existing.filter(rule=>!isPair(rule)),incoming,card,deps);
  let inserted=false;const next=[];
  for(const rule of existing){if(isPair(rule)){if(!inserted){next.push(...incoming);inserted=true;}}else next.push(rule);}
  if(!inserted)next.push(...incoming);
  return next;
}

function applyRecords(overrides, records, deps) {
  const next = clone(overrides), state = clone(cards.stateOf(overrides));
  const applied = { ...(overrides.licenseCardPeerApplied || {}) };
  let profilesChanged = false, rulesChanged = false, metadataChanged = false;
  const byId = new Map(state.items.map((card, index) => [card.id, index]));
  for (const [id, record] of Object.entries(records || {})) {
    if(overrides.licenseCardOutbox?.[id])continue;
    if (id === 'state') {
      if (record.initialized === true && !state.initialized) { state.initialized = true; profilesChanged = true; }
      if (record.lastImportedAt && (!state.lastImportedAt || record.lastImportedAt > state.lastImportedAt)) { state.lastImportedAt = record.lastImportedAt; profilesChanged = true; }
      continue;
    }
    if (id === TEMPLATES_ID) {
      const incoming = record && record.templates, local = cards.templatesOf(next);
      if (incoming && Array.isArray(incoming.items) && String(incoming.updatedAt || '') > String(local.updatedAt || '')) {
        // Templates replace as a whole (newest wins); the linked stages arrive as card profiles.
        const items = [];for (const item of incoming.items.slice(0, 60)) { try { items.push(cards.normalizeTemplate(item, String(item.updatedAt || incoming.updatedAt))); } catch (_) { /* skip an invalid peer template */ } }
        next.licenseStageTemplates = { items, updatedAt: String(incoming.updatedAt) };
        metadataChanged = true; profilesChanged = true;
      }
      continue;
    }
    if (!validId(id) || !record || record._deleted) continue;
    const checkpoint = { ...(applied[id] || {}) };
    if (record.profile) {
      const profile = profileSnapshot(record.profile);
      if (profile.id !== id) throw new Error('LICENSE_CARD_SYNC_ID');
      const index = byId.get(id), current = index == null ? null : state.items[index];
      // Older clients do not publish the optional atlas field. Their profile
      // updates must retain an atlas already stored by an upgraded client.
      if (current?.processAtlas && !Object.hasOwn(record.profile, 'processAtlas')) profile.processAtlas = clone(current.processAtlas);
      if (current && (cards.pairKey(current.license, '') !== cards.pairKey(profile.license, '') || (current.licensor && cards.pairKey(current.license, current.licensor) !== cards.pairKey(profile.license, profile.licensor)))) throw new Error('LICENSE_CARD_SYNC_PAIR');
      if (!current || JSON.stringify(current) !== JSON.stringify(profile)) {
        if (index == null) { byId.set(id, state.items.length); state.items.push(profile); }
        else state.items[index] = profile;
        profilesChanged = true;
      }
      const fingerprint=digest(record.profile);
      if(checkpoint.profile!==fingerprint){checkpoint.profile=fingerprint;metadataChanged=true;}
    }
    const card = state.items[byId.get(id)];
    if (card && record.contracts) {
      if (record.contracts.pair !== cards.pairKey(card.license, card.licensor)) throw new Error('LICENSE_CARD_SYNC_CONTRACT_PAIR');
      const normalized = cards.normalizeRules(record.contracts.rules, card, deps);
      const merged = replaceContracts(next.pricingRules || [], normalized, card, deps);
      if (JSON.stringify(merged) !== JSON.stringify(next.pricingRules || [])) { next.pricingRules = merged; rulesChanged = true; }
      const fingerprint=digest(record.contracts);
      if(checkpoint.contracts!==fingerprint){checkpoint.contracts=fingerprint;metadataChanged=true;}
    }
    applied[id] = checkpoint;
  }
  if (!profilesChanged && !rulesChanged && !metadataChanged) return { changed:false, profilesChanged:false, rulesChanged:false, overrides };
  next.licenseCards = state; next.licenseCardPeerApplied = applied;
  next._revisions = { ...(next._revisions || {}) };
  if (profilesChanged || rulesChanged) next._revisions.licenseCards = cards.revisionOf(overrides, 'licenseCards') + 1;
  if (rulesChanged) next._revisions.pricingRules = cards.revisionOf(overrides, 'pricingRules') + 1;
  return { changed:true, profilesChanged, rulesChanged, overrides:next };
}

function createLicenseCardSync({ deltaStore, loadOverrides, saveOverrides, ...deps }) {
  let flushing=null,retryTimer=null,recovering=false;
  function retry(){recovering=true;if(retryTimer)return;retryTimer=setTimeout(()=>{retryTimer=null;void flushOutbox().catch(()=>retry());},3000);retryTimer.unref?.();}
  function flushOutbox(){
    if(flushing)return flushing;
    flushing=(async()=>{
      const pending=clone(loadOverrides().licenseCardOutbox||{}),completed={};
      for(const [id,entry] of Object.entries(pending)){
        const result=await deltaStore.mirror(COLLECTION,{[id]:entry.fields},{userId:entry.actorId||null});
        if(result&&result.ok===false){retry();continue;}
        completed[id]=digest(entry);
      }
      if(Object.keys(completed).length){
        for(let attempt=0;attempt<2;attempt++){
          const current=loadOverrides(),outbox={...(current.licenseCardOutbox||{})};let removed=false;
          for(const [id,fingerprint] of Object.entries(completed))if(outbox[id]&&digest(outbox[id])===fingerprint){delete outbox[id];removed=true;}
          if(!removed)break;
          try{saveOverrides({...current,licenseCardOutbox:outbox},Number(current._revision)||0);break;}
          catch(error){if(attempt||error.code!=='REVISION_CONFLICT'){retry();throw error;}}
        }
      }
      const isPending=Object.keys(loadOverrides().licenseCardOutbox||{}).length>0;
      if(isPending)retry();
      else if(recovering){recovering=false;deps.onRecovered?.();}
      return {ok:!isPending,pending:isPending};
    })().finally(()=>{flushing=null;});
    return flushing;
  }
  async function publish(req, change) {
    const current=loadOverrides(),staged=stageChange(current,{...change,actorId:req?.currentUser?.id||change.actorId||''});
    if(JSON.stringify(staged.licenseCardOutbox)!==JSON.stringify(current.licenseCardOutbox||{}))saveOverrides(staged,Number(current._revision)||0);
    try{return await flushOutbox();}catch(error){retry();return {ok:false,pending:true};}
  }
  async function reconcile() {
    const records = deltaStore.readAllSync(COLLECTION);
    if (!records) return { changed:false };
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = loadOverrides(), result = applyRecords(current, records, deps);
      if (!result.changed) return result;
      try { saveOverrides(result.overrides, Number(current._revision) || 0); return result; }
      catch (error) { if (attempt || error.code !== 'REVISION_CONFLICT') throw error; }
    }
  }
  return { publish, reconcile, flushOutbox };
}
module.exports = { COLLECTION, TEMPLATES_ID, validId, profileSnapshot, stageChange, replaceContracts, applyRecords, createLicenseCardSync };
