'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../server/lib/collection-image-sync-policy');

test('Shared Hub model images are enabled only for Collection scope', () => {
  assert.equal(policy.scopeUsesSharedImages('koleksiyon'), true);
  assert.equal(policy.scopeUsesSharedImages('KOLEKSİYON'), true);
  for (const scope of ['cp', 'orders', 'backlog', 'overview', 'lfl', 'priceanalysis', 'source', '']) {
    assert.equal(policy.scopeUsesSharedImages(scope), false, scope);
  }
});

test('workspaceImageItems returns only Collection rows with persistent image ref and PLM identity', () => {
  const workspace = {
    rows: [
      { id: 1, plmId: '123', ccode: '01', colour: 'Black', imgRef: 'ci_a' },
      { id: 2, 'PLM ID': '456', 'Renk Kodu': '02', Renk: 'White', imageRef: 'ci_b' },
      { id: 3, plmId: '789', ccode: '03', colour: 'Blue' },
      { id: 4, imgRef: 'ci_c' },
      { id: 1, plmId: '123', ccode: '01', colour: 'Black', imgRef: 'ci_a' },
    ],
  };
  const items = policy.workspaceImageItems(workspace);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    imageRef: 'ci_a', plmId: '123', colourCode: '01', colour: 'Black', recordId: '1',
  });
  assert.deepEqual(items[1], {
    imageRef: 'ci_b', plmId: '456', colourCode: '02', colour: 'White', recordId: '2',
  });
});

test('Collection images are published only when owner granted view or edit access', () => {
  const grants = [
    { ownerId: 'owner-a', granteeId: 'user-b', level: 'view' },
    { ownerId: 'owner-c', granteeId: 'user-d', level: 'edit' },
  ];
  assert.equal(policy.shouldPublishOwnerImages(grants, 'owner-a'), true);
  assert.equal(policy.shouldPublishOwnerImages(grants, 'owner-c'), true);
  assert.equal(policy.shouldPublishOwnerImages(grants, 'owner-x'), false);
  assert.equal(policy.shouldPublishOwnerImages([{ ownerId: 'owner-a', granteeId: 'user-b', level: 'none' }], 'owner-a'), false);
});
