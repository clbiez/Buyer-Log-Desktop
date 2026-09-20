'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

// v10.72: renk başına Options görseli çekilmiyor. Aynı regression (ekranda
// zaten yüklenmiş Attachment yanıtını tekrar indirmemek) artık model
// seviyesindeki Style List görseli için geçerli.
test('Style List görseli ekranda yüklenmişse yeniden çapraz alan isteği atılmaz', () => {
  const start = source.indexOf('async function coreNectumBulkImages(');
  assert.notEqual(start, -1);
  const block = source.slice(start, source.indexOf('\nasync function coreNectumStyleListRowImage(', start));
  const capture = block.search(/coreNectumWaitCapturedImage\(capture,url,\d+\)/);
  const refetch = block.indexOf('coreNectumImageFromUrl(page,url)');
  assert.ok(capture >= 0, 'ekranda yüklenmiş Attachment yanıtı önce kullanılmalı');
  assert.ok(refetch > capture, 'yalnız yakalanmış yanıt yoksa tekrar indirme denenmeli');
});
