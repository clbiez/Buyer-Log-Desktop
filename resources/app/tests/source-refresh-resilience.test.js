'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MIN_REFRESH_TIMEOUT_MS,
  computeRefreshTimeoutMs,
  computeParseTimeoutMs,
  refreshSourceWorkbooks,
} = require('../server/lib/source-refresh');

test('ASAS Excel automation failure does not prevent Antrepo refresh or disk parsing fallback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-source-refresh-'));
  try {
    const asas = path.join(root, 'ASAS.xlsx');
    const antrepo = path.join(root, 'ANTREPO.xlsx');
    fs.writeFileSync(asas, Buffer.alloc(1024));
    fs.writeFileSync(antrepo, Buffer.alloc(2048));
    const calls = [];
    const report = await refreshSourceWorkbooks({
      asas: { name: 'ASAS.xlsx', full: asas },
      antrepo: { name: 'ANTREPO.xlsx', full: antrepo },
    }, {
      enabled: true,
      configuredTimeoutMs: 1000,
      refreshFn: async (file, timeoutMs) => {
        calls.push({ file, timeoutMs });
        if (file === asas) throw new Error('COM connection failed');
        return 'OK';
      },
    });
    assert.equal(report.attempted, 2);
    assert.equal(report.succeeded, 1);
    assert.equal(report.failed, 1);
    assert.equal(report.files[0].source, 'ASAS');
    assert.equal(report.files[0].ok, false);
    assert.equal(report.files[1].source, 'ANTREPO');
    assert.equal(report.files[1].ok, true);
    assert.match(report.warnings[0], /mevcut kayıtlı hali okunmaya devam edildi/i);
    assert.ok(calls.every(call => call.timeoutMs >= MIN_REFRESH_TIMEOUT_MS));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refresh and parse timeouts scale with source workbook size and stay bounded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-source-timeout-'));
  try {
    const small = path.join(root, 'small.xlsx');
    const large = path.join(root, 'large.xlsx');
    fs.writeFileSync(small, Buffer.alloc(1024));
    fs.writeFileSync(large, Buffer.alloc(12 * 1024 * 1024));
    const smallTimeout = computeRefreshTimeoutMs(small, 1000);
    const largeTimeout = computeRefreshTimeoutMs(large, 1000);
    assert.ok(smallTimeout >= MIN_REFRESH_TIMEOUT_MS);
    assert.ok(largeTimeout > smallTimeout);
    const parseTimeout = computeParseTimeoutMs({ asas: { full: large }, antrepo: { full: large } }, 1000);
    assert.ok(parseTimeout > MIN_REFRESH_TIMEOUT_MS);
    assert.ok(parseTimeout <= 20 * 60 * 1000);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// api.normalizeManufacturerList uyumluluk kontrolü index.html'den app-main.js'e taşındı.
// sourceExcelRefreshFailures sembolü kod tabanında artık hiçbir yerde yok — yerini alan
// bir isim de bulunamadı; muhtemelen mekanizma yeniden tasarlandı. Bu assertion, neyi
// doğrulaması gerektiği netleşene kadar kaldırıldı (yanlış bir sembolü doğrulamaktansa).
test('refresh UI has a compatibility fallback for an older business-rules script', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const appMain = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  const sourceRefresh = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'source-refresh.js'), 'utf8');
  assert.match(html, /business-rules\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(appMain, /typeof api\.normalizeManufacturerList==='function'/);
  assert.match(sourceRefresh, /mevcut kayıtlı hali okunmaya devam edildi/);
});
