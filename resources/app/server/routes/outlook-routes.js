'use strict';

/* Microsoft 365 / Outlook route'ları (delegated Mail.Read + Mail Intelligence V2)
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (config) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerOutlookRoutes(app, deps) {
  const {
    LOCAL_DATA_ROOT,
    apiError,
    atomicWriteJson,
    cleanupOrphanExcel,
    createOutlookGraphService,
    crypto,
    express,
    logRuntimeFailure,
    outlookGraph,
    outlookLocal,
    outlookMail,
    outlookSetupSettings,
    outlookV2,
    userAccess,
  } = deps;
  const getConfig = deps.getConfig;

// ---- Microsoft 365 / Outlook — kullanıcıya özel delegated Mail.Read --------
app.get('/api/outlook/status', userAccess.requireCapability('OUTLOOK.SEARCH'), (req, res) => {
  res.set('Cache-Control','no-store').json(outlookMail.publicStatus(req.currentUser.id));
});
app.post('/api/outlook/connect', userAccess.requireCapability('OUTLOOK.SEARCH'), express.json({ limit: '32kb' }), (req, res) => {
  try {
    const result = outlookGraph.beginConnect(req.currentUser, req);
    userAccess.appendAudit(req.currentUser, 'OUTLOOK_CONNECT_STARTED', 'microsoft365', { mock: Boolean(result.mock) }, req);
    res.set('Cache-Control','no-store').json({ ok: true, ...result });
  } catch (err) { apiError(res, err, 'Microsoft 365 bağlantısı başlatılamadı.'); }
});
app.post('/api/outlook/disconnect', userAccess.requireCapability('OUTLOOK.SEARCH'), express.json({ limit: '32kb' }), (req, res) => {
  try {
    const disconnected = outlookGraph.disconnect(req.currentUser.id);
    userAccess.appendAudit(req.currentUser, 'OUTLOOK_DISCONNECTED', 'microsoft365', { disconnected }, req);
    res.json({ ok: true, disconnected });
  } catch (err) { apiError(res, err, 'Microsoft 365 bağlantısı kesilemedi.'); }
});
app.post('/api/outlook/search', userAccess.requireCapability('OUTLOOK.SEARCH'), express.json({ limit: '128kb' }), async (req, res) => {
  const context = req.body && req.body.context || {}, searchOptions = req.body && req.body.options || {};
  try {
    const hash = outlookMail.contextHash(context);
    userAccess.appendAudit(req.currentUser, 'OUTLOOK_SEARCH_STARTED', 'microsoft365', { contextHash: hash }, req);
    const result = await outlookMail.search(req.currentUser.id, context, searchOptions);
    userAccess.appendAudit(req.currentUser, 'OUTLOOK_SEARCH_COMPLETED', 'microsoft365', { contextHash: hash, resultCount: result.items.length, cached: Boolean(result.cached) }, req);
    res.set('Cache-Control','no-store').json({ ok: true, ...result });
  } catch (err) {
    const authFailure = ['REAUTH_REQUIRED','OUTLOOK_NOT_CONNECTED','MICROSOFT_TOKEN_FAILED','MICROSOFT_CONSENT_DENIED'].includes(err && err.code);
    userAccess.appendAudit(req.currentUser, authFailure ? 'OUTLOOK_AUTH_FAILED' : 'OUTLOOK_SEARCH_FAILED', 'microsoft365', { code: err.code || 'OUTLOOK_SEARCH_FAILED' }, req);
    apiError(res, err, 'Outlook araması tamamlanamadı.');
  }
});
app.post('/api/outlook/message-detail', userAccess.requireCapability('OUTLOOK.SEARCH'), express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const detail = await outlookMail.messageDetail(req.currentUser.id, req.body && req.body.messageId);
    res.set('Cache-Control','no-store').json({ ok: true, ...detail });
  } catch (err) { apiError(res, err, 'Mail detayı yüklenemedi.'); }
});
app.post('/api/outlook/message-opened', userAccess.requireCapability('OUTLOOK.SEARCH'), express.json({ limit: '32kb' }), (req, res) => {
  const fingerprint = crypto.createHash('sha256').update(String(req.body && req.body.messageId || '')).digest('hex').slice(0,16);
  userAccess.appendAudit(req.currentUser, 'OUTLOOK_MESSAGE_OPENED', 'microsoft365', { messageFingerprint: fingerprint }, req);
  res.json({ ok: true });
});

app.post('/api/outlook/local/open', userAccess.requireCapability('OUTLOOK.SEARCH'), express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const messageId = String(req.body && req.body.messageId || '');
    const result = await outlookMail.openLocal(messageId, { internetMessageId:String(req.body&&req.body.internetMessageId||'') });
    const fingerprint = crypto.createHash('sha256').update(messageId).digest('hex').slice(0,16);
    userAccess.appendAudit(req.currentUser, 'OUTLOOK_MESSAGE_OPENED', 'classic-outlook-local', { messageFingerprint: fingerprint, engine:'CLASSIC_OUTLOOK_LOCAL' }, req);
    res.set('Cache-Control','no-store').json({ ok:true, ...result });
  } catch (err) { apiError(res, err, 'Classic Outlook mesajı açılamadı.'); }
});
app.post('/api/outlook/bridge', userAccess.requireCapability('OUTLOOK.SEARCH'), express.json({ limit: '128kb' }), async (req, res) => {
  try {
    const context = req.body && req.body.context || {}, searchOptions = req.body && req.body.options || {};
    const result = await outlookMail.bridge(context, searchOptions);
    userAccess.appendAudit(req.currentUser, 'OUTLOOK_BRIDGE_OPENED', 'classic-outlook-local', { contextHash:outlookMail.contextHash(context), mode:result.mode }, req);
    res.set('Cache-Control','no-store').json({ ok:true, ...result });
  } catch (err) { apiError(res, err, 'Outlook Bridge başlatılamadı.'); }
});

// ---- Outlook Mail Intelligence V2 -----------------------------------------
app.get('/api/outlook/v2/features', userAccess.requireCapability('OUTLOOK.SEARCH'), (req,res) => res.set('Cache-Control','no-store').json({ ok:true, features:outlookV2.features }));
function outlookSetupPublic() {
  const settings=outlookSetupSettings.publicSettings(getConfig(),process.env),graph=settings.graph||{},application=settings.application||{},webhook=settings.webhook||{},local=outlookLocal.status();
  const httpsWebhook=/^https:\/\//i.test(webhook.notificationUrl||'')&&/^https:\/\//i.test(webhook.lifecycleUrl||'');
  return {
    ...settings,
    local,
    running:{ graphReady:Boolean(outlookGraph.setup&&outlookGraph.setup.ready),graphState:outlookGraph.setup&&outlookGraph.setup.code||'CONFIG_REQUIRED',applicationReady:Boolean(outlookGraph.config&&outlookGraph.config.applicationConfigured),activeEngine:outlookMail.publicStatus('setup-preview').activeEngine,features:outlookV2.features },
    readiness:{
      classicOutlookLocal:Boolean(local&&local.connected),
      delegatedConfigured:Boolean(graph.enabled&&graph.clientId&&graph.tenantId&&graph.redirectUri&&graph.hasClientSecret&&settings.security&&settings.security.tokenEncryptionReady),
      applicationCredentialsConfigured:Boolean(application.clientId&&application.tenantId&&application.hasClientSecret),
      webhookConfigured:Boolean(httpsWebhook&&webhook.hasClientState),
      sharedMailboxCandidates:(graph.sharedMailboxCandidates||[]).length,
      externalAdminConsent:'MANUAL_VERIFICATION_REQUIRED',
      externalExchangeRbac:'MANUAL_VERIFICATION_REQUIRED',
      externalPublicHttps:'MANUAL_VERIFICATION_REQUIRED',
    },
    externalSteps:[
      {id:'ENTRA_PERMISSIONS',label:'Entra API permissions + admin consent',external:true,url:'https://entra.microsoft.com/'},
      {id:'EXCHANGE_RBAC',label:'Exchange Online RBAC for Applications',external:true,url:'https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac'},
      {id:'PUBLIC_HTTPS',label:'Public HTTPS + trusted certificate/DNS',external:true,url:'https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks'},
    ],
  };
}
app.get('/api/outlook/v2/admin/setup', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.ADMIN'), (_req,res) => {
  try { res.set('Cache-Control','no-store').json({ok:true,...outlookSetupPublic()}); }
  catch(err){apiError(res,err,'Outlook kurulum ayarları okunamadı.');}
});
app.post('/api/outlook/v2/admin/setup', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.ADMIN'), express.json({limit:'128kb'}), (req,res) => {
  try {
    outlookSetupSettings.saveSettings(req.body||{},req.currentUser.id);
    const result=outlookSetupPublic();
    userAccess.appendAudit(req.currentUser,'OUTLOOK_SETUP_UPDATED','microsoft365',{graphEnabled:Boolean(result.graph&&result.graph.enabled),applicationConfigured:Boolean(result.application&&result.application.hasClientSecret),changeNotificationsEnabled:Boolean(result.features&&result.features.changeNotificationsEnabled),sharedMailboxCount:Number(result.readiness&&result.readiness.sharedMailboxCandidates)||0,environmentOverrideCount:(result.security&&result.security.environmentOverrides||[]).length},req);
    res.set('Cache-Control','no-store').json({ok:true,...result,restartRequired:true});
  } catch(err){if(Number(err&&err.statusCode)===400)return res.status(400).json({error:err.message,code:err.code||'OUTLOOK_SETUP_INVALID'});apiError(res,err,'Outlook kurulum ayarları kaydedilemedi.');}
});
app.post('/api/outlook/v2/admin/setup/test', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.ADMIN'), express.json({limit:'32kb'}), async (req,res) => {
  try {
    const runtime=outlookSetupSettings.applyToRuntime(getConfig(),process.env),probe=createOutlookGraphService({config:runtime.config,env:runtime.env,dataRoot:LOCAL_DATA_ROOT,writeJson:atomicWriteJson}),mailbox=String(req.body&&req.body.mailbox||'').trim().toLowerCase(),checks=[];
    checks.push({id:'DELEGATED_CONFIG',ok:Boolean(probe.setup&&probe.setup.ready),code:probe.setup&&probe.setup.code||'CONFIG_REQUIRED',message:probe.setup&&probe.setup.message||'Delegated Graph yapılandırması hazır.'});
    const localStatus=outlookLocal.status(true);
    checks.push({id:'CLASSIC_OUTLOOK_LOCAL',ok:Boolean(localStatus&&localStatus.connected),code:localStatus&&localStatus.state||'CLASSIC_OUTLOOK_UNAVAILABLE',message:localStatus&&localStatus.connected?`Classic Outlook kullanılabilir: ${localStatus.profileName||localStatus.storeName||'yerel profil'}`:(localStatus&&localStatus.message||'Classic Outlook kullanılamıyor.')});
    if(req.body&&req.body.testDelegatedMailbox&&mailbox){
      try { const item=await probe.probeSharedMailbox(req.currentUser.id,mailbox);checks.push({id:'DELEGATED_MAILBOX',ok:Boolean(item),code:item?'ACCESSIBLE':'MAILBOX_ACCESS_DENIED',message:item?'Shared mailbox kullanıcı tarafından erişilebilir.':'Shared mailbox erişimi Microsoft tarafından doğrulanamadı.'}); }
      catch(error){checks.push({id:'DELEGATED_MAILBOX',ok:false,code:error.code||'GRAPH_TEST_FAILED',message:String(error.message||'Graph testi başarısız.').slice(0,500)});}
    }
    if(req.body&&req.body.testApplication){
      try {
        await probe.applicationAccessToken();
        checks.push({id:'APPLICATION_TOKEN',ok:true,code:'TOKEN_ACQUIRED',message:'Application token başarıyla alındı.'});
        if(mailbox){await probe.applicationGraph(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox?$select=id,displayName`);checks.push({id:'EXCHANGE_RBAC_MAILBOX',ok:true,code:'MAILBOX_SCOPED',message:'Application Mail.Read ve Exchange RBAC mailbox erişimi doğrulandı.'});}
      } catch(error){checks.push({id:mailbox?'EXCHANGE_RBAC_MAILBOX':'APPLICATION_TOKEN',ok:false,code:error.code||'GRAPH_TEST_FAILED',message:String(error.message||'Graph testi başarısız.').slice(0,500)});}
    }
    const setup=outlookSetupPublic();
    checks.push({id:'WEBHOOK_FORMAT',ok:Boolean(setup.readiness.webhookConfigured),code:setup.readiness.webhookConfigured?'HTTPS_READY':'WEBHOOK_SETUP_REQUIRED',message:setup.readiness.webhookConfigured?'Webhook adresleri ve clientState hazır.':'Public HTTPS webhook adresleri eksik.'});
    userAccess.appendAudit(req.currentUser,'OUTLOOK_SETUP_TESTED','microsoft365',{checks:checks.map(item=>({id:item.id,ok:item.ok,code:item.code})),mailboxTested:Boolean(mailbox)},req);
    res.set('Cache-Control','no-store').json({ok:true,checks,restartRequired:false});
  } catch(err){apiError(res,err,'Outlook kurulum testi tamamlanamadı.');}
});
app.post('/api/outlook/v2/admin/setup/restart', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.ADMIN'), express.json({limit:'8kb'}), (req,res) => {
  if(process.env.BL_KEEP_ALIVE!=='1')return res.status(409).json({error:'Otomatik yeniden başlatma yalnız Buyer Log gözetmeniyle açıldığında kullanılabilir. Programı kapatıp yeniden açın.',code:'WATCHDOG_REQUIRED'});
  userAccess.appendAudit(req.currentUser,'OUTLOOK_SETUP_RESTART_REQUESTED','microsoft365',{},req);
  res.json({ok:true,restarting:true});
  setTimeout(()=>{try{cleanupOrphanExcel();}catch(_){}process.exit(0);},350).unref();
});
app.get('/api/outlook/v2/mailboxes', userAccess.requireCapability('OUTLOOK.SEARCH'), async (req,res) => {
  try { const sources=await outlookV2.mailboxSources(req.currentUser); if(!userAccess.hasCapability(req.currentUser,'OUTLOOK_SHARED_MAIL.SEARCH'))sources.shared=[];res.set('Cache-Control','no-store').json({ok:true,...sources}); }
  catch(err){apiError(res,err,'Mailbox kaynakları okunamadı.');}
});
app.post('/api/outlook/v2/search', userAccess.requireCapability('OUTLOOK.SEARCH'), express.json({limit:'192kb'}), async (req,res) => {
  try { const options=req.body&&req.body.options||{},source=String(options.mailboxSource||'PERSONAL').toUpperCase();if(source!=='PERSONAL'&&!userAccess.hasCapability(req.currentUser,'OUTLOOK_SHARED_MAIL.SEARCH'))return res.status(403).json({error:'Shared mailbox arama yetkisi bulunmuyor.',code:'PERMISSION_DENIED'});const started=Date.now(),result=await outlookV2.search(req.currentUser,req.body&&req.body.context||{},options);outlookV2.store.metric('graph_search_count');outlookV2.store.metric('graph_search_latency',0,Date.now()-started);if(source!=='PERSONAL')userAccess.appendAudit(req.currentUser,'OUTLOOK_SHARED_MAILBOX_ACCESSED','microsoft365',{mailboxCount:new Set((result.items||[]).map(item=>item.mailboxAddress).filter(Boolean)).size,resultCount:(result.items||[]).length},req);res.set('Cache-Control','no-store').json({ok:true,...result}); }
  catch(err){apiError(res,err,'Outlook V2 araması tamamlanamadı.');}
});
app.post('/api/outlook/v2/message-detail', userAccess.requireCapability('OUTLOOK.SEARCH'), express.json({limit:'64kb'}), async (req,res) => {
  try { const body=req.body||{},type=String(body.mailboxType||'PERSONAL').toUpperCase();if(type!=='PERSONAL'&&!userAccess.hasCapability(req.currentUser,'OUTLOOK_SHARED_MAIL.SEARCH'))return res.status(403).json({error:'Mailbox erişim yetkisi bulunmuyor.',code:'PERMISSION_DENIED'});const detail=await outlookV2.messageDetail(req.currentUser,body);res.set('Cache-Control','no-store').json({ok:true,...detail}); }
  catch(err){apiError(res,err,'Mail detayı yüklenemedi.');}
});
app.post('/api/outlook/v2/links', userAccess.requireCapability('OUTLOOK_MAIL.LINK'), express.json({limit:'128kb'}), (req,res) => {
  try { const result=outlookV2.link(req.currentUser,req.body||{});userAccess.appendAudit(req.currentUser,'OUTLOOK_MAIL_LINKED','mail',{linkIds:result.map(item=>item.item.id),targets:result.map(item=>`${item.item.entityType}:${item.item.entityId}`)},req);res.status(201).json({ok:true,results:result}); }
  catch(err){apiError(res,err,'Mail siparişe bağlanamadı.');}
});
app.delete('/api/outlook/v2/links/:id', userAccess.requireCapability('OUTLOOK_MAIL.LINK'), (req,res) => {
  try { const removed=outlookV2.unlink(req.currentUser,req.params.id);userAccess.appendAudit(req.currentUser,'OUTLOOK_MAIL_UNLINKED',req.params.id,{entityType:removed.entityType,entityId:removed.entityId},req);res.json({ok:true,removed}); }
  catch(err){apiError(res,err,'Mail bağlantısı kaldırılamadı.');}
});
app.patch('/api/outlook/v2/links/:id', userAccess.requireCapability('OUTLOOK_MAIL.PIN'), express.json({limit:'64kb'}), (req,res) => {
  try { const updated=outlookV2.pin(req.currentUser,req.params.id,req.body||{}),event=updated.isPinned?'OUTLOOK_MAIL_PINNED':'OUTLOOK_MAIL_UNPINNED';userAccess.appendAudit(req.currentUser,event,updated.id,{tags:updated.tags||[],pinReason:Boolean(updated.pinReason)},req);res.json({ok:true,item:updated}); }
  catch(err){apiError(res,err,'Mail işareti kaydedilemedi.');}
});
app.get('/api/outlook/v2/timeline/:entityType/:entityId', userAccess.requireCapability('OUTLOOK_MAIL.TIMELINE_VIEW'), (req,res) => {
  try { res.set('Cache-Control','no-store').json({ok:true,...outlookV2.timeline(req.currentUser,req.params.entityType,req.params.entityId)}); }
  catch(err){apiError(res,err,'İletişim timeline yüklenemedi.');}
});
app.post('/api/outlook/v2/analyze', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.VIEW'), express.json({limit:'768kb'}), async (req,res) => {
  try { const result=await outlookV2.analyze(req.currentUser,req.body||{});userAccess.appendAudit(req.currentUser,'MAIL_INTELLIGENCE_DETECTED',`${req.body&&req.body.entityType}:${req.body&&req.body.entityId}`,{candidateCount:(result.candidates||[]).length,classifications:(result.classifications||[]).map(item=>item.type)},req);res.json({ok:true,...result}); }
  catch(err){apiError(res,err,'Mail intelligence analizi tamamlanamadı.');}
});
app.get('/api/outlook/v2/candidates/:entityType/:entityId', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.VIEW'), (req,res) => {
  try { res.set('Cache-Control','no-store').json({ok:true,items:outlookV2.changeCandidates(req.currentUser,req.params.entityType,req.params.entityId)}); }
  catch(err){apiError(res,err,'Değişiklik adayları yüklenemedi.');}
});
app.post('/api/outlook/v2/candidates/:id/decision', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.VIEW'), express.json({limit:'32kb'}), async (req,res) => {
  try { const decision=String(req.body&&req.body.decision||'').toUpperCase(),item=await outlookV2.decideCandidate(req.currentUser,req.params.id,decision),event=decision==='ACCEPTED'?'MAIL_INTELLIGENCE_ACCEPTED':'MAIL_INTELLIGENCE_REJECTED';userAccess.appendAudit(req.currentUser,event,item.id,{entityType:item.entityType,entityId:item.entityId,type:item.type},req);res.json({ok:true,item}); }
  catch(err){apiError(res,err,'Değişiklik adayı kararı uygulanamadı.');}
});
app.post('/api/outlook/v2/summary', userAccess.requireCapability('OUTLOOK_MAIL.AI_SUMMARY'), express.json({limit:'2mb'}), async (req,res) => {
  try { const result=await outlookV2.summarize(req.currentUser,req.body||{});userAccess.appendAudit(req.currentUser,'MAIL_AI_SUMMARY_CREATED',String(req.body&&req.body.conversationId||''),{cached:Boolean(result.cached),provider:result.provider,mailCount:Array.isArray(req.body&&req.body.messages)?req.body.messages.length:0},req);res.set('Cache-Control','private, no-store').json({ok:true,...result}); }
  catch(err){apiError(res,err,'Mail özeti oluşturulamadı.');}
});
app.post('/api/outlook/v2/watch/:entityId', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.VIEW'), express.json({limit:'32kb'}), (req,res) => {
  try { res.json({ok:true,item:outlookV2.setWatch(req.currentUser,req.params.entityId,req.body||{})}); }
  catch(err){apiError(res,err,'Sipariş takip tercihi kaydedilemedi.');}
});
app.post('/api/outlook/v2/attachment', userAccess.requireCapability('OUTLOOK_MAIL.ATTACHMENT_VIEW'), express.json({limit:'64kb'}), async (req,res) => {
  try { const item=await outlookV2.attachment(req.currentUser,req.body||{});userAccess.appendAudit(req.currentUser,'OUTLOOK_ATTACHMENT_OPENED','attachment',{nameHash:crypto.createHash('sha256').update(item.name).digest('hex').slice(0,16),size:item.size,contentType:item.contentType},req);res.set({'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="${String(item.name||'attachment').replace(/[\r\n"\\]/g,'_')}"`}).type(item.contentType).send(item.buffer); }
  catch(err){apiError(res,err,'Attachment güvenli önizleme için açılamadı.');}
});
app.post('/api/outlook/v2/feedback', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.VIEW'), express.json({limit:'32kb'}), (req,res) => {
  try { res.status(201).json({ok:true,item:outlookV2.feedback(req.currentUser,req.body||{})}); }
  catch(err){apiError(res,err,'Geri bildirim kaydedilemedi.');}
});
app.get('/api/outlook/v2/notifications', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.VIEW'), (req,res) => res.set('Cache-Control','no-store').json({ok:true,items:outlookV2.notifications(req.currentUser)}));
app.get('/api/outlook/v2/dashboard', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.VIEW'), (req,res) => {
  try { res.set('Cache-Control','no-store').json({ok:true,...outlookV2.dashboard(req.currentUser)}); }
  catch(err){apiError(res,err,'Mail Intelligence dashboard yüklenemedi.');}
});
app.get('/api/outlook/v2/admin/managed-mailboxes', userAccess.requireCapability('OUTLOOK_MANAGED_MAILBOX.ADMIN'), (req,res) => res.set('Cache-Control','no-store').json({ok:true,items:outlookV2.store.listManagedMailboxes()}));
app.post('/api/outlook/v2/admin/managed-mailboxes', userAccess.requireCapability('OUTLOOK_MANAGED_MAILBOX.ADMIN'), express.json({limit:'64kb'}), (req,res) => {
  try { const result=outlookV2.store.upsertManagedMailbox(req.body||{},req.currentUser.id),event=result.created?'MANAGED_MAILBOX_ADDED':result.item.isEnabled?'MANAGED_MAILBOX_ENABLED':'MANAGED_MAILBOX_DISABLED';userAccess.appendAudit(req.currentUser,event,result.item.id,{emailHash:crypto.createHash('sha256').update(result.item.email).digest('hex').slice(0,16),intelligenceEnabled:result.item.intelligenceEnabled},req);res.status(result.created?201:200).json({ok:true,...result}); }
  catch(err){apiError(res,err,'Managed mailbox kaydedilemedi.');}
});
app.delete('/api/outlook/v2/admin/managed-mailboxes/:id', userAccess.requireCapability('OUTLOOK_MANAGED_MAILBOX.ADMIN'), (req,res) => {
  try { const removed=outlookV2.store.removeManagedMailbox(req.params.id);if(!removed)return res.status(404).json({error:'Mailbox bulunamadı.',code:'MAILBOX_NOT_FOUND'});userAccess.appendAudit(req.currentUser,'MANAGED_MAILBOX_REMOVED',removed.id,{emailHash:crypto.createHash('sha256').update(removed.email).digest('hex').slice(0,16)},req);res.json({ok:true,removed:true}); }
  catch(err){apiError(res,err,'Managed mailbox silinemedi.');}
});
app.get('/api/outlook/v2/admin/health', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.ADMIN'), (req,res) => res.set('Cache-Control','no-store').json({ok:true,...outlookV2.health()}));
app.post('/api/outlook/v2/admin/subscriptions/ensure', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.ADMIN'), express.json({limit:'16kb'}), async (req,res) => {
  try { const result=await outlookV2.subscriptions.ensureAll();userAccess.appendAudit(req.currentUser,result.failed?'GRAPH_SUBSCRIPTION_FAILED':result.renewed?'GRAPH_SUBSCRIPTION_RENEWED':'GRAPH_SUBSCRIPTION_CREATED','microsoft365',result,req);res.json({ok:true,...result}); }
  catch(err){apiError(res,err,'Graph subscription işlemi tamamlanamadı.');}
});
app.post('/api/outlook/v2/admin/delta/:mailboxId/:folderId', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.ADMIN'), express.json({limit:'16kb'}), async (req,res) => {
  try { res.json({ok:true,...await outlookV2.subscriptions.deltaRecover(req.params.mailboxId,req.params.folderId)}); }
  catch(err){apiError(res,err,'Delta recovery tamamlanamadı.');}
});
app.post('/api/outlook/v2/admin/queue/process', userAccess.requireCapability('OUTLOOK_INTELLIGENCE.ADMIN'), express.json({limit:'16kb'}), async (req,res) => {
  try { res.json({ok:true,results:await outlookV2.subscriptions.processQueue(Math.max(1,Math.min(50,Number(req.body&&req.body.limit)||10)))}); }
  catch(err){apiError(res,err,'Mail intelligence kuyruğu işlenemedi.');}
});

if (outlookV2.features.changeNotifications) {
  setInterval(() => outlookV2.subscriptions.ensureAll().catch(error=>logRuntimeFailure('outlookSubscriptionRenewal',error)), 60*60*1000).unref();
  setInterval(() => outlookV2.subscriptions.processQueue(10).catch(error=>logRuntimeFailure('outlookIntelligenceQueue',error)), 15000).unref();
}
setInterval(() => { try { outlookV2.store.pruneRetention(); } catch(error){ logRuntimeFailure('outlookRetention',error); } }, 24*60*60*1000).unref();
};
