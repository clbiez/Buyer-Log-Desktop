'use strict';
const { createCentralIam } = require('../../server/lib/central-iam');
(async () => {
  const client = createCentralIam({ sharedRoot: process.argv[2], cacheFile: process.argv[3] });
  await client.refresh();
  const next = client.readLocal(); next.users[0].displayName = 'Winner';
  await client.commit(next, next._revision, { id: 'moderator' });
  process.send({ ok: true }); process.disconnect();
})().catch(e => { process.send({ code: e.code }); process.disconnect(); process.exitCode = 1; });
