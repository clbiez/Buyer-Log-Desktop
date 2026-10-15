'use strict';

const { id, hash, error, text, AREAS } = require('./agent-office-store');
const { analyzeOperationalData, compareSnapshots, severityLevel, bilingual } = require('./agent-office-intelligence');
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
  /* Taban (katılımcılar + kapsam) bütçeyi aşarsa çağrı reddedilmez: büyük
     kapsam alanları özetlenir, talimatlar katılımcı başına eşit payla kısaltılır
     ve bu açıkça işaretlenir. Eskiden 6000 karakterlik talimatlı bir agentla
     bile "talimatlar çok büyük" hatası alınabiliyordu. */
  context.coverage = { ...context.coverage };
  for (const [key, value] of Object.entries(context.coverage)) {
    const size = JSON.stringify(value ?? null).length;
    if (size > 800) context.coverage[key] = { omitted: true, size };
  }
  // Tek tek küçük ama toplamda büyük kapsam da bütçenin dörtte birini aşmaz: en büyük alanlar özetlenir.
  const coverageBudget = Math.floor(max * 0.25);
  while (JSON.stringify(context.coverage).length > coverageBudget) {
    const [key, size] = Object.entries(context.coverage).filter(([, value]) => !(value && value.omitted === true))
      .map(([name, value]) => [name, JSON.stringify(value ?? null).length]).sort((a, b) => b[1] - a[1])[0] || [];
    if (!key || size <= 40) break;
    context.coverage[key] = { omitted: true, size };
  }
  const baseBudget = Math.floor(max * 0.55);
  const withoutInstructions = JSON.stringify({ ...context, participants: context.participants.map(item => ({ ...item, instructions: [] })) }).length;
  const share = Math.max(400, Math.floor((baseBudget - withoutInstructions) / Math.max(1, context.participants.length)));
  for (const participant of context.participants) {
    const full = String(participant.instructions || '');
    const kept = full.length > share ? full.slice(0, share) : full;
    if (kept.length < full.length) { participant.instructionsTrimmed = { kept: kept.length, total: full.length }; context.omitted++; }
    participant.instructions = kept.match(/[\s\S]{1,1500}/g) || [];
  }
  // Kalem listeleri doldurmadan ÖNCE açılır; sonradan eklenen boş listeler
  // sınırın hemen altına kadar dolmuş paketi taşırıyordu.
  const lists = Object.entries(parts).filter(([name]) => name !== 'coverage' && name !== 'participants');
  for (const [name] of lists) context[name] = [];
  for (const [name, list] of lists) {
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
function shareableGuidance(doc){return doc.active&&!doc.deleted&&!doc.supersededBy&&!doc.conflictingIds?.length&&doc.approved===true&&['instruction','preference','decision'].includes(doc.type)&&!doc.sourceId&&!doc.sourceRecord&&!doc.verifiedSource&&!doc.sourceRevision&&!doc.authorizationFingerprint&&!doc.toolIds?.length&&(!doc.expiresAt||Date.parse(doc.expiresAt)>Date.now());}
function createAgentOfficeService(deps) {
  const { store, sync, userAccess, engine, getOperationalData } = deps;
  const runtimeInstanceId=id();
  const initialized = new Map(), active = new Map(), scans = new Map(), actors = new Map();
  let timer = null, backgroundRunning = false;
  const assistantChecks=new Map();
  const freshProfile = profile => {
    const current = userAccess.profileById ? userAccess.profileById(profile.id) : profile;
    if (!current || current.enabled === false) throw error('OFFICE_USER_DISABLED', 403);
    return current;
  };
  const canAutomate = profile => userAccess.hasArea(profile,'automations') && userAccess.hasCapability?.(profile,'AUTOMATIONS.CREATE') === true;
  const allowedAreas = profile => AREAS.filter(area => userAccess.hasArea(profile, moduleArea(area)));
  const audit = (profile, action, target, detail) => userAccess.appendAudit(profile, action, target, detail);
  const engineOf = () => typeof engine === 'function' ? engine() : engine;
  const memoryPolicy=require('./agent-memory-policy').createMemoryPolicy({store,userAccess,registry:deps.toolRegistry,dataset:deps.memoryDataset});
  const memoryContext=(profile,ids,conversationId,query,budget,options)=>memoryPolicy.context(profile,ids,conversationId,query,budget,options);
  function activate(profile) {
    actors.set(profile.id, { lastSeen: Date.now() });
    if (!timer) { timer = setInterval(background, 120000); timer.unref?.(); }
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
        for (const job of state.jobs.filter(item => item.type!=='capability-task'&&item.status === 'running' && !active.has(item.id) && (item.runtimeDeviceId===store.db(profile.id).getDeviceId()&&item.runtimeInstanceId!==runtimeInstanceId || !item.runtimeInstanceId&&Date.now()-Date.parse(item.updatedAt)>360000))) await store.save(profile.id, 'job', {...job, status:'interrupted', errorCode:'OFFICE_PROCESS_INTERRUPTED'});
      })();
      initialized.set(profile.id, work); work.catch(() => initialized.delete(profile.id));
    }
    await initialized.get(profile.id); return profile;
  }
  async function assistantSettings(profile){const docs=await store.records(profile.id);const saved=docs.find(d=>d.kind==='metadata'&&d.id==='assistant-settings');return saved||{id:'assistant-settings',enabled:true,desktopBackground:false,timeZone:'UTC',intervalMinutes:5,dailyHour:9,severity:'HIGH',revision:0};}
  async function configureAssistant(profile,raw){profile=await ensure(profile);const previous=await assistantSettings(profile);let timeZone=raw.timeZone||previous.timeZone;try{new Intl.DateTimeFormat('en',{timeZone}).format();}catch(_){throw error('OFFICE_TIMEZONE_INVALID');}
    const settings={...previous,enabled:raw.enabled===undefined?previous.enabled:raw.enabled===true,desktopBackground:raw.desktopBackground===undefined?previous.desktopBackground:raw.desktopBackground===true,timeZone,intervalMinutes:Math.max(2,Math.min(30,Math.round(Number(raw.intervalMinutes)||previous.intervalMinutes))),dailyHour:Math.max(0,Math.min(23,Math.round(Number(raw.dailyHour??previous.dailyHour)))),severity:['HIGH','MEDIUM','WATCH'].includes(raw.severity)?raw.severity:previous.severity};
    const result=await store.save(profile.id,'metadata',settings,{expectedRevision:raw.revision??previous.revision});assistantChecks.delete(profile.id);audit(profile,'AGENT_ASSISTANT_CONFIGURE',profile.id,{enabled:result.enabled,intervalMinutes:result.intervalMinutes});return result;}
  async function checkAssistant(profile){profile=freshProfile(profile);const settings=await assistantSettings(profile);if(!settings.enabled)return;const previous=assistantChecks.get(profile.id),now=Date.now();if(previous&&(previous.running||now-previous.at<settings.intervalMinutes*60000))return;assistantChecks.set(profile.id,{at:now,running:true});
    try{const result=await scan(profile,{},{});const actionable=result.findings.filter(f=>severityLevel(f.severity)>=({HIGH:3,MEDIUM:2,WATCH:1}[settings.severity]||3));
      const fingerprint=hash(JSON.stringify({findings:actionable.map(f=>[f.id,f.severity,f.reasons,f.action]),snapshots:result.snapshots})),docs=await store.records(profile.id),record=docs.find(d=>d.kind==='metadata'&&d.id==='assistant-observation');
      const local=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',hourCycle:'h23'}).formatToParts(new Date());const datePart=type=>local.find(p=>p.type===type)?.value;const day=[datePart('year'),datePart('month'),datePart('day')].join('-'),daily=Number(datePart('hour'))>=settings.dailyHour&&record?.lastDay!==day,changed=record?.fingerprint!==fingerprint;
      if((actionable.length||result.changes.length)&&(changed||daily))await store.save(profile.id,'alert',{id:id(),kind:daily?'daily-brief':'assistant-risk',title:bilingual(daily?'Günlük asistan özeti hazır':'Asistanın operasyonel risk tespit etti',daily?'Your daily assistant brief is ready':'Your assistant detected operational risk'),findings:actionable.slice(0,30),changes:result.changes.slice(0,20),totalFindings:actionable.length,sourceUpdatedAt:result.sourceUpdatedAt,coverage:Object.fromEntries(['cp','orders','collection','backlog','lfl','bom','checklists','tests','samples'].filter(key=>result.coverage[key]!==undefined).map(key=>[key,typeof result.coverage[key]==='object'?'available':result.coverage[key]])),aiCalls:0,dismissed:false});
      await store.save(profile.id,'metadata',{id:'assistant-observation',fingerprint,lastDay:daily?day:record?.lastDay||'',checkedAt:new Date().toISOString()});
    }finally{assistantChecks.set(profile.id,{at:Date.now(),running:false});}}
  async function state(profile) {
    profile = await ensure(profile);
    const value = await store.state(profile.id);
    const assistant=await assistantSettings(profile);profile=freshProfile(profile);
    const publicTasks=service.taskPublicState?await service.taskPublicState(profile,value.jobs,value.memory):{jobs:value.jobs,memory:value.memory};
    return { ...value, ...publicTasks, assistant, capabilities: { areas: allowedAreas(profile), canModerate: profile.systemRole === 'moderator', canAutomate: canAutomate(profile),
      learning: 'persistent-context', runtime: 'buyer-log-open', outlook: false, voice: false, plmChanges: false, cpTools:Boolean(deps.toolRegistry && deps.runtime)&&userAccess.hasArea(profile,'cp'), cpDrafts:userAccess.hasArea(profile,'automations') },
      activeJobs: [...active.values()].filter(job => job.ownerId === profile.id).map(job => ({ id:job.id, profileIds:job.profileIds,phase:job.phase||'review' })), sync: sync?.status(profile.id) || { state:'local' } };
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
    const agent=await store.get(profile.id,'profile',profileId),source=raw.sourceRef?await memoryPolicy.source(profile,[agent],raw.sourceRef):null;
    if(source&&raw.type!=='fact')throw error('OFFICE_MEMORY_SOURCE_INVALID',422);
    const expected=memoryPolicy.fingerprint(profile);
    const parent=raw.sourceId?(await store.records(profile.id)).find(doc=>doc.id===raw.sourceId&&['memory','message','job','summary'].includes(doc.kind)):null;
    if(raw.sourceId&&(!parent||!(parent.profileId===profileId||parent.profileIds?.includes(profileId))))throw error('OFFICE_MEMORY_SOURCE_INVALID',422);
    const inherited=parent?{sourceRecord:{kind:parent.kind,id:parent.id,revision:parent.revision},authorizationFingerprint:parent.authorizationFingerprint||hash('legacy-source:'+parent.id),...Object.fromEntries(['verifiedSource','sourceRevision','toolIds','taskId'].filter(key=>parent[key]!=null).map(key=>[key,parent[key]]))}:{};
    if(parent?.steps)inherited.toolIds=parent.steps.filter(step=>step.agentId===profileId).map(step=>step.toolId);
    const result = await store.learn(profile.id, profileId, raw,{expectedAgentRevision:agent.revision,assertAuthority:(_agent,state)=>{if(expected!==memoryPolicy.fingerprint(freshProfile(profile))||parent&&state.records[parent.kind+':'+parent.id]?.doc?.revision!==parent.revision)throw error('OFFICE_PREVIEW_CHANGED',409);},metadata:{...inherited,...(source?{verifiedSource:source,sourceRevision:source.revision,authorizationFingerprint:expected}:{})}});
    if(result.conflictingIds.length)await store.save(profile.id,'alert',{id:id(),profileId,kind:'memory-conflict',title:bilingual('Aynı konuda farklı hafıza kayıtları var · birlikte doğrula','Different memories share a topic · review them together'),findings:[{title:bilingual(result.key,result.key)}],sourceIds:[result.id,...result.conflictingIds],aiCalls:0,dismissed:false});
    audit(profile, 'AGENT_MEMORY_ADD', result.id, { profileId, type:result.type, conflicts:result.conflictingIds.length }); return result;
  }
  async function run(profile, raw, onProgress = () => {}, internal = {}) {
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
    const runAuthority=memoryPolicy.fingerprint(profile);
    async function assertRunScope(){const latest=await Promise.all(ids.map(key=>store.get(profile.id,'profile',key)));if(latest.some((agent,i)=>agent.revision!==participants[i].revision)||runAuthority!==memoryPolicy.fingerprint(freshProfile(profile)))throw error('OFFICE_PREVIEW_CHANGED',409);}
    // Görev cevabı, sahibin konuşmada zaten yazdığı mesaja bağlanır; mesaj ikinci kez eklenmez.
    let reused = null;
    if (internal.reuseUserMessageId) {
      try { reused = await store.get(profile.id, 'message', internal.reuseUserMessageId); } catch (_) { reused = null; }
      if (reused && (reused.conversationId !== conv.id || reused.role !== 'user')) reused = null;
    }
    const userMessage = reused || await store.appendMessage(profile.id, conv.id, { role:'user', text:task, requestId,authorizationFingerprint:runAuthority });
    if (typeof internal.afterUserMessage === 'function') await internal.afterUserMessage(conv);
    let job = await store.save(profile.id, 'job', { id:requestId, profileIds:ids, conversationId:conv.id, userMessageId:userMessage.id, type:raw.mode === 'automation' ? 'automation' : 'analysis',
      runtimeInstanceId,runtimeDeviceId:store.db(profile.id).getDeviceId(),authorizationFingerprint:runAuthority,status:'running', task, scope:resolvedScope, calls:0, perspectiveMode:ids.length > 1 ? 'one-call-shared-perspectives' : 'single-agent' });
    active.set(job.id, {...job,ownerId:profile.id,phase:'review'});
    onProgress({phase:'review',jobId:job.id,profileIds:ids});
    let partial = '', archivedReply = false, aiAttempted=false;
    const progress = event => { if (event.delta) {partial += String(event.delta);const running=active.get(job.id);if(running)running.phase='responding';} onProgress(event); };
    try {
      const areas = [...new Set(participants.flatMap(agent => agent.areas))].filter(area => allowedAreas(profile).includes(area));
      const operations = areas.length ? await scan(profile, resolvedScope, { areas }) : { findings:[], changes:[], orders:[], coverage:{}, rowCount:0 };
      const memory = await memoryContext(profile, ids, conv.id, task, 9000);
      const context = packContext({ participants:participants.map(agent => ({ id:agent.id, name:agent.name, role:agent.role, instructions:agent.instructions, areas:agent.areas, copied:!!agent.lineage })),
        coverage:{ ...operations.coverage, scope:resolvedScope, rowsAnalyzed:operations.rowCount, historyOmitted:memory.omittedCount, completeArchive:false, asAt:operations.sourceUpdatedAt, comparison:operations.comparison },
        handoffs:internal.handoffs||[],orchestration:internal.orchestration?[internal.orchestration]:[],evidenceAttachments:internal.evidenceAttachments||[],
        memory:memory.selected, findings:operations.findings.slice(0,20), changes:operations.changes.slice(0,15),
        orderEvidence:operations.orders.slice(0,6).map(order => ({ id:order.orderKey, identity:order.identity, evidence:order.evidence,bom:order.bom?{...order.bom,components:order.bom.components.slice(0,20),omittedComponents:Math.max(0,order.bom.components.length-20)}:null,collection:order.collection, unavailable:order.unavailable, sources:order.sources })),
        decisionSupport:operations.decisionSupport?[{supplierHistory:operations.decisionSupport.supplierHistory.slice(0,8),collectionPipeline:operations.decisionSupport.collectionPipeline.slice(0,8),historicalPrices:operations.decisionSupport.historicalPrices.slice(0,3).map(p=>({...p,suppliers:p.suppliers.slice(0,8)})),omittedSuppliers:Math.max(0,operations.decisionSupport.supplierHistory.length-8)}]:[],
        bomEvidence:(operations.bomEvidence||[]).slice(0,6),
        supplierInsights:(operations.suppliers || []).slice(0,8), collectionEvidence:(operations.collection?.options || []).slice(0,8) });
      if(context.handoffs.length!==(internal.handoffs||[]).length||context.evidenceAttachments.length!==(internal.evidenceAttachments||[]).length||context.orchestration.length!==(internal.orchestration?1:0))throw error('OFFICE_CONTEXT_TOO_LARGE',413);
      let source = 'agent-office', guide = '';
      // Az önce çalışan görev adımlarının doğrulanmış sonuçları rehber metni olarak gider (bağlam JSON sınırına takılmaz).
      // Konuşmanın son mesajları tam metin gider: önceki cevaptaki liste/taslak üzerinde sohbet sürebilsin.
      if (raw.mode !== 'automation') {
        /* Yalnız isteğe kadarki mesajlar ve yalnız sahibin bugünkü yetkisiyle yazılmış agent cevapları gider:
           yetkisi kaldırılan bir alandan gelen eski cevap LCW AI'a yeniden taşınmaz. Sahibin kendi yazdığı mesaj
           parmak izi taşımasa da onun sözüdür. */
        const before = (await store.messages(profile.id, conv.id, { before: userMessage.id, limit: 14 })).messages;
        const recent = before.filter(item => item.role !== 'system' && item.text && (!item.status || item.status === 'complete')
          && (item.role === 'user' ? !item.authorizationFingerprint || item.authorizationFingerprint === runAuthority : item.authorizationFingerprint === runAuthority)).slice(-6);
        const lines = []; let room = 8000;
        for (const item of recent.reverse()) {
          const who = item.role === 'user' ? 'owner' : participants.filter(agent => (item.profileIds || []).includes(agent.id) || item.provenance?.speaker === agent.id).map(agent => agent.name).join(', ') || 'agent';
          if (room < 200) break;
          // Taslaklar cevap metninde değil, kendi alanında durur: "CC'ye ekle", "Türkçe yap" gibi devam istekleri için birlikte gider.
          const drafts = (item.provenance?.emailDrafts || []).map((draft, index) => [`[draft ${index + 1}]`, `To: ${draft.to.join('; ')}`, draft.cc.length ? `Cc: ${draft.cc.join('; ')}` : '', `Subject: ${draft.subject}`, draft.body].filter(Boolean).join('\n'));
          const full = [item.text, ...drafts].join('\n\n'), body = full.slice(0, room - 40);
          lines.unshift(`--- ${who}${body.length < full.length ? ' (cut)' : ''} ---\n${body}`); room -= body.length + 40;
        }
        if (lines.length) { guide = '=== RECENT CONVERSATION ===\n' + lines.join('\n'); context.recentConversation = [{ messages: lines.length }]; }
      }
      // Az önce çalışan görev adımlarının doğrulanmış sonuçları rehber metni olarak gider (bağlam JSON sınırına takılmaz).
      if (internal.taskResults?.text) { guide = [guide, '=== TASK RESULTS ===\n' + internal.taskResults.text].filter(Boolean).join('\n\n'); context.taskResults = [{ taskId: internal.taskResults.taskId, lead: internal.taskResults.lead }]; }
      if (Array.isArray(internal.pricingPackages) && internal.pricingPackages.length) context.pricingPackages = internal.pricingPackages.slice(0, 30);
      if (raw.mode === 'automation') {
        if (!canAutomate(profile)) throw error('OFFICE_AUTOMATION_FORBIDDEN', 403);
        source = 'automations'; guide = await deps.automationGuide(profile);
      }
      const ai=engineOf(),ask=internal.files?.length?ai.askWithFiles.bind(ai):ai.ask.bind(ai);
      await assertRunScope();
      job=await store.save(profile.id,'job',{...job,calls:1});
      onProgress({phase:'ai-call',jobId:job.id,profileIds:ids});
      await assertRunScope();aiAttempted=true;
      const result = await ask(profile.id, { files:internal.files||[],requestId, source, task, context, guide, lang:raw.lang === 'en' ? 'en' : 'tr', onProgress:progress,
        signal:raw.signal });
      try{await assertRunScope();}catch(scopeError){
        const reply=result.data?.answer||result.text;if(reply){await store.appendMessage(profile.id,conv.id,{role:'assistant',text:reply,requestId,status:'failed',authorizationFingerprint:runAuthority,provenance:{origin:'scope-changed-ai-response',confidence:'LOW',contractValid:false}});archivedReply=true;}throw scopeError;
      }
      if (!result.structured?.ok || !result.data) {
        if (result.text) { await store.appendMessage(profile.id, conv.id, {role:'assistant',text:result.text,requestId,authorizationFingerprint:runAuthority,status:'failed',provenance:{origin:'unverified-ai-response',confidence:'LOW',contractValid:false}}); archivedReply = true; }
        throw error('OFFICE_AI_CONTRACT_INVALID', 422);
      }
      const response = result.data;
      const references = (response.references || []).filter(reference => context.referenceIds.includes(reference));
      const unsupportedReferences = (response.references || []).filter(reference => !context.referenceIds.includes(reference));
      const body = raw.mode === 'automation' ? result.text : response.answer;
      const reply = await store.appendMessage(profile.id, conv.id, { role:'assistant', text:body, requestId, model:result.model?.label,authorizationFingerprint:runAuthority,
        sourceIds:references, provenance:{ origin:'ai-proposal', confidence:!unsupportedReferences.length && !result.truncated && ['LOW','MEDIUM','HIGH'].includes(response.confidence) ? response.confidence : 'LOW',
          sourceUpdatedAt:operations.sourceUpdatedAt || null, contextOmitted:context.omitted + memory.omittedCount, unsupportedReferences,
          perspectives:(response.perspectives || []).filter(value => ids.includes(String(value).split('|')[0])),
          actions:response.actions || [], contradictions:response.contradictions || [], memoryCandidates:response.memoryCandidates || [],
          emailDrafts:require('./agent-email-drafts').parseDrafts(response.emailDrafts),
          ...(internal.extraProvenance?.pricingPackages ? { pricingPackages: internal.extraProvenance.pricingPackages } : {}),
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
      if (partial && !archivedReply) await store.appendMessage(profile.id, conv.id, {role:'assistant',text:partial,requestId,authorizationFingerprint:runAuthority,status:status === 'cancelled' ? 'cancelled' : 'interrupted',provenance:{origin:'partial-ai-response',confidence:'LOW',contractValid:false}});
      await store.appendMessage(profile.id, conv.id, { role:'system', text:code, status, requestId });
      await store.save(profile.id, 'job', { ...job, calls:aiAttempted?1:0,status, errorCode:code, finishedAt:new Date().toISOString() });
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
    const agent = await store.get(profile.id, 'profile', profileId), memory = (await store.records(profile.id)).filter(doc => doc.kind === 'memory' && doc.profileId === profileId && doc.shareable && shareableGuidance(doc));
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
    profile = freshProfile(profile);const archiveAuthority=memoryPolicy.fingerprint(profile);
    if ([...active.values()].filter(job => job.ownerId === profile.id).length >= 2) throw error('OFFICE_BUSY',429);
    const preview = await trainingPreview(profile, raw);
    if (raw.confirmed !== true || raw.fingerprint !== preview.fingerprint || Number(raw.maxCalls) < preview.estimatedCalls) throw error('OFFICE_COST_APPROVAL_REQUIRED',409);
    if (!preview.parts.length || preview.estimatedCalls > 16) throw error('OFFICE_ARCHIVE_BATCH_LIMIT',409);
    const records = await store.exportTraining(preview.ownerId, raw.profileIds), chunks = trainingChunks(records).slice(preview.range.start,preview.range.start+preview.range.count), jobId = id();
    let job = await store.save(profile.id, 'job', { runtimeInstanceId,runtimeDeviceId:store.db(profile.id).getDeviceId(),id:jobId, profileIds:raw.profileIds || [], type:'archive-review', status:'running', calls:0, plannedCalls:preview.estimatedCalls, sourceOwnerId:preview.ownerId,range:preview.range,totalParts:preview.totalParts });
    active.set(jobId, job);
    const archiveAgents=(await store.records(profile.id)).filter(doc=>doc.kind==='profile'&&(!raw.profileIds?.length||raw.profileIds.includes(doc.id)));
    async function checkArchiveAuthority(reply){const latestAgents=await Promise.all(archiveAgents.map(agent=>store.get(profile.id,'profile',agent.id)));if(latestAgents.some((agent,i)=>agent.revision!==archiveAgents[i].revision)||archiveAuthority!==memoryPolicy.fingerprint(freshProfile(profile))){if(reply)await store.save(profile.id,'summary',{id:id(),profileIds:preview.ownerId===profile.id?raw.profileIds||[]:[],text:reply,authorizationFingerprint:archiveAuthority,origin:'scope-changed-ai-response',confidence:'LOW',contractValid:false,requiresVerification:true});throw error('OFFICE_PREVIEW_CHANGED',409);}}
    const summaries = [];let partial='',part=-1;const progress=event=>{if(event.delta)partial+=String(event.delta);onProgress(event);};
    try {
      for (let index=0; index<chunks.length; index++) {
        await checkArchiveAuthority();
        if (raw.signal?.aborted) throw error('LCWAI_CANCELLED',499);
        onProgress({ phase:'archive-part', index, total:chunks.length, jobId });
        const chunk = chunks[index];part=preview.range.start+index;partial='';
        job.calls++;
        const result = await engineOf().askWithFiles(profile.id, { requestId:`${jobId}-${index}`, source:'agent-office', task:text(raw.task || 'Summarize decisions, contradictions and open actions. Preserve source IDs and dates; do not treat old facts as current.',4000),
          context:{ part:preview.range.start+index+1, totalParts:preview.totalParts,selectedParts:chunks.length, sourceOwner:preview.ownerId, completeArchive:false },
          files:[{ fileName:chunk.name, buffer:chunk.buffer, contentType:'text/markdown' }], lang:raw.lang || 'tr', signal:raw.signal, onProgress:progress });
        await checkArchiveAuthority(result.data?.answer||result.text);
        if (!result.data || !result.structured?.ok) {await store.save(profile.id,'summary',{id:id(),profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [],text:result.text || '',sourceIds:chunk.sourceIds,sourceOwnerId:preview.ownerId,part,origin:'unverified-ai-response',confidence:'LOW',contractValid:false,requiresVerification:true});throw error('OFFICE_AI_CONTRACT_INVALID',422);}
        partial='';
        const summary = await store.save(profile.id, 'summary', { id:id(), profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [], text:result.data.answer,
          sourceIds:chunk.sourceIds, sourceOwnerId:preview.ownerId, sourceFingerprint:preview.fingerprint, rawResponse:result.text, part:preview.range.start+index, origin:'ai-inference', authorizationFingerprint:archiveAuthority,confidence:'LOW', requiresVerification:true });
        summaries.push(summary);
        job = await store.save(profile.id,'job',{...job, completedParts:index+1});
      }
      let combined = summaries[0]?.text || '';
      if (summaries.length > 1) {
        partial='';part=-1;
        const context = packContext({ summaries:summaries.map(doc => ({id:doc.id,text:doc.text})), coverage:{ parts:summaries.length, fullSourceReadUnverified:true } });
        await checkArchiveAuthority();
        job.calls++;
        const result = await engineOf().ask(profile.id,{ requestId:`${jobId}-merge`, source:'agent-office', task:text(raw.task || 'Combine these part summaries. Identify contradictions using dates and sources, and retain original evidence references.',4000), context, lang:raw.lang || 'tr', signal:raw.signal, onProgress:progress });
        await checkArchiveAuthority(result.data?.answer||result.text);
        if (!result.data || !result.structured?.ok) {await store.save(profile.id,'summary',{id:id(),profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [],text:result.text || '',sourceOwnerId:preview.ownerId,origin:'unverified-ai-response',confidence:'LOW',contractValid:false,requiresVerification:true});partial='';throw error('OFFICE_AI_CONTRACT_INVALID',422);}
        partial='';
        combined = result.data.answer;
        await store.save(profile.id,'summary',{id:id(),profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [],text:combined,rawResponse:result.text,sourceIds:summaries.map(item=>item.id),sourceOwnerId:preview.ownerId,sourceFingerprint:preview.fingerprint,origin:'ai-inference',authorizationFingerprint:archiveAuthority,confidence:'LOW',requiresVerification:true});
      }
      job = await store.save(profile.id,'job',{...job,status:'completed',finishedAt:new Date().toISOString(),text:combined,summaryIds:summaries.map(doc=>doc.id), completeness:'uploaded-parts-not-proof-of-full-reading'});
      audit(profile,'AGENT_ARCHIVE_REVIEW',jobId,{calls:job.calls,ownerId:preview.ownerId}); return { job };
    } catch(err) { if(partial)await store.save(profile.id,'summary',{id:id(),profileIds:preview.ownerId === profile.id ? raw.profileIds || [] : [],text:partial,sourceOwnerId:preview.ownerId,part,authorizationFingerprint:archiveAuthority,origin:'partial-ai-response',confidence:'LOW',contractValid:false,requiresVerification:true});await store.save(profile.id,'job',{...job,status:raw.signal?.aborted?'cancelled':'failed',finishedAt:new Date().toISOString(),errorCode:err.code || 'OFFICE_AI_FAILED'}); throw err; }
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
      candidates.push(...(await store.records(selection.ownerId)).filter(doc => doc.kind==='memory' && doc.profileId===agent.id && shareableGuidance(doc)).map(doc=>({...doc,sourceOwnerId:selection.ownerId})));
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
  async function notifications(profile,hints={}) {
    profile = await ensure(profile);
    const settings=await assistantSettings(profile);if(!settings.revision&&hints.timeZone){try{new Intl.DateTimeFormat('en',{timeZone:hints.timeZone}).format();await store.save(profile.id,'metadata',{...settings,timeZone:hints.timeZone},{expectedRevision:0});}catch(err){if(err.code!=='OFFICE_REVISION_CONFLICT'&&!(err instanceof RangeError))throw err;}}
    // A notification read must not project every native data source. The
    // existing background worker performs scans after application readiness.
    const docs = await store.records(profile.id);
    return {ownerId:profile.id,assistant:await assistantSettings(profile),alerts:docs.filter(doc => doc.kind === 'alert' && !doc.dismissed).slice(-100).map(({id,title,createdAt,totalFindings,sourceUpdatedAt})=>({id,title,createdAt,totalFindings,sourceUpdatedAt})), watching:docs.filter(doc => doc.kind === 'watch' && doc.enabled).length};
  }
  async function background() {
    if (deps.canRunBackground && !deps.canRunBackground()) return;
    if (backgroundRunning) return; backgroundRunning = true;
    try { for(const [owner,entry] of actors) {
      if(Date.now()-entry.lastSeen>30*60000){actors.delete(owner);continue;}
      const profile=userAccess.profileById(owner);
      if(!profile||profile.enabled===false){actors.delete(owner);continue;}
      try{await checkAssistant(profile);await checkWatches(profile);if(sync)await sync.sync(profile);}catch(err){ deps.onBackgroundError?.(err.code || 'OFFICE_BACKGROUND_FAILED'); }
    }
    } finally { backgroundRunning = false; }
  }
  const service = { configureAssistant, checkAssistant, assistantSettings, notifications, state, scan, createProfile, updateProfile, learn, run, syncNow, publish, copyAgent, trainingPreview, archivePart, reviewArchive,
    moderation, mergePreview, merge, watch, checkWatches, allowedAreas, activate,
    canAutomate,memoryContext,memoryFingerprint:memoryPolicy.fingerprint,runtimeContext:owner=>({runtimeInstanceId,runtimeDeviceId:store.db(owner).getDeviceId()}), stop:()=>{if(timer)clearInterval(timer);timer=null;}, engineOf, store, sync, packContext };
  Object.assign(service,require('./agent-office-workflow').attachWorkflow(service,deps));
  if(deps.toolRegistry&&deps.runtime)Object.assign(service,require('./agent-office-cp').attachCp(service,deps));
  if(deps.toolRegistry&&deps.runtime)Object.assign(service,require('./agent-office-tasks').attachTasks(service,deps));
  if(deps.getEvidenceAttachments&&deps.readEvidenceAttachment)Object.assign(service,require('./agent-office-evidence').attachEvidence(service,deps));
  if(deps.toolRegistry&&deps.runtime)Object.assign(service,require('./agent-office-chat').attachChat(service,deps));
  return service;
}
module.exports = { createAgentOfficeService, packContext, trainingChunks, scopeOf, inferScope };
