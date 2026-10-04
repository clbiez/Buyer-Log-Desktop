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

module.exports = function registerLcwAiRoutes(app, deps) {
  const {
    express,
    userAccess,
  } = deps;
  // Testler motoru enjekte edebilir; üretimde varsayılan LCW AI motoru kullanılır.
  const engineOverride = deps.engine;
  const engineOf = () => engineOverride || require('../lib/lcwai').getDefaultEngine();
  const loginErrors = new Map();
  const ownerOf = req => String(req.currentUser && req.currentUser.id || 'default');
  const audit = (req, action, details) => { try { userAccess.appendAudit(req.currentUser, action, 'lcwai', details); } catch (_) {} };
  const fail = (res, error) => {
    const safe = isLcwAiError(error) ? error : lcwAiError('INTERNAL');
    if (!isLcwAiError(error)) { try { console.warn('[LCWAI] route failure', error && error.code ? `code=${error.code}` : ''); } catch (_) {} }
    res.status(safe.statusCode || 500).set('Cache-Control', 'no-store').json({ ok: false, error: safe.message, ...publicError(safe) });
  };
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
