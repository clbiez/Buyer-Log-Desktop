'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, '../public/user-management.js'), 'utf8');

test('v7.07 Organization tree is built only from ACTIVE users', () => {
  assert.match(ui, /const activeUsers = store\.users\.filter\(user => user\.status === 'ACTIVE'\)/);
  assert.match(ui, /const known = new Set\(activeUsers\.map\(user => user\.id\)\)/);
  assert.match(ui, /const roots = activeUsers\.filter\(/);
  assert.match(ui, /childrenOf\(user\.id\)\.filter\(item => item\.status === 'ACTIVE'\)/);
  assert.match(ui, /const reports = childrenOf\(user\.id\)\.filter\(item => item\.status === 'ACTIVE'\)/);
  assert.match(ui, /Only active users are shown/);
});

test('v7.07 inactive user management remains available outside Organization', () => {
  assert.match(ui, /statusFilter === 'inactive'/);
  assert.match(ui, /data-act="activate"/);
  assert.match(ui, /Kullanıcı pasife alındı/);
});
