'use strict';
/* Test Raporu Aktarımı (sürükle-bırak).
   GET  /api/test-reports          → depolanan raporlar, bağlantılar, tip eşlemesi
   POST /api/test-reports/parse    → dosyaları okur, önizleme için rapor döner
                                     (hiçbir şey kalıcı yazılmaz)
   POST /api/test-reports/commit   → kullanıcının onayladığı kalemleri yazar,
                                     ekleri checklist ek deposuna koyar
   Yetki: ek yükleme ile aynı alanlar (cp, orders); satır düzenleme yetkisi
   istemcide row._canEdit ile ayrıca uygulanır. */

const MAX_FILES = 30;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MIME = { pdf: 'application/pdf', msg: 'application/vnd.ms-outlook', eml: 'message/rfc822' };

module.exports = function registerTestReportRoutes(app, deps) {
  const { automationError, checklistSupplierStore, express, userAccess } = deps;
  const extract = deps.testReportExtract || require('../lib/test-reports/extract');
  const store = deps.testReportStore || require('../lib/test-reports/store');
  const staging = deps.testReportStaging || require('../lib/test-reports/staging');
  const userId = req => String(req.currentUser && req.currentUser.id || '');
  const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 300);

  app.get('/api/test-reports', userAccess.requireAnyArea('cp', 'orders', 'overview'), (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(store.publicPayload()); }
    catch (err) { automationError(res, err, 'Test raporları okunamadı.'); }
  });

  app.get('/api/test-reports/tasks', userAccess.requireAnyArea('cp', 'orders', 'overview'), (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ tasks: store.tasks() }); }
    catch (err) { automationError(res, err, 'Test raporu görevleri okunamadı.'); }
  });

  app.post('/api/test-reports/parse', userAccess.requireAnyArea('cp', 'orders'), express.json({ limit: '160mb' }), async (req, res) => {
    try {
      const input = Array.isArray(req.body && req.body.files) ? req.body.files : null;
      if (!input || !input.length) return res.status(400).json({ error: 'files (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
      if (input.length > MAX_FILES) return res.status(413).json({ error: 'En fazla ' + MAX_FILES + ' dosya bırakılabilir.', code: 'TEST_REPORT_TOO_MANY_FILES' });
      const files = [];
      for (const raw of input) {
        const buffer = Buffer.from(String(raw && raw.base64 || '').replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, ''), 'base64');
        if (!buffer.length || buffer.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'Dosya boş ya da 40 MB sınırını aşıyor.', code: 'TEST_REPORT_FILE_SIZE', file: text(raw && raw.name) });
        files.push({ name: text(raw && raw.name, 300) || 'file', buffer });
      }
      const session = staging.createSession(userId(req));
      const out = await extract.processFiles(files, { stage: session.stage });
      session.setReports(out.reports);
      res.set('Cache-Control', 'no-store').json({
        ok: true,
        sessionId: session.id,
        files: out.files.map(f => ({ name: f.name, kind: f.kind, status: f.status, format: f.format, warnings: f.warnings, talepNos: f.reports.map(r => r.talepNo) })),
        reports: out.reports,
      });
    } catch (err) {
      automationError(res, err, 'Test raporları okunamadı.');
    }
  });

  app.post('/api/test-reports/commit', userAccess.requireAnyArea('cp', 'orders'), express.json({ limit: '2mb' }), (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const session = staging.getSession(body.sessionId, userId(req));
      if (!session) return res.status(410).json({ error: 'Önizleme süresi doldu; dosyaları yeniden bırakın.', code: 'TEST_REPORT_SESSION_EXPIRED' });
      const requested = Array.isArray(body.items) ? body.items : [];
      const byTalep = new Map(session.reports.filter(r => r.talepNo).map(r => [r.talepNo, r]));
      const items = [];
      for (const raw of requested) {
        const report = byTalep.get(text(raw && raw.talepNo, 20));
        if (!report) return res.status(400).json({ error: 'Önizlemede olmayan talep no.', code: 'TEST_REPORT_UNKNOWN', talepNo: text(raw && raw.talepNo, 20) });
        items.push({ report, orderKey: text(raw.orderKey, 300), itemId: text(raw.itemId, 160), context: raw.context && typeof raw.context === 'object' ? raw.context : {} });
      }
      const attach = (file, report, item) => {
        const staged = file.stagingId ? session.files.get(file.stagingId) : null;
        if (!staged) return null;
        const c = item.context;
        return checklistSupplierStore.addAttachmentBuffer(staged.buffer, {
          filename: staged.name,
          mimeType: MIME[staged.kind] || 'application/octet-stream',
          context: {
            orderCode: text(c.orderCode, 60), plmId: text(c.plmId, 60), modelName: text(c.modelName, 120),
            colourCode: text(c.colourCode, 60), checklistName: text(c.checklistName, 120) || 'Test',
            checklistStatus: text(c.checklistStatus, 60) || report.talepNo,
          },
        }, req.currentUser);
      };
      const typeMap = body.typeMap && typeof body.typeMap === 'object' ? body.typeMap : {};
      const result = store.commit(items, typeMap, req.currentUser, attach);
      for (const item of result.results) {
        userAccess.appendAudit(req.currentUser, 'TEST_REPORT_IMPORT', item.talepNo, {
          orderKey: item.orderKey, itemId: item.itemId,
          attachments: item.attachments.length, newDecisions: item.newDecisions,
          sources: (item.report.kaynaklar || []).slice(0, 6),
        });
      }
      staging.dropSession(body.sessionId);
      res.json(result);
    } catch (err) {
      automationError(res, err, 'Test raporları kaydedilemedi.');
    }
  });
};
