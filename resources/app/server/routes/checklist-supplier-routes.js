'use strict';

module.exports = function registerChecklistSupplierRoutes(app, deps) {
  const { automationError, checklistSupplierStore, express, userAccess } = deps;

app.get('/api/checklist-supplier', userAccess.requireAnyArea('cp', 'orders', 'overview'), (req, res) => {
      try {
        res.set('Cache-Control', 'no-store').json(checklistSupplierStore.publicPayload());
      } catch (err) {
        automationError(res, err, 'Checklist üretici verileri okunamadı.');
      }
    });

app.post('/api/checklist-supplier/attachments', userAccess.requireAnyArea('cp', 'orders'), express.json({ limit: '56mb' }), (req, res) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const attachment = checklistSupplierStore.addAttachment(body, req.currentUser);
        userAccess.appendAudit(req.currentUser, 'CHECKLIST_ATTACHMENT_UPLOAD', attachment.id, {
          filename: attachment.filename, size: attachment.size,
        });
        res.json({ ok: true, attachment });
      } catch (err) {
        automationError(res, err, 'Checklist eki yüklenemedi.');
      }
    });

app.get('/api/checklist-supplier/attachments/:id', userAccess.requireAnyArea('cp', 'orders', 'overview'), (req, res) => {
      try {
        const fullPath = checklistSupplierStore.getAttachmentPath(req.params && req.params.id);
        if (!fullPath) return res.status(404).json({ error: 'Checklist eki bulunamadı.', code: 'CHECKLIST_ATTACHMENT_NOT_FOUND' });
        res.set('Cache-Control', 'private, no-store');
        res.type('application/octet-stream');
        return res.sendFile(fullPath);
      } catch (err) {
        automationError(res, err, 'Checklist eki okunamadı.');
      }
    });

app.delete('/api/checklist-supplier/attachments/:id', userAccess.requireAnyArea('cp', 'orders'), (req, res) => {
      try {
        const id = String(req.params && req.params.id || '');
        const deleted = checklistSupplierStore.deleteAttachment(id);
        userAccess.appendAudit(req.currentUser, 'CHECKLIST_ATTACHMENT_DELETE', id, { deleted });
        res.json({ ok: true, deleted });
      } catch (err) {
        automationError(res, err, 'Checklist eki silinemedi.');
      }
    });

app.post('/api/checklist-supplier/definitions', userAccess.requireAnyArea('cp', 'overview'), express.json({ limit: '2mb' }), (req, res) => {
      try {
        const definitions = req.body && req.body.definitions;
        if (!Array.isArray(definitions)) {
          return res.status(400).json({ error: 'definitions (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
        }
        const result = checklistSupplierStore.replaceDefinitions(definitions, req.currentUser);
        userAccess.appendAudit(req.currentUser, 'CHECKLIST_DEFINITIONS_SYNC', 'checklist', {
          definitions: result.definitions.length,
          revision: result.revision,
        });
        res.json(result);
      } catch (err) {
        automationError(res, err, 'Checklist tanımları kaydedilemedi.');
      }
    });

app.post('/api/checklist-supplier/answers', userAccess.requireAnyArea('cp', 'orders', 'overview'), express.json({ limit: '12mb' }), (req, res) => {
      try {
        const entries = req.body && req.body.entries;
        if (!Array.isArray(entries)) {
          return res.status(400).json({ error: 'entries (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
        }
        const source = String(req.body && req.body.source || 'buyer_log').trim().slice(0, 80) || 'buyer_log';
        const result = checklistSupplierStore.applyEntries(entries, req.currentUser, { source });
        userAccess.appendAudit(
          req.currentUser,
          source === 'supplier_excel' ? 'CHECKLIST_SUPPLIER_EXCEL_IMPORT' : 'CHECKLIST_ANSWER_SYNC',
          'checklist',
          {
            source,
            entries: entries.length,
            updated: result.updated,
            cleared: result.cleared,
            skipped: result.skipped,
            conflicts: result.conflicts || 0,
            revision: result.revision,
          }
        );
        res.json(result);
      } catch (err) {
        automationError(res, err, 'Checklist cevapları kaydedilemedi.');
      }
    }
  );
};
