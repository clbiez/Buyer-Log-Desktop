'use strict';

const merchCalendarStore = require('../lib/merch-calendar-store');

module.exports = function registerMerchCalendarRoutes(app, deps = {}) {
  const { express, userAccess } = deps;
  if (!app || !express || !userAccess) throw new Error('Merch Calendar route dependencies are incomplete.');

  const read = (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json({ ok:true, ...merchCalendarStore.publicProjection() });
    } catch (error) {
      res.status(500).json({ ok:false, error:'Merch Calendar okunamadı.', code:error.code || 'MERCH_READ_FAILED' });
    }
  };

  app.get('/api/merch-calendar', read);

  app.post(
    '/api/merch-calendar',
    userAccess.requireArea('source'),
    userAccess.requirePermission('manageModelConnections'),
    express.json({ limit:'18mb' }),
    (req, res) => {
      try {
        const body = req.body || {};
        const sourceName = String(body.name || '').trim();
        const encoded = String(body.contentBase64 || '').trim();
        if (!sourceName) return res.status(400).json({ ok:false, error:'Dosya adı gerekli.', code:'MERCH_NAME_REQUIRED' });
        if (!encoded) return res.status(400).json({ ok:false, error:'Merch Calendar dosyası gerekli.', code:'MERCH_FILE_REQUIRED' });
        const ext = sourceName.toLocaleLowerCase('en').match(/\.(xlsx?|html?)$/);
        if (!ext) return res.status(400).json({ ok:false, error:'Yalnız .xls, .xlsx, .html veya .htm Merch Calendar dosyaları kabul edilir.', code:'MERCH_FILE_TYPE' });
        let buffer;
        try { buffer = Buffer.from(encoded, 'base64'); }
        catch (_) { return res.status(400).json({ ok:false, error:'Merch Calendar dosyası okunamadı.', code:'MERCH_BASE64_INVALID' }); }
        if (!buffer.length) return res.status(400).json({ ok:false, error:'Merch Calendar dosyası boş.', code:'MERCH_EMPTY' });
        const saved = merchCalendarStore.save(buffer, sourceName);
        if (typeof userAccess.appendAudit === 'function') {
          userAccess.appendAudit(req.currentUser, 'MERCH_CALENDAR_UPLOAD', sourceName, {
            yearFrom:saved.meta && saved.meta.yearFrom,
            yearTo:saved.meta && saved.meta.yearTo,
            weekCount:saved.meta && saved.meta.weekCount,
          });
        }
        return res.json({ ok:true, ...merchCalendarStore.publicProjection(saved) });
      } catch (error) {
        return res.status(Number(error.status) || 400).json({
          ok:false,
          error:String(error && error.message || 'Merch Calendar yüklenemedi.'),
          code:error && error.code || 'MERCH_UPLOAD_FAILED',
          details:error && error.details || null,
        });
      }
    },
  );

  app.delete(
    '/api/merch-calendar',
    userAccess.requireArea('source'),
    userAccess.requirePermission('manageModelConnections'),
    (req, res) => {
      try {
        merchCalendarStore.remove();
        if (typeof userAccess.appendAudit === 'function') userAccess.appendAudit(req.currentUser, 'MERCH_CALENDAR_DELETE', 'Merch Calendar');
        return res.json({ ok:true, configured:false, calendar:null, summary:null });
      } catch (error) {
        return res.status(500).json({ ok:false, error:'Merch Calendar kaldırılamadı.', code:error.code || 'MERCH_DELETE_FAILED' });
      }
    },
  );
};
