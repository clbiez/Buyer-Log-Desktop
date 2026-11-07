'use strict';
// Explicit frozen oracle capture, always from the specified untouched baseline.
const fs = require('node:fs');
const path = require('node:path');
const { fixture, isolate, response } = require('./fixture.cjs');
const root = isolate(), source = path.resolve(process.argv[2]);
try {
  fs.writeFileSync(path.join(process.env.BUYER_LOG_AUTH_DATA_ROOT, 'user-access.json'), JSON.stringify(fixture(3, 2)));
  const access = require(path.join(source, 'resources/app/server/lib/user-access'));
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  const store = access.readStore(), res = response();
  runtime.adminListHandler({ currentUser: store.moderator, headers: {} }, res);
  const result = { publicProfiles: [store.moderator, ...store.users].map(p => access.publicProfile(p, store)), adminList: res.body };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
