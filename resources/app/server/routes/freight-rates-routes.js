'use strict';
module.exports = function registerFreightRateRoutes(app, deps) {
  const { userAccess, express, service, requestRevision, publishSharedMasterChange, apiError } = deps;
  const context = (req, write = false) => ({ ownerId: String(req.currentUser.id), profile: req.currentUser, assertAuthority: () => {
    const current = userAccess.profileById(req.currentUser.id);
    const allowed = current && current.enabled !== false && (write
      ? userAccess.hasArea(current, 'shipping') && userAccess.hasPermission(current, 'manageBusinessRules')
      : ['shipping', 'source'].some(area => userAccess.hasArea(current, area)));
    if (!allowed) throw Object.assign(new Error('PERMISSION_REQUIRED'), { code: 'PERMISSION_REQUIRED', statusCode: 403 });
    req.currentUser = current; return current;
  } });
  app.get('/api/freight-rates', userAccess.requireAnyArea('shipping', 'source'), async (req, res) => {
    try { const saved = await service.snapshot(context(req)); res.set('ETag', `"${saved.revision}"`); res.json(saved); }
    catch (err) { apiError(res, err, 'Navlun ücretleri okunamadı.'); }
  });
  app.put('/api/freight-rates', userAccess.requireArea('shipping'), userAccess.requirePermission('manageBusinessRules'), express.json({ limit: '32kb' }), async (req, res) => {
    try {
      const saved = await service.replace(req.body && req.body.freight, { revision: requestRevision(req) }, context(req, true));
      userAccess.appendAudit(req.currentUser, 'FREIGHT_RATES_UPDATE', 'shipping', { count: saved.freight.rates.length, revision: saved.revision });
      publishSharedMasterChange('freightRates', req);
      res.json({ freight: saved.freight, revision: saved.revision });
    } catch (err) { apiError(res, err, 'Navlun ücretleri kaydedilemedi.'); }
  });
};
