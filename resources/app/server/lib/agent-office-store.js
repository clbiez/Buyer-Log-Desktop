'use strict';

// Agent metadata and complete transcripts use the existing durable WAL store.
// A separate DB per owner prevents another buyer's archive from entering the
// normal sync channel or the hot business-data database.
const path = require('path');
const crypto = require('crypto');
const { createLocalDb } = require('./local-db');
const { redactSecrets } = require('../../shared/secret-redaction');
const workshopModel = require('../../public/agent-office-workshop-model');

const AREAS = [...new Set(['collection',...require('./module-registry').list().map(module=>module.area==='koleksiyon'?'collection':module.area)])];
const KINDS = new Set(['profile', 'memory', 'memory-version', 'conversation', 'message', 'job', 'snapshot', 'watch', 'alert', 'office', 'summary', 'metadata']);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
function error(code, status = 400) { return Object.assign(new Error(code), { code, statusCode: status }); }
function text(value, max) {
  const result = redactSecrets(String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim());
  if (result.length > max) throw error('OFFICE_TEXT_TOO_LONG', 413);
  return result;
}
function avatar(raw = {}) {
  const choose = (value, values, fallback) => values.includes(value) ? value : fallback;
  const accessory = choose(raw.accessory, ['none', 'glasses', 'headphones'], 'none');
  return { hair: choose(raw.hair, ['short', 'long', 'bun'], 'short'),
    skin: Math.max(0, Math.min(4, Math.round(Number(raw.skin) || 0))),
    clothes: choose(raw.clothes, ['blue', 'cream', 'green', 'ink', 'rust'], 'blue'), accessory,
    hairColor: choose(raw.hairColor, ['brown', 'black', 'auburn', 'blonde', 'silver'], 'brown'),
    top: choose(raw.top, ['shirt', 'cardigan', 'jacket', 'knit'], 'shirt'),
    bottoms: choose(raw.bottoms, ['navy', 'black', 'denim', 'cream'], 'navy'),
    shoes: choose(raw.shoes, ['brown', 'black', 'white'], 'brown'),
    glasses: typeof raw.glasses === 'boolean' ? raw.glasses : accessory === 'glasses',
    ornament: choose(raw.ornament, ['none', 'headphones', 'scarf'], accessory === 'headphones' ? 'headphones' : 'none') };
}
const FURNITURE_KINDS = ['desk', 'sofa', 'plant', 'shelf', 'table', 'rug', 'lamp', 'rack', 'coffee', 'chair', 'mannequin', 'monstera', 'board', 'decor'];
function normalizeOffice(raw = {}) {
  const workshop = raw.scene === 'workshop-v1';
  const furniture = (items, isWorkshop = workshop) => (Array.isArray(items) ? items : []).slice(0, 48).map(item => ({
    id: /^[a-zA-Z0-9_-]{1,80}$/.test(item?.id || '') ? item.id : id(),
    kind: FURNITURE_KINDS.includes(item?.kind) ? item.kind : 'desk',
    x: Math.max(0, Math.min(isWorkshop ? 23 : 11, Math.round(Number(item?.x) || 0))),
    y: Math.max(0, Math.min(isWorkshop ? 3 : 7, Math.round(Number(item?.y) || 0))),
    ...(isWorkshop ? { floor: Number(item?.floor) === 1 ? 1 : 0 } : {}),
    ...(isWorkshop && item && workshopModel.scale(item) === 1.3 ? {scale:1.3} : {}),
    ...(isWorkshop && workshopModel.styles(item?.kind).length>1 && workshopModel.styles(item?.kind).includes(item.style)?{style:item.style}:{}),
    rotation: (isWorkshop ? [0,1] : [0,1,2,3]).includes(Number(item?.rotation)) ? Number(item.rotation) : 0,
  }));
  const result = { ...(workshop ? {scene:'workshop-v1'} : {}),
    period: ['auto', 'morning', 'noon', 'evening', 'night'].includes(raw.period) ? raw.period : 'auto',
    quality:['low','balanced','high'].includes(raw.quality)?raw.quality:'balanced',
    lighting: Number.isFinite(Number(raw.lighting)) ? Math.max(0, Math.min(100, Math.round(Number(raw.lighting)))) : 80,
    lightsOn: typeof raw.lightsOn === 'boolean' ? raw.lightsOn : true,
    furniture: furniture(raw.furniture),
    templates: (Array.isArray(raw.templates) ? raw.templates : []).slice(0,6).map(template => ({
      name: text(template?.name || '',60), furniture: furniture(template?.furniture) })).filter(template => template.name) };
  if (workshop && raw.previousLayout && typeof raw.previousLayout === 'object') {
    result.previousLayout = { scene:'legacy',
      period: ['auto','morning','noon','evening','night'].includes(raw.previousLayout.period) ? raw.previousLayout.period : 'auto',
      quality: ['low','balanced','high'].includes(raw.previousLayout.quality) ? raw.previousLayout.quality : 'balanced',
      furniture: furniture(raw.previousLayout.furniture, false) };
  }
  if (workshop) {
    for (const items of [result.furniture, ...result.templates.map(template => template.furniture)]) {
      if (new Set(items.map(item => item.id)).size !== items.length || items.some(item => !workshopModel.validPlacement(item, items))) throw error('OFFICE_LAYOUT_INVALID');
    }
  }
  return result;
}
const DEFAULT_FURNITURE = [
  {id:'desk-a',kind:'desk',x:4,y:2,floor:1}, {id:'desk-b',kind:'desk',x:12,y:2,floor:1}, {id:'desk-c',kind:'desk',x:20,y:2,floor:1},
  {id:'coffee-bar',kind:'coffee',x:2,y:2,floor:0}, {id:'meeting',kind:'table',x:12,y:2,floor:0}, {id:'sofa',kind:'sofa',x:20,y:2,floor:0},
  {id:'shelf',kind:'shelf',x:8,y:0,floor:0}, {id:'shelf-entrance',kind:'shelf',x:1,y:0,floor:1}, {id:'rack-quality',kind:'rack',x:23,y:0,floor:1}, {id:'shelf-upper',kind:'rack',x:10,y:0,floor:1},
  {id:'rack',kind:'plant',x:16,y:0,floor:1}, {id:'tailor',kind:'mannequin',x:8,y:0,floor:1},
  {id:'plant-a',kind:'monstera',x:1,y:0,floor:0}, {id:'plant-b',kind:'plant',x:23,y:1,floor:1},
  {id:'board-a',kind:'board',x:3,y:0,floor:1}, {id:'board-b',kind:'board',x:12,y:0,floor:0},
  {id:'rug-meeting',kind:'rug',x:12,y:2,floor:0}, {id:'rug-lounge',kind:'rug',x:20,y:2,floor:0},
  {id:'board-upper',kind:'board',x:14,y:0,floor:1}, {id:'board-quality',kind:'board',x:21,y:0,floor:1},
  {id:'plant-upper',kind:'plant',x:6,y:0,floor:1}, {id:'plant-meeting',kind:'plant',x:10,y:0,floor:0},
  {id:'shelf-lounge',kind:'shelf',x:17,y:0,floor:0,style:'library'}, {id:'plant-lounge',kind:'monstera',x:23,y:0,floor:0},
  {id:'decor-lower',kind:'decor',x:6,y:0,floor:0}, {id:'lamp-a',kind:'lamp',x:5,y:0,floor:0}, {id:'lamp-b',kind:'lamp',x:21,y:0,floor:0},
].map(item => ({...item,rotation:0,...(['coffee','table','sofa','rug'].includes(item.kind)?{scale:1.3}:{})}));
function defaultOffice() { return { scene:'workshop-v1', period:'auto',quality:'balanced',lighting:80,lightsOn:true,templates:[],furniture:copy(DEFAULT_FURNITURE) }; }

function createAgentOfficeStore({ root, onChange = () => {} } = {}) {
  if (!root) throw new TypeError('Agent Office root required');
  const databases = new Map();
  function db(owner) {
    if (!owner) throw error('OFFICE_OWNER_REQUIRED');
    const key = hash(owner);
    if (!databases.has(key)) {
      const instance = createLocalDb(path.join(root, `${key}.db`), {walMaxBytes:32 * 1024 * 1024});
      instance.setTransportFilter(() => false); // ONLY the encrypted owner channel.
      databases.set(key, instance);
    }
    return databases.get(key);
  }
  async function records(owner, includeDeleted = false) {
    const state = await db(owner).read();
    return Object.values(state.records || {}).map(record => record.doc).filter(doc => doc && doc.ownerId === owner && (includeDeleted || !doc.deleted));
  }
  async function get(owner, kind, key) {
    const state = await db(owner).read();
    const doc = state.records[`${kind}:${key}`]?.doc;
    if (!doc || doc.ownerId !== owner || doc.deleted) throw error('OFFICE_NOT_FOUND', 404);
    return copy(doc);
  }
  async function save(owner, kind, raw, { expectedRevision, immutable = false } = {}) {
    if (!KINDS.has(kind)) throw error('OFFICE_KIND_INVALID');
    const key = raw.id || id(), database = db(owner);
    // The WAL transaction gives concurrent browser tabs a single CAS boundary.
    const result = await database.privateRecordTransaction(state => {
      const recordKey = `${kind}:${key}`, previous = state.records[recordKey]?.doc;
      if (immutable && previous) return {result:copy(previous)};
      if (expectedRevision != null && Number(previous?.revision || 0) !== Number(expectedRevision)) throw error('OFFICE_REVISION_CONFLICT', 409);
      const doc = { ...copy(raw), id: key, kind, ownerId: owner, revision: Number(previous?.revision || 0) + 1,
        createdAt: previous?.createdAt || raw.createdAt || now(), updatedAt: now() };
      const changed = {[recordKey]:{doc}};
      if (kind === 'message') {
        const sequenceKey = 'metadata:sequence-' + doc.conversationId, prior = state.records[sequenceKey]?.doc;
        doc.sequence = Number(prior?.sequence || 0) + 1;
        changed[sequenceKey] = {doc:{id:'sequence-'+doc.conversationId, kind:'metadata', ownerId:owner, sequence:doc.sequence, revision:Number(prior?.revision || 0)+1, updatedAt:now(), createdAt:prior?.createdAt || now()}};
      }
      return {records:changed, result:copy(doc)};
    });
    onChange(owner);
    return result;
  }
  async function createProfile(owner, raw = {}, allowed = AREAS) {
    const profiles = (await records(owner)).filter(doc => doc.kind === 'profile');
    if (profiles.length >= 24) throw error('OFFICE_AGENT_LIMIT', 409);
    const name = text(raw.name, 60);
    if (!name) throw error('OFFICE_NAME_REQUIRED');
    return save(owner, 'profile', { id: id(), name, role: text(raw.role || 'assistant', 80), instructions: text(raw.instructions, 6000),
      areas: [...new Set((Array.isArray(raw.areas) ? raw.areas : allowed).filter(area => AREAS.includes(area) && allowed.includes(area)))],
      avatar: avatar(raw.avatar), deskId: text(raw.deskId, 80), lineage: raw.lineage ? copy(raw.lineage) : null });
  }
  async function updateProfile(owner, key, raw, allowed = AREAS) {
    const previous = await get(owner, 'profile', key);
    if (!text(raw.name ?? previous.name, 60)) throw error('OFFICE_NAME_REQUIRED');
    if (raw.areas != null && !Array.isArray(raw.areas)) throw error('OFFICE_PARTICIPANTS_INVALID');
    return save(owner, 'profile', { ...previous, name: text(raw.name ?? previous.name, 60), role: text(raw.role ?? previous.role, 80),
      instructions: text(raw.instructions ?? previous.instructions, 6000), avatar: avatar(raw.avatar || previous.avatar),
      areas: [...new Set((raw.areas || previous.areas).filter(area => AREAS.includes(area) && allowed.includes(area)))],
      deskId: text(raw.deskId ?? previous.deskId, 80) }, { expectedRevision: raw.revision ?? previous.revision });
  }
  async function learn(owner, profileId, raw) {
    await get(owner, 'profile', profileId);
    const content = text(raw.text, 6000);
    if (!content) throw error('OFFICE_MEMORY_REQUIRED');
    const type = ['instruction', 'preference', 'fact', 'decision', 'task', 'inference'].includes(raw.type) ? raw.type : 'instruction';
    const key = text(raw.key || '', 120), memories = (await records(owner)).filter(doc => doc.kind === 'memory' && doc.profileId === profileId && doc.active);
    const conflicts = key ? memories.filter(doc => doc.key === key && doc.text !== content).map(doc => doc.id) : [];
    const category=({fact:'source-fact',preference:'user-preference',instruction:'business-procedure',decision:'business-procedure',task:'task-history',inference:'unverified-inference'})[type];
    const memory = await save(owner, 'memory', { id: id(), profileId, text: content, type, category, key, active: true,
      approved: raw.approved === true && type !== 'inference', origin: 'user', confidence: type === 'inference' ? 'LOW' : 'USER_REPORTED',
      sourceId: text(raw.sourceId, 120), expiresAt: raw.expiresAt && Number.isFinite(Date.parse(raw.expiresAt)) ? new Date(raw.expiresAt).toISOString() : '',
      shareable: raw.shareable === true, conflictingIds: conflicts,sourceRevision:text(raw.sourceRevision||'',160),correctsMemoryId:text(raw.correctsMemoryId||'',120) });
    return memory;
  }
  async function editMemory(owner, key, raw) {
    const previous = await get(owner, 'memory', key);
    await save(owner, 'memory-version', { ...previous, id: id(), memoryId: previous.id }, { immutable: true });
    const next = { ...previous, type: ['instruction','preference','fact','decision','task','inference'].includes(raw.type) ? raw.type : previous.type, key: text(raw.key ?? previous.key, 120), text: text(raw.text ?? previous.text, 6000), active: raw.active ?? previous.active,
      approved: raw.approved ?? previous.approved, shareable: raw.shareable ?? previous.shareable,
      deleted: raw.deleted === true, conflictingIds: raw.resolve === true ? [] : previous.conflictingIds };
    if (!next.text) throw error('OFFICE_MEMORY_REQUIRED');
    if (next.type === 'inference') next.approved = false;
    next.category=({fact:'source-fact',preference:'user-preference',instruction:'business-procedure',decision:'business-procedure',task:'task-history',inference:'unverified-inference'})[next.type];
    return save(owner, 'memory', next, { expectedRevision: raw.revision ?? previous.revision });
  }
  async function conversation(owner, profileIds, title) {
    const ids = [...new Set(profileIds || [])];
    if (!ids.length || ids.length > 4) throw error('OFFICE_PARTICIPANTS_INVALID');
    for (const key of ids) await get(owner, 'profile', key);
    return save(owner, 'conversation', { id: id(), profileIds: ids, title: text(title || 'Conversation', 160) });
  }
  async function appendMessage(owner, conversationId, raw) {
    const conv = await get(owner, 'conversation', conversationId);
    if (!['user', 'assistant', 'system'].includes(raw.role)) throw error('OFFICE_MESSAGE_INVALID');
    return save(owner, 'message', { id: raw.id || id(), conversationId: conv.id, role: raw.role,
      text: text(raw.text, 2000000), profileIds: conv.profileIds, sourceIds: Array.isArray(raw.sourceIds) ? raw.sourceIds.slice(0, 100) : [],
      status: ['complete', 'failed', 'cancelled', 'interrupted'].includes(raw.status) ? raw.status : 'complete',
      requestId: text(raw.requestId, 120), model: text(raw.model, 80), provenance: raw.provenance ? copy(raw.provenance) : null }, { immutable: true });
  }
  async function messages(owner, conversationId, { before = '', limit = 60, query = '' } = {}) {
    await get(owner, 'conversation', conversationId);
    const all = (await records(owner)).filter(doc => doc.kind === 'message' && doc.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || Number(a.sequence || 0) - Number(b.sequence || 0) || a.id.localeCompare(b.id));
    const cursor = before ? all.findIndex(doc => doc.id === before) : all.length;
    if (before && cursor < 0) throw error('OFFICE_CURSOR_INVALID');
    const matched = all.slice(0, cursor).filter(doc => !query || doc.text.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')));
    const selected = matched.slice(-Math.max(1, Math.min(100, Number(limit) || 60)));
    return { messages: selected, hasMore: matched.length > selected.length, before: selected[0]?.id || '', total: all.length };
  }
  async function state(owner) {
    const docs = await records(owner), conflicts = await db(owner).listConflictSummaries();
    return { profiles: docs.filter(doc => doc.kind === 'profile'), memory: docs.filter(doc => doc.kind === 'memory'),
      conversations: docs.filter(doc => doc.kind === 'conversation').sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)),
      jobs: docs.filter(doc => doc.kind === 'job').sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
      watches: docs.filter(doc => doc.kind === 'watch'), alerts: docs.filter(doc => doc.kind === 'alert' && !doc.dismissed).slice(-100),
      summaries: docs.filter(doc => doc.kind === 'summary'),
      taskSchedules:docs.filter(doc=>doc.kind==='metadata'&&doc.type==='capability-schedule'),
      office: docs.find(doc => doc.kind === 'office') || { id: 'layout', ...defaultOffice() },
      defaultOffice:defaultOffice(),
      archive: { messages: docs.filter(doc => doc.kind === 'message').length, bytes: docs.filter(doc => doc.kind === 'message').reduce((sum,doc) => sum + Buffer.byteLength(doc.text), 0) },
      conflicts };
  }
  async function selectContext(owner, profileIds, conversationId, query, budget = 16000) {
    const docs = await records(owner), words = [...new Set(String(query).toLocaleLowerCase('tr-TR').match(/[\p{L}\p{N}]{3,}/gu) || [])].slice(0,24), scores = new Map();
    const score = doc => {if(scores.has(doc.id))return scores.get(doc.id);const haystack=String(doc.text || '').toLocaleLowerCase('tr-TR'), value=words.reduce((n,word)=>n+Number(haystack.includes(word)),0);scores.set(doc.id,value);return value;};
    const memory = docs.filter(doc => doc.kind === 'memory' && profileIds.includes(doc.profileId) && doc.active && !doc.deleted && !(doc.origin === 'copied' && !doc.approved) &&
      (!doc.expiresAt || Date.parse(doc.expiresAt) > Date.now()));
    const history = docs.filter(doc => doc.kind === 'message' && doc.role !== 'system' && doc.profileIds.some(key => profileIds.includes(key)));
    history.sort((a,b) => ((b.conversationId === conversationId ? 5 : 0) + score(b)) - ((a.conversationId === conversationId ? 5 : 0) + score(a)) || b.createdAt.localeCompare(a.createdAt));
    const candidates = memory.sort((a,b) => (Number(!!b.feedbackKind)-Number(!!a.feedbackKind)) || (Number(b.approved) - Number(a.approved)) || score(b) - score(a) || b.updatedAt.localeCompare(a.updatedAt))
      .concat(docs.filter(doc => doc.kind === 'summary' && doc.contractValid !== false && doc.profileIds?.some(key => profileIds.includes(key))).slice(-4), history);
    const selected = [], omitted = [];
    let size = 0;
    for (const doc of candidates) {
      const value = { id: doc.id, kind: doc.kind, profileId: doc.profileId, role: doc.role, type: doc.type, text: doc.text,
        category:doc.category,feedbackKind:doc.feedbackKind,toolIds:doc.toolIds,taskId:doc.taskId,sourceRevision:doc.sourceRevision,correctsMemoryId:doc.correctsMemoryId,
        approved: doc.approved, origin: doc.origin, confidence: doc.confidence, createdAt: doc.createdAt, sourceId: doc.sourceId, conflictingIds: doc.conflictingIds };
      if(['message','summary'].includes(doc.kind)&&value.text.length>1800){const haystack=value.text.toLocaleLowerCase('tr-TR'),hit=words.map(word=>haystack.indexOf(word)).find(index=>index>=0),start=Math.max(0,(hit??Math.max(0,value.text.length-1600))-180);value.text=value.text.slice(start,start+1600);value.excerpt=true;value.fullCharacters=doc.text.length;value.excerptStart=start;value.contentHash=hash(doc.text);}
      const chars = JSON.stringify(value).length;
      if (size + chars <= budget && selected.length < 30) { selected.push(value); size += chars; }
      else omitted.push(doc.id);
    }
    return { selected, omittedCount: omitted.length, chars: size, strategy: 'approved-memory-and-relevant-history', completeArchive: false };
  }
  async function searchHistory(owner,profileId,raw={}){await get(owner,'profile',profileId);const query=text(raw.query,160),terms=[...new Set(query.toLocaleLowerCase('tr-TR').match(/[\p{L}\p{N}]{2,}/gu)||[])];if(!terms.length)return{messages:[],total:0,hasMore:false};const offset=Math.max(0,Math.floor(Number(raw.offset)||0)),limit=Math.max(1,Math.min(50,Math.floor(Number(raw.limit)||20)));
    const matches=(await records(owner)).filter(doc=>doc.kind==='message'&&doc.profileIds.includes(profileId)).map(doc=>{const lower=doc.text.toLocaleLowerCase('tr-TR');return{doc,score:terms.reduce((n,t)=>n+Number(lower.includes(t)),0),first:Math.min(...terms.map(t=>lower.indexOf(t)).filter(i=>i>=0))};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||b.doc.createdAt.localeCompare(a.doc.createdAt));
    return{messages:matches.slice(offset,offset+limit).map(({doc,first})=>({id:doc.id,conversationId:doc.conversationId,role:doc.role,createdAt:doc.createdAt,text:doc.text.slice(Math.max(0,first-100),Math.max(0,first-100)+1000),excerpt:doc.text.length>1000,sourceIds:doc.sourceIds,provenance:doc.provenance})),total:matches.length,hasMore:offset+limit<matches.length,offset};}
  async function exportTraining(owner, profileIds) {
    const docs = await records(owner);
    return docs.filter(doc => ['profile','memory','memory-version','conversation','message','summary'].includes(doc.kind) &&
      (!profileIds?.length || profileIds.includes(doc.id) || profileIds.includes(doc.profileId) || doc.profileIds?.some(key => profileIds.includes(key))));
  }
  async function importRecords(owner, incoming) {
    // Ciphertext authenticity is checked by the sync service; owner and kinds
    // are checked again here. Never import executable code/permissions.
    return db(owner).privateRecordTransaction(state => {
      let applied = 0; const changed = {}, conflicts = [];
      for (const raw of incoming) {
        const doc = raw?.doc;
        if (!doc || doc.ownerId !== owner || !KINDS.has(doc.kind) || !/^[A-Za-z0-9_-]{1,120}$/.test(doc.id)) throw error('OFFICE_SYNC_RECORD_INVALID');
        const key = `${doc.kind}:${doc.id}`, current = (changed[key] || state.records[key])?.doc;
        if (current && JSON.stringify(current) === JSON.stringify(doc)) continue;
        if (current && (doc.kind === 'message' || doc.kind === 'memory-version')) throw error('OFFICE_IMMUTABLE_CONFLICT', 409);
        if (current && current.revision === doc.revision) {
          const conflictId = id();
          changed[`memory-version:${conflictId}`] = { doc: { ...(current.updatedAt >= doc.updatedAt ? doc : current), id: conflictId, kind: 'memory-version', conflictingRecord: key } };
          conflicts.push({ conflictId, id: key, field: 'doc', type: 'field', current: copy(current), incoming: copy(doc), at: now(), resolved: false });
        }
        if (current && (current.updatedAt > doc.updatedAt || (current.updatedAt === doc.updatedAt && current.revision >= doc.revision))) continue;
        changed[key] = { doc: copy(doc) }; applied++;
      }
      return {records:changed, conflicts, result:{applied}};
    });
  }
  return { db, records, get, save, state, createProfile, updateProfile, learn, editMemory, conversation, appendMessage, messages, selectContext, searchHistory, exportTraining, importRecords,
    normalizeOffice, defaultOffice, AREAS, DEFAULT_FURNITURE };
}

module.exports = { createAgentOfficeStore, normalizeOffice, defaultOffice, avatar, AREAS, DEFAULT_FURNITURE, hash, id, text, error };
