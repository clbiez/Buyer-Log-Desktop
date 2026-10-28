'use strict';

// The page-cache CP path carries no _canEditShared; /api/cp-shared-edit must give
// exactly the decision /api/data/cp's sharedAccessRows makes per line key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-shared-edit-denied-'));
const isolation = {
  BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'server'),
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
  BUYER_LOG_TEMP_ROOT: path.join(root, 'temp'),
  BUYER_LOG_CENTRAL_IAM_ENABLED: '0',
};
const previous = Object.fromEntries(Object.keys(isolation).map(key => [key, process.env[key]]));
Object.assign(process.env, isolation);
fs.mkdirSync(isolation.BUYER_LOG_AUTH_DATA_ROOT, { recursive: true });
test.after(() => {
  fs.rmSync(root, { recursive:true, force:true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const iam = require('../server/lib/iam-core');
const sourceBuyer = 'ALİ YILMAZ';
const buyerId = crypto.createHash('sha256').update(sourceBuyer.toLocaleUpperCase('tr-TR')).digest('hex').slice(0, 20);
const seed = iam.migrateStore({ schemaVersion:8, _revision:1,
  moderator: { id:'moderator', username:'admin', displayName:'Admin', role:'moderator', systemRole:'moderator', enabled:true },
  users: [
    { id:'owner', username:'corporate-login', displayName:'Yeni Kurumsal Ad', role:'buyer', systemRole:'buyer', enabled:true,
      stableIds:{ buyerId, sourceId:`asas-buyer:${buyerId}` },
      dataScope:{ mode:'CUSTOM', buyers:[sourceBuyer] }, mags:['MAG-1'], mmygs:['MMYG-1'], buyingGroups:['BG-1'] },
    { id:'manager', username:'manager', displayName:'Manager', role:'manager', systemRole:'manager', enabled:true,
      dataScope:{ mode:'MAG' }, mags:['MAG-1'], mmygs:['MMYG-1'], buyingGroups:['BG-1'] },
    { id:'disabled', username:'disabled', displayName:'Disabled', role:'moderator', systemRole:'moderator', enabled:false, status:'INACTIVE' },
  ],
});
fs.writeFileSync(path.join(isolation.BUYER_LOG_AUTH_DATA_ROOT, 'user-access.json'), JSON.stringify(seed));
const access = require('../server/lib/user-access');
const runtime = access.buildUserAccess({ ensureDataLoaded:async () => {}, getOrders:() => [] });
const authoritative = [
  { ocode:4100002, buyer:sourceBuyer, merch:'MAG-1', ageGroup:'MMYG-1', buyerGrup:'BG-1' },
  { ocode:4100003, buyer:sourceBuyer, merch:'MAG-1', ageGroup:'MMYG-1', buyerGrup:'BG-1' },
  { ocode:4100003, buyer:'BAŞKA ALICI', merch:'MAG-1', ageGroup:'MMYG-1', buyerGrup:'BG-1' },
  { ocode:4100004, buyer:'TANIMSIZ ALICI', merch:'MAG-1', ageGroup:'MMYG-1', buyerGrup:'BG-1' },
];
runtime.syncProfiles(authoritative, { authoritative:true });


const codes = ['4100002', '4100003', '4100004'];
function expectedDenied(userId) {
  return codes.filter(code => !runtime.sharedOwnerOf(`cp-order:${code}|MODEL|BLUE`, userId).allowed);
}

test('denied order codes match the per-line shared-owner decision for every actor', () => {
  for (const id of ['manager', 'owner', 'moderator']) {
    assert.deepEqual(runtime.sharedEditDeniedOrderCodes(id, codes).sort(), expectedDenied(id), id);
  }
  assert.deepEqual(runtime.sharedEditDeniedOrderCodes('manager', codes), ['4100002'], 'foreign single owner is locked; multi/unknown owner lines stay open');
  assert.deepEqual(runtime.sharedEditDeniedOrderCodes('owner', codes), []);
  assert.deepEqual(runtime.sharedEditDeniedOrderCodes('moderator', codes), []);
  assert.deepEqual(runtime.sharedEditDeniedOrderCodes('', codes), [], 'no session user keeps the legacy unlocked UI');
});

test('only order codes the caller already holds are evaluated (no out-of-scope disclosure)', () => {
  assert.deepEqual(runtime.sharedEditDeniedOrderCodes('manager', ['4100003']), []);
  assert.deepEqual(runtime.sharedEditDeniedOrderCodes('manager', []), []);
  assert.deepEqual(runtime.sharedEditDeniedOrderCodes('manager'), []);
  assert.deepEqual(runtime.sharedEditDeniedOrderCodes('manager', ['4100002', '4100002', ' 4100002 ', 'x|y', '../4100002', 12]), ['4100002'], 'deduplicated, only plain numeric codes');
});

test('the CP client applies the list by the same order-code key as lineKeyOfRow', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
  assert.match(app, /row\._canEditShared=!denied\.has\(lineKeyOfRow\(row\)\.split\('\|'\)\[0\]\)/);
  assert.match(app, /if\(!rows\.length\|\|rows\.some\(row=>row&&row\._canEditShared!==undefined\)\)return false;/);
  const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/cp-shared-edit', userAccess\.requireArea\('cp'\), express\.json\(\{ limit: '8mb' \}\)/);
  assert.match(server, /userAccess\.sharedEditDeniedOrderCodes\(profile && profile\.id, codes\)/);
  assert.match(app, /const codes=\[\.\.\.new Set\(rows\.map\(row=>row\?lineKeyOfRow\(row\)\.split\('\|'\)\[0\]:''\)\.filter\(Boolean\)\)\];/);
});
