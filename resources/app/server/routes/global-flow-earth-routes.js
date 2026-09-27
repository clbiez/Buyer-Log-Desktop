'use strict';

/* Global Flow · Earth 3D ayar route'ları.
   Okuma: Overview erişimi olan her kullanıcı (anahtarsız durum + çalışma
   yapılandırması). Yazma: yalnız Moderatör. */
module.exports = function registerGlobalFlowEarthRoutes(app, deps) {
  const { express, userAccess } = deps;
  const earthSettings = require('../lib/global-flow-earth-settings');
  const isModerator = req => Boolean(req.currentUser && req.currentUser.systemRole === 'moderator');
  const readGuard = userAccess.requireAnyArea('overview', 'source', 'cp', 'orders');
  const fail = (res, err) => res.status(err && err.statusCode || 500).json({ error: err && err.message || 'Earth ayarı kaydedilemedi.', code: err && err.code || 'EARTH_SETTINGS_FAILED' });

app.get('/api/global-flow/earth/status', readGuard, (req, res) => {
    res.set('Cache-Control', 'no-store').json(earthSettings.publicStatus({ canConfigure: isModerator(req) }));
  });
app.get('/api/global-flow/earth/runtime', readGuard, (req, res) => {
    res.set('Cache-Control', 'no-store').json(earthSettings.runtimeConfig());
  });
app.put('/api/global-flow/earth/settings', userAccess.requireModerator, express.json({ limit: '8kb' }), (req, res) => {
    try {
      const body = req.body || {};
      earthSettings.saveSettings({
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(typeof body.provider === 'string' ? { provider: body.provider } : {}),
        ...(typeof body.defaultMode === 'string' ? { defaultMode: body.defaultMode } : {}),
        ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
        ...(body.clearApiKey === true ? { clearApiKey: true } : {})
      }, req.currentUser && (req.currentUser.id || req.currentUser.name));
      res.set('Cache-Control', 'no-store').json(earthSettings.publicStatus({ canConfigure: true }));
    } catch (err) { fail(res, err); }
  });
};
