const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function modalSource() {
  const start = APP.indexOf('async function openModelImageLimitModal');
  const end = APP.indexOf('async function openSyncLocalDataModal', start);
  assert.ok(start >= 0, 'Image Size Limit modalı bulunamadı');
  assert.ok(end > start, 'Image Size Limit modalının sonu bulunamadı');
  return APP.slice(start, end);
}

test('Görsel limiti penceresi gerçek model görseli için canlı önizleme alanı üretir', () => {
  const modal = modalSource();
  assert.match(modal, /_modelImageSamplePreview/);
  assert.match(modal, /<img[^>]+id=\"_modelImageSampleImg\"/);
  assert.match(modal, /sample\.innerHTML\s*=\s*'<div class="modelImageSamplePreview"/);
  assert.match(modal, /findModelImagePreviewSource/);
});

test('Görsel limiti UI seçimini sunucu ayarına kaydeder; önizleme ham kaynağı güvenli biçimde gösterir', () => {
  const modal = modalSource();
  const previewStart = APP.indexOf('async function updateModelImageSamplePreview');
  const previewEnd = APP.indexOf('function clearLocalModelImageMirrors', previewStart);
  const preview = APP.slice(previewStart, previewEnd);
  assert.match(preview, /const targetBytes=Math\.max\(1024,Math\.round\(Number\(maxKb\)\|\|1\)\*1024\)/);
  assert.match(preview, /modelImagePreviewDataUrl\(source\)/);
  assert.match(preview, /original image|ham görsel/);
  assert.match(modal, /updateModelImageSamplePreview/);
  assert.match(modal, /fetch\('\/api\/model-images\/settings',\{method:'PUT'/);
  assert.match(modal, /body:JSON\.stringify\(\{maxKb\}\)/);
  assert.match(modal, /MODEL_IMAGE_MAX_BYTES=Number\(saved\.maxBytes\)\|\|maxKb\*1024/);
});
