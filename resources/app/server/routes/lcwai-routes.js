'use strict';

/*
 * /api/lcwai/* — renderer ile LCW AI motoru arasındaki tek kapı.
 *
 * Renderer yalnız İSTEK, İLERLEME, SONUÇ ve HATA görür. Token, Authorization
 * başlığı veya tarayıcı oturum ayrıntısı hiçbir yanıtta yer almaz. Hata
 * yanıtları kod + TR/EN metindir; ham exception dönmez.
 */
const { publicError, isLcwAiError, lcwAiError } = require('../lib/lcwai/lcwai-errors');
const lcwaiConfig = require('../lib/lcwai/lcwai-config');
const layoutControlStore = require('../lib/layout-control-store');
const userTemplates = require('../lib/lcwai-output/output-user-templates');
const { TEMPLATES: BUILT_IN_TEMPLATES } = require('../lib/lcwai-output/output-templates');

module.exports = function registerLcwAiRoutes(app, deps) {
  const {
    express,
    userAccess,
  } = deps;
  // Testler motoru enjekte edebilir; üretimde varsayılan LCW AI motoru kullanılır.
  const engineOverride = deps.engine;
  const engineOf = () => engineOverride || require('../lib/lcwai').getDefaultEngine();
  const outputOverride = deps.outputService;
  const outputsOf = () => outputOverride || require('../lib/lcwai').getDefaultOutputService();
  const platform = deps.platform || require('../lib/platform');
  const loginErrors = new Map();
  const ownerOf = req => String(req.currentUser && req.currentUser.id || 'default');
  const audit = (req, action, details) => { try { userAccess.appendAudit(req.currentUser, action, 'lcwai', details); } catch (_) {} };
  const fail = (res, error) => {
    const safe = isLcwAiError(error) ? error : lcwAiError('INTERNAL');
    if (!isLcwAiError(error)) { try { console.warn('[LCWAI] route failure', error && error.code ? `code=${error.code}` : ''); } catch (_) {} }
    res.status(safe.statusCode || 500).set('Cache-Control', 'no-store').json({ ok: false, error: safe.message, ...publicError(safe) });
  };
  /* ---------------- Çıktı şablonları (kişisel + ekip) ----------------
     Depo profil deposudur (db.js): kişisel kopya kullanıcıya, ekip şablonları
     ortak dosyaya yazılır. Ekip şablonunu yalnız sahibi ya da moderatör
     değiştirir/siler; diğerleri "Kopyasını al" ile kendi listesine alır. */
  const templateStore = deps.outputTemplates || null;
  const canModerate = req => { try { return Boolean(typeof userAccess.hasPermission === 'function' && userAccess.hasPermission(req.currentUser, 'manageAllOrders')); } catch (_) { return false; } };
  const nameOf = req => { const user = req.currentUser || {}; return String(user.displayName || user.username || user.id || '').slice(0, 80); };
  function requireTemplateStore() { if (!templateStore) throw lcwAiError('OUTPUT_TEMPLATE_NOT_FOUND'); return templateStore; }
  function publicTemplate(item, shared, req) {
    const data = item && item.data && typeof item.data === 'object' ? item.data : {};
    const definition = userTemplates.normalizeDefinition(data.definition);
    if (!definition) return null;
    const mine = shared ? String(data.ownerId || '') === ownerOf(req) : true;
    return {
      id: item.id, name: String(item.name || '').slice(0, 80), shared, mine, canEdit: shared ? mine || canModerate(req) : true,
      ownerName: shared ? String(data.ownerName || '').slice(0, 80) : '', updatedAt: item.updatedAt || item.createdAt || null, definition,
    };
  }
  function templateLists(req) {
    const store = requireTemplateStore();
    const personal = (store.load(ownerOf(req)).items || []).map(item => publicTemplate(item, false, req)).filter(Boolean);
    const shared = (store.load(null).items || []).map(item => publicTemplate(item, true, req)).filter(Boolean);
    return { personal, shared };
  }
  function findTemplate(req, id, shared) {
    const store = requireTemplateStore();
    const item = (store.load(shared ? null : ownerOf(req)).items || []).find(entry => entry && entry.id === String(id || ''));
    if (!item) throw lcwAiError('OUTPUT_TEMPLATE_NOT_FOUND');
    return item;
  }
  function templateInput(body) {
    const name = String(body && body.name || '').replace(/\s+/g, ' ').trim().slice(0, userTemplates.LIMITS.name);
    const definition = userTemplates.normalizeDefinition(body && body.definition);
    if (!name || !definition) throw lcwAiError('OUTPUT_TEMPLATE_INVALID');
    return { name, definition };
  }
  /* Sohbetteki istek: { id, shared } → depodaki şablon. İstemcinin gönderdiği
     tanım kullanılmaz; ekip şablonu da sunucudan okunur. */
  function resolveUserTemplate(req, output) {
    const ref = output && output.userTemplate;
    if (!ref || typeof ref !== 'object') return null;
    const item = findTemplate(req, ref.id, ref.shared === true);
    const template = publicTemplate(item, ref.shared === true, req);
    if (!template) throw lcwAiError('OUTPUT_TEMPLATE_NOT_FOUND');
    return { name: template.name, definition: template.definition };
  }

  const withLoginError = (owner, status) => {
    const error = loginErrors.get(owner);
    return error && !status.connected && !status.loginInProgress ? { ...status, lastError: error } : status;
  };

app.get('/api/lcwai/config', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true, config: lcwaiConfig.publicConfig() });
  });

app.get('/api/lcwai/status', async (req, res) => {
    try {
      const owner = ownerOf(req);
      const status = await engineOf().getStatus(owner, { refresh: req.query.refresh !== '0' });
      res.set('Cache-Control', 'no-store').json({ ok: true, status: withLoginError(owner, status) });
    } catch (error) { fail(res, error); }
  });

  /* Giriş arka planda yürür (kullanıcı tarayıcıda kurumsal girişini yapar);
     istemci durumu /status ile izler. Zaten geçerli bir sekme varsa sonuç
     birkaç saniye içinde döner. */
app.post('/api/lcwai/connect', express.json({ limit: '4kb' }), async (req, res) => {
    const owner = ownerOf(req);
    const engine = engineOf();
    loginErrors.delete(owner);
    const login = engine.login(owner).then(status => { audit(req, 'LCWAI_CONNECT', { ok: true }); return status; }, error => {
      loginErrors.set(owner, publicError(isLcwAiError(error) ? error : lcwAiError('BROWSER_UNAVAILABLE')));
      audit(req, 'LCWAI_CONNECT', { ok: false, code: error && error.code });
      throw error;
    });
    login.catch(() => {});
    const quick = await Promise.race([login.then(() => 'done', () => 'failed'), new Promise(resolve => setTimeout(() => resolve('pending'), 2500))]);
    try {
      if (quick === 'failed') { await login; return; }
      const status = await engine.getStatus(owner, { refresh: false });
      res.set('Cache-Control', 'no-store').json({ ok: true, status: withLoginError(owner, status) });
    } catch (error) { fail(res, error); }
  });

app.post('/api/lcwai/disconnect', express.json({ limit: '4kb' }), async (req, res) => {
    try {
      const owner = ownerOf(req);
      loginErrors.delete(owner);
      const status = await engineOf().disconnect(owner);
      audit(req, 'LCWAI_DISCONNECT', {});
      res.set('Cache-Control', 'no-store').json({ ok: true, status });
    } catch (error) { fail(res, error); }
  });

app.post('/api/lcwai/cancel', express.json({ limit: '4kb' }), (req, res) => {
    const cancelled = engineOf().cancel(ownerOf(req), req.body && req.body.requestId);
    res.set('Cache-Control', 'no-store').json({ ok: true, cancelled });
  });

  /* Dosya ham gövdeyle gelir (multipart ayrıştırıcısı/bağımlılığı yok).
     Ad başlıkta URI-kodlu taşınır. Sonuç yalnız ek tanımıdır. */
app.post('/api/lcwai/files', express.raw({ type: () => true, limit: lcwaiConfig.LIMITS.maxFileBytes + 1024 }), async (req, res) => {
    try {
      let fileName = '';
      try { fileName = decodeURIComponent(String(req.headers['x-lcwai-file-name'] || '')); } catch (_) { fileName = ''; }
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const attachment = await engineOf().uploadFile(ownerOf(req), { buffer, fileName, contentType: req.headers['content-type'] });
      audit(req, 'LCWAI_FILE_UPLOAD', { bytes: buffer.length });
      res.set('Cache-Control', 'no-store').json({ ok: true, attachment });
    } catch (error) {
      if (error && error.type === 'entity.too.large') return fail(res, lcwAiError('FILE_TOO_LARGE'));
      fail(res, error);
    }
  });

  /* Genel sohbet (Global LCW AI). ask ile aynı NDJSON akışı; sonuç chatId
   taşır, istemci devam mesajlarında aynı chatId'yi gönderir. */
app.post('/api/lcwai/chat', express.json({ limit: '2mb' }), async (req, res) => {
    const owner = ownerOf(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const controller = new AbortController();
    let finished = false;
    res.on('close', () => { if (!finished) controller.abort(); });
    res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const write = event => { if (!res.writableEnded) { try { res.write(`${JSON.stringify(event)}\n`); } catch (_) {} } };
    const contexts = Array.isArray(body.contexts) ? body.contexts : [];
    // output: { format: pdf|xlsx|pptx|html, orientation, detail } → AI Çıktı
    // Oluşturma; aynı sohbet, cevap Buyer Log'un oluşturduğu dosyadır.
    let output = body.output && typeof body.output === 'object' ? { ...body.output } : null;
    try {
      if (output) {
        const resolved = resolveUserTemplate(req, output);
        output = { ...output, userTemplate: resolved };
        if (resolved) output.format = resolved.definition.format;
      }
      const input = {
        requestId: body.requestId,
        chatId: body.chatId,
        message: body.message,
        contexts,
        attachments: body.attachments,
        lang: body.lang,
        signal: controller.signal,
        onProgress: event => write({ type: 'progress', ...event }),
      };
      const result = output ? await outputsOf().create(owner, { ...input, output }) : await engineOf().chat(owner, input);
      audit(req, 'LCWAI_CHAT', { ok: true, continued: Boolean(body.chatId), contexts: contexts.length, attachments: Array.isArray(body.attachments) ? body.attachments.length : 0, output: output ? String(output.format || '').slice(0, 8) : undefined });
      write({ type: 'result', result });
    } catch (error) {
      const safe = isLcwAiError(error) ? error : lcwAiError('INTERNAL');
      if (!isLcwAiError(error)) { try { console.warn('[LCWAI] chat failure', error && error.code ? `code=${error.code}` : ''); } catch (_) {} }
      audit(req, 'LCWAI_CHAT', { ok: false, code: safe.code, output: output ? String(output.format || '').slice(0, 8) : undefined });
      write({ type: 'error', error: publicError(safe) });
    } finally {
      finished = true;
      if (!res.writableEnded) res.end();
    }
  });

  /* ---------------- Layout Control history ----------------
     PDF baytları/native metin saklanmaz. Yalnız normalize kontrol özeti,
     reference zamanı ve kullanıcıya gösterilen check sonuçları kalıcıdır. */
app.get('/api/lcwai/layout-control/history', (req, res) => {
    try {
      const result = layoutControlStore.listRuns(ownerOf(req), req.query && req.query.limit);
      res.set('Cache-Control', 'no-store').json({ ok: true, ...result });
    } catch (error) { fail(res, error); }
  });

app.post('/api/lcwai/layout-control/history', express.json({ limit: '512kb' }), (req, res) => {
    try {
      const result = layoutControlStore.add(ownerOf(req), req.body || {});
      audit(req, 'LCWAI_LAYOUT_CHECK', {
        documentType: result.run.documentType,
        status: result.run.summary.status,
        models: result.run.modelCodes.slice(0, 3),
        errors: result.run.summary.errors,
        review: result.run.summary.review,
        notChecked: result.run.summary.notChecked,
      });
      res.set('Cache-Control', 'no-store').json({ ok: true, ...result });
    } catch (error) { fail(res, error); }
  });

app.delete('/api/lcwai/layout-control/history', (req, res) => {
    try {
      const result = layoutControlStore.clear(ownerOf(req));
      audit(req, 'LCWAI_LAYOUT_HISTORY_CLEAR', { count: result.cleared });
      res.set('Cache-Control', 'no-store').json({ ok: true, ...result });
    } catch (error) { fail(res, error); }
  });

app.patch('/api/lcwai/layout-control/history/:id', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const result=layoutControlStore.review(ownerOf(req),req.params.id,req.body||{});
      audit(req,'LCWAI_LAYOUT_REVIEW',{runId:result.run.id,rule:req.body&&req.body.check&&req.body.check.rule,status:result.run.summary.status});
      res.set('Cache-Control','no-store').json({ok:true,...result});
    }catch(error){fail(res,error);}
  });

  /* ---------------- AI Çıktı Düzenleyici (taslaklar) ----------------
     Taslak yalnız sahibine açılır; düzenleme yeniden doğrulanır ve yeni bir
     dosya olarak kaydedilir (eski dosya silinmez). */
app.get('/api/lcwai/output-drafts/:id', (req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json({ ok: true, draft: outputsOf().getDraft(ownerOf(req), req.params.id) });
    } catch (error) { fail(res, error); }
  });

app.post('/api/lcwai/output-drafts/:id/render', express.json({ limit: '8mb' }), (req, res) => {
    try {
      const body = req.body || {};
      const result = outputsOf().renderDraft(ownerOf(req), req.params.id, { data: body.data, title: body.title, orientation: body.orientation });
      audit(req, 'LCWAI_OUTPUT_EDIT', { format: result.output.format, pending: result.output.pending || undefined });
      res.set('Cache-Control', 'no-store').json({ ok: true, ...result });
    } catch (error) {
      if (error && error.type === 'entity.too.large') return fail(res, lcwAiError('OUTPUT_RENDER_FAILED', { detail: 'draft-too-large' }));
      fail(res, error);
    }
  });

app.post('/api/lcwai/output-drafts/:id/skeleton', express.json({ limit: '8mb' }), (req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json({ ok: true, definition: outputsOf().skeleton(ownerOf(req), req.params.id, req.body && req.body.data) });
    } catch (error) { fail(res, error); }
  });

  /* ---------------- Çıktı şablonları ---------------- */
app.get('/api/lcwai/output-templates', (req, res) => {
    try {
      const builtIn = Object.values(BUILT_IN_TEMPLATES).map(item => ({ key: item.key, label: item.label, formats: item.formats }));
      res.set('Cache-Control', 'no-store').json({ ok: true, builtIn, ...templateLists(req) });
    } catch (error) { fail(res, error); }
  });

app.post('/api/lcwai/output-templates', express.json({ limit: '256kb' }), (req, res) => {
    try {
      const store = requireTemplateStore();
      const { name, definition } = templateInput(req.body);
      const shared = req.body && req.body.shared === true;
      store.add(shared ? null : ownerOf(req), name, { definition, ownerId: ownerOf(req), ownerName: nameOf(req) }, null);
      audit(req, 'LCWAI_OUTPUT_TEMPLATE_CREATE', { format: definition.format, shared, items: definition.structure.length });
      res.set('Cache-Control', 'no-store').json({ ok: true, ...templateLists(req) });
    } catch (error) { fail(res, error); }
  });

app.put('/api/lcwai/output-templates/:id', express.json({ limit: '256kb' }), (req, res) => {
    try {
      const store = requireTemplateStore();
      const shared = String(req.query && req.query.shared || '') === '1';
      const item = findTemplate(req, req.params.id, shared);
      const current = publicTemplate(item, shared, req);
      if (!current || !current.canEdit) throw lcwAiError('OUTPUT_TEMPLATE_FORBIDDEN');
      const { name, definition } = templateInput({ name: req.body && req.body.name || current.name, definition: req.body && req.body.definition || current.definition });
      store.update(shared ? null : ownerOf(req), item.id, { ...item.data, definition }, null, name);
      audit(req, 'LCWAI_OUTPUT_TEMPLATE_UPDATE', { format: definition.format, shared });
      res.set('Cache-Control', 'no-store').json({ ok: true, ...templateLists(req) });
    } catch (error) { fail(res, error); }
  });

app.delete('/api/lcwai/output-templates/:id', (req, res) => {
    try {
      const store = requireTemplateStore();
      const shared = String(req.query && req.query.shared || '') === '1';
      const item = findTemplate(req, req.params.id, shared);
      const current = publicTemplate(item, shared, req);
      if (shared && !(current && current.canEdit)) throw lcwAiError('OUTPUT_TEMPLATE_FORBIDDEN');
      store.remove(shared ? null : ownerOf(req), item.id, null);
      audit(req, 'LCWAI_OUTPUT_TEMPLATE_DELETE', { shared });
      res.set('Cache-Control', 'no-store').json({ ok: true, ...templateLists(req) });
    } catch (error) { fail(res, error); }
  });

  // Kişisel şablonu ekiple paylaşır: KOPYALAR, taşımaz (sahibinin kopyası kalır).
app.post('/api/lcwai/output-templates/:id/share', express.json({ limit: '4kb' }), (req, res) => {
    try {
      const store = requireTemplateStore();
      const item = findTemplate(req, req.params.id, false);
      const current = publicTemplate(item, false, req);
      if (!current) throw lcwAiError('OUTPUT_TEMPLATE_NOT_FOUND');
      store.add(null, current.name, { definition: current.definition, ownerId: ownerOf(req), ownerName: nameOf(req) }, null);
      audit(req, 'LCWAI_OUTPUT_TEMPLATE_SHARE', { format: current.definition.format });
      res.set('Cache-Control', 'no-store').json({ ok: true, ...templateLists(req) });
    } catch (error) { fail(res, error); }
  });

  // Ekip şablonunun kişisel kopyası (kullanıcı kendi ihtiyacına göre değiştirir).
app.post('/api/lcwai/output-templates/:id/copy', express.json({ limit: '4kb' }), (req, res) => {
    try {
      const store = requireTemplateStore();
      const item = findTemplate(req, req.params.id, true);
      const current = publicTemplate(item, true, req);
      if (!current) throw lcwAiError('OUTPUT_TEMPLATE_NOT_FOUND');
      store.add(ownerOf(req), current.name, { definition: current.definition, ownerId: ownerOf(req), ownerName: nameOf(req), copiedFrom: current.ownerName }, null);
      audit(req, 'LCWAI_OUTPUT_TEMPLATE_COPY', { format: current.definition.format });
      res.set('Cache-Control', 'no-store').json({ ok: true, ...templateLists(req) });
    } catch (error) { fail(res, error); }
  });

  /* ---------------- AI çıktıları (AI Outputs) ----------------
     Renderer dosyaya yalnız kimlik ile ulaşır; yol kabul edilmez. */
app.get('/api/lcwai/outputs', (req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json({ ok: true, outputs: outputsOf().list(ownerOf(req), 20) });
    } catch (error) { fail(res, error); }
  });

  // Çıktının kullandığı model görselleri: renderer yerel depodan çözer
  // ({ anahtar: dataURL }); sunucu doğrular ve dosyayı görsellerle oluşturur.
  // records: aynı anahtarların bağlam satırı (kart bilgisi kaynak değerleri).
app.post('/api/lcwai/outputs/:pendingId/images', express.json({ limit: '48mb' }), (req, res) => {
    try {
      const output = outputsOf().completeImages(ownerOf(req), req.params.pendingId, req.body && req.body.images, req.body && req.body.records);
      audit(req, 'LCWAI_OUTPUT_IMAGES', { requested: output.imagesRequested, used: output.imagesUsed });
      res.set('Cache-Control', 'no-store').json({ ok: true, output });
    } catch (error) {
      if (error && error.type === 'entity.too.large') return fail(res, lcwAiError('OUTPUT_RENDER_FAILED', { detail: 'images-too-large' }));
      fail(res, error);
    }
  });

  // Masaüstü kabuğunun (Chromium printToPDF) bastığı PDF baytları.
app.post('/api/lcwai/outputs/:pendingId/pdf', express.raw({ type: () => true, limit: '52mb' }), (req, res) => {
    try {
      const record = outputsOf().completePdf(ownerOf(req), req.params.pendingId, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
      audit(req, 'LCWAI_OUTPUT', { format: 'pdf', bytes: record.bytes });
      res.set('Cache-Control', 'no-store').json({ ok: true, output: record });
    } catch (error) { fail(res, error); }
  });

  // Kabuk yoksa/başarısızsa aynı belge HTML olarak kaydedilir.
app.post('/api/lcwai/outputs/:pendingId/fallback', express.json({ limit: '4kb' }), (req, res) => {
    try {
      const record = outputsOf().fallbackHtml(ownerOf(req), req.params.pendingId);
      audit(req, 'LCWAI_OUTPUT', { format: 'html', fallback: true, bytes: record.bytes });
      res.set('Cache-Control', 'no-store').json({ ok: true, output: record });
    } catch (error) { fail(res, error); }
  });

app.post('/api/lcwai/outputs/:id/open', express.json({ limit: '4kb' }), (req, res) => {
    try {
      const record = outputsOf().get(ownerOf(req), req.params.id);
      if (!record) throw lcwAiError('OUTPUT_NOT_FOUND');
      res.set('Cache-Control', 'no-store').json({ ok: Boolean(platform.openPathExternallyAsync(record.path)) });
    } catch (error) { fail(res, error); }
  });

app.post('/api/lcwai/outputs/:id/reveal', express.json({ limit: '4kb' }), (req, res) => {
    try {
      const record = outputsOf().get(ownerOf(req), req.params.id);
      if (!record) throw lcwAiError('OUTPUT_NOT_FOUND');
      res.set('Cache-Control', 'no-store').json({ ok: Boolean(platform.revealFileExternally(record.path)) });
    } catch (error) { fail(res, error); }
  });

/* İstek NDJSON akışıyla cevaplanır: {type:'progress'} … {type:'result'} ya
     da {type:'error'}. İstemci bağlantıyı keserse LCW AI isteği de iptal
     edilir. */
app.post('/api/lcwai/ask', express.json({ limit: '768kb' }), async (req, res) => {
    const owner = ownerOf(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const controller = new AbortController();
    let finished = false;
    res.on('close', () => { if (!finished) controller.abort(); });
    res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const write = event => { if (!res.writableEnded) { try { res.write(`${JSON.stringify(event)}\n`); } catch (_) {} } };
    const source = String(body.source || '').slice(0, 40);
    try {
      const result = await engineOf().ask(owner, {
        requestId: body.requestId,
        source,
        task: body.task,
        context: body.context,
        guide: body.guide,
        lang: body.lang,
        attachments: body.attachments,
        signal: controller.signal,
        onProgress: event => write({ type: 'progress', ...event }),
      });
      audit(req, 'LCWAI_ASK', { source, ok: true, structured: result.structured.ok, attachments: Array.isArray(body.attachments) ? body.attachments.length : 0 });
      write({ type: 'result', result });
    } catch (error) {
      const safe = isLcwAiError(error) ? error : lcwAiError('INTERNAL');
      audit(req, 'LCWAI_ASK', { source, ok: false, code: safe.code });
      write({ type: 'error', error: publicError(safe) });
    } finally {
      finished = true;
      if (!res.writableEnded) res.end();
    }
  });
};
