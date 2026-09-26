'use strict';
// Sipariş sahipliği dağıtımı için gerçek, yalıtılmış yetki sunucusu (çok cihazlı test).
const express = require('express');
const access = require('../../server/lib/user-access');
const instance = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
const app = express(); app.use(express.json()); app.use(instance.requireSelection);
app.post('/api/user-login', instance.loginHandler);
app.get('/api/users/admin', instance.requireUserAdmin, instance.adminListHandler);
app.post('/api/users', instance.requireUserAdmin, instance.adminCreateHandler);
app.post('/api/iam/initialize', instance.requireModerator, instance.iamInitializeHandler);
// Moderatörün ASAS yenilemesinin yetki adımı (server.js: syncProfiles(..., { authoritative: id === 'moderator' })).
app.post('/api/test/sync-orders', instance.requireModerator, (req, res) => { instance.syncProfiles(req.body.orders, { authoritative: true }); res.json({ ok: true }); });
app.get('/api/test/can-edit/:code', (req, res) => {
  const rows = instance.authoritativeOrderRows(req.params.code);
  res.json({ rows: rows.length, canEdit: rows.length > 0 && rows.every(order => instance.canEditOrder(req.currentUser, order)) });
});
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('message', async message => {
  if (message === 'refresh') { await instance.refreshIam(); process.send({ refreshed: true }); }
});
