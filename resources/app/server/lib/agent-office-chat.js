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
const AREA_LABELS = Object.freeze({
  collection: { tr: 'Koleksiyon', en: 'Collection' }, overview: { tr: 'Genel Bakış', en: 'Overview' }, cp: { tr: 'CP Tracker', en: 'CP Tracker' },
  orders: { tr: 'Siparişler', en: 'Orders' }, priceanalysis: { tr: 'Fiyat ve Üretici Analizi', en: 'Price and Supplier Analysis' }, lfl: { tr: 'LFL Analizi', en: 'LFL Analysis' },
  opencosting: { tr: 'Ön Maliyet', en: 'Open Costing' }, backlog: { tr: 'Backlog', en: 'Backlog' }, shipping: { tr: 'Nakliye Kıyaslama', en: 'Shipping Comparison' },
  automations: { tr: 'Otomasyonlar', en: 'Automations' }, source: { tr: 'Kaynak Veri', en: 'Source Data' }, agents: { tr: 'Agent Ofisi', en: 'Agent Office' },
});

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

const DOCUMENT_FILE = /\.(pdf|msg|eml|png|jpe?g)$/i, WORKBOOK_FILE = /\.xlsx?$/i;
/* Sohbete eklenen dosyalar mevcut motorlarla hazırlanır: test raporu ve
   e-postalar test motoruyla okunup sahibin yazabildiği siparişlerle eşlenir;
   Excel kitapları agent dosya deposuna alınır. LCW AI'a yalnız kimlik, dosya
   adı ve eşleşme özeti gider. Hiçbir iş burada uygulanmaz. */
async function prepareAttachments(profile, files, { qualityService, qualityTools, artifacts, canReadDocuments, engine, lang, assertAuthority } = {}) {
  const list = Array.isArray(files) ? files.slice(0, 10) : [];
  if (!list.length) return [];
  if (list.some(file => !file || typeof file.name !== 'string' || typeof file.base64 !== 'string')) throw error('OFFICE_TASK_INVALID', 422);
  const out = [], documents = list.filter(file => DOCUMENT_FILE.test(file.name)), workbooks = list.filter(file => WORKBOOK_FILE.test(file.name));
  if (list.length !== documents.length + workbooks.length) throw error('OFFICE_ATTACHMENT_TYPE', 415);
  if (documents.length) {
    if (!qualityService || !qualityTools || !(await canReadDocuments?.())) throw error('OFFICE_ATTACHMENT_AGENT_REQUIRED', 403);
    const parsed = await qualityService.parse(profile, documents, { durable: true });
    if (engine) await qualityService.extractAi(profile, parsed.sessionId, { engine, lang, assertAuthority });
    const preview = await qualityTools.inspect(profile, parsed.sessionId);
    out.push({ kind: 'test-documents', sessionId: parsed.sessionId, files: documents.map(file => text(file.name, 160)),
      matches: (preview.matches || []).slice(0, 20).map(match => ({ talepNo: text(match.talepNo, 80), outcome: text(match.outcome?.status || match.outcome, 40), level: text(match.level, 20),
        orders: (match.candidates || []).slice(0, 3).map(candidate => text(candidate.identity?.orderCode || candidate.orderKey, 80)) })) });
  }
  for (const file of workbooks) {
    const buffer = Buffer.from(file.base64, 'base64');
    const meta = await artifacts.put(profile, buffer, text(file.name, 160), 'workbook');
    out.push({ kind: 'workbook', artifactId: meta.id, name: text(file.name, 160) });
  }
  return out;
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

  async function route(profile, conv, message, agents, lang, signal, attachments) {
    const toolsBy = await toolsFor(profile, agents);
    const history = conv ? (await store.messages(profile.id, conv.id, { limit: 8 })).messages
      .filter(item => item.role !== 'system')
      .map(item => ({ from: item.role === 'user' ? 'owner' : (item.profileIds || []).join(','), text: String(item.text || '').slice(0, 500) })) : [];
    const context = {
      agents: agents.map(agent => ({ id: agent.id, name: agent.name, role: agent.role, areas: agent.areas || [],
        brief: String(agent.instructions || '').slice(0, 400), toolIds: chunks(toolsBy[agent.id] || []) })),
      currentParticipants: conv ? conv.profileIds : [],
      attachments: attachments || [],
      conversation: history,
    };
    const response = await service.engineOf().ask(profile.id, { requestId: id(), source: 'agent-chat-route', lang: lang === 'en' ? 'en' : 'tr', task: message, context, signal });
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
    const names = (Array.isArray(raw.attachments) ? raw.attachments : []).flatMap(item => item.kind === 'workbook' ? [item.name] : (item.files || [])).filter(Boolean);
    const typed = text(raw.text, 4000);
    if (!typed && !names.length) throw error('OFFICE_TASK_INVALID', 422);
    const message = text([typed || (raw.lang === 'en' ? 'Please review the attached files.' : 'Ekteki dosyaları inceler misin?'), names.length ? (raw.lang === 'en' ? 'Attachments: ' : 'Ekler: ') + names.join(', ') : ''].filter(Boolean).join('\n\n'), 6000);
    if (busy.get(profile.id)) throw error('OFFICE_BUSY', 429);
    busy.set(profile.id, true);
    try {
      const agents = await roster(profile);
      if (!agents.length) throw error('OFFICE_AGENT_REQUIRED', 409);
      let conv = raw.conversationId ? await store.get(profile.id, 'conversation', raw.conversationId) : null;
      const selected = agents.find(agent => agent.id === raw.agentId) || (conv ? null : agents[0]);
      onProgress({ phase: 'route' });
      const attachments = Array.isArray(raw.attachments) ? raw.attachments.slice(0, 10) : [];
      const decision = await route(profile, conv, message, agents, raw.lang, raw.signal, attachments);
      // Sahibin seçtiği agent konuşmanın içinde kalır.
      let ids = [...new Set([...(selected ? [selected.id] : []), ...(conv ? conv.profileIds : []), ...decision.agentIds])].slice(0, 4);
      // Konuşma doluysa ve lider içinde değilse lider kendi yeni konuşmasını açar; işi yapan agent daima katılımcıdır.
      if (decision.lead && !ids.includes(decision.lead)) { conv = null; ids = [...new Set([decision.lead, ...decision.agentIds])].slice(0, 4); }
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
          job = await service.taskPlan(profile, { agentId: decision.lead, task: decision.brief || message, toolIds: decision.toolIds, lang: raw.lang, conversationId: conv.id, attachments });
        } catch (err) {
          // Boş veya geçersiz plan: güvenle yapılabilecek adım yok; sahipten ayrıntı istenir.
          if (err.code === 'OFFICE_TASK_INVALID' || err.code === 'OFFICE_AI_CONTRACT_INVALID') {
            await note(profile, conv, { type: 'task-empty', agentId: decision.lead });
            return { conversation: await store.get(profile.id, 'conversation', conv.id), route: decision, task: null };
          }
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

  /* Doğal dille agent tanımı: LCW AI yalnız TASLAK üretir; alanlar sahibin
     erişebildikleriyle sınırlanır, kayıt mevcut profil uçlarıyla ve sahibin
     onayıyla yapılır. */
  async function agentDraft(profile, raw = {}) {
    const description = text(raw.text, 4000);
    if (!description) throw error('OFFICE_TASK_INVALID', 422);
    const allowed = typeof service.allowedAreas === 'function' ? service.allowedAreas(profile) : Object.keys(AREA_LABELS);
    const current = raw.agentId ? await store.get(profile.id, 'profile', raw.agentId) : null;
    const lang = raw.lang === 'en' ? 'en' : 'tr';
    const context = { areas: allowed.map(key => ({ key, label: (AREA_LABELS[key] || { tr: key, en: key })[lang] })),
      ...(current ? { current: { name: current.name, role: current.role, areas: current.areas || [], instructions: String(current.instructions || '') } } : {}) };
    const response = await service.engineOf().ask(profile.id, { requestId: id(), source: 'agent-profile-draft', lang, task: description, context, signal: raw.signal });
    if (!response?.structured?.ok || !response.data) throw error('OFFICE_AI_CONTRACT_INVALID', 422);
    const data = response.data, areas = [...new Set((Array.isArray(data.areas) ? data.areas : []).map(String).filter(key => allowed.includes(key)))];
    // Mevcut agent eğitilirken alanları daralmaz; yeni iş gerekiyorsa alan eklenir. Sahip önizlemede değiştirebilir.
    const kept = (current?.areas || []).filter(key => allowed.includes(key));
    const draft = { name: text(data.name || current?.name || '', 60), role: text(data.role || current?.role || '', 80), areas: [...new Set([...kept, ...areas])],
      instructions: text(data.instructions, 6000), summary: text(data.summary, 400) };
    if (!draft.name || !draft.instructions) throw error('OFFICE_AI_CONTRACT_INVALID', 422);
    return { draft, agentId: current?.id || '', revision: current?.revision ?? null, areaLabels: Object.fromEntries(allowed.map(key => [key, AREA_LABELS[key] || { tr: key, en: key }])) };
  }

  return { officeAgentDraft: agentDraft, officeChat: chat, officeChatApprove: approve, officeChatAdvance: async (profile, jobId) => publicTask(profile, await advance(profile, jobId)), officeChatTask: task, officeChatRoster: roster };
}

module.exports = { attachChat, validateRoute, chunks, prepareAttachments };
