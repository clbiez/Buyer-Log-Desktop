'use strict';

module.exports = function registerChecklistSupplierRoutes(app, deps) {
  const { automationError, checklistSupplierStore: store, express, userAccess } = deps;
  const fail = (code, statusCode = 403) => Object.assign(new Error(code === 'CHECKLIST_AUTH_UNAVAILABLE'
    ? 'Checklist yetkilendirmesi kullanılamıyor. / Checklist authorization is unavailable.'
    : 'Güncel checklist kayıt yetkisi gerekli. / Current checklist record permission is required.'), { code, statusCode });
  function current(req, definitions = false, areas = ['cp', 'orders', 'overview']) {
    const profile = userAccess.sessionProfile ? userAccess.sessionProfile(req) : userAccess.profileById(req.currentUser.id);
    if (!profile || profile.enabled === false || profile.status && profile.status !== 'ACTIVE' || !areas.some(area => userAccess.hasArea(profile, area))
      || definitions && !userAccess.hasPermission(profile, 'manageBusinessRules')) throw fail('CHECKLIST_FORBIDDEN');
    req.currentUser = profile;
    return profile;
  }
  // Load source data asynchronously, then resolve again from current authoritative
  // state inside the store lease. A captured Map is never a commit guard.
  async function context(req, write = false, areas = ['cp', 'orders', 'overview']) {
    if (typeof deps.authorizedOrders !== 'function' || typeof deps.authorizedOrdersNow !== 'function') throw fail('CHECKLIST_AUTH_UNAVAILABLE', 503);
    await deps.authorizedOrders(current(req, false, areas), { write });
    const orders = () => {
      const result = deps.authorizedOrdersNow(current(req, false, areas), { write });
      if (!(result instanceof Map)) throw fail('CHECKLIST_AUTH_UNAVAILABLE', 503);
      return result;
    };
    return { orders, assertAuthority: () => { orders(); } };
  }
  function assertEntries(entries, actor, allowed) {
    let canAccessAttachment;
    for (const entry of entries) {
      if (!entry || typeof entry.orderKey !== 'string' || !allowed.has(entry.orderKey)) throw fail('CHECKLIST_ORDER_FORBIDDEN');
      if (entry.attachments != null && !Array.isArray(entry.attachments)) throw fail('CHECKLIST_EVIDENCE_INVALID', 400);
      const at = entry.at == null ? Date.now() : Date.parse(entry.at);
      if (!Number.isFinite(at) || at > Date.now() + 5 * 60 * 1000) throw fail('CHECKLIST_TIMESTAMP_INVALID', 400);
      for (const attachment of entry.attachments || []) {
        canAccessAttachment ||= store.attachmentAccess(actor, new Set(allowed.keys()));
        if (!canAccessAttachment(attachment && attachment.id)) throw fail('CHECKLIST_ATTACHMENT_FORBIDDEN');
      }
    }
  }
  const readArea = userAccess.requireAnyArea('cp', 'orders', 'overview');
  const writeArea = userAccess.requireAnyArea('cp', 'orders');

  app.get('/api/checklist-supplier', readArea, async (req, res) => {
    try {
      const ctx = await context(req);
      const saved = await store._readAsync();
      res.set('Cache-Control', 'no-store').json(store.publicPayload(new Set(ctx.orders().keys()), saved));
    } catch (err) { automationError(res, err, 'Checklist üretici verileri okunamadı.'); }
  });
  app.post('/api/checklist-supplier/answers', readArea, express.json({ limit: '12mb' }), async (req, res) => {
    try {
      const entries = req.body && req.body.entries;
      if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries (dizi) zorunlu. / entries must be an array.', code: 'VALIDATION_ERROR' });
      if (!['buyer_log', 'supplier_excel'].includes(req.body.source || 'buyer_log')) throw fail('CHECKLIST_SOURCE_INVALID', 400);
      const source = req.body.source || 'buyer_log', ctx = await context(req, true);
      const assertAuthority = () => assertEntries(entries, current(req), ctx.orders());
      assertAuthority();
      const result = await store.applyEntries(entries, req.currentUser, { source, serverIdentity: true, assertAuthority });
      userAccess.appendAudit(req.currentUser, source === 'supplier_excel' ? 'CHECKLIST_SUPPLIER_EXCEL_IMPORT' : 'CHECKLIST_ANSWER_SYNC', 'checklist', {
        source, entries: entries.length, updated: result.updated, cleared: result.cleared, skipped: result.skipped, conflicts: result.conflicts || 0, revision: result.revision,
      });
      res.json(result);
    } catch (err) { automationError(res, err, 'Checklist cevapları kaydedilemedi.'); }
  });
  app.post('/api/checklist-supplier/definitions', userAccess.requireAnyArea('cp', 'overview'), express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const definitions = req.body && req.body.definitions;
      if (!Array.isArray(definitions)) return res.status(400).json({ error: 'definitions (dizi) zorunlu. / definitions must be an array.', code: 'VALIDATION_ERROR' });
      current(req, true, ['cp', 'overview']);
      const result = await store.replaceDefinitions(definitions, req.currentUser, { assertAuthority: () => current(req, true, ['cp', 'overview']) });
      userAccess.appendAudit(req.currentUser, 'CHECKLIST_DEFINITIONS_SYNC', 'checklist', { definitions: result.definitions.length, revision: result.revision });
      res.json(result);
    } catch (err) { automationError(res, err, 'Checklist tanımları kaydedilemedi.'); }
  });
  app.post('/api/checklist-supplier/attachments', writeArea, express.json({ limit: '56mb' }), async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {}, ctx = await context(req, true, ['cp', 'orders']);
      const allowed = ctx.orders(), input = body.context || {};
      // Older clients send the canonical order/model/colour tuple, newer clients
      // may also provide orderKey. Both resolve only within the live write set.
      const match = input.orderKey ? allowed.has(input.orderKey) && input.orderKey : [...allowed].find(([key, row]) => !key.startsWith('@option:')
        && ['orderCode', 'modelName', 'colourCode'].every(field => String(row[field] || '') === String(input[field] || '')))?.[0];
      if (!match) throw fail('CHECKLIST_ORDER_FORBIDDEN');
      const assertAuthority = () => { if (!ctx.orders().has(match)) throw fail('CHECKLIST_ORDER_FORBIDDEN'); };
      const attachment = store.addAttachment(body, req.currentUser, { orderKey: match, assertAuthority });
      userAccess.appendAudit(req.currentUser, 'CHECKLIST_ATTACHMENT_UPLOAD', attachment.id, { filename: attachment.filename, size: attachment.size });
      res.json({ ok: true, attachment });
    } catch (err) { automationError(res, err, 'Checklist eki yüklenemedi.'); }
  });
  for (const method of ['get', 'delete']) {
    app[method]('/api/checklist-supplier/attachments/:id', method === 'get' ? readArea : writeArea, async (req, res) => {
      try {
        const ctx = await context(req, method === 'delete', method === 'delete' ? ['cp', 'orders'] : ['cp', 'orders', 'overview']), id = String(req.params.id || '').toLowerCase();
        const assertAuthority = () => {
          if (!store.canAccessAttachment(id, current(req), new Set(ctx.orders().keys()))) throw fail('CHECKLIST_ATTACHMENT_NOT_FOUND', 404);
        };
        assertAuthority();
        if (method === 'delete') {
          const deleted = store.deleteAttachment(id, { assertAuthority });
          userAccess.appendAudit(req.currentUser, 'CHECKLIST_ATTACHMENT_DELETE', id, { deleted });
          return res.json({ ok: true, deleted });
        }
        const fullPath = store.getAttachmentPath(id);
        if (!fullPath) throw fail('CHECKLIST_ATTACHMENT_NOT_FOUND', 404);
        res.set('Cache-Control', 'private, no-store').type('application/octet-stream');
        return res.sendFile(fullPath);
      } catch (err) { automationError(res, err, 'Checklist eki işlenemedi.'); }
    });
  }
};
