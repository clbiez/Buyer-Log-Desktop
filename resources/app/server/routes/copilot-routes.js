'use strict';

/* Octopus (Copilot) route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (config) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerCopilotRoutes(app, deps) {
  const {
    APP_VERSION,
    DISPLAY_VERSION,
    agentAi,
    agentPlatformError,
    agentPolicyEngine,
    agentToolRegistry,
    apiError,
    auth,
    cacheForUser,
    copilotActions,
    copilotAgent,
    express,
    getExcelWorkerStats,
    octopusExports,
    sourceFolderForUser,
    sourceUserId,
    userAccess,
  } = deps;
  const getConfig = deps.getConfig;

/* ---- Octopus: yerel modele ince vekil ----
   İş gerçeği burada ÜRETİLMEZ. İstemci deterministic sonucu zaten hesaplamış
   olur; buradan geçen tek şey o sonucun cümleye çevrilmesidir. Dönen metin
   istemcide grounding validator'dan geçmeden kullanıcıya gösterilmez. */
const copilotLlm = require('../lib/copilot-llm');
const formulaWriter = require('../lib/cp-formula-writer');
app.get('/api/copilot/status', userAccess.requireAnyArea('source', 'koleksiyon', 'cp', 'orders', 'overview'), async (req, res) => {
  try {
    const requestedModel = String(req.query && req.query.model || '').trim();
    const status = await copilotLlm.status(requestedModel ? { ...getConfig(), aiModel: requestedModel } : getConfig());
    const aiPub = agentAi.providerStatus();
    res.set('Cache-Control', 'no-store').json({ ...status, canConfigure:String(req.currentUser.role || '').trim().toLowerCase() === 'moderator', openrouter: aiPub.openrouter, nvidia: aiPub.nvidia, customRemoteDataPolicy: aiPub.customRemoteDataPolicy, remoteDataPolicy: aiPub.remoteDataPolicy, endpointRemote: aiPub.endpointRemote, endpointError: aiPub.endpointError });
  }
  catch (err) { res.json({ status: copilotLlm.STATUS.OFFLINE, ok: false, reason: err && err.message }); }
});
app.post('/api/copilot/explain', userAccess.requireAnyArea('source', 'koleksiyon', 'cp', 'orders', 'overview'), express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const result = req.body && req.body.result;
    // Cevaplanamaz bir sonuç için açıklama üretmek, olmayan bir gerçeği
    // cümleye dökmektir; istemci de bunu reddederdi, burada da reddedilir.
    if (!result || result.answerable !== true) return res.status(400).json({ error: 'Açıklanacak cevaplanabilir bir sonuç yok.' });
    const text = await copilotLlm.explain(getConfig(), { result, question: req.body.question, language: req.body.language, model: req.body.model });
    res.set('Cache-Control', 'no-store').json({ ok: true, text });
  } catch (err) {
    // AI'ın yokluğu bir hata değil bir durumdur; istemci yapılandırılmış
    // sonucu göstermeye devam eder.
    res.status(200).json({ ok: false, text: '', reason: err && err.message || String(err) });
  }
});
/* Formula AI yalnızca güvenli, doğrulanmış bir öneri üretir. Öneri istemciye
   uygulanmadan önce kullanıcı tarafından incelenir; burada da aynı parser ile
   doğrulanır. Aynı kullanıcıdan eşzamanlı istekleri engellemek, provider'ın
   gecikmeli yanıtlarında duplicate üretim ve gereksiz maliyeti önler. */
const formulaAiInFlight = new Set();
app.post('/api/copilot/formula', userAccess.requireAnyArea('source', 'koleksiyon', 'cp', 'orders', 'overview'), express.json({ limit: '64kb' }), async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const userId = String(req.currentUser && req.currentUser.id || '');
  if (formulaAiInFlight.has(userId)) return res.status(409).json({ ok: false, code: 'FORMULA_AI_IN_PROGRESS', error: 'Formula AI request already in progress.' });
  let request;
  let fields;
  try {
    request = formulaWriter.sanitizeRequest(body.request);
    fields = formulaWriter.sanitizeFields(body.fields);
    if (!fields.length) return res.status(400).json({ ok: false, code: 'FORMULA_AI_FIELDS_REQUIRED', error: 'No formula fields were supplied.' });
  } catch (err) {
    return res.status(400).json({ ok: false, code: 'FORMULA_AI_INPUT_INVALID', error: err.message || 'Formula AI input is invalid.' });
  }
  formulaAiInFlight.add(userId);
  try {
    const result = await copilotLlm.generateFormula(getConfig(), {
      request,
      fields,
      language: body.language,
      model: body.model,
    });
    userAccess.appendAudit(req.currentUser, 'COPILOT_FORMULA_AI_SUGGESTION', 'formula-writer', {
      fieldCount: fields.length,
      formulaValid: true,
    });
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      formula: result.formula,
      explanation: result.explanation,
      fields: result.fields,
      conditions: result.conditions,
      match: result.match,
    });
  } catch (err) {
    const code = String(err && err.code || 'FORMULA_AI_UNAVAILABLE');
    const invalid = code === 'AI_FORMULA_INVALID' || code === 'AI_FORMULA_EMPTY';
    const status = Number(err && err.statusCode) || (invalid ? 422 : 503);
    res.status(status >= 500 ? 503 : status).json({
      ok: false,
      code,
      error: invalid ? 'AI returned no safe Buyer Log formula suggestion.' : 'Formula AI is currently unavailable.',
    });
  } finally {
    formulaAiInFlight.delete(userId);
  }
});
/* Ajan önerisi uygulandığında provenance kaydı. Audit iş taahhüdü sınırı
   DEĞİLDİR: burada bir hata olması değişikliği geri almaz, bu yüzden istemci
   de cevabı beklemez. Yine de sessizce kaybolmaz — appendAudit kendi
   acil-durum izini tutar. */
app.post('/api/copilot/audit', userAccess.requireAnyArea('source', 'koleksiyon', 'cp', 'orders', 'overview'), express.json({ limit: '32kb' }), (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const type = String(body.type || '').trim();
    // Eylem listesi kapalı: istemci uydurma bir tür bildirip audit'i kirletemez.
    if (!Object.prototype.hasOwnProperty.call(copilotActions.ACTIONS, type)) {
      return res.status(400).json({ ok: false, error: 'Bilinmeyen eylem türü.', code: 'COPILOT_AUDIT_TYPE_INVALID' });
    }
    const proposalId = String(body.proposalId || '').trim().slice(0, 120);
    const status = String(body.status || '').trim().slice(0, 40);
    /* Aktör OTURUMDAN gelir; istemcinin gönderdiği bir kimlik kullanılmaz.
       Payload istemci tarafından bildirilir ve öyle kaydedilir — kullanıcının
       ONAYLADIĞI şeyin kaydıdır, verinin ne olduğunun kanıtı değil. */
    userAccess.appendAudit(req.currentUser, 'COPILOT_APPLY', proposalId || type, {
      type, status: status || 'APPLIED',
      payload: body.payload && typeof body.payload === 'object' ? body.payload : null,
      reason: String(body.reason || '').slice(0, 500) || null,
      clientReported: true,
    }, req);
    res.json({ ok: true });
  } catch (err) { apiError(res, err, 'Octopus denetim kaydı yazılamadı.'); }
});
/* Octopus çıktısını indirir. Dosya İSTENDİĞİNDE yazılır: her cevapta bir
   workbook üretmek, kullanıcıların çoğunun hiç indirmeyeceği dosyalar için
   iş yapmak olurdu.

   Yetki iki katmanlı: rota alan kontrolünden geçer VE depo isteyenin o
   çıktının sahibi olduğunu doğrular. Kimliğin tahmin edilemez olması tek
   başına yeterli sayılmaz — kimliği ele geçiren biri, yetki katmanına hiç
   uğramadan başkasının kapsamındaki veriyi indirebilirdi. */
app.get('/api/copilot/export/:exportId', userAccess.requireAnyArea('source', 'koleksiyon', 'cp', 'orders', 'overview'), (req, res) => {
  try {
    const model = octopusExports.get(req.currentUser.id, req.params.exportId);
    // Sahibi olmayan ile hiç var olmayan AYNI cevabı alır: aksi hâlde
    // başkasının çıktısının varlığı sızardı.
    if (!model) return res.status(404).json({ error: 'Çıktı bulunamadı ya da süresi doldu.', code: 'OCTOPUS_EXPORT_NOT_FOUND' });
    const XLSX = require('xlsx');
    const workbook = XLSX.utils.book_new();
    for (const sheet of model.sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.aoa), sheet.name);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    userAccess.appendAudit(req.currentUser, 'OCTOPUS_EXPORT', String(req.params.exportId), {
      fileName: model.fileName, tableCount: model.tableCount, rowCount: model.rowCount,
    }, req);
    /* Dosya adı ASCII'ye indirgenmiş hâliyle de verilir: eski istemciler
       filename* alanını okumuyor ve Türkçe karakterli bir ad başlığı bozuyor. */
    const asciiName = String(model.fileName || 'octopus.xlsx').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(model.fileName)}`);
    res.set('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) { apiError(res, err, 'Octopus çıktısı üretilemedi.'); }
});
/* Görsel eki (§7): sabit bir izin listesi + say/boyut sınırı. Base64 ham
   boyuta göre ~%33 büyür; 6 MB decode sınırı ekran görüntüsü/rapor
   görseli için yeterli, sunucuyu büyük yüklerle boğmaz. Geçersiz/aşırı
   büyük bir ek sessizce ATILIR — kullanıcı "gönderildi ama görülmedi"
   sanmasın diye copilot-agent.js görsel isteyip hiç ek gelmediğini
   fark ederse kullanıcıya söyler (bkz. vision routing). */
const COPILOT_MAX_ATTACHMENTS = 3;
const COPILOT_MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const COPILOT_ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
function sanitizeCopilotAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, COPILOT_MAX_ATTACHMENTS).map(item => {
    const mimeType = String(item && item.mimeType || '').toLowerCase().trim();
    const dataBase64 = String(item && item.dataBase64 || '').trim();
    if (!COPILOT_ALLOWED_IMAGE_MIME.has(mimeType) || !dataBase64) return null;
    if (dataBase64.length * 0.75 > COPILOT_MAX_ATTACHMENT_BYTES) return null;
    return { mimeType, dataBase64 };
  }).filter(Boolean);
}
app.post('/api/copilot/ask', userAccess.requireAnyArea('source', 'koleksiyon', 'cp', 'orders', 'overview'), express.json({ limit: '16mb' }), async (req, res) => {
  try {
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const requestedPolicy=String(body.horizon&&body.horizon.outsideHorizon||'allow').trim().toLowerCase();
    const horizon={
      seasons:Array.isArray(body.horizon&&body.horizon.seasons)?body.horizon.seasons.map(value=>String(value||'').trim()).filter(Boolean).slice(0,50):[],
      outsideHorizon:['allow','ask','deny'].includes(requestedPolicy)?requestedPolicy:'allow',
    };
    const result=await copilotAgent.respond({
      question:String(body.question||''),history:body.history,language:body.language,model:body.model,
      attachments:sanitizeCopilotAttachments(body.attachments),
      horizon,ownerId:req.currentUser.id,profile:req.currentUser,
      toolRegistry:agentToolRegistry,policyEngine:agentPolicyEngine,
    });
    userAccess.appendAudit(req.currentUser,'COPILOT_RESPONSE',result.model||'gemma',{mode:result.mode,toolCount:result.toolCalls.length,sources:[...new Set((result.evidence||[]).map(item=>item.source).filter(Boolean))]});
    /* ÇIKTI MODELİ İSTEMCİYE GİTMEZ. Ajan onu üretiyor çünkü araç
       satırları yalnız orada; ama satırların istemciye gönderilmemesi
       kasıtlı bir karar. Model sunucuda saklanır, yerine kısa ömürlü bir
       kimlik gider. Ayıklamayı unutmak, tam da o kararı sessizce geri
       almak olurdu. */
    const { exportModel, ...payload } = result;
    const exportId = exportModel ? octopusExports.put(req.currentUser.id, exportModel) : null;
    res.set('Cache-Control','no-store').json(exportId
      ? { ...payload, export: { id: exportId, fileName: exportModel.fileName, tableCount: exportModel.tableCount, rowCount: exportModel.rowCount } }
      : payload);
  } catch(err) { agentPlatformError(res,err,'Octopus yanıt üretemedi.'); }
});

/* Akışlı (SSE) ikiz uç. Yukarıdaki /api/copilot/ask ile AYNI ajanı çağırır —
   tek fark onDelta/onReset callback'leri: model "answer" alanını üretirken
   parça parça yollanır (bkz. copilot-agent.js createAnswerStreamExtractor).
   EventSource kullanılmaz çünkü yalnız GET destekler; istemci düz fetch() +
   ReadableStream ile POST gövdesiyle SSE tüketir (gateway.chatStream'in
   kendi SSE tüketimiyle aynı desen). */
app.post('/api/copilot/ask/stream', userAccess.requireAnyArea('source', 'koleksiyon', 'cp', 'orders', 'overview'), express.json({ limit: '16mb' }), async (req, res) => {
  const body=req.body&&typeof req.body==='object'?req.body:{};
  const requestedPolicy=String(body.horizon&&body.horizon.outsideHorizon||'allow').trim().toLowerCase();
  const horizon={
    seasons:Array.isArray(body.horizon&&body.horizon.seasons)?body.horizon.seasons.map(value=>String(value||'').trim()).filter(Boolean).slice(0,50):[],
    outsideHorizon:['allow','ask','deny'].includes(requestedPolicy)?requestedPolicy:'allow',
  };
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  try {
    const result=await copilotAgent.respond({
      question:String(body.question||''),history:body.history,language:body.language,model:body.model,
      attachments:sanitizeCopilotAttachments(body.attachments),
      horizon,ownerId:req.currentUser.id,profile:req.currentUser,
      toolRegistry:agentToolRegistry,policyEngine:agentPolicyEngine,
      onDelta:text=>send('delta',{text}),
      onReset:()=>send('reset',{}),
    });
    userAccess.appendAudit(req.currentUser,'COPILOT_RESPONSE',result.model||'gemma',{mode:result.mode,toolCount:result.toolCalls.length,sources:[...new Set((result.evidence||[]).map(item=>item.source).filter(Boolean))]});
    const { exportModel, ...payload } = result;
    const exportId = exportModel ? octopusExports.put(req.currentUser.id, exportModel) : null;
    send('done', exportId
      ? { ...payload, export: { id: exportId, fileName: exportModel.fileName, tableCount: exportModel.tableCount, rowCount: exportModel.rowCount } }
      : payload);
  } catch(err) {
    send('error', { error: (err && err.message) || 'Octopus yanıt üretemedi.', code: err && err.code || 'AGENT_PLATFORM_ERROR' });
  } finally { res.end(); }
});

app.get('/api/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  // The desktop launcher needs a version marker before either authentication layer.
  // When the optional outer password gate is enabled, do not expose local paths or
  // source metadata until that gate has been passed.
  if (auth.enabled && !auth.isAuthenticated(req)) {
    return res.json({ app: 'Buyer Log', appVersion: APP_VERSION, displayVersion: DISPLAY_VERSION, authRequired: true });
  }
  const id=sourceUserId(req),runtime=cacheForUser(id);
  res.json({ app: 'Buyer Log', appVersion: APP_VERSION, displayVersion: DISPLAY_VERSION, loadedAt: runtime.loadedAt, sources: runtime.sources, sourceFolder: sourceFolderForUser(id), userId:id, excelWorker: getExcelWorkerStats() });
});

};
