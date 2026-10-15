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
const { severityLevel } = require('./agent-office-intelligence');

// AI ve belge kaynaklı metin kesilir, reddedilmez.
const cut = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
// Yerel takvim günü: araçların @today değeriyle aynı gün (UTC gece yarısı kayması olmaz).
const localDay = (date = new Date()) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
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
  const route = { mode, agentIds, lead, toolIds, brief: cut(data?.brief, 4000), note: cut(data?.note, 600), suggestion: cut(data?.suggestion, 2000) };
  // Uygun araç yoksa iş planı kurulmaz; cevap yoluna düşer.
  if (route.mode === 'task' && !route.toolIds.length) route.mode = 'reply';
  return route;
}

const DOCUMENT_FILE = /\.(pdf|msg|eml|png|jpe?g)$/i, WORKBOOK_FILE = /\.xlsx?$/i, TABLE_FILE = /\.csv$/i, AI_DOCUMENT_LIMIT = 5;
/* Sohbete eklenen dosyalar mevcut motorlarla ve mevcut yükleme kurallarıyla
   hazırlanır:
   - test raporu ve e-postalar: seçili agentın test belgesi okuma yetkisi olmalı;
     test motoru okur ve sahibin yazabildiği siparişlerle eşler. En çok 5 belgede
     metin çıkarımı için belgeler şirket içi LCW AI'a gider (mevcut test
     akışındaki AI okuma ile aynı yol); daha fazlasında yalnız yerel okuma yapılır.
   - Excel: Veri Yönetimi'ndeki yükleme ile aynı alan/izin şartı.
   Yönlendirici ve planlayıcıya yalnız kimlik, dosya adı ve eşleşme özeti gider.
   Her adımın arasında sahibin erişimi yeniden doğrulanır; hata olursa geçici
   oturum silinir. Hiçbir iş burada uygulanmaz. */
async function prepareAttachments(profile, files, { qualityService, qualityTools, artifacts, staging, canReadDocuments, canStoreWorkbooks, analyzeDocuments, engine, lang, assertAuthority = () => {} } = {}) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return [];
  if (list.length > 10) throw error('OFFICE_ATTACHMENT_LIMIT', 413);
  if (list.some(file => !file || typeof file.name !== 'string' || typeof file.base64 !== 'string')) throw error('OFFICE_TASK_INVALID', 422);
  const out = [], documents = list.filter(file => DOCUMENT_FILE.test(file.name)), workbooks = list.filter(file => WORKBOOK_FILE.test(file.name)), tables = list.filter(file => TABLE_FILE.test(file.name));
  if (list.length !== documents.length + workbooks.length + tables.length) throw error('OFFICE_ATTACHMENT_TYPE', 415);
  /* Paydaş belgesi analizi varsa her dosya önce siparişlerle eşlenir; test belgesi
     motoru ve dosya deposu yalnız ilgili yetki varsa ek olarak çalışır. Analiz
     yoksa (eski yol) yetki eksikliği reddedilir. */
  const readTests = documents.length > 0 && !!qualityService && !!qualityTools && !!(await canReadDocuments?.());
  const storeBooks = workbooks.length > 0 && !!(await canStoreWorkbooks?.());
  if (!analyzeDocuments) {
    if (tables.length) throw error('OFFICE_ATTACHMENT_TYPE', 415);
    if (documents.length && !readTests) throw error('OFFICE_ATTACHMENT_AGENT_REQUIRED', 403);
    if (workbooks.length && !storeBooks) throw error('OFFICE_TOOL_FORBIDDEN', 403);
  }
  assertAuthority();
  let sessionId = '', docKind = '';
  try {
    let analysisFailed = null;
    if (analyzeDocuments) {
      // Belge analizi başarısız olsa da test belgesi ve dosya deposu yolları çalışır.
      try { const analysis = await analyzeDocuments(list); if (analysis) { docKind = analysis.docKind; out.push(analysis); } }
      catch (err) { if (err.code === 'OFFICE_PREVIEW_CHANGED' || err.code === 'OFFICE_TOOL_FORBIDDEN' || err.code === 'LCWAI_CANCELLED') throw err; analysisFailed = err; }
      assertAuthority();
    }
    if (readTests && (!analyzeDocuments || analysisFailed || docKind === 'test-report')) {
      const parsed = await qualityService.parse(profile, documents, { durable: true });
      sessionId = parsed.sessionId; assertAuthority();
      if (engine && documents.length <= AI_DOCUMENT_LIMIT) { await qualityService.extractAi(profile, parsed.sessionId, { engine, lang, assertAuthority }); assertAuthority(); }
      const preview = await qualityTools.inspect(profile, parsed.sessionId); assertAuthority();
      out.push({ kind: 'test-documents', sessionId: parsed.sessionId, files: documents.map(file => cut(file.name, 160)),
        matches: (preview.matches || []).slice(0, 20).map(match => ({ talepNo: cut(match.talepNo, 80), outcome: cut(match.outcome?.status || match.outcome, 40), level: cut(match.level, 20),
          orders: (match.candidates || []).slice(0, 3).map(candidate => cut(candidate.identity?.orderCode || candidate.orderKey, 80)) })) });
    }
    for (const file of storeBooks ? workbooks : []) {
      const meta = await artifacts.put(profile, Buffer.from(file.base64, 'base64'), cut(file.name, 160), 'workbook'); assertAuthority();
      out.push({ kind: 'workbook', artifactId: meta.id, name: cut(file.name, 160) });
    }
    if (!out.length && analysisFailed) throw analysisFailed;
    return out;
  } catch (err) { if (sessionId) staging?.dropSession(sessionId); throw err; }
}
/* Sohbet işi başarısız olursa hazırlanan test oturumu bekletilmez. */
function dropAttachments(attachments, staging) {
  for (const item of attachments || []) if (item.kind === 'test-documents' && item.sessionId) staging?.dropSession(item.sessionId);
}

/* Görev adımlarının doğrulanmış sonuçları, lider agentın cevabı için düz
   metne çevrilir. Geri alma anahtarı gibi iç alanlar gitmez; büyük sonuç
   kesilir ve bu açıkça yazılır. Metin yalnız şirket içi LCW AI'a gider. */
const RESULT_LIMIT = 22000, HIDDEN_RESULT_KEYS = new Set(['rollbackToken', 'verified', 'receipt', 'fingerprint']);
/* Satır listeleri (nesne dizileri) JSON yerine "sütunlar + satırlar" tablosu
   olarak yazılır: her satırda alan adları tekrarlanmadığı için aynı bütçeye
   çok daha fazla sipariş sığar. Diğer değerler JSON kalır. */
const flat = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
function compactValue(value) {
  if (Array.isArray(value) && value.length >= 2 && value.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
    const columns = [...new Set(value.flatMap(item => Object.keys(item)))];
    return 'TABLE ' + columns.join(' | ') + '\n' + value.map(item => columns.map(column => flat(item[column]).replace(/[|\n]/g, ' ')).join(' | ')).join('\n');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const parts = [], scalars = {};
    for (const [key, item] of Object.entries(value)) {
      const text = compactValue(item);
      if (typeof text === 'string' && text.startsWith('TABLE ')) parts.push(key + ':\n' + text);
      else scalars[key] = item;
    }
    if (parts.length) return [Object.keys(scalars).length ? JSON.stringify(scalars) : '', ...parts].filter(Boolean).join('\n');
  }
  return JSON.stringify(value);
}
/* Fiyata gönderme paketleri doğrulanmış araç sonucundan Buyer Log tarafından kurulur;
   LCW AI model listesini kopyalamaz. Her paket Send to Pricing penceresini açar. */
function pricingPackages(job) {
  const out = [];
  for (const step of job?.steps || []) {
    if (step?.toolId !== 'pricing.suppliers.suggest' || !['completed', 'partial'].includes(step.status)) continue;
    const data = step.result?.data || {};
    for (const supplier of data.suppliers || []) {
      const models = (supplier.models || []).filter(item => item && item.rowId);
      if (!models.length) continue;
      out.push({ supplier: String(supplier.name || '').slice(0, 200), season: String(data.currentSeason || '').slice(0, 80),
        classifications: (supplier.classifications || []).slice(0, 30).map(item => ({ name: String(item.name || '').slice(0, 120), index: item.index ?? null })),
        rowIds: models.map(item => String(item.rowId)), models: models.map(item => ({ plmId: item.plmId || '', model: item.model || '', colourCode: item.colourCode || '' })),
        truncated: supplier.modelsTruncated === true });
      if (out.length >= 30) return out;
    }
  }
  return out;
}

function stepResultsText(job) {
  const items = (job?.steps || []).map((step, index) => {
    if (!step || !step.result || !['completed', 'partial'].includes(step.status)) return null;
    const value = Object.fromEntries(Object.entries(step.result).filter(([key]) => !HIDDEN_RESULT_KEYS.has(key)));
    return { index, toolId: step.toolId, body: compactValue(value.data !== undefined && Object.keys(value).length <= 2 ? value.data : value) };
  }).filter(Boolean);
  // Bütçe adil bölünür: küçük sonuç tam kalır, artanı büyük sonuçlar paylaşır.
  let left = RESULT_LIMIT;
  const room = new Map();
  [...items].sort((a, b) => a.body.length - b.body.length).forEach((item, order, sorted) => {
    const share = Math.floor(left / (sorted.length - order));
    room.set(item, Math.min(item.body.length, share)); left -= room.get(item);
  });
  return items.map(item => {
    const limit = room.get(item), cutOff = item.body.length > limit;
    if (limit < 200 && cutOff) return `=== ${item.index + 1}. ${item.toolId}: omitted (size limit) ===`;
    return `=== ${item.index + 1}. ${item.toolId}${cutOff ? ' (truncated)' : ''} ===\n${item.body.slice(0, limit)}`;
  }).join('\n\n');
}

function attachChat(service, deps = {}) {
  const store = service.store;
  const busy = new Map(), answering = new Set();

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
    const response = await service.engineOf().ask(profile.id, { requestId: id(), source: 'agent-chat-route', lang: lang === 'en' ? 'en' : 'tr', task: message, context, signal, reasoningLevel: 'Low' });
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

  /* Görev bitince lider agent sonuçları sahibin isteğine göre cevaba
     çevirir (liste, tablo, e-posta taslağı…). Her görev bir kez cevaplanır;
     cevap aynı konuşmaya yazılır, böylece sonraki sorular da onu görür. */
  async function answerTask(profile, job, onProgress = () => {}, signal) {
    if (!job || !['completed', 'partial'].includes(job.status) || job.accessRestricted || answering.has(job.id)) return null;
    answering.add(job.id);
    try { return await writeAnswer(profile, job, onProgress, signal); } finally { answering.delete(job.id); }
  }
  async function writeAnswer(profile, job, onProgress, signal) {
    const records = await store.records(profile.id);
    const link = records.find(doc => doc.kind === 'metadata' && doc.id === 'task-chat-' + job.id);
    if (!link || link.answeredMessageId) return null;
    const results = stepResultsText(job), packages = pricingPackages(job);
    if (!results) return null;
    let conv;
    try { conv = await store.get(profile.id, 'conversation', link.conversationId); } catch (_) { return null; }
    const lead = conv.profileIds.includes(link.lead) ? link.lead : conv.profileIds[0];
    onProgress({ phase: 'answer', taskId: job.id });
    // Cevap bir kez denenir: başarısız olursa da işaretlenir, her yoklamada yeni AI çağrısı yapılmaz.
    let answered = 'failed';
    try {
      const result = await service.run(profile, { profileIds: conv.profileIds, conversationId: conv.id, task: link.request, lang: link.lang, signal }, onProgress,
        { reuseUserMessageId: link.userMessageId, taskResults: { taskId: job.id, lead, text: results },
          ...(packages.length ? { extraProvenance: { pricingPackages: packages }, pricingPackages: packages.map(item => ({ supplier: item.supplier, models: item.rowIds.length })) } : {}) });
      answered = result.message?.id || 'failed';
      return result.message || null;
    } finally {
      try { await store.save(profile.id, 'metadata', { ...link, answeredMessageId: answered }, { expectedRevision: link.revision }); }
      catch (err) { if (err.code !== 'OFFICE_REVISION_CONFLICT') throw err; }
    }
  }

  async function chat(profile, raw = {}, onProgress = () => {}) {
    const names = [...new Set((Array.isArray(raw.attachments) ? raw.attachments : []).flatMap(item => item.kind === 'workbook' ? [item.name] : (item.files || [])).filter(Boolean))];
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
      const prepared = Array.isArray(raw.attachments) ? raw.attachments.slice(0, 10) : [];
      // LCW AI'a giden ek özeti: satırların yalnız eşleşme/risk/tarih alanları.
      const attachments = prepared.map(item => item.kind === 'document-orders'
        ? { kind: item.kind, docKind: item.docKind, request: item.request, summary: item.summary, totals: item.totals,
          rows: (item.rows || []).map(row => ({ line: row.line, orderCode: row.orderCode, requestedExFactory: row.requestedExFactory, risk: row.risk, match: row.match })) }
        : item);
      const documentOrders = prepared.filter(item => item.kind === 'document-orders');
      const cards = documentOrders.map(({ compact, ...card }) => ({ type: 'document-orders', ...card }));
      const evidence = documentOrders.map((item, index) => ({ id: 'document-orders-' + (index + 1), text: [item.request, item.summary,
        'line|order|model|colour|currentEXF→requestedEXF|shift|latestSafeLoad|risk|match|basis', item.compact].filter(Boolean).join('\n') }));
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
        for (const card of cards) await note(profile, conv, card);
        const reply = await store.appendMessage(profile.id, conv.id, { role: 'assistant', text: decision.note, requestId: id(), provenance: { origin: 'route-question', speaker: decision.lead } });
        return { conversation: await store.get(profile.id, 'conversation', conv.id), route: decision, message: reply };
      }
      if (decision.mode === 'task') {
        const asked = await store.appendMessage(profile.id, conv.id, { role: 'user', text: message, requestId: id() });
        if (joinNote) await note(profile, conv, joinNote);
        for (const card of cards) await note(profile, conv, card);
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
        await store.save(profile.id, 'metadata', { id: 'task-chat-' + job.id, conversationId: conv.id, userMessageId: asked.id, lead: decision.lead, request: message, lang: raw.lang === 'en' ? 'en' : 'tr', answeredMessageId: null });
        onProgress({ phase: 'prepare', taskId: job.id });
        try { job = await advance(profile, job.id); } catch (err) { await note(profile, conv, { type: 'task', taskId: job.id, agentId: decision.lead, code: err.code || 'OFFICE_TASK_FAILED' }); throw err; }
        await note(profile, conv, { type: 'task', taskId: job.id, agentId: decision.lead, brief: decision.brief });
        const shown = await publicTask(profile, job);
        // Okuma adımları bittiyse cevap hemen yazılır; onay bekleyen iş onaydan sonra cevaplanır.
        // Cevap yazılamazsa iş sonucu korunur; hata konuşmaya not düşülür ve sahibe gösterilir.
        let answer = null, answerError = '';
        try { answer = await answerTask(profile, shown, onProgress, raw.signal); }
        catch (err) { answerError = raw.signal?.aborted ? 'LCWAI_CANCELLED' : err.code || 'OFFICE_AI_FAILED'; }
        return { conversation: await store.get(profile.id, 'conversation', conv.id), route: decision, task: shown, message: answer, ...(answerError ? { answerError } : {}) };
      }
      onProgress({ phase: 'reply' });
      const result = await service.run(profile, { profileIds: conv.profileIds, conversationId: conv.id, task: message, lang: raw.lang, signal: raw.signal }, onProgress,
        { afterUserMessage: joinNote || cards.length ? async current => { if (joinNote) await note(profile, current, joinNote); for (const card of cards) await note(profile, current, card); } : null,
          // Eşleme ve risk rakamları Buyer Log'dan gelir; agent bunların üstüne değerlendirme yazar.
          ...(evidence.length ? { evidenceAttachments: evidence } : {}) });
      if (decision.suggestion) await note(profile, conv, { type: 'suggestion', agentId: decision.lead, text: decision.suggestion });
      return { ...result, conversation: await store.get(profile.id, 'conversation', conv.id), route: decision };
    } finally { busy.delete(profile.id); }
  }

  /* Onay kartındaki "Onayla": yalnız önizlenen parmak iziyle çalışır, sonra
     kalan okuma adımlarını ilerletir. */
  async function approve(profile, jobId, raw = {}) {
    await service.taskExecute(profile, jobId, { confirmed: raw.confirmed === true, fingerprint: String(raw.fingerprint || '') });
    return finished(profile, await advance(profile, jobId));
  }
  // Onaydan ya da bekleyen adımdan sonra iş bittiyse lider agent cevabını yazar.
  async function finished(profile, job) {
    const shown = await publicTask(profile, job);
    // Sahibin o anki sohbetini kilitlemez; aynı işin iki kez cevaplanmasını `answering` önler.
    try { await answerTask(profile, shown); } catch (_) { /* hata run() tarafından konuşmaya yazıldı */ }
    return shown;
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
    const draft = { name: cut(data.name || current?.name || '', 60), role: cut(data.role || current?.role || '', 80), areas: [...new Set([...kept, ...areas])],
      instructions: cut(data.instructions, 6000), summary: cut(data.summary, 400) };
    if (!draft.name || !draft.instructions) throw error('OFFICE_AI_CONTRACT_INVALID', 422);
    return { draft, agentId: current?.id || '', revision: current?.revision ?? null, areaLabels: Object.fromEntries(allowed.map(key => [key, AREA_LABELS[key] || { tr: key, en: key }])) };
  }

  /* Günlük öncelikler: tarama motorunun deterministik bulguları (CP kritik/yüksek
     öncelik ve gerekçeleri) ve koleksiyon akışı (siparişe bağlanmamış, üreticisi
     boş seçenekler). Günde bir kez hesaplanıp saklanır; "yenile" yeniden hesaplar.
     LCW AI çağrılmaz. */
  async function brief(profile, raw = {}) {
    const day = localDay(), authority = typeof service.memoryFingerprint === 'function' ? service.memoryFingerprint(profile) : '';
    const saved = (await store.records(profile.id)).find(doc => doc.kind === 'metadata' && doc.id === 'chat-brief');
    // Yetki değişince saklı özet kullanılmaz: kaldırılan alanın siparişleri görünmeye devam etmez.
    if (saved && saved.day === day && saved.authority === authority && raw.refresh !== true) return saved.brief;
    const result = await service.scan(profile, {}, {});
    const orders = new Map((result.orders || []).map(order => [order.orderKey, order]));
    const priority = (result.findings || []).filter(item => item.code === 'CP_PRIORITY');
    const count = level => priority.filter(item => severityLevel(item.severity) === level).length;
    const top = priority.filter(item => severityLevel(item.severity) >= 2).sort((a, b) => severityLevel(b.severity) - severityLevel(a.severity)).slice(0, 8).map(item => {
      const order = orders.get(item.orderKey) || {}, identity = order.identity || {};
      return { severity: item.severity, level: severityLevel(item.severity), title: item.title, reasons: (item.reasons || []).slice(0, 3).map(reason => reason.title),
        orderCode: cut(identity.orderCode, 40), model: cut(order.analysis?.modelName || identity.modelName, 120), colour: cut(identity.colourCode, 40), supplier: cut(order.dimensions?.manufacturer, 80) };
    });
    const collection = (result.decisionSupport?.collectionPipeline || []).filter(group => group.unlinked || group.missingSupplier)
      .sort((a, b) => (b.unlinked || 0) - (a.unlinked || 0)).slice(0, 4)
      .map(group => ({ season: cut(group.season, 40), status: cut(group.status, 60), options: group.options || 0, unlinked: group.unlinked || 0, missingSupplier: group.missingSupplier || 0 }));
    const value = { day, computedAt: new Date().toISOString(), sourceUpdatedAt: result.sourceUpdatedAt || null,
      counts: { critical: count(4), today: count(3), week: count(2), changes: (result.changes || []).length }, top, collection };
    try { await store.save(profile.id, 'metadata', { ...(saved || {}), id: 'chat-brief', day, authority, brief: value }, saved ? { expectedRevision: saved.revision } : {}); }
    catch (err) { if (err.code !== 'OFFICE_REVISION_CONFLICT') throw err; }
    return value;
  }

  return { officeChatBrief: brief, officeAgentDraft: agentDraft, officeChatBusy: owner => busy.has(owner), officeChat: chat, officeChatApprove: approve, officeChatAdvance: async (profile, jobId) => finished(profile, await advance(profile, jobId)), officeChatTask: task, officeChatRoster: roster };
}

module.exports = { attachChat, validateRoute, chunks, prepareAttachments, dropAttachments, stepResultsText, pricingPackages };
