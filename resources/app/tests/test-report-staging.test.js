'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const staging = require('../server/lib/test-reports/staging');

test('test raporu önizleme oturumu aktif kullanımda kayan süreyle canlı kalır', () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  let id = '';
  try {
    assert.ok(staging.TTL_MS >= 4 * 60 * 60 * 1000, 'önizleme süresi uzun incelemeyi destekler');
    const created = staging.createSession('u1');
    id = created.id;

    now += staging.TTL_MS - 1000;
    assert.ok(staging.getSession(id, 'u1'), 'ilk aktif erişim oturumu yeniler');

    now += staging.TTL_MS - 1000;
    assert.ok(staging.getSession(id, 'u1'), 'süre yaratılıştan değil son erişimden hesaplanır');

    now += staging.TTL_MS + 1;
    assert.equal(staging.getSession(id, 'u1'), null, 'gerçekten uzun süre kullanılmayan oturum temizlenir');
  } finally {
    Date.now = originalNow;
    if (id) staging.dropSession(id);
  }
});
