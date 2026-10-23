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
  const service=deps.service||createLicenseCardService({loadOverrides,saveOverrides,mutate:deps.mutateSharedResource,pricing:deps,getDiscoveryRows:profile=>getLicenseDiscoveryRows({currentUser:profile}),publish:deps.publishLicenseCardChange?((profile,change)=>deps.publishLicenseCardChange({currentUser:profile},change)):null,changed:(profile,entity,detail,context)=>notify(entity,{currentUser:profile,headers:{'x-client-id':context?.originClientId||''}},detail)});
  const authority=(req,write=false)=>()=>{
    const profile=userAccess.profileById?userAccess.profileById(req.currentUser.id):req.currentUser;
    if(!profile||profile.enabled===false||userAccess.hasArea&&!['orders','cp','source'].some(area=>userAccess.hasArea(profile,area))||write&&!userAccess.hasPermission(profile,'manageBusinessRules'))throw Object.assign(new Error('Güncel lisans kartı yetkisi gerekli. / Current license-card permission is required.'),{code:'OFFICE_TOOL_FORBIDDEN',statusCode:403});
  };
  async function importCards(req, force) {
    const result=await service.discover(req.currentUser,{force,assertAuthority:authority(req,force),originClientId:String(req.headers?.['x-client-id']||'').slice(0,80)});
    if(force)userAccess.appendAudit(req.currentUser,'LICENSE_CARDS_REFRESH','licenseCards',{added:result.added,revision:cards.revisionOf(result.saved,'licenseCards')});
    return result;
  }
app.get('/api/license-cards', area, async (req, res) => {
    try { const result = await importCards(req, false); send(req, res, result.saved, { syncPending: result.syncPending }); } catch (err) { error(res, err); }
  });
// Content-addressed card images: immutable, cached by the browser for good.
app.get('/api/license-cards/assets/:name', area, async (req, res) => {
    try {
      const asset=await require('../lib/license-card-assets').read(String(req.params.name||''));
      if(!asset)return res.status(404).json({error:'Görsel bulunamadı. / Image not found.',code:'LICENSE_ASSET_NOT_FOUND'});
      res.set('Content-Type',asset.type);res.set('Cache-Control','private, max-age=31536000, immutable');res.set('X-Content-Type-Options','nosniff');
      res.end(asset.bytes);
    } catch(err){error(res,err);}
  });
app.get('/api/license-cards/atlas-library', area, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(require('../lib/license-atlas-library.json'));
  });
app.post('/api/license-cards/refresh', area, permission, async (req, res) => {
    try { const result = await importCards(req, true); send(req, res, result.saved, { added: result.added, resolved: result.resolved || 0, discovered: result.discovered || 0, sourceStamp: result.sourceStamp || '', syncPending: result.syncPending }); } catch (err) { error(res, err); }
  });
const clientId=req=>String(req.headers?.['x-client-id']||'').slice(0,80);
app.put('/api/license-cards/:id/licensor', area, permission, async (req, res) => {
    try {
      const result=await service.setLicensor(req.currentUser,req.params.id,req.body||{},{assertAuthority:authority(req,true),originClientId:clientId(req)});
      userAccess.appendAudit(req.currentUser,'LICENSE_CARD_LICENSOR',req.params.id,{mode:req.body?.mode==='add'?'add':'assign',card:result.cards[0]?.id,revision:cards.revisionOf(result.saved,'licenseCards')});
      send(req,res,result.saved,{syncPending:result.syncPending,cardId:result.cards[0]?.id||''});
    } catch(err){error(res,err);}
  });
app.put('/api/license-cards/licensor-merges', area, permission, async (req, res) => {
    try {
      const result=await service.setLicensorMerge(req.currentUser,req.body||{},{assertAuthority:authority(req,true),originClientId:clientId(req)});
      userAccess.appendAudit(req.currentUser,'LICENSE_LICENSOR_MERGE','licenseCards',{key:String(req.body?.key||'').slice(0,200),source:String(req.body?.source||'').slice(0,200),target:String(req.body?.target||'').slice(0,200),split:req.body?.split===true});
      send(req,res,result.saved,{syncPending:result.syncPending});
    } catch(err){error(res,err);}
  });
app.post('/api/license-cards/stage-templates', area, permission, async (req, res) => {
    try {
      const result=await service.saveTemplate(req.currentUser,req.body||{},{assertAuthority:authority(req,true),originClientId:clientId(req)});
      userAccess.appendAudit(req.currentUser,'LICENSE_STAGE_TEMPLATE_SAVE','licenseCards',{template:req.body?.template?.id||'',propagated:result.cards.length});
      send(req,res,result.saved,{syncPending:result.syncPending,propagated:result.cards.length});
    } catch(err){error(res,err);}
  });
app.delete('/api/license-cards/stage-templates/:templateId', area, permission, async (req, res) => {
    try {
      const result=await service.deleteTemplate(req.currentUser,req.params.templateId,req.body||{},{assertAuthority:authority(req,true),originClientId:clientId(req)});
      userAccess.appendAudit(req.currentUser,'LICENSE_STAGE_TEMPLATE_DELETE','licenseCards',{template:req.params.templateId,unlinked:result.cards.length});
      send(req,res,result.saved,{syncPending:result.syncPending,unlinked:result.cards.length});
    } catch(err){error(res,err);}
  });
app.put('/api/license-cards/atlas-batch', area, permission, async (req, res) => {
    try {
      const result=await service.updateAtlasBatch(req.currentUser,req.body?.changes,{assertAuthority:authority(req,true),originClientId:String(req.headers?.['x-client-id']||'').slice(0,80)});
      userAccess.appendAudit(req.currentUser,'LICENSE_ATLAS_BATCH_UPDATE','licenseCards',{updated:result.updated,revision:cards.revisionOf(result.saved,'licenseCards')});
      send(req,res,result.saved,{syncPending:result.syncPending});
    } catch(err){error(res,err);}
  });
app.put('/api/license-cards/:id', area, permission, async (req, res) => {
    try {
      const result=await service.update(req.currentUser,req.params.id,req.body||{},{assertAuthority:authority(req,true),originClientId:String(req.headers?.['x-client-id']||'').slice(0,80)}),{saved,syncPending}=result;
      userAccess.appendAudit(req.currentUser, 'LICENSE_CARD_UPDATE', req.params.id, { revision: cards.revisionOf(saved, 'licenseCards'), pricingRevision: cards.revisionOf(saved, 'pricingRules'), rulesChanged: result.rulesChanged });
      send(req, res, saved, { syncPending });
    } catch (err) { error(res, err); }
  });
};
