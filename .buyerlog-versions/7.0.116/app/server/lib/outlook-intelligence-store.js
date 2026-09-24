'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENTITY_TYPES = new Set(['ORDER', 'PO', 'PLM', 'MODEL', 'COLLECTION']);
const LINK_SOURCES = new Set(['AUTO', 'MANUAL', 'AI_CONFIRMED']);
const MAILBOX_TYPES = new Set(['PERSONAL', 'SHARED_DELEGATED', 'MANAGED_APPLICATION']);
const TAGS = new Set(['TERMIN', 'FIYAT', 'ONAY', 'REVIZYON', 'IPTAL', 'NUMUNE', 'SEVKIYAT', 'KALITE', 'URETIM', 'ODEME', 'DIGER']);
const CANDIDATE_STATUSES = new Set(['PENDING', 'ACCEPTED', 'REJECTED', 'STALE']);
const QUEUE_STATUSES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'RETRY', 'DEAD_LETTER']);

function text(value, max = 500) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function upper(value, max) { return text(value, max).toLocaleUpperCase('tr-TR'); }
function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function hash(value) { return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex'); }
function unique(values, max = 50) { return [...new Set((Array.isArray(values) ? values : []).map(v => upper(v, 100)).filter(Boolean))].slice(0, max); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function initialState() {
  return {
    schemaVersion: 1, revision: 0, managedMailboxes: [], links: [], timelineEvents: [],
    candidates: [], watchers: [], notifications: [], summaries: [], feedback: [],
    subscriptions: [], deltaStates: [], queue: [], deadLetters: [], processedEvents: [],
    metrics: {}, indexes: {}, config: {
      autoLinkThreshold: 95, confirmationThreshold: 80,
      retentionDays: { mailMetadata: 365, links: 1825, summaries: 90, candidates: 365, notifications: 365, audit: 2555 },
      severity: { APPROVAL: 'ACTION', DELIVERY_DATE_CHANGE: 'ACTION', PRICE_CHANGE: 'WARNING', CANCELLATION: 'CRITICAL' },
    },
  };
}
function rebuildIndexes(state){const indexes={linksByEntity:{},linksByGraphMessage:{},linksByInternetMessage:{},linksByConversation:{},linksByMailbox:{},timelineByEntity:{},candidatesByEntity:{},candidatesByStatus:{}};const push=(group,key,value)=>{const textKey=String(key||'');if(!textKey)return;(group[textKey]||(group[textKey]=[])).push(value);};for(const item of state.links||[]){push(indexes.linksByEntity,`${item.entityType}|${item.entityId}`,item.id);push(indexes.linksByGraphMessage,item.graphMessageId,item.id);push(indexes.linksByInternetMessage,item.internetMessageId,item.id);push(indexes.linksByConversation,item.conversationId,item.id);push(indexes.linksByMailbox,item.mailboxAddress||item.mailboxType,item.id);}for(const item of state.timelineEvents||[])push(indexes.timelineByEntity,`${item.entityType}|${item.entityId}`,item.id);for(const item of state.candidates||[]){push(indexes.candidatesByEntity,`${item.entityType}|${item.entityId}`,item.id);push(indexes.candidatesByStatus,item.status,item.id);}state.indexes=indexes;return state;}
function normalizeState(input) {
  const base = initialState(), src = input && typeof input === 'object' ? input : {};
  const out = { ...base, ...src, config: { ...base.config, ...(src.config || {}), retentionDays: { ...base.config.retentionDays, ...(src.config && src.config.retentionDays || {}) }, severity: { ...base.config.severity, ...(src.config && src.config.severity || {}) } } };
  for (const key of ['managedMailboxes','links','timelineEvents','candidates','watchers','notifications','summaries','feedback','subscriptions','deltaStates','queue','deadLetters','processedEvents']) if (!Array.isArray(out[key])) out[key] = [];
  if (!out.metrics || typeof out.metrics !== 'object' || Array.isArray(out.metrics)) out.metrics = {};
  out.schemaVersion = 1; out.revision = Math.max(0, Number(out.revision) || 0);
  return rebuildIndexes(out);
}

function createOutlookIntelligenceStore(options = {}) {
  const file = options.file || path.join(options.dataRoot || path.join(__dirname, '..', 'data'), 'outlook-intelligence.json');
  const writeJson = options.writeJson || ((target, value) => { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value, null, 2), 'utf8'); });
  function load() { try { return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) { return initialState(); } }
  function save(state) { const next = rebuildIndexes(normalizeState(state)); next.revision += 1; next.updatedAt = now(); writeJson(file, next); return next; }
  function mutate(fn) { const state = load(), result = fn(state); save(state); return clone(result); }
  function read(fn) { return clone(fn(load())); }
  function metric(name, amount = 1, durationMs) {
    return mutate(state => {
      const key = text(name, 100), current = state.metrics[key] || { count: 0, totalMs: 0, maxMs: 0 };
      current.count += Number(amount) || 0;
      if (Number.isFinite(Number(durationMs))) { current.totalMs += Number(durationMs); current.maxMs = Math.max(current.maxMs, Number(durationMs)); }
      current.updatedAt = now(); state.metrics[key] = current; return current;
    });
  }
  function listManagedMailboxes({ enabledOnly = false, intelligenceOnly = false } = {}) {
    return read(state => state.managedMailboxes.filter(item => (!enabledOnly || item.isEnabled) && (!intelligenceOnly || item.intelligenceEnabled)));
  }
  function managedMailbox(mailboxIdOrAddress) {
    const key = upper(mailboxIdOrAddress, 500);
    return read(state => state.managedMailboxes.find(item => upper(item.id, 500) === key || upper(item.mailboxId, 500) === key || upper(item.email, 500) === key) || null);
  }
  function upsertManagedMailbox(input, actorId) {
    const email = text(input && input.email, 500).toLowerCase(), mailboxId = text(input && (input.mailboxId || input.id), 500) || email;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Geçerli mailbox e-posta adresi zorunludur.'), { code: 'MAILBOX_EMAIL_INVALID', statusCode: 400 });
    return mutate(state => {
      let item = state.managedMailboxes.find(row => upper(row.mailboxId) === upper(mailboxId) || upper(row.email) === upper(email));
      const created = !item;
      if (!item) { item = { id: id('mailbox'), mailboxId, email, createdBy: text(actorId, 160), createdAt: now() }; state.managedMailboxes.push(item); }
      Object.assign(item, { mailboxId, email, displayName: text(input.displayName, 500) || email, type: upper(input.type, 40) || 'SHARED', isEnabled: input.isEnabled !== false, intelligenceEnabled: input.intelligenceEnabled === true, watchInbox: input.watchInbox !== false, watchSentItems: input.watchSentItems === true, folders: unique(input.folders || [], 25), updatedBy: text(actorId, 160), updatedAt: now() });
      return { item, created };
    });
  }
  function removeManagedMailbox(idValue) { return mutate(state => { const index = state.managedMailboxes.findIndex(item => item.id === text(idValue)); if (index < 0) return null; return state.managedMailboxes.splice(index, 1)[0]; }); }
  function assertManagedMailbox(value, intelligence = false) {
    const item = managedMailbox(value);
    if (!item || !item.isEnabled || (intelligence && !item.intelligenceEnabled)) throw Object.assign(new Error('Mailbox Buyer Log yönetilen mailbox kaydında etkin değil.'), { code: 'MAILBOX_REGISTRY_DENIED', statusCode: 403 });
    return item;
  }
  function linkMail(input, actorId) {
    const entityType = upper(input.entityType, 40), entityId = text(input.entityId, 500), mailboxType = upper(input.mailboxType, 40) || 'PERSONAL';
    if (!ENTITY_TYPES.has(entityType) || !entityId) throw Object.assign(new Error('Geçerli ilişkilendirme hedefi zorunludur.'), { code: 'MAIL_LINK_TARGET_INVALID', statusCode: 400 });
    if (!MAILBOX_TYPES.has(mailboxType)) throw Object.assign(new Error('Mailbox tipi geçersizdir.'), { code: 'MAILBOX_TYPE_INVALID', statusCode: 400 });
    const graphMessageId = text(input.graphMessageId || input.messageId, 1000), mailboxAddress = text(input.mailboxAddress, 500).toLowerCase();
    if (!graphMessageId) throw Object.assign(new Error('Graph message ID zorunludur.'), { code: 'MESSAGE_ID_REQUIRED', statusCode: 400 });
    return mutate(state => {
      let item = state.links.find(row => row.entityType === entityType && row.entityId === entityId && row.graphMessageId === graphMessageId && upper(row.mailboxAddress) === upper(mailboxAddress));
      const created = !item;
      if (!item) {
        item = { id: id('mail-link'), entityType, entityId, mailboxType, mailboxAddress, graphMessageId, internetMessageId: text(input.internetMessageId, 1000), conversationId: text(input.conversationId, 1000), linkedBy: text(actorId, 160), linkedAt: now(), source: LINK_SOURCES.has(upper(input.source)) ? upper(input.source) : 'MANUAL', sourceStatus: 'AVAILABLE' };
        state.links.push(item);
      }
      Object.assign(item, { subjectSnapshot: text(input.subject, 1000), senderSnapshot: text(input.sender, 500), receivedDateTime: text(input.receivedDateTime || input.receivedAt, 80), linkType: text(input.linkType, 80) || 'RELATED', confidence: Math.max(0, Math.min(100, Number(input.confidence) || 0)), updatedAt: now() });
      if (created) state.timelineEvents.push({ id: id('timeline'), entityType, entityId, eventType: 'MAIL', subtype: 'MAIL_LINKED', sourceId: item.id, occurredAt: item.receivedDateTime || item.linkedAt, createdAt: now(), createdBy: text(actorId, 160), metadata: { subject: item.subjectSnapshot, sender: item.senderSnapshot, conversationId: item.conversationId, mailboxType, tag: null } });
      return { item, created };
    });
  }
  function unlinkMail(linkId) { return mutate(state => { const index = state.links.findIndex(item => item.id === text(linkId)); if (index < 0) return null; const [removed] = state.links.splice(index, 1); state.timelineEvents = state.timelineEvents.filter(event => event.sourceId !== removed.id); return removed; }); }
  function updateLink(linkId, patch) { return mutate(state => { const item = state.links.find(row => row.id === text(linkId)); if (!item) return null; if (Object.prototype.hasOwnProperty.call(patch || {}, 'isPinned')) item.isPinned = Boolean(patch.isPinned); if (Object.prototype.hasOwnProperty.call(patch || {}, 'pinReason')) item.pinReason = text(patch.pinReason, 500); if (Object.prototype.hasOwnProperty.call(patch || {}, 'tags')) item.tags = unique(patch.tags).filter(tag => TAGS.has(tag)); item.updatedAt = now(); return item; }); }
  function linksForEntity(entityType, entityId) { const key = `${upper(entityType,40)}|${text(entityId,500)}`; return read(state => {const ids=new Set(state.indexes.linksByEntity[key]||[]);return state.links.filter(item=>ids.has(item.id));}); }
  function timeline(entityType, entityId) { const key = `${upper(entityType,40)}|${text(entityId,500)}`; return read(state => {const ids=new Set(state.indexes.timelineByEntity[key]||[]);return state.timelineEvents.filter(item=>ids.has(item.id)).sort((a, b) => Date.parse(b.occurredAt || b.createdAt) - Date.parse(a.occurredAt || a.createdAt));}); }
  function addTimelineEvent(input, actorId) { return mutate(state => { const item = { id: id('timeline'), entityType: upper(input.entityType, 40), entityId: text(input.entityId, 500), eventType: upper(input.eventType, 50) || 'MAIL', subtype: upper(input.subtype, 80), sourceId: text(input.sourceId, 500), occurredAt: text(input.occurredAt, 80) || now(), createdAt: now(), createdBy: text(actorId, 160), metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {} }; state.timelineEvents.push(item); return item; }); }
  function createCandidate(input) {
    const fingerprint = hash([input.entityType, input.entityId, input.type, input.newValue, input.conversationId, input.graphMessageId].map(v => text(v, 1000)).join('|'));
    return mutate(state => { let item = state.candidates.find(row => row.fingerprint === fingerprint); const created = !item; if (!item) { item = { id: id('candidate'), fingerprint, status: 'PENDING', detectedAt: now() }; state.candidates.push(item); } Object.assign(item, { entityType: upper(input.entityType, 40), entityId: text(input.entityId, 500), type: upper(input.type, 80), oldValue: text(input.oldValue, 500), newValue: text(input.newValue, 500), currency: upper(input.currency, 20), unit: text(input.unit, 80), confidence: Math.max(0, Math.min(100, Number(input.confidence) || 0)), sourceMessageId: text(input.sourceMessageId || input.graphMessageId, 1000), conversationId: text(input.conversationId, 1000), sourceExcerpt: text(input.sourceExcerpt, 1200), reasons: (Array.isArray(input.reasons) ? input.reasons : []).map(v => text(v, 300)).filter(Boolean).slice(0, 20), classification: unique(input.classification || [], 20), updatedAt: now() }); return { item, created }; });
  }
  function candidatesForEntity(entityType, entityId, status) { const key=`${upper(entityType,40)}|${text(entityId,500)}`,wanted=upper(status,30);return read(state=>{const ids=new Set(state.indexes.candidatesByEntity[key]||[]);return state.candidates.filter(item=>ids.has(item.id)&&(!wanted||item.status===wanted));}); }
  function decideCandidate(candidateId, decision, actorId) { const status = upper(decision, 30); if (!CANDIDATE_STATUSES.has(status)) throw Object.assign(new Error('Geçersiz aday kararı.'), { code: 'CANDIDATE_DECISION_INVALID', statusCode: 400 }); return mutate(state => { const item = state.candidates.find(row => row.id === text(candidateId)); if (!item) return null; item.status = status; item.decidedBy = text(actorId, 160); item.decidedAt = now(); return item; }); }
  function setWatcher(userId, entityId, input = {}) { return mutate(state => { let item = state.watchers.find(row => row.userId === text(userId) && row.entityId === text(entityId)); if (!item) { item = { id: id('watcher'), userId: text(userId), entityType: upper(input.entityType, 40) || 'ORDER', entityId: text(entityId), createdAt: now() }; state.watchers.push(item); } item.enabled = input.enabled !== false; item.eventTypes = unique(input.eventTypes || ['DELIVERY_DATE_CHANGE','CANCELLATION','PRICE_CHANGE','APPROVAL'], 20); item.updatedAt = now(); return item; }); }
  function watchersForEntity(entityId, eventType) { return read(state => state.watchers.filter(item => item.enabled && item.entityId === text(entityId) && (!eventType || item.eventTypes.includes(upper(eventType))))); }
  function createNotification(input) { const fingerprint = text(input.fingerprint, 1000) || hash([input.entityId, input.type, input.newValue, input.conversationId].join('|')); return mutate(state => { const existing = state.notifications.find(item => item.fingerprint === fingerprint); if (existing) return { item: existing, created: false }; const item = { id: id('mail-notification'), fingerprint, userIds: unique(input.userIds, 200), entityType: upper(input.entityType, 40), entityId: text(input.entityId, 500), type: upper(input.type, 80), severity: upper(input.severity, 20) || 'INFO', title: text(input.title, 500), message: text(input.message, 1500), sourceRestricted: Boolean(input.sourceRestricted), createdAt: now(), readBy: [] }; state.notifications.push(item); return { item, created: true }; }); }
  function notificationsForUser(userId, limit = 100) { return read(state => state.notifications.filter(item => item.userIds.includes(text(userId))).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0, Math.max(1, Math.min(500, Number(limit)||100)))); }
  function summaryGet(cacheKey) { return read(state => state.summaries.find(item => item.cacheKey === text(cacheKey, 1000)) || null); }
  function summaryPut(cacheKey, result, meta = {}) { return mutate(state => { state.summaries = state.summaries.filter(item => item.cacheKey !== text(cacheKey, 1000)); const item = { id: id('summary'), cacheKey: text(cacheKey, 1000), result: clone(result), conversationId: text(meta.conversationId, 1000), latestMessageId: text(meta.latestMessageId, 1000), createdAt: now(), expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() }; state.summaries.push(item); return item; }); }
  function feedback(input, userId) { return mutate(state => { const item = { id: id('feedback'), userId: text(userId, 160), linkId: text(input.linkId, 200), graphMessageId: text(input.graphMessageId, 1000), value: upper(input.value, 40), createdAt: now() }; state.feedback.push(item); return item; }); }
  function upsertSubscription(input) { return mutate(state => { let item = state.subscriptions.find(row => row.id === text(input.id) || (row.mailboxId === text(input.mailboxId) && row.folderId === text(input.folderId))); if (!item) { item = { id: text(input.id, 500) || id('subscription'), createdAt: now() }; state.subscriptions.push(item); } Object.assign(item, clone(input), { updatedAt: now() }); return item; }); }
  function removeSubscription(idValue) { return mutate(state => { const index = state.subscriptions.findIndex(item => item.id === text(idValue)); return index >= 0 ? state.subscriptions.splice(index,1)[0] : null; }); }
  function subscriptions() { return read(state => state.subscriptions); }
  function upsertDeltaState(input) { return mutate(state => { let item = state.deltaStates.find(row => row.mailboxId === text(input.mailboxId) && row.folderId === text(input.folderId)); if (!item) { item = { id: id('delta'), mailboxId: text(input.mailboxId), folderId: text(input.folderId) }; state.deltaStates.push(item); } Object.assign(item, clone(input), { updatedAt: now() }); return item; }); }
  function deltaStates() { return read(state => state.deltaStates); }
  function enqueue(input) { const key = text(input.uniqueKey, 1000) || hash(JSON.stringify(input.payload || {})); return mutate(state => { const duplicate = state.queue.find(item => item.uniqueKey === key && item.status !== 'DEAD_LETTER') || state.processedEvents.find(item => item.uniqueKey === key); if (duplicate) return { item: duplicate, created: false }; const item = { id: id('mail-job'), uniqueKey: key, type: upper(input.type, 80), payload: clone(input.payload || {}), status: 'PENDING', attempts: 0, availableAt: now(), createdAt: now() }; state.queue.push(item); return { item, created: true }; }); }
  function claim(limit = 10) { return mutate(state => { const due = Date.now(), items = state.queue.filter(item => ['PENDING','RETRY'].includes(item.status) && Date.parse(item.availableAt || 0) <= due).slice(0, Math.max(1, Math.min(100, Number(limit)||10))); items.forEach(item => { item.status = 'PROCESSING'; item.attempts += 1; item.startedAt = now(); }); return items; }); }
  function completeJob(jobId) { return mutate(state => { const item = state.queue.find(row => row.id === text(jobId)); if (!item) return null; item.status = 'COMPLETED'; item.completedAt = now(); state.processedEvents.push({ uniqueKey: item.uniqueKey, completedAt: item.completedAt }); if (state.processedEvents.length > 20000) state.processedEvents.splice(0, state.processedEvents.length - 20000); return item; }); }
  function failJob(jobId, error, retryable = true, maxAttempts = 5) { return mutate(state => { const item = state.queue.find(row => row.id === text(jobId)); if (!item) return null; item.lastError = text(error && (error.code || error.message || error), 500); item.lastErrorAt = now(); if (retryable && item.attempts < maxAttempts) { item.status = 'RETRY'; const delay = Math.min(300000, 1000 * (2 ** Math.max(0,item.attempts-1))) + Math.floor(Math.random()*750); item.availableAt = new Date(Date.now()+delay).toISOString(); } else { item.status = 'DEAD_LETTER'; state.deadLetters.push(clone(item)); } return item; }); }
  function queueStats() { return read(state => ({ pending: state.queue.filter(item => ['PENDING','RETRY'].includes(item.status)).length, processing: state.queue.filter(item => item.status === 'PROCESSING').length, failed: state.queue.filter(item => item.status === 'DEAD_LETTER').length })); }
  function health() { return read(state => ({ managedMailboxes: state.managedMailboxes.length, enabledMailboxes: state.managedMailboxes.filter(item=>item.isEnabled&&item.intelligenceEnabled).length, subscriptions: state.subscriptions.length, expiringSoon: state.subscriptions.filter(item=>Date.parse(item.expirationDateTime||0)-Date.now()<24*3600000).length, lastWebhook: state.metrics.last_webhook_at && state.metrics.last_webhook_at.value || null, lastDeltaRecovery: state.metrics.last_delta_recovery_at && state.metrics.last_delta_recovery_at.value || null, mailboxes:state.managedMailboxes.map(mailbox=>{const subs=state.subscriptions.filter(item=>item.mailboxId===mailbox.id),status=!mailbox.isEnabled?'PAUSED':!mailbox.intelligenceEnabled?'CONNECTED':subs.some(item=>item.status==='REAUTH_REQUIRED')?'UNAUTHORIZED':subs.some(item=>item.status==='ERROR')?'GRAPH_ERROR':subs.length?'HEALTHY':'SUBSCRIPTION_EXPIRED';return{id:mailbox.id,email:mailbox.email,displayName:mailbox.displayName,status,subscriptionCount:subs.length};}), queue: { pending: state.queue.filter(item=>['PENDING','RETRY'].includes(item.status)).length, processing: state.queue.filter(item=>item.status==='PROCESSING').length, failed: state.queue.filter(item=>item.status==='DEAD_LETTER').length }, metrics: state.metrics })); }
  function setGauge(name, value) { return mutate(state => { state.metrics[text(name,100)] = { value, updatedAt: now() }; return state.metrics[text(name,100)]; }); }
  function pruneRetention(reference=Date.now()){return mutate(state=>{const days=state.config.retentionDays||{},before={links:state.links.length,candidates:state.candidates.length,notifications:state.notifications.length,summaries:state.summaries.length};const keep=(value,limit)=>!limit||!Number.isFinite(Date.parse(value))||reference-Date.parse(value)<=Number(limit)*86400000;state.links=state.links.filter(item=>keep(item.linkedAt,days.links));const linkIds=new Set(state.links.map(item=>item.id));state.timelineEvents=state.timelineEvents.filter(item=>item.eventType!=='MAIL'||linkIds.has(item.sourceId)||keep(item.createdAt,days.links));state.candidates=state.candidates.filter(item=>keep(item.detectedAt,days.candidates));state.notifications=state.notifications.filter(item=>keep(item.createdAt,days.notifications));state.summaries=state.summaries.filter(item=>keep(item.createdAt,days.summaries)&&(!item.expiresAt||Date.parse(item.expiresAt)>reference));return{removed:{links:before.links-state.links.length,candidates:before.candidates-state.candidates.length,notifications:before.notifications-state.notifications.length,summaries:before.summaries-state.summaries.length}};});}
  return { file, load, metric, setGauge, pruneRetention, listManagedMailboxes, managedMailbox, upsertManagedMailbox, removeManagedMailbox, assertManagedMailbox, linkMail, unlinkMail, updateLink, linksForEntity, timeline, addTimelineEvent, createCandidate, candidatesForEntity, decideCandidate, setWatcher, watchersForEntity, createNotification, notificationsForUser, summaryGet, summaryPut, feedback, upsertSubscription, removeSubscription, subscriptions, upsertDeltaState, deltaStates, enqueue, claim, completeJob, failJob, queueStats, health };
}

module.exports = { ENTITY_TYPES, LINK_SOURCES, MAILBOX_TYPES, TAGS, CANDIDATE_STATUSES, QUEUE_STATUSES, rebuildIndexes, createOutlookIntelligenceStore };
