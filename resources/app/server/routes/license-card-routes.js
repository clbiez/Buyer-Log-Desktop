'use strict';

const cards = require('../lib/license-cards');
const { createLicenseCardService } = require('../lib/license-card-service');

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
  const service=deps.service||createLicenseCardService({loadOverrides,saveOverrides,mutate:deps.mutateSharedResource,pricing:deps,getDiscoveryRows:profile=>getLicenseDiscoveryRows({currentUser:profile}),publish:deps.publishLicenseCardChange?((profile,change)=>deps.publishLicenseCardChange({currentUser:profile},change)):null,changed:(profile,entity,detail)=>notify(entity,{currentUser:profile},detail)});
  const authority=(req,write=false)=>()=>{
    const profile=userAccess.profileById?userAccess.profileById(req.currentUser.id):req.currentUser;
    if(!profile||profile.enabled===false||userAccess.hasArea&&!['orders','cp','source'].some(area=>userAccess.hasArea(profile,area))||write&&!userAccess.hasPermission(profile,'manageBusinessRules'))throw Object.assign(new Error('Güncel lisans kartı yetkisi gerekli. / Current license-card permission is required.'),{code:'OFFICE_TOOL_FORBIDDEN',statusCode:403});
  };
  async function importCards(req, force) {
    const result=await service.discover(req.currentUser,{force,assertAuthority:authority(req,force)});
    if(force)userAccess.appendAudit(req.currentUser,'LICENSE_CARDS_REFRESH','licenseCards',{added:result.added,revision:cards.revisionOf(result.saved,'licenseCards')});
    return result;
  }
app.get('/api/license-cards', area, async (req, res) => {
    try { const result = await importCards(req, false); send(req, res, result.saved, { syncPending: result.syncPending }); } catch (err) { error(res, err); }
  });
app.post('/api/license-cards/refresh', area, permission, async (req, res) => {
    try { const result = await importCards(req, true); send(req, res, result.saved, { added: result.added, syncPending: result.syncPending }); } catch (err) { error(res, err); }
  });
app.put('/api/license-cards/:id', area, permission, async (req, res) => {
    try {
      const result=await service.update(req.currentUser,req.params.id,req.body||{},{assertAuthority:authority(req,true)}),{saved,syncPending}=result;
      userAccess.appendAudit(req.currentUser, 'LICENSE_CARD_UPDATE', req.params.id, { revision: cards.revisionOf(saved, 'licenseCards'), pricingRevision: cards.revisionOf(saved, 'pricingRules'), rulesChanged: result.rulesChanged });
      send(req, res, saved, { syncPending });
    } catch (err) { error(res, err); }
  });
};
