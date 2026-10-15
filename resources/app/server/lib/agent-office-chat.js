'use strict';

/* Sade Agent Ofisi sohbeti.

   Sahip tek bir kutuya doğal dille yazar. Her mesajda LCW AI (aynı motor,
   'agent-chat-route' sözleşmesi) yalnız YÖNLENDİRİR: düz cevap mı, Buyer Log'da
   yapılacak bir iş mi, yoksa eksik bir kimlik için kısa soru mu. Konu başka
   agentların alanına giriyorsa onları konuşmaya katar (en çok 4).

   - Cevap: mevcut service.run (tek çağrıda paylaşılan bakış açıları).
   - İş: mevcut görev planlayıcı (taskPlan) yalnız seçilen araçlarla plan kurar;
     okuma adımları hemen ilerler, değiştiren adım onay kartında durur. Onay,
     geri alma ve yetki denetimi görev motorunda aynen kalır.

   Yönlendirici kararı deterministik olarak doğrulanır: bilinmeyen agent veya
   araç kimliği düşer, lider katılımcı listesinde olmalıdır. */
const { id, error, text } = require('./agent-office-store');

const WAITING = new Set(['waiting_approval', 'waiting_output', 'waiting_operation']);
const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled', 'interrupted', 'rejected', 'rolled_back']);
const MODES = new Set(['reply', 'task', 'clarify']);

function chunks(list, size = 1800) {
  const out = []; let current = '';
  for (const item of list) {
    if (current && current.length + item.length + 1 > size) { out.push(current); current = ''; }
    current = current ? current + ',' + item : item;
  }
  if (current) out.push(current);
  return out;
}

/* Yönlendirici çıktısını sahibin gerçek agent ve araç listesiyle sınırlar. */
function validateRoute(data, { roster, toolsBy, current }) {
  const known = new Set(roster.map(agent => agent.id));
  const mode = MODES.has(String(data?.mode || '').trim()) ? String(data.mode).trim() : 'reply';
  let agentIds = [...new Set((Array.isArray(data?.agentIds) ? data.agentIds : []).map(String).filter(key => known.has(key)))];
  let lead = known.has(String(data?.lead || '')) ? String(data.lead) : agentIds[0] || current[0] || roster[0]?.id || '';
  if (lead && !agentIds.includes(lead)) agentIds.unshift(lead);
  if (!agentIds.length && lead) agentIds = [lead];
  agentIds = agentIds.slice(0, 4);
  const allowedTools = new Set(toolsBy[lead] || []);
  const toolIds = [...new Set((Array.isArray(data?.toolIds) ? data.toolIds : []).map(String).filter(key => allowedTools.has(key)))].slice(0, 8);
  const route = { mode, agentIds, lead, toolIds, brief: text(data?.brief, 4000), note: text(data?.note, 600), suggestion: text(data?.suggestion, 2000) };
  // Uygun araç yoksa iş planı kurulmaz; cevap yoluna düşer.
  if (route.mode === 'task' && !route.toolIds.length) route.mode = 'reply';
  return route;
}

function attachChat(service, deps = {}) {
  const store = service.store;
  const busy = new Map();

  async function roster(profile) {
    return (await store.records(profile.id)).filter(doc => doc.kind === 'profile' && doc.enabled !== false)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }
  async function toolsFor(profile, agents) {
    const out = {};
    for (const agent of agents) {
      try { out[agent.id] = typeof service.taskCatalog === 'function' ? (await service.taskCatalog(profile, agent.id)).map(tool => tool.id) : []; }
      catch (_) { out[agent.id] = []; }
    }
    return out;
  }

  async function route(profile, conv, message, agents, lang) {
    const toolsBy = await toolsFor(profile, agents);
    const history = conv ? (await store.messages(profile.id, conv.id, { limit: 8 })).messages
      .filter(item => item.role !== 'system')
      .map(item => ({ from: item.role === 'user' ? 'owner' : (item.profileIds || []).join(','), text: String(item.text || '').slice(0, 500) })) : [];
    const context = {
      agents: agents.map(agent => ({ id: agent.id, name: agent.name, role: agent.role, areas: agent.areas || [],
        brief: String(agent.instructions || '').slice(0, 400), toolIds: chunks(toolsBy[agent.id] || []) })),
      currentParticipants: conv ? conv.profileIds : [],
      conversation: history,
    };
    const response = await service.engineOf().ask(profile.id, { requestId: id(), source: 'agent-chat-route', lang: lang === 'en' ? 'en' : 'tr', task: message, context });
    if (!response?.structured?.ok || !response.data) {
      return { mode: 'reply', agentIds: conv ? conv.profileIds.slice(0, 4) : [agents[0].id], lead: conv ? conv.profileIds[0] : agents[0].id, toolIds: [], brief: '', note: '', suggestion: '', routed: false };
    }
    return { ...validateRoute(response.data, { roster: agents, toolsBy, current: conv ? conv.profileIds : [] }), routed: true };
  }

  /* Konuşmaya yeni agent katılırsa aynı konuşma kaydı genişler; önceki
     mesajlar kendi katılımcı listesini korur. */
  async function joinConversation(profile, conv, ids) {
    const next = [...new Set([...(conv.profileIds || []), ...ids])];
    if (next.length > 4) throw error('OFFICE_PARTICIPANTS_INVALID', 422);
    if (next.length === conv.profileIds.length) return conv;
    return store.save(profile.id, 'conversation', { ...conv, profileIds: next }, { expectedRevision: conv.revision });
  }

  /* Okuma adımlarını hemen ilerletir; onay, dosya veya uzun işlem bekleyen
     adımda ya da iş bitince durur. Onay asla burada verilmez. */
  async function advance(profile, jobId) {
    let job = await store.get(profile.id, 'job', jobId);
    for (let i = 0; i < 12 && !TERMINAL.has(job.status) && !WAITING.has(job.status); i += 1) {
      job = await service.taskPrepare(profile, jobId);
      if (TERMINAL.has(job.status) || WAITING.has(job.status)) break;
      if (job.status === 'queued') job = await service.taskExecute(profile, jobId, {});
    }
    return job;
  }

  // Sohbet kartı görev motorunun görünürlük denetiminden geçmiş görünümü kullanır.
  async function publicTask(profile, job) {
    if (typeof service.taskPublicJobs !== 'function') return job;
    return (await service.taskPublicJobs(profile, [job]))[0] || null;
  }
  async function task(profile, jobId) { return publicTask(profile, await store.get(profile.id, 'job', jobId)); }

  async function note(profile, conv, payload) {
    return store.appendMessage(profile.id, conv.id, { role: 'system', text: JSON.stringify(payload).slice(0, 8000), status: 'complete', requestId: id() });
  }

  async function chat(profile, raw = {}, onProgress = () => {}) {
    const message = text(raw.text, 4000);
    if (!message) throw error('OFFICE_TASK_INVALID', 422);
    if (busy.get(profile.id)) throw error('OFFICE_BUSY', 429);
    busy.set(profile.id, true);
    try {
      const agents = await roster(profile);
      if (!agents.length) throw error('OFFICE_AGENT_REQUIRED', 409);
      let conv = raw.conversationId ? await store.get(profile.id, 'conversation', raw.conversationId) : null;
      const selected = agents.find(agent => agent.id === raw.agentId) || (conv ? null : agents[0]);
      onProgress({ phase: 'route' });
      const decision = await route(profile, conv, message, agents, raw.lang);
      // Sahibin seçtiği agent konuşmanın içinde kalır.
      const ids = [...new Set([...(selected ? [selected.id] : []), ...(conv ? conv.profileIds : []), ...decision.agentIds])].slice(0, 4);
      const before = conv ? conv.profileIds : (selected ? [selected.id] : []);
      if (!conv) conv = await store.conversation(profile.id, ids, message.slice(0, 80));
      else conv = await joinConversation(profile, conv, ids);
      const joined = ids.filter(key => !before.includes(key));
      // "Katıldı" notu, sahibin mesajından hemen sonra görünür.
      const joinNote = decision.note && joined.length ? { type: 'join', agentIds: joined, text: decision.note } : null;

      if (decision.mode === 'clarify' && decision.note) {
        await store.appendMessage(profile.id, conv.id, { role: 'user', text: message, requestId: id() });
        const reply = await store.appendMessage(profile.id, conv.id, { role: 'assistant', text: decision.note, requestId: id(), provenance: { origin: 'route-question', speaker: decision.lead } });
        return { conversation: await store.get(profile.id, 'conversation', conv.id), route: decision, message: reply };
      }
      if (decision.mode === 'task') {
        await store.appendMessage(profile.id, conv.id, { role: 'user', text: message, requestId: id() });
        if (joinNote) await note(profile, conv, joinNote);
        onProgress({ phase: 'plan' });
        let job;
        try {
          job = await service.taskPlan(profile, { agentId: decision.lead, task: decision.brief || message, toolIds: decision.toolIds, lang: raw.lang, conversationId: conv.id });
        } catch (err) {
          await note(profile, conv, { type: 'task-failed', agentId: decision.lead, code: err.code || 'OFFICE_TASK_FAILED' });
          throw err;
        }
        if (!job.steps?.length) {
          await note(profile, conv, { type: 'task-empty', agentId: decision.lead });
          return { conversation: await store.get(profile.id, 'conversation', conv.id), route: decision, task: await publicTask(profile, job) };
        }
        onProgress({ phase: 'prepare', taskId: job.id });
        try { job = await advance(profile, job.id); } catch (err) { await note(profile, conv, { type: 'task', taskId: job.id, agentId: decision.lead, code: err.code || 'OFFICE_TASK_FAILED' }); throw err; }
        await note(profile, conv, { type: 'task', taskId: job.id, agentId: decision.lead, brief: decision.brief });
        return { conversation: await store.get(profile.id, 'conversation', conv.id), route: decision, task: await publicTask(profile, job) };
      }
      onProgress({ phase: 'reply' });
      const result = await service.run(profile, { profileIds: conv.profileIds, conversationId: conv.id, task: message, lang: raw.lang, signal: raw.signal }, onProgress,
        { afterUserMessage: joinNote ? current => note(profile, current, joinNote) : null });
      if (decision.suggestion) await note(profile, conv, { type: 'suggestion', agentId: decision.lead, text: decision.suggestion });
      return { ...result, conversation: await store.get(profile.id, 'conversation', conv.id), route: decision };
    } finally { busy.delete(profile.id); }
  }

  /* Onay kartındaki "Onayla": yalnız önizlenen parmak iziyle çalışır, sonra
     kalan okuma adımlarını ilerletir. */
  async function approve(profile, jobId, raw = {}) {
    await service.taskExecute(profile, jobId, { confirmed: raw.confirmed === true, fingerprint: String(raw.fingerprint || '') });
    return publicTask(profile, await advance(profile, jobId));
  }

  return { officeChat: chat, officeChatApprove: approve, officeChatAdvance: async (profile, jobId) => publicTask(profile, await advance(profile, jobId)), officeChatTask: task, officeChatRoster: roster };
}

module.exports = { attachChat, validateRoute, chunks };
