'use strict';

/* PLM numune talepleri (CoreNectum Requests) route'ları.
   İş mantığı lib/plm-sample-request-sync.js ve lib/plm-sample-requests-store.js
   içindedir; burada yalnız yetki, girdi ve yanıt vardır. */
module.exports = function registerPlmRequestRoutes(app, deps) {
  const {
    automationError,
    clearModelOperationProgress,
    coreNectumApiClient,
    express,
    loadPlmStyleLinks,
    normalizePlmId,
    sampleRequestStore,
    sampleRequestSync,
    setModelOperationProgress,
    upsertPlmStyleLinks,
    userAccess,
    withPlmJob,
  } = deps;

  app.get('/api/plm-requests', userAccess.requireAnyArea('koleksiyon', 'cp', 'orders', 'overview'), (_req, res) => {
    try { res.set('Cache-Control', 'no-store').json(sampleRequestStore.publicPayload()); }
    catch (err) { automationError(res, err, 'PLM numune talepleri okunamadı.'); }
  });

  app.post('/api/plm-requests/sync', userAccess.requireAnyArea('koleksiyon', 'cp', 'orders'), express.json({ limit: '2mb' }), async (req, res) => {
    const userId = req.currentUser && req.currentUser.id;
    try {
      const raw = Array.isArray(req.body && req.body.plmIds) ? req.body.plmIds : null;
      if (!raw) return res.status(400).json({ error: 'plmIds (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
      const scope = String(req.body && req.body.scope || '') === 'cp' ? 'cp' : 'koleksiyon';
      /* İş kaydı: PLM İşlemleri panelinde görünür ve sayfa değişince durmaz. */
      const run = await withPlmJob(req, {
        kind: 'plm-requests', scope, total: raw.length,
        label: `PLM numune talepleri · ${raw.length} model`, phase: 'PLM numune talepleri alınıyor',
      }, async job => {
        const result = await sampleRequestSync.syncSampleRequests(raw, {
          normalizePlmId,
          loadLinks: loadPlmStyleLinks,
          upsertLinks: links => upsertPlmStyleLinks(links, req.currentUser),
          postJson: (url, body, options) => coreNectumApiClient.postJson(userId, url, body, options),
          store: sampleRequestStore,
          onProgress: progress => {
            setModelOperationProgress(userId, { kind: 'plm-requests', ...progress });
            job.report({ phase: progress.phase, processed: progress.current, total: progress.total, activeModel: progress.model });
          },
        });
        result.failed.forEach(item => job.fail({ plmId: item.plmId, error: item.error, code: item.code }));
        result.notFound.forEach(plmId => job.fail({ plmId, error: 'PLM listesinde bulunamadı.', code: 'PLM_NOT_FOUND' }));
        job.report({ processed: result.checked, total: result.checked, succeeded: result.synced });
        return result;
      });
      const summary = run.result;
      userAccess.appendAudit(req.currentUser, 'PLM_SAMPLE_REQUESTS_SYNC', 'corenectum', {
        checked: summary.checked, synced: summary.synced, requests: summary.requestCount,
        notFound: summary.notFound.length, failed: summary.failed.length,
      });
      res.json({ ok: true, ...summary, jobId: run.job.id });
    } catch (err) { automationError(res, err, 'PLM numune talepleri alınamadı.'); }
    finally { clearModelOperationProgress(userId); }
  });
};
