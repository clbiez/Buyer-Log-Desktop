'use strict';

const { id, hash, error, text, AREAS } = require('./agent-office-store');
const { analyzeOperationalData, compareSnapshots, bilingual } = require('./agent-office-intelligence');
const { MAX_BYTES } = require('./agent-office-sync');
const scopeOf = raw => Object.fromEntries(['orderCode','plmId','colourCode'].filter(key => raw?.[key]).map(key => [key, text(raw[key], 80)]));
// Only explicit business identifiers become filters; amounts/dates remain text.
function inferScope(task, explicit = {}) {
  const source=String(task || ''), scope={};
  const order=source.match(/(?:sipariş|order|po)\s*(?:(?:kodu?|code|no)\s*)?[:#-]?\s*(\d{5,12})\b/iu) || source.match(/\b(\d{5,12})\s*(?:(?:nolu|numaralı)\s*)?(?:sipariş[a-zığüşöç]*|order|po)\b/iu);
  const plm=source.match(/\bplm\s*(?:id\s*)?[:#-]?\s*(\d{4,12})\b/iu);
  const color=source.match(/(?:renk\s*kodu|colou?r\s*code)\s*[:#-]?\s*([\p{L}\p{N}_-]{1,30})\b/iu);
  if(order)scope.orderCode=order[1];if(plm)scope.plmId=plm[1];if(color)scope.colourCode=color[1];
  return {...scope,...scopeOf(explicit)};
}
const moduleArea = area => area === 'collection' ? 'koleksiyon' : area;

function packContext(parts, max = 17800) {
  const context = { referenceIds: [], coverage: parts.coverage || {}, participants: parts.participants || [], omitted: 0 };
  // Prompt sanitizer's per-string limit is respected without truncating an
  // instruction mid-sentence invisibly: long text is sent in numbered chunks.
  for (const participant of context.participants) {
    participant.instructions = String(participant.instructions || '').match(/[\s\S]{1,1500}/g) || [];
  }
  for (const [name, list] of Object.entries(parts)) {
    if (name === 'coverage' || name === 'participants') continue;
    context[name] = [];
    for (const item of Array.isArray(list) ? list : []) {
      const safe = JSON.parse(JSON.stringify(item));
      if (safe.text && safe.text.length > 1800) safe.text = { parts: safe.text.match(/[\s\S]{1,1500}/g) };
      context[name].push(safe);
      const refs = [safe.id, safe.sourceId, ...(safe.sources || []).map(source => source.id)].filter(Boolean);
      const oldRefs = context.referenceIds;
      context.referenceIds = [...new Set([...oldRefs, ...refs])];
      if (JSON.stringify(context).length > max) { context[name].pop(); context.referenceIds = oldRefs; context.omitted++; }
    }
  }
  if (JSON.stringify(context).length > max) throw error('OFFICE_CONTEXT_TOO_LARGE', 413);
  return context;
}
function trainingChunks(records) {
  // Whole messages retain IDs, timestamps and boundaries. 19 MiB provides
  // headroom under the API's 20 MiB limit; it is not a context-window claim.
  const blocks = []; let block = [], bytes = 0;
  for (const doc of records) {
    const rendered = `## ${doc.kind} / ${doc.id}\n\n\`\`\`json\n${JSON.stringify(doc)}\n\`\`\`\n\n`, size = Buffer.byteLength(rendered);
    if(size > MAX_BYTES - 512) throw error('OFFICE_SYNC_RECORD_TOO_LARGE',413);
    if(block.length && bytes + size > MAX_BYTES - 512) {blocks.push(block);block=[];bytes=0;}
    block.push({doc,rendered});bytes += size;
  }
  if(block.length)blocks.push(block);
  return blocks.map((block,index)=>({name:`agent-training-${index+1}.md`,buffer:Buffer.from(`# Buyer Log Agent Training — ${index+1}/${blocks.length}\n\n${block.map(item=>item.rendered).join('')}`),sourceIds:block.map(item=>item.doc.id)}));
}
function createAgentOfficeService(deps) {
  const { store, sync, userAccess, engine, getOperationalData } = deps;
  const initialized = new Map(), active = new Map(), scans = new Map(), actors = new Map();
  let timer = null, backgroundRunning = false;
  const freshProfile = profile => {
    const current = userAccess.profileById ? userAccess.profileById(profile.id) : profile;
    if (!current || current.enabled === false) throw error('OFFICE_USER_DISABLED', 403);
    return current;
  };
  const canAutomate = profile => userAccess.hasArea(profile,'automations') && userAccess.hasCapability?.(profile,'AUTOMATIONS.CREATE') === true;
  const allowedAreas = profile => AREAS.filter(area => userAccess.hasArea(profile, moduleArea(area)));
  const audit = (profile, action, target, detail) => userAccess.appendAudit(profile, action, target, detail);
  const engineOf = () => typeof engine === 'function' ? engine() : engine;
  function activate(profile) {
    actors.set(profile.id, { lastSeen: Date.now() });
    if (!timer) { timer = setInterval(() => { void background(); }, 120000); timer.unref?.(); }
  }
  async function ensure(profile) {
    profile = freshProfile(profile); activate(profile);
    if (!initialized.has(profile.id)) {
      const work = (async () => {
        const state = await store.state(profile.id);
        const seeded = (await store.records(profile.id)).some(doc => doc.kind === 'metadata' && doc.id === 'initialized');
        if (!state.profiles.length && !seeded) {
          const seeds = [{ name: 'Ada', role: 'CP', areas: ['cp','orders'], deskId:'desk-a',avatar: { hair:'bun', clothes:'cream', skin:1 } },
            { name: 'Atlas', role:'Collection', areas: ['collection'],deskId:'desk-b', avatar: { hair:'short', clothes:'blue', skin:1,accessory:'glasses' } },
            { name: 'Ece', role:'Quality', areas:['cp','orders'],deskId:'desk-c', avatar:{ hair:'long', clothes:'green', skin:1 } }];
          for (const seed of seeds) await store.createProfile(profile.id, seed, allowedAreas(profile));
        }
        if (!seeded) await store.save(profile.id, 'metadata', {id:'initialized'});
        for (const job of state.jobs.filter(item => item.status === 'running' && Date.now() - Date.parse(item.updatedAt) > 360000 && !active.has(item.id))) await store.save(profile.id, 'job', {...job, status:'interrupted', errorCode:'OFFICE_PROCESS_INTERRUPTED'});
      })();
      initialized.set(profile.id, work); work.catch(() => initialized.delete(profile.id));
    }
    await initialized.get(profile.id); return profile;
  }
  async function state(profile) {
    profile = await ensure(profile);
    const value = await store.state(profile.id);
    return { ...value, capabilities: { areas: allowedAreas(profile), canModerate: profile.systemRole === 'moderator', canAutomate: canAutomate(profile),
      learning: 'persistent-context', runtime: 'buyer-log-open', outlook: false, voice: false, plmChanges: false },
      activeJobs: [...active.values()].filter(job => job.ownerId === profile.id).map(job => ({ id:job.id, profileIds:job.profileIds })), sync: sync?.status(profile.id) || { state:'local' } };
  }
  async function scan(profile, raw = {}, { force = false, areas = null } = {}) {
    profile = freshProfile(profile);
    const scope = scopeOf(raw), enabled = (areas || allowedAreas(profile)).filter(area => allowedAreas(profile).includes(area));
    const key = `${profile.id}:${hash(JSON.stringify({scope,enabled,authorization:profile}))}`, cached = scans.get(key);
    if (cached && !force && Date.now() - cached.at < 60000) return cached.result;
    const data = await getOperationalData(profile, scope, enabled), result = analyzeOperationalData({ ...data, scope });
    const snapshotId = hash(key), previous = (await store.records(profile.id)).find(doc => doc.kind === 'snapshot' && doc.id === snapshotId);
    result.changes = previous ? compareSnapshots(previous.values, result.snapshots) : [];
    result.comparison = { previousAt: previous?.capturedAt || null, firstObservation: !previous, sourceChangesAreNotContradictions: true };
    const fingerprint = hash(JSON.stringify(result.snapshots));
    if (!previous || previous.fingerprint !== fingerprint) {
      if (previous) await store.save(profile.id, 'snapshot', { ...previous, id:id(), archive:true }, { immutable:true });
      await store.save(profile.id, 'snapshot', { id:snapshotId, scope, fingerprint, values:result.snapshots, capturedAt:result.computedAt, archive:false });
    }
    scans.set(key, { at:Date.now(), result });
    if (scans.size > 80) scans.delete(scans.keys().next().value);
    return result;
  }
  async function createProfile(profile, raw) {
    profile = await ensure(profile);
    const result = await store.createProfile(profile.id, { ...raw, lineage:null }, allowedAreas(profile));
    audit(profile, 'AGENT_CREATE', result.id, { role:result.role }); return result;
  }
  async function updateProfile(profile, key, raw) {
    profile = freshProfile(profile);
    const result = await store.updateProfile(profile.id, key, raw, allowedAreas(profile));
    audit(profile, 'AGENT_PROFILE_UPDATE', key, { revision:result.revision }); return result;
  }
  async function learn(profile, profileId, raw) {
    profile = freshProfile(profile);
    const result = await store.learn(profile.id, profileId, raw);
    if(result.conflictingIds.length)await store.save(profile.id,'alert',{id:id(),profileId,kind:'memory-conflict',title:bilingual('Aynı konuda farklı hafıza kayıtları var · birlikte doğrula','Different memories share a topic · review them together'),findings:[{title:bilingual(result.key,result.key)}],sourceIds:[result.id,...result.conflictingIds],aiCalls:0,dismissed:false});
    audit(profile, 'AGENT_MEMORY_ADD', result.id, { profileId, type:result.type, conflicts:result.conflictingIds.length }); return result;
  }
  async function run(profile, raw, onProgress = () => {}) {
    profile = await ensure(profile);
    const ids = [...new Set(Array.isArray(raw.profileIds) ? raw.profileIds : [])], task = text(raw.task, 4000);
    if (!task || !ids.length || ids.length > 4) throw error('OFFICE_TASK_INVALID');
    if ([...active.values()].filter(job => job.ownerId === profile.id).length >= 2) throw error('OFFICE_BUSY', 429);
    const participants = [];
    for (const key of ids) participants.push(await store.get(profile.id, 'profile', key));
    let conv;
    if (raw.conversationId) {
      conv = await store.get(profile.id, 'conversation', raw.conversationId);
      if (JSON.stringify([...conv.profileIds].sort()) !== JSON.stringify([...ids].sort())) throw error('OFFICE_CONVERSATION_SCOPE', 409);
    } else conv = await store.conversation(profile.id, ids, task.slice(0, 80));
    const requestId = id(), resolvedScope = inferScope(task,raw.scope);
    const userMessage = await store.appendMessage(profile.id, conv.id, { role:'user', text:task, requestId });
    const job = await store.save(profile.id, 'job', { id:requestId, profileIds:ids, conversationId:conv.id, userMessageId:userMessage.id, type:raw.mode === 'automation' ? 'automation' : 'analysis',
      status:'running', task, scope:resolvedScope, calls:1, perspectiveMode:ids.length > 1 ? 'one-call-shared-perspectives' : 'single-agent' });
    active.set(job.id, job);
    let partial = '', archivedReply = false;
    const progress = event => { if (event.delta) partial += String(event.delta); onProgress(event); };
    try {
      const areas = [...new Set(participants.flatMap(agent => agent.areas))].filter(area => allowedAreas(profile).includes(area));
      const operations = areas.length ? await scan(profile, resolvedScope, { areas }) : { findings:[], changes:[], orders:[], coverage:{}, rowCount:0 };
      const memory = await store.selectContext(profile.id, ids, conv.id, task, 9000);
      const context = packContext({ participants:participants.map(agent => ({ id:agent.id, name:agent.name, role:agent.role, instructions:agent.instructions, areas:agent.areas, copied:!!agent.lineage })),
        coverage:{ ...operations.coverage, scope:resolvedScope, rowsAnalyzed:operations.rowCount, historyOmitted:memory.omittedCount, completeArchive:false, asAt:operations.sourceUpdatedAt, comparison:operations.comparison },
        memory:memory.selected, findings:operations.findings.slice(0,20), changes:operations.changes.slice(0,15),
        orderEvidence:operations.orders.slice(0,6).map(order => ({ id:order.orderKey, identity:order.identity, evidence:order.evidence, unavailable:order.unavailable, sources:order.sources })),
        supplierInsights:(operations.suppliers || []).slice(0,8), collectionEvidence:(operations.collection?.options || []).slice(0,8) });
      let source = 'agent-office', guide = '';
      if (raw.mode === 'automation') {
        if (!canAutomate(profile)) throw error('OFFICE_AUTOMATION_FORBIDDEN', 403);
        source = 'automations'; guide = await deps.automationGuide(profile);
      }
      const result = await engineOf().ask(profile.id, { requestId, source, task, context, guide, lang:raw.lang === 'en' ? 'en' : 'tr', onProgress:progress,
        signal:raw.signal });
      if (!result.structured?.ok || !result.data) {
        if (result.text) { await store.appendMessage(profile.id, conv.id, {role:'assistant',text:result.text,requestId,status:'failed',provenance:{origin:'unverified-ai-response',confidence:'LOW',contractValid:false}}); archivedReply = true; }
        throw error('OFFICE_AI_CONTRACT_INVALID', 422);
      }
      const response = result.data;
      const references = (response.references || []).filter(reference => context.referenceIds.includes(reference));
      const unsupportedReferences = (response.references || []).filter(reference => !context.referenceIds.includes(reference));
      const body = raw.mode === 'automation' ? result.text : response.answer;
      const reply = await store.appendMessage(profile.id, conv.id, { role:'assistant', text:body, requestId, model:result.model?.label,
        sourceIds:references, provenance:{ origin:'ai-proposal', confidence:!unsupportedReferences.length && !result.truncated && ['LOW','MEDIUM','HIGH'].includes(response.confidence) ? response.confidence : 'LOW',
          sourceUpdatedAt:operations.sourceUpdatedAt || null, contextOmitted:context.omitted + memory.omittedCount, unsupportedReferences,
          perspectives:(response.perspectives || []).filter(value => ids.includes(String(value).split('|')[0])),
          actions:response.actions || [], contradictions:response.contradictions || [], memoryCandidates:response.memoryCandidates || [],
          warnings:response.warnings || [], truncated:result.truncated === true, independentReviews:false } });
      archivedReply = true;
      let proposal = null;
      if (raw.mode === 'automation') proposal = await deps.validateAutomation(profile, response.code);
      const saved = await store.save(profile.id, 'job', { ...job, status:'completed', finishedAt:new Date().toISOString(), responseId:reply.id,
        proposedAutomation:proposal ? { code:response.code, preview:proposal } : null, findings:operations.findings.slice(0,30), changes:operations.changes.slice(0,30) });
      audit(profile, 'AGENT_JOB_COMPLETE', job.id, { participants:ids.length, calls:1, contextChars:JSON.stringify(context).length });
      return { job:saved, conversation:conv, message:reply, context:{ omitted:context.omitted + memory.omittedCount, chars:JSON.stringify(context).length, references:context.referenceIds } };
    } catch (err) {
      const code = /^LCWAI_|^OFFICE_|^AI_AUTOMATION_/.test(err.code || '') ? err.code : 'OFFICE_AI_FAILED';
      const status = raw.signal?.aborted || /CANCELLED/.test(code) ? 'cancelled' : 'failed';
      if (partial && !archivedReply) await store.appendMessage(profile.id, conv.id, {role:'assistant',text:partial,requestId,status:status === 'cancelled' ? 'cancelled' : 'interrupted',provenance:{origin:'partial-ai-response',confidence:'LOW',contractValid:false}});
      await store.appendMessage(profile.id, conv.id, { role:'system', text:code, status, requestId });
      await store.save(profile.id, 'job', { ...job, status, errorCode:code, finishedAt:new Date().toISOString() });
      throw err;
    } finally { active.delete(job.id); }
  }
  async function syncNow(profile, owners = []) {
    profile = await ensure(profile);
    if (owners.length && profile.systemRole !== 'moderator') throw error('OFFICE_MODERATOR_REQUIRED', 403);
    return sync.sync(profile, owners.slice(0,20));
  }
  async function publish(profile, profileId, confirmed) {
    profile = freshProfile(profile); if (confirmed !== true) throw error('OFFICE_APPROVAL_REQUIRED', 409);
    const agent = await store.get(profile.id, 'profile', profileId), memory = (await store.records(profile.id)).filter(doc => doc.kind === 'memory' && doc.profileId === profileId && doc.active && doc.approved && doc.shareable && (!doc.expiresAt || Date.parse(doc.expiresAt) > Date.now()) && doc.type !== 'inference');
    const entry = { version:1, ownerId:profile.id, ownerName:text(profile.displayName || profile.username || profile.id,80),
      profile:{ id:agent.id, name:agent.name, role:agent.role, instructions:agent.instructions, areas:agent.areas, avatar:agent.avatar, revision:agent.revision },
      memory:memory.map(doc => ({ id:doc.id, key:doc.key, text:doc.text, type:doc.type, confidence:doc.confidence, createdAt:doc.createdAt })),
      publishedAt:new Date().toISOString(), trainingMethod:'persistent-context', transcriptsIncluded:false };
    if (Buffer.byteLength(JSON.stringify(entry)) > 250 * 1024) throw error('OFFICE_CATALOG_TOO_LARGE', 413);
    await sync.publishCatalog(profile, entry); audit(profile, 'AGENT_CATALOG_PUBLISH', profileId, { memories:memory.length }); return entry;
  }
  async function copyAgent(profile, ownerId, profileId, mode = 'copy') {
    profile = await ensure(profile);
    const entry = (await sync.catalog()).find(item => item.ownerId === ownerId && item.profile.id === profileId);
    if (!entry) throw error('OFFICE_CATALOG_NOT_FOUND', 404);
    const agent = await store.createProfile(profile.id, { ...entry.profile, lineage:{ ownerId, profileId, revision:entry.profile.revision, mode:mode === 'rental' ? 'rental' : 'copy', copiedAt:new Date().toISOString() } }, allowedAreas(profile));
    for (const memory of entry.memory || []) {
      // Copied learning is evidence until the new owner approves it.
      const saved = await store.learn(profile.id, agent.id, { ...memory, approved:false, shareable:false, sourceId:memory.id });
      await store.save(profile.id, 'memory', { ...saved, origin:'copied', confidence:'UNVERIFIED', approved:false });
    }
    audit(profile, 'AGENT_COPY', agent.id, { ownerId, profileId, mode, sourceRevision:entry.profile.revision }); return agent;
  }
  function archiveRange(total, raw) {
    const start=Number(raw.startPart ?? 0),count=Number(raw.partCount ?? Math.min(15,Math.max(0,total-start)));
    if(!Number.isInteger(start)||!Number.isInteger(count)||start<0||start>=Math.max(1,total)||count<0||count>15||(total&&count<1))throw error('OFFICE_ARCHIVE_BATCH_LIMIT',409);
    return {start,count:Math.min(count,Math.max(0,total-start))};
  }
  async function trainingPreview(profile, raw = {}) {
    profile = freshProfile(profile);
    const owner = raw.ownerId || profile.id;
    if (owner !== profile.id && profile.systemRole !== 'moderator') throw error('OFFICE_MODERATOR_REQUIRED', 403);
    const records = await store.exportTraining(owner, raw.profileIds), chunks = trainingChunks(records);
    const range=archiveRange(chunks.length,raw);
    return { ownerId:owner, fingerprint:hash(JSON.stringify([records,range])), records:records.length, bytes:chunks.reduce((sum,item) => sum + item.buffer.length,0),range,totalParts:chunks.length,
      parts:chunks.map((chunk,index) => ({ index, fileName:chunk.name, bytes:chunk.buffer.length, sourceCount:chunk.sourceIds.length,selected:index>=range.start&&index<range.start+range.count })),
      estimatedCalls:range.count + Number(range.count > 1), limitBytes:20 * 1024 * 1024, uploadedDoesNotMeanFullyRead:true };
  }
  async function archivePart(profile, raw) {
    const preview = await trainingPreview(profile, raw);
    const records = await store.exportTraining(preview.ownerId, raw.profileIds), chunks = trainingChunks(records), part = chunks[Number(raw.index)];
    if (!part) throw error('OFFICE_PART_NOT_FOUND',404);
    if (preview.ownerId !== profile.id) audit(profile, 'AGENT_TRAINING_EXPORT', preview.ownerId, { part:Number(raw.index), bytes:part.buffer.length });
    return part;
  }
  async function reviewArchive(profile, raw, onProgress = () => {}) {
    profile = freshProfile(profile);
    if ([...active.values()].filter(job => job.ownerId === profile.id).length >= 2) throw error('OFFICE_BUSY',429);
    const preview = await trainingPreview(profile, raw);
    if (raw.confirmed !== true || raw.fingerprint !== preview.fingerprint || Number(raw.maxCalls) < preview.estimatedCalls) throw error('OFFICE_COST_APPROVAL_REQUIRED',409);
    if (!preview.parts.length || preview.estimatedCalls > 16) throw error('OFFICE_ARCHIVE_BATCH_LIMIT',409);
    const records = await store.exportTraining(preview.ownerId, raw.profileIds), chunks = trainingChunks(records).slice(preview.range.start,preview.range.start+preview.range.count), jobId = id();
    let job = await store.save(profile.id, 'job', { id:jobId, profileIds:raw.profileIds || [], type:'archive-review', status:'running', calls:0, plannedCalls:preview.estimatedCalls, sourceOwnerId:preview.ownerId,range:preview.range,totalParts:preview.totalParts });
    active.set(jobId, job);
    const summaries = [];let partial='',part=-1;const progress=event=>{if(event.delta)partial+=String(event.delta);onProgress(event);};
    try {
      for (let index=0; index<chunks.length; index++) {
        if (raw.signal?.aborted) throw error('LCWAI_CANCELLED',499);
        onProgress({ phase:'archive-part', index, total:chunks.length, jobId });
        const chunk = chunks[index];part=preview.range.start+index;partial='';
        const result = await engineOf().askWithFiles(profile.id, { requestId:`${jobId}-${index}`, source:'agent-office', task:text(raw.task || 'Summarize decisions, contradictions and open actions. Preserve source IDs and dates; do not treat old facts as current.',4000),
          context:{ part:preview.range.start+index+1, totalParts:preview.totalParts,selectedParts:chunks.length, sourceOwner:preview.ownerId, completeArchive:false },
          files:[{ fileName:chunk.name, buffer:chunk.buffer, contentType:'text/markdown' }], lang:raw.lang || 'tr', signal:raw.signal, onProgress:progress });
        if (!result.data || !result.structured?.ok) {await store.save(profile.id,'summary',{id:id(),profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [],text:result.text || '',sourceIds:chunk.sourceIds,sourceOwnerId:preview.ownerId,part,origin:'unverified-ai-response',confidence:'LOW',contractValid:false,requiresVerification:true});throw error('OFFICE_AI_CONTRACT_INVALID',422);}
        partial='';
        const summary = await store.save(profile.id, 'summary', { id:id(), profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [], text:result.data.answer,
          sourceIds:chunk.sourceIds, sourceOwnerId:preview.ownerId, sourceFingerprint:preview.fingerprint, rawResponse:result.text, part:preview.range.start+index, origin:'ai-inference', confidence:'LOW', requiresVerification:true });
        summaries.push(summary); job.calls++;
        job = await store.save(profile.id,'job',{...job, completedParts:index+1});
      }
      let combined = summaries[0]?.text || '';
      if (summaries.length > 1) {
        partial='';part=-1;
        const context = packContext({ summaries:summaries.map(doc => ({id:doc.id,text:doc.text})), coverage:{ parts:summaries.length, fullSourceReadUnverified:true } });
        const result = await engineOf().ask(profile.id,{ requestId:`${jobId}-merge`, source:'agent-office', task:text(raw.task || 'Combine these part summaries. Identify contradictions using dates and sources, and retain original evidence references.',4000), context, lang:raw.lang || 'tr', signal:raw.signal, onProgress:progress });
        if (!result.data || !result.structured?.ok) {await store.save(profile.id,'summary',{id:id(),profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [],text:result.text || '',sourceOwnerId:preview.ownerId,origin:'unverified-ai-response',confidence:'LOW',contractValid:false,requiresVerification:true});partial='';throw error('OFFICE_AI_CONTRACT_INVALID',422);}
        partial='';
        combined = result.data.answer; job.calls++;
        await store.save(profile.id,'summary',{id:id(),profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [],text:combined,rawResponse:result.text,sourceIds:summaries.map(item=>item.id),sourceOwnerId:preview.ownerId,sourceFingerprint:preview.fingerprint,origin:'ai-inference',confidence:'LOW',requiresVerification:true});
      }
      job = await store.save(profile.id,'job',{...job,status:'completed',finishedAt:new Date().toISOString(),text:combined,summaryIds:summaries.map(doc=>doc.id), completeness:'uploaded-parts-not-proof-of-full-reading'});
      audit(profile,'AGENT_ARCHIVE_REVIEW',jobId,{calls:job.calls,ownerId:preview.ownerId}); return { job };
    } catch(err) { if(partial)await store.save(profile.id,'summary',{id:id(),profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [],text:partial,sourceOwnerId:preview.ownerId,part,origin:'partial-ai-response',confidence:'LOW',contractValid:false,requiresVerification:true});await store.save(profile.id,'job',{...job,status:raw.signal?.aborted?'cancelled':'failed',finishedAt:new Date().toISOString(),errorCode:err.code || 'OFFICE_AI_FAILED'}); throw err; }
    finally { active.delete(jobId); }
  }
  async function moderation(profile, ownerId) {
    profile = freshProfile(profile); if (profile.systemRole !== 'moderator') throw error('OFFICE_MODERATOR_REQUIRED',403);
    if (!userAccess.profileById(ownerId)) throw error('OFFICE_OWNER_NOT_FOUND',404);
    await sync.sync(profile,[ownerId]);
    const result = await store.state(ownerId);
    audit(profile,'AGENT_TRAINING_READ',ownerId,{profiles:result.profiles.length,messages:result.archive.messages});
    return { ...result, ownerId, trainingMethod:'persistent-context' };
  }
  async function mergePreview(profile, selections) {
    profile = freshProfile(profile); if (profile.systemRole !== 'moderator') throw error('OFFICE_MODERATOR_REQUIRED',403);
    if (!Array.isArray(selections) || selections.length < 2 || selections.length > 12) throw error('OFFICE_MERGE_SCOPE');
    const candidates = [], profiles = [];
    for (const selection of selections) {
      const agent = await store.get(selection.ownerId,'profile',selection.profileId); profiles.push({ownerId:selection.ownerId,profileId:agent.id,revision:agent.revision});
      if(agent.instructions)candidates.push({id:'profile-instruction:'+selection.ownerId+':'+agent.id,kind:'memory',profileId:agent.id,type:'instruction',text:agent.instructions,key:'',approved:true,active:true,sourceOwnerId:selection.ownerId,sourceId:agent.id,origin:'profile-instructions',updatedAt:agent.updatedAt});
      candidates.push(...(await store.records(selection.ownerId)).filter(doc => doc.kind==='memory' && doc.profileId===agent.id && doc.active && doc.approved && (!doc.expiresAt || Date.parse(doc.expiresAt) > Date.now()) && doc.type!=='inference').map(doc=>({...doc,sourceOwnerId:selection.ownerId})));
    }
    const unique = [], seen = new Set(), byKey = new Map();
    for (const candidate of candidates) {
      const key = candidate.text.toLocaleLowerCase('tr-TR').replace(/\s+/g,' ');
      if (seen.has(key)) continue; seen.add(key); unique.push(candidate);
      if (candidate.key) { if(!byKey.has(candidate.key))byKey.set(candidate.key,[]); byKey.get(candidate.key).push(candidate); }
    }
    const conflicts = [...byKey].filter(([,items])=>new Set(items.map(item=>item.text)).size>1).map(([key,items])=>({key,ids:items.map(item=>item.id),texts:items.map(item=>item.text)}));
    return { profiles,candidates:unique,conflicts,duplicates:candidates.length-unique.length,fingerprint:hash(JSON.stringify({profiles,unique})),aiCalls:0 };
  }
  async function merge(profile, raw) {
    const preview = await mergePreview(profile,raw.selections);
    if (raw.confirmed !== true || raw.fingerprint !== preview.fingerprint) throw error('OFFICE_APPROVAL_REQUIRED',409);
    const chosen = new Set(raw.memoryIds || []), conflicting = new Set(preview.conflicts.flatMap(item=>item.ids));
    for (const conflict of preview.conflicts) if (conflict.ids.filter(key=>chosen.has(key)).length>1) throw error('OFFICE_MEMORY_CONFLICT',409);
    const agent = await store.createProfile(profile.id,{ name:raw.name,role:'Combined',areas:allowedAreas(profile),lineage:{ mode:'merged',sources:preview.profiles } },allowedAreas(profile));
    for (const candidate of preview.candidates) if(chosen.has(candidate.id)) {
      const saved = await store.learn(profile.id,agent.id,{...candidate,sourceId:candidate.id,approved:true,shareable:false});
      await store.save(profile.id,'memory',{...saved,origin:'moderator-curated',sourceOwnerId:candidate.sourceOwnerId,requiresVerification:conflicting.has(candidate.id)});
    }
    audit(profile,'AGENT_TRAINING_MERGE',agent.id,{sources:preview.profiles.length,memories:chosen.size}); return agent;
  }
  async function watch(profile, raw) {
    profile = await ensure(profile); await store.get(profile.id,'profile',raw.profileId);
    if ((await store.state(profile.id)).watches.length >= 30) throw error('OFFICE_WATCH_LIMIT',409);
    let timeZone='UTC';try{new Intl.DateTimeFormat('en',{timeZone:raw.timeZone || 'UTC'}).format();timeZone=raw.timeZone || 'UTC';}catch(_){throw error('OFFICE_TIMEZONE_INVALID');}
    const result = await store.save(profile.id,'watch',{id:id(),profileId:raw.profileId,name:text(raw.name || 'Watch',100),scope:scopeOf(raw.scope),timeZone,enabled:true,
      mode:raw.mode==='daily'?'daily':'changes',lastFingerprint:null,lastNotifiedAt:null});
    audit(profile,'AGENT_WATCH_CREATE',result.id,{mode:result.mode}); return result;
  }
  async function checkWatches(profile) {
    profile = freshProfile(profile);
    for(const watcher of (await store.state(profile.id)).watches.filter(doc=>doc.enabled)) {
      const agent = await store.get(profile.id,'profile',watcher.profileId), result = await scan(profile,watcher.scope,{areas:agent.areas});
      const actionable = result.findings.filter(item=>['CRITICAL','HIGH','MEDIUM'].includes(item.severity));
      const fingerprint=hash(JSON.stringify({findings:actionable.map(item=>({id:item.id,severity:item.severity,reasons:item.reasons})),values:result.snapshots})), day=new Intl.DateTimeFormat('en-CA',{timeZone:watcher.timeZone || 'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const changed=watcher.lastFingerprint!==fingerprint, daily=watcher.mode==='daily'&&watcher.lastDay!==day;
      if((actionable.length || result.changes.length) && (changed||daily)) await store.save(profile.id,'alert',{id:id(),profileId:agent.id,watchId:watcher.id,scope:watcher.scope,
        title:bilingual('Takip ettiğin konuda aksiyon gerekiyor','Your watched topic needs action'),findings:actionable.slice(0,30),changes:result.changes.slice(0,20),fingerprint,aiCalls:0,dismissed:false});
      if(changed||daily)await store.save(profile.id,'watch',{...watcher,lastFingerprint:fingerprint,lastDay:day,lastCheckedAt:new Date().toISOString()});
    }
  }
  async function notifications(profile) {
    profile = freshProfile(profile); activate(profile);
    const docs = await store.records(profile.id);
    return {alerts:docs.filter(doc => doc.kind === 'alert' && !doc.dismissed).slice(-100), watching:docs.filter(doc => doc.kind === 'watch' && doc.enabled).length};
  }
  async function background() {
    if (backgroundRunning) return; backgroundRunning = true;
    try { for(const [owner,entry] of actors) {
      if(Date.now()-entry.lastSeen>30*60000){actors.delete(owner);continue;}
      const profile=userAccess.profileById(owner);
      if(!profile||profile.enabled===false){actors.delete(owner);continue;}
      try{await checkWatches(profile);if(sync)await sync.sync(profile);}catch(err){ deps.onBackgroundError?.(err.code || 'OFFICE_BACKGROUND_FAILED'); }
    }
    } finally { backgroundRunning = false; }
  }
  return { notifications, state, scan, createProfile, updateProfile, learn, run, syncNow, publish, copyAgent, trainingPreview, archivePart, reviewArchive,
    moderation, mergePreview, merge, watch, checkWatches, allowedAreas, activate,
    canAutomate, stop:()=>{if(timer)clearInterval(timer);timer=null;}, engineOf, store, sync, packContext };
}
module.exports = { createAgentOfficeService, packContext, trainingChunks, scopeOf, inferScope };
