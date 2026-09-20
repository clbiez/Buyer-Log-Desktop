'use strict';

/* v7.03 — Sunucunun kullandığı buildUserAccess nesnesinde rol workspace erişimi. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-workspace-v703-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const access = require('../server/lib/user-access');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('buildUserAccess çalışma zamanı nesnesi roleWorkspaceEntries metodunu sunar', () => {
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  assert.equal(typeof runtime.roleWorkspaceEntries, 'function');
  assert.deepEqual(runtime.roleWorkspaceEntries('moderator'), access.roleWorkspaceEntries('moderator'));
});

test('çalışma zamanı rol workspace erişimi bilinmeyen kullanıcıda güvenli boş sonuç döndürür', () => {
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  assert.deepEqual(runtime.roleWorkspaceEntries('missing-user'), {});
});
