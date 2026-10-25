'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-checklist-authority-'));
Object.assign(process.env, { BUYER_LOG_SERVER_DATA_ROOT: root, BUYER_LOG_AUTH_DATA_ROOT: root, BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_CENTRAL_IAM_ENABLED: '0' });
const iam = require('../server/lib/iam-core');
const seed = iam.migrateStore({ schemaVersion: 8, _revision: 1,
  moderator: { id: 'moderator', role: 'moderator', systemRole: 'moderator', username: 'moderator', enabled: true },
  users: [{ id: 'a', role: 'buyer', systemRole: 'buyer', username: 'a', displayName: 'Buyer A', enabled: true, dataScope: { mode: 'CUSTOM', buyers: ['Buyer A'] } }],
  orderAccess: { '1001': [{ buyer: 'Buyer A' }], '1002': [{ buyer: 'Buyer B' }], '1003': [{ buyer: 'Buyer A' }, { buyer: 'Buyer B' }] },
});
fs.writeFileSync(path.join(root, 'user-access.json'), JSON.stringify(seed));
const userAccess = require('../server/lib/user-access').buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
const serverPath = path.join(__dirname, '../server/server.js'), source = fs.readFileSync(serverPath, 'utf8');
function fn(name) { const at = source.indexOf('function ' + name + '('); assert.ok(at >= 0); return source.slice(at, source.indexOf('\n}', at) + 2); }
const rows = [1001, 1002, 1003].map(code => ({ 'Order Code': code, 'Model Name': 'MODEL-' + code, 'PLM ID': code + 10000, 'C.Code': '01', Buyer: 'Buyer A' }));
const context = { require: createRequire(serverPath), Map, Set, userAccess, canonicalFields: require('../public/canonical-fields'), agentQualityOrderRowsNow: () => rows };
vm.createContext(context);
vm.runInContext(['orderRowsForCode', 'canUserEditOrderCode', 'checklistAuthorizedOrdersNow'].map(fn).join('\n'), context);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test('production checklist resolver uses real IAM authority, handles mixed ownership and reusable option identities', () => {
  const CP = require('../public/cp-readiness-engine'), Checklist = require('../public/cp-checklist-engine');
  const profile = userAccess.profileById('a'), read = context.checklistAuthorizedOrdersNow(profile), write = context.checklistAuthorizedOrdersNow(profile, { write: true });
  const keys = rows.map(row => CP.analyzeOrder(row).orderKey);
  assert.equal(read.has(keys[0]), true); assert.equal(write.has(keys[0]), true);
  assert.equal(read.has(keys[1]), false, 'forged self-scoped cache row cannot expose foreign evidence');
  assert.equal(write.has(keys[1]), false);
  assert.equal(read.has(keys[2]), true, 'mixed ownership can remain visible');
  assert.equal(write.has(keys[2]), false, 'every official owner must permit writes to an order code');
  for (let i = 0; i < rows.length; i++) {
    const optionKey = '@option:' + Checklist.optionIdentity(CP.analyzeOrder(rows[i]));
    assert.equal(read.has(optionKey), i !== 1);
    assert.equal(write.has(optionKey), i === 0);
  }
  const moderator = userAccess.profileById('moderator');
  assert.equal(context.checklistAuthorizedOrdersNow(moderator, { write: true }).size, 6);
});
test('checklist read computes the invocation-wide management permission once, retaining per-code ownership checks',()=>{
 const hasPermission=userAccess.hasPermission,originalRows=rows.slice();let calls=0;
 userAccess.hasPermission=(...args)=>{calls++;return hasPermission(...args);};
 try{
  for(let i=0;i<1000;i++)rows.push({...originalRows[0],'Model Name':'SCALE-'+i});
  const result=context.checklistAuthorizedOrdersNow(userAccess.profileById('a'));
  assert.equal(calls,1,'permission graph must not be rebuilt per row');
  assert.ok(result.size>=1000);assert.equal(result.has(require('../public/cp-readiness-engine').analyzeOrder(originalRows[1]).orderKey),false,'foreign official owner remains denied');
 }finally{userAccess.hasPermission=hasPermission;rows.splice(0,rows.length,...originalRows);}
});
test('on-demand projection edit hints compute permission once per projection and keep foreign/mixed ownership closed',()=>{
 vm.runInContext(fn('pageProjectionEditResolver'),context);
 const hasPermission=userAccess.hasPermission;let calls=0;
 userAccess.hasPermission=(...args)=>{calls++;return hasPermission(...args);};
 try{
  const profile=userAccess.profileById('moderator'),canEdit=context.pageProjectionEditResolver(profile);for(let i=0;i<1000;i++)assert.equal(canEdit(rows[i%3]),true);assert.equal(calls,1);
  const buyer=context.pageProjectionEditResolver(userAccess.profileById('a'));assert.equal(buyer(rows[0]),true);assert.equal(buyer(rows[1]),false);assert.equal(buyer(rows[2]),false);assert.equal(context.pageProjectionEditResolver(null)(rows[0]),false);
  const denied=context.pageProjectionEditResolver(userAccess.profileById('a'));assert.equal(denied(rows[1]),false,'new invocation must not reuse the previous moderator result');
 }finally{userAccess.hasPermission=hasPermission;}
});
