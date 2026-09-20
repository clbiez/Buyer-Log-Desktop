'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

function functionSource(name, nextName) {
  const start = SERVER.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  const end = SERVER.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(end > start, `${name} sonu bulunamadı`);
  return SERVER.slice(start, end);
}

test('v4.74 kayıtlı model snapshot açılışında tanımsız parsedAsas değişkenine erişilmez', () => {
  const body = functionSource('hydrateSnapshotPayload', 'hydrateModelSnapshot');
  assert.doesNotMatch(body, /\bparsedAsas\b/);
  assert.match(body, /fabricHeaderInfo:\s*snapshot\.fabricHeaderInfo\s*\|\|\s*null/);
});

test('v4.74 yeni ASAS okumasında kumaş başlık bilgisi parsedAsas üzerinden kaydedilmeye devam eder', () => {
  assert.match(SERVER, /fabricHeaderInfo:\s*parsedAsas\.fabricHeaderInfo\s*\|\|\s*null/);
});
