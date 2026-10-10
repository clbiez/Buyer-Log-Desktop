'use strict';

const cards = require('../lib/license-cards');
const { stageChange } = require('../lib/license-card-sync');

module.exports = function registerLicenseCardRoutes(app, deps) {
  const { loadOverrides, saveOverrides, userAccess, getLicenseDiscoveryRows, publishSharedMasterChange } = deps;
  const area = userAccess.requireAnyArea('orders', 'cp', 'source');
  const permission = userAccess.requirePermission('manageBusinessRules');
  const canEdit = req => userAccess.hasPermission(req.currentUser, 'manageBusinessRules');
  const send = (req, res, overrides, extra = {}) => {
    const response = cards.responseOf(overrides, canEdit(req));
    res.set('Cache-Control', 'no-store'); res.set('ETag', `"${response.revision}"`); res.json({ ...response, ...extra });
  };
  const error = (res, err) => {
    if (err.statusCode && err.statusCode < 500) return res.status(err.statusCode).json({ error: err.message, code: err.code, currentRevision: err.currentRevision, expectedRevision: err.expectedRevision, revisionKey: err.revisionKey });
    if (deps.apiError) return deps.apiError(res, err, 'Lisans kartları işlenemedi. / License cards could not be processed.');
    return res.status(500).json({ error: 'Lisans kartları işlenemedi. / License cards could not be processed.', code: 'LICENSE_CARDS_ERROR' });
  };
  const notify = (entity, req, detail = {}) => publishSharedMasterChange(entity, req, { ...detail, licenseCardUpdate: true });
  const pendingOf = overrides => Object.keys(overrides && overrides.licenseCardOutbox || {}).length > 0;
  const publish = async (req, change) => {
    if (!deps.publishLicenseCardChange) return false;
    try {
      const result = await deps.publishLicenseCardChange(req, change);
      return Boolean(result && (result.pending || result.ok === false));
    } catch (_) {
      // The saved outbox retains the exact profile/contracts for retry. A
      // transport failure must not conceal a successful local transaction.
      return true;
    }
  };
  async function importCards(req, force) {
    const previous = loadOverrides();
    if (!force && cards.stateOf(previous).initialized) return { saved: previous, added: 0, syncPending: pendingOf(previous) };
    const pairs = cards.discoverPairs(await getLicenseDiscoveryRows(req));
    // A concurrent first read may have completed while ASAS was loading.
    const current = loadOverrides();
    if (!force && cards.stateOf(current).initialized) return { saved: current, added: 0, syncPending: pendingOf(current) };
    const imported = cards.appendDiscovered(current, pairs);
    const previousById = new Map(cards.stateOf(current).items.map(card => [card.id, JSON.stringify(card)]));
    const change = { cards: cards.stateOf(imported.overrides).items.filter(card => previousById.get(card.id) !== JSON.stringify(card)), initialized: true, lastImportedAt: cards.stateOf(imported.overrides).lastImportedAt, actorId: req.currentUser.id };
    const staged = deps.publishLicenseCardChange ? stageChange(imported.overrides, change) : imported.overrides;
    const saved = saveOverrides(staged, Number(current._revision) || 0);
    const syncPending = await publish(req, change);
    notify('licenseCards', req, { revision: cards.revisionOf(saved, 'licenseCards'), added: imported.added });
    if (force) userAccess.appendAudit(req.currentUser, 'LICENSE_CARDS_REFRESH', 'licenseCards', { added: imported.added, revision: cards.revisionOf(saved, 'licenseCards') });
    return { saved, added: imported.added, syncPending };
  }
app.get('/api/license-cards', area, async (req, res) => {
    try { const result = await importCards(req, false); send(req, res, result.saved, { syncPending: result.syncPending }); } catch (err) { error(res, err); }
  });
app.post('/api/license-cards/refresh', area, permission, async (req, res) => {
    try { const result = await importCards(req, true); send(req, res, result.saved, { added: result.added, syncPending: result.syncPending }); } catch (err) { error(res, err); }
  });
app.put('/api/license-cards/:id', area, permission, async (req, res) => {
    try {
      const current = loadOverrides(), result = cards.updateCard(current, req.params.id, req.body || {}, deps);
      // One revision-checked store commit atomically persists profile and prices;
      // the existing store writer also mirrors the whole document to delta.
      const change = {
        card: result.card, rulesChanged: result.rulesChanged,
        ...(result.rulesChanged ? { contracts: cards.responseOf(result.overrides, true).cards.find(card => card.id === req.params.id).rules } : {}),
        initialized: cards.stateOf(result.overrides).initialized, lastImportedAt: cards.stateOf(result.overrides).lastImportedAt, actorId: req.currentUser.id,
      };
      const staged = deps.publishLicenseCardChange ? stageChange(result.overrides, change) : result.overrides;
      const saved = saveOverrides(staged, Number(current._revision) || 0);
      const syncPending = await publish(req, change);
      userAccess.appendAudit(req.currentUser, 'LICENSE_CARD_UPDATE', req.params.id, { revision: cards.revisionOf(saved, 'licenseCards'), pricingRevision: cards.revisionOf(saved, 'pricingRules'), rulesChanged: result.rulesChanged });
      notify('licenseCards', req, { revision: cards.revisionOf(saved, 'licenseCards'), cardId: req.params.id });
      if (result.rulesChanged) notify('pricingRules', req, { revision: cards.revisionOf(saved, 'pricingRules'), changedLicenses: [result.card.license] });
      send(req, res, saved, { syncPending });
    } catch (err) { error(res, err); }
  });
};
