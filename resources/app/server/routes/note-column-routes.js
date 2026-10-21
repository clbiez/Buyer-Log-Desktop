'use strict';

/* Kullanıcı tanımlı not sütunları ve Excel içe aktarma denetimi route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerNoteColumnRoutes(app, deps) {
  const {
    apiError,
    express,
    loadOverrides,
    publishSharedMasterChange,
    replaceNoteColumnDefs,
    replaceImportanceSettings,
    requestRevision,
    userAccess,
  } = deps;
  const BLOrderImportance = require('../../public/order-importance');


// ---- Kullanıcı tanımlı boş not sütunları (CP/Orders "Add Column" — Packet 9) ----
// Tanımlar ortak listede tutulur (Add Column ile aynı mimari, ikinci bir sistem
// kurulmaz); değerler notesmap deseniyle patchOrderOverride üzerinden yazılır.
app.get('/api/note-columns', userAccess.requireAnyArea('cp', 'orders'), (req, res) => {
  const ov = loadOverrides();
  const revision = Number(ov._revisions && ov._revisions.noteColumnDefs) || 0;
  res.set('ETag', `"${revision}"`);
  res.json({ columns: ov.noteColumnDefs || [], revision });
});
app.put('/api/note-columns', userAccess.requireArea('cp'), express.json({limit:'32kb'}), (req, res) => {
  try {
    const saved = replaceNoteColumnDefs((req.body || {}).columns, requestRevision(req));
    userAccess.appendAudit(req.currentUser, 'NOTE_COLUMNS_UPDATE', 'cp', { count: saved.columns.length, revision: saved.revision });
    publishSharedMasterChange('noteColumnDefs', req);
    res.set('ETag', `"${saved.revision}"`);
    res.json({ ok: true, ...saved });
  } catch (err) { apiError(res, err, 'Not sütunları kaydedilemedi.'); }
});

// ---- Sipariş önem etiketleri (BTS, Bayram …) — katalog + Line/Sezon kuralları ----
// Sipariş atamaları ayrı değildir: patchOrderOverride { importance } ile yazılır.
app.get('/api/order-importance', userAccess.requireAnyArea('cp', 'orders', 'backlog'), (req, res) => {
  const ov = loadOverrides();
  const revision = Number(ov._revisions && ov._revisions.importanceSettings) || 0;
  res.set('ETag', `"${revision}"`);
  res.json({ settings: BLOrderImportance.normalizeSettings(ov.importanceSettings), revision });
});
app.put('/api/order-importance', userAccess.requireAnyArea('cp', 'orders'), express.json({ limit: '64kb' }), (req, res) => {
  try {
    const saved = replaceImportanceSettings((req.body || {}).settings, requestRevision(req));
    userAccess.appendAudit(req.currentUser, 'ORDER_IMPORTANCE_UPDATE', 'cp', { tags: saved.settings.tags.length, rules: saved.settings.rules.length, pruned: saved.pruned, revision: saved.revision });
    publishSharedMasterChange('importanceSettings', req);
    res.set('ETag', `"${saved.revision}"`);
    res.json({ ok: true, ...saved });
  } catch (err) { apiError(res, err, 'Önem etiketleri kaydedilemedi.'); }
});

/* ---- Kullanıcı Excel'i içe aktarma — SINIRLI denetim kaydı ----
   Mevcut audit mimarisi kullanılır; ikinci bir günlük kurulmaz. Çalışma
   kitabının içeriği KAYDEDİLMEZ: yalnız kim, ne zaman, hangi dosya/sayfa,
   hangi modül ve kaç satırın ne olduğu. Sayaçlar istemciden gelir ama
   AKTÖR her zaman oturumdan belirlenir. */
app.post('/api/excel-import/audit', userAccess.requireAnyArea('cp', 'koleksiyon'), express.json({ limit: '32kb' }), (req, res) => {
  try {
    const body = req.body || {};
    const moduleId = String(body.moduleId || '').slice(0, 24);
    if (moduleId !== 'cp' && moduleId !== 'collection') return res.status(400).json({ error: 'Geçersiz içe aktarma modülü.', code: 'VALIDATION_ERROR' });
    const count = value => Math.max(0, Math.min(1000000, Number(value) || 0));
    userAccess.appendAudit(req.currentUser, 'EXCEL_IMPORT', moduleId, {
      fileName: String(body.fileName || '').slice(0, 160),
      sheet: String(body.sheet || '').slice(0, 120),
      profile: String(body.profile || '').slice(0, 80),
      planId: String(body.planId || '').slice(0, 64),
      status: ['success', 'failed', 'partial', 'aborted'].includes(String(body.status)) ? String(body.status) : 'failed',
      analyzed: count(body.analyzed), created: count(body.created), updated: count(body.updated),
      skipped: count(body.skipped), failed: count(body.failed), warnings: count(body.warnings),
      customFieldsCreated: count(body.customFieldsCreated),
    });
    res.json({ ok: true });
  } catch (err) { apiError(res, err, 'İçe aktarma denetim kaydı yazılamadı.'); }
});

};
