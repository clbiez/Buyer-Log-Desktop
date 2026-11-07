'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const AT = '2026-11-07T12:00:00.000Z';
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function grant(permission, extra = {}) {
  return { id: `demo-${permission}`, permission, source: 'DIRECT', reason: 'synthetic', grantedAt: AT, ...extra };
}
function fixture(count = 30, fanout = 3) {
  if (!Number.isInteger(count) || count < 2 || !Number.isInteger(fanout) || fanout < 1) throw new Error('Invalid synthetic tree');
  const profile = (id, parent, index, moderator = false) => ({
    id, iamVersion: 1, username: `demo-${id}`, displayName: `DEMO ${id}`, title: 'Synthetic', email: '',
    role: moderator ? 'moderator' : index === 0 ? 'manager' : 'buyer', systemRole: moderator ? 'moderator' : 'buyer',
    orgLevel: 'job_title', enabled: true, status: 'ACTIVE', managerId: parent, supervisorId: parent,
    stableIds: { sourceId: `SYNTHETIC:${id}` }, credentialRevision: 1, accessRevision: 1,
    mags: [`MAG${index % 3}`], mmygs: [`MMYG${index % 5}`], buyingGroups: [`BG${index % 2}`],
    dataScope: { mode: moderator ? 'ALL' : index === 0 ? 'TEAM' : 'SELF' },
    permissions: {}, accessAreas: {}, collectionAccess: [], directPermissions: moderator ? [] : [grant('CP.EDIT')], temporaryPermissions: [],
  });
  return { schemaVersion: 8, _revision: 7, _updatedAt: AT, moderator: profile('moderator', null, 0, true),
    users: Array.from({ length: count }, (_, i) => profile(`u${i}`, i === 0 ? 'moderator' : `u${Math.floor((i - 1) / fanout)}`, i)),
    iam: {}, scopeCatalog: {}, orderAccess: {} };
}
function isolate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-admin03-'));
  for (const name of ['AUTH_DATA_ROOT', 'SERVER_DATA_ROOT', 'DATA_ROOT', 'LOCAL_DATA_ROOT', 'PORTABLE_DATA_ROOT', 'TEMP_ROOT', 'IAM_SHARED_ROOT']) {
    const value = path.join(root, ['AUTH_DATA_ROOT', 'SERVER_DATA_ROOT'].includes(name) ? 'auth' : name.toLowerCase());
    fs.mkdirSync(value, { recursive: true }); process.env[`BUYER_LOG_${name}`] = value;
  }
  process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
  process.env.BUYER_LOG_CENTRAL_IAM_ENABLED = '0';
  return root;
}
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
module.exports = { AT, fixture, grant, hash, isolate, response };
