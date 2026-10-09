'use strict';
// Real isolated auth server for the multi-device integration tests. Each child
// process has independent module caches, HMAC sessions and filesystem roots.
const express = require('express');
const access = require('../../server/lib/user-access');
const instance = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
const app = express(); app.use(express.json({ limit: '8mb' })); app.use(instance.requireSelection);
app.post('/api/user-login', instance.loginHandler);
app.get('/api/current-user', instance.currentHandler);
app.get('/api/iam/health', instance.iamHealthHandler);
app.get('/api/users/admin', instance.requireUserAdmin, instance.adminListHandler);
app.post('/api/users', instance.requireUserAdmin, instance.adminCreateHandler);
app.put('/api/users/:id', instance.requireUserAdmin, instance.adminUpdateHandler);
app.put('/api/iam/roles', instance.requireCapability('ROLE.MANAGE'), instance.roleMatrixUpdateHandler);
app.post('/api/iam/users/bulk', instance.requireUserAdmin, instance.adminBulkHandler);
app.post('/api/iam/permissions/copy', instance.requireCapability('USER.GRANT'), instance.permissionCopyHandler);
app.post('/api/iam/initialize', instance.requireModerator, instance.iamInitializeHandler);
app.post('/api/iam/refresh', instance.requireUserAdmin, instance.iamRefreshHandler);
app.post('/api/iam/adopt-central', instance.requireModerator, instance.iamAdoptHandler);
app.post('/api/iam/horizon-defaults', instance.requireUserAdmin, instance.horizonDefaultsHandler);
app.post('/api/iam/role-horizon-defaults', instance.requireCapability('ROLE.MANAGE'), instance.roleHorizonDefaultsHandler);
app.post('/api/iam/role-bundles', instance.requireCapability('ROLE.MANAGE'), instance.roleBundleHandler);
app.get('/api/iam/export.xlsx', instance.requireUserAdmin, instance.iamExportHandler);
app.post('/api/iam/import/preview', instance.requireUserAdmin, instance.iamImportPreviewHandler);
app.post('/api/iam/import', instance.requireUserAdmin, instance.iamImportHandler);
app.post('/api/iam/users/:id/temporary-grants', instance.requireCapability('USER.GRANT'), instance.temporaryGrantHandler);
app.delete('/api/iam/users/:id/temporary-grants/:grantId', instance.requireCapability('USER.GRANT'), instance.temporaryGrantRevokeHandler);
app.post('/api/iam/profile-copy', instance.requireCapability('USER.PROFILE_COPY'), instance.profileCopyHandler);
// Kişisel ufuk bu cihazın tercih dosyasına yazılır; çözümleme sunucudaki gerçek zincirle yapılır.
const userPreferences = require('../../server/lib/user-preferences');
app.put('/api/user-workspace/:module/horizon', (req, res) => { userPreferences.saveHorizon(req.currentUser.id, req.params.module, req.body.horizon); res.json({ ok: true }); });
app.get('/api/user-workspace/:module', (req, res) => {
  const roleEntries = instance.roleWorkspaceEntries(req.currentUser);
  res.json({ horizon: userPreferences.resolveHorizon(req.currentUser.id, req.params.module, null, {}, roleEntries),
    layer: userPreferences.resolveHorizonProvenance(req.currentUser.id, req.params.module, null, {}, roleEntries).layer });
});
app.get('/api/cp-probe', instance.requireArea('cp'), (_req, res) => res.json({ ok: true }));
app.get('/api/metrics', (_req, res) => res.json(access.getCentralIam().metrics));
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('message', async message => {
  if (message === 'refresh') { await instance.refreshIam(); process.send({ refreshed: true }); }
  if (message === 'close') server.close(() => process.exit(0));
});
