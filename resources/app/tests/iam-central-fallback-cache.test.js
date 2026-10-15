'use strict';
/* P0 (7.0.279–7.0.281): Central IAM enabled while this device has no valid
   central cache (the local user-access.json is a plain local store). Every
   readStore() — each request's session check and the Office task timer —
   re-ran the legacy-store recovery: it walked the whole portable data tree,
   data-BACKUP-* folders and sibling Buyer Log installs and parsed every
   user-access*.json it found. In the field one call took minutes and the
   server stayed blocked after login. Recovery is a start/transition decision:
   it runs again only when the local auth files change. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function store(name, revision) {
  return { schemaVersion: 8, _revision: revision,
    moderator: { id: 'moderator', role: 'moderator', systemRole: 'moderator', username: name, displayName: name, passwordHash: 'x'.repeat(64), enabled: true, status: 'ACTIVE' },
    users: [{ id: 'u1', role: 'buyer', systemRole: 'buyer', username: 'DEMO Buyer', displayName: 'DEMO Buyer', passwordHash: 'y'.repeat(64), enabled: true, status: 'ACTIVE' }],
    orderAccess: {}, scopeCatalog: {} };
}
function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-iam-central-fallback-'));
  const install = path.join(base, 'BuyerLog DEMO'), auth = path.join(install, 'data', 'app', 'auth'), server = path.join(install, 'data', 'server');
  fs.mkdirSync(auth, { recursive: true }); fs.mkdirSync(server, { recursive: true });
  fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(store('DEMO Moderator', 5)));
  // Historical copies the recovery scan finds and parses.
  for (let i = 0; i < 4; i += 1) {
    const dir = path.join(install, 'data-BACKUP-' + i, 'auth'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'user-access.json'), JSON.stringify(store('DEMO Old', 1)));
  }
  process.env.BUYER_LOG_AUTH_DATA_ROOT = auth; process.env.BUYER_LOG_SERVER_DATA_ROOT = server;
  process.env.BUYER_LOG_CENTRAL_IAM_ENABLED = '1';
  delete process.env.BUYER_LOG_PORTABLE_DATA_ROOT;
  const serverRoot = path.join(ROOT, 'server') + path.sep;
  for (const key of Object.keys(require.cache)) if (key.startsWith(serverRoot)) delete require.cache[key];
  return { base, auth, ua: require(path.join(ROOT, 'server', 'lib', 'user-access.js')) };
}
function countReads(work) {
  const readdir = fs.readdirSync, readFile = fs.readFileSync; let dirs = 0, files = 0;
  fs.readdirSync = function (...args) { dirs += 1; return readdir.apply(this, args); };
  fs.readFileSync = function (...args) { files += 1; return readFile.apply(this, args); };
  try { return { value: work(), dirs, files }; } finally { fs.readdirSync = readdir; fs.readFileSync = readFile; }
}

test('without a valid central cache, a repeated read reuses the resolved directory instead of rescanning', t => {
  const { base, auth, ua } = setup();
  t.after(() => { delete process.env.BUYER_LOG_CENTRAL_IAM_ENABLED; fs.rmSync(base, { recursive: true, force: true }); });
  const first = countReads(() => ua.readStore());
  assert.equal(first.value.moderator.username, 'DEMO Moderator');
  assert.ok(first.dirs > 0, 'the first read still runs the recovery scan');
  const second = countReads(() => ua.readStore());
  assert.equal(second.value, first.value, 'same cached directory');
  assert.deepEqual([second.dirs, second.files], [0, 0], 'no folder scan or file parse on a warm read');
  assert.equal(second.value.users.find(user => user.id === 'u1').username, 'DEMO Buyer');

  // A changed auth file is seen on the next read (no stale authority).
  const next = store('DEMO Renamed', 6); next.users[0].displayName = 'DEMO Buyer 2';
  fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(next));
  const changed = ua.readStore();
  assert.equal(changed.moderator.username, 'DEMO Renamed');
  assert.equal(changed.users.find(user => user.id === 'u1').displayName, 'DEMO Buyer 2');
});
