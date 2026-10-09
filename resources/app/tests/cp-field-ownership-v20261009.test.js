'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createOwnershipResolver, ownershipFor, isOwnerWrite } = require('../server/lib/cp-field-ownership');
const rows = { 1001: [{ buyer: 'ALİ YILMAZ', merch: 'M1', ageGroup: 'A1', buyerGrup: 'B1' }] };
const owner = { id: 'owner', username: 'ALİ YILMAZ', displayName: 'ALİ YILMAZ', systemRole: 'buyer' };
const other = { id: 'other', username: 'Başka', systemRole: 'manager', mags: ['M1'], mmygs: ['A1'], buyingGroups: ['B1'] };
const profiles = [owner, other];
const actor = userId => ({ recordId: 'cp-order:1001|MODEL|BLUE', userId, systemRole: 'buyer' });

test('verified ASAS owner can write; shared MAG/MMYG manager cannot substitute for owner', () => {
  assert.equal(isOwnerWrite(actor('owner'), rows, profiles), true);
  assert.deepEqual(ownershipFor(actor('other'), rows, profiles).ownerUserIds, ['owner']);
  assert.equal(isOwnerWrite(actor('other'), rows, profiles), false);
  assert.equal(isOwnerWrite({ ...actor('moderator'), systemRole: 'moderator' }, rows, profiles), true);
});
test('unknown authority/order/user/owner identity preserves legacy behavior', () => {
  for (const result of [ownershipFor(actor('other'), null, profiles), ownershipFor({ ...actor('other'), recordId: 'cp-order:9999' }, rows, profiles), ownershipFor(actor(null), rows, profiles), ownershipFor(actor('other'), rows, [other])]) {
    assert.equal(result.allowed, true); assert.equal(result.known, false);
  }
});
test('ASAS stable identity survives IAM rename; ambiguous identity is not treated as verified ownership', () => {
  const buyerId = crypto.createHash('sha256').update('ALİ YILMAZ').digest('hex').slice(0, 20);
  const renamed = { id: 'owner', username: 'corporate-login', displayName: 'Yeni Ad', stableIds: { buyerId, sourceId: `asas-buyer:${buyerId}` } };
  assert.equal(isOwnerWrite(actor('owner'), rows, [renamed, other]), true);
  assert.equal(isOwnerWrite(actor('other'), rows, [renamed, other]), false);
  const duplicate = { ...renamed, id: 'duplicate' };
  assert.equal(ownershipFor(actor('other'), rows, [renamed, duplicate, other]).known, false);
});
test('legacy order key covers every authoritative ASAS row; resolver is pure and reusable', () => {
  const mixed = { 1001: [...rows[1001], { buyer: 'Başka' }] };
  const before = JSON.stringify({ mixed, profiles }), resolve = createOwnershipResolver(mixed, profiles);
  assert.equal(resolve({ ...actor('owner'), recordId:'cp-order:1001' }).allowed, false);
  assert.equal(resolve.forRows(actor('owner'), rows[1001]).allowed, true);
  assert.equal(JSON.stringify({ mixed, profiles }), before);
});
test('canonical line with multiple known owners preserves unknown-line fallback without inventing model/color ownership', () => {
  const mixed = { 1001: [...rows[1001], { buyer:'Başka' }] };
  const result = ownershipFor(actor('owner'), mixed, profiles);
  assert.equal(result.allowed, true); assert.equal(result.known, false);
  assert.equal(result.reason, 'unknown-line-owner');
  assert.equal(ownershipFor({ ...actor('owner'), systemRole:'moderator' }, mixed, profiles).known, true);
});
test('unregistered sender cannot substitute for a known owner; missing sender remains legacy', () => {
  const result = ownershipFor(actor('missing-profile'), rows, profiles);
  assert.equal(result.allowed, false); assert.equal(result.known, true);
  assert.equal(result.reason, 'foreign-owner');
  assert.equal(ownershipFor(actor(null), rows, profiles).known, false);
});
test('missing buyer, empty authority rows and ambiguous legacy account names retain unknown ownership', () => {
  const duplicate = { ...owner, id:'legacy-duplicate' };
  for (const result of [ownershipFor(actor('other'), { 1001:[{ merch:'M1' }] }, profiles), ownershipFor(actor('other'), { 1001:[] }, profiles), ownershipFor(actor('other'), rows, [owner, duplicate, other])]) {
    assert.equal(result.allowed, true); assert.equal(result.known, false);
  }
});
test('owner identity remains known while disabled; actor role must be resolved by the trusted IAM integration', () => {
  const disabled = { ...owner, enabled:false, systemRole:'moderator' };
  assert.equal(ownershipFor(actor('other'), rows, [disabled, other]).allowed, false);
  // Actor.systemRole is a trusted argument. An unregistered/disabled actor's
  // event cannot supply it: buildUserAccess.sharedOwnerOf resolves findProfile.
  assert.equal(ownershipFor(actor('missing-profile'), rows, [disabled, other]).moderator, undefined);
});
