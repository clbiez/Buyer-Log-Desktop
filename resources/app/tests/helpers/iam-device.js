'use strict';
// Real isolated auth server for the multi-device integration tests. Each child
// process has independent module caches, HMAC sessions and filesystem roots.
const express = require('express');
const access = require('../../server/lib/user-access');
const instance = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
const app = express(); app.use(express.json()); app.use(instance.requireSelection);
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
app.get('/api/cp-probe', instance.requireArea('cp'), (_req, res) => res.json({ ok: true }));
app.get('/api/metrics', (_req, res) => res.json(access.getCentralIam().metrics));
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('message', async message => {
  if (message === 'refresh') { await instance.refreshIam(); process.send({ refreshed: true }); }
  if (message === 'close') server.close(() => process.exit(0));
});
