'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { imagemapPatch, compactBackgroundImageResult } = require('../server/lib/plm-image-silent-response');

test('imagemapPatch yalnız değişen/kaldırılan anahtarları taşır', () => {
  const before = { a: 'ci_1', b: 'ci_2', gone: 'ci_9' };
  const after = { a: 'ci_1', b: 'ci_3', fresh: 'ci_4' };
  assert.deepEqual(imagemapPatch(before, after), { b: 'ci_3', fresh: 'ci_4', gone: null });
});

test('sessiz yanıt tam overrides taşımaz; sayılar ve görseller korunur', () => {
  const imagemap = {}; for (let i = 0; i < 30000; i++) imagemap['plm:' + i] = 'ci_' + i;
  const result = { overrides: { imagemap: { ...imagemap, 'plm:new|colour:HFB': 'ci_new' }, other: { big: true } }, images: [{ plmId: 'new' }], requested: 1, distribution: { localAvailable: 0 }, batchLog: [1], diagnostics: [2] };
  const compact = compactBackgroundImageResult(result, imagemap);
  assert.equal(compact.overrides, undefined);
  assert.equal(compact.batchLog, undefined);
  assert.deepEqual(compact.imagemapPatch, { 'plm:new|colour:HFB': 'ci_new' });
  assert.equal(compact.silent, true);
  assert.equal(compact.requested, 1);
  assert.ok(JSON.stringify(compact).length < 400, 'yanıt küçük kalır');
});

test('import-plm yalnız arka plan isteğinde sıkıştırılmış yanıt döner', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const start = source.indexOf('async function runPlmImageImport');
  const block = source.slice(start, source.indexOf("app.post('/api/model-images/import-asas'", start));
  assert.match(block, /background\?plmImageSilentResponse\.compactBackgroundImageResult\(result,beforeImagemap,\{relevantKeys:map=>requestedPlmIds\.flatMap\(plmId=>parseLib\.plmImageKeysFor\(map,plmId\)\)\}\):result/);
});

test('BLModelImageCache.patchRegistryMap artımlıdır ve adlı renk indeksini korur', () => {
  const { createModelImageCache } = require('../public/model-image-cache.js');
  const cache = createModelImageCache({});
  const map = {};
  cache.setRegistryMap(map);
  const key = cache.canonicalImageKey('1202929', 'HFB', 'NAVY');
  map[key] = 'ci_x'; // uygulama durumu aynı nesneyi önceden yazmış olabilir
  assert.equal(cache.patchRegistryMap({ [key]: 'ci_x' }), 1);
  assert.equal(cache.hasRegistryKey('1202929', 'HFB'), true, 'adlı anahtar renk kodu aramasında bulunur');
  assert.equal(cache.resolveRegistrySource('1202929', 'HFB'), '/api/collection-images/ci_x');
  cache.patchRegistryMap({ [key]: null });
  assert.equal(cache.hasRegistryKey('1202929', 'HFB'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(map, key), false);
});

test('istemci eskiyse: görsel sunucuda zaten varken (değişiklik yok) istenen kimliğin anahtarı yine döner', () => {
  const parseLib = require('../server/lib/parse');
  const imagemap = { 'plm:1202929|colour:HFB|name:NAVY': 'ci_local', 'plm:999|colour:X': 'ci_other' };
  const compact = compactBackgroundImageResult({ overrides: { imagemap }, images: [] }, imagemap, {
    relevantKeys: map => ['1202929'].flatMap(id => parseLib.plmImageKeysFor(map, id)),
  });
  assert.deepEqual(compact.imagemapPatch, { 'plm:1202929|colour:HFB|name:NAVY': 'ci_local' });
});

test('arka plan işinde PLM hatası yerel sonucu kaybetmez (upstreamDeferred); kullanıcı işi hata fırlatır', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const start = source.indexOf('async function runPlmImageImport');
  const block = source.slice(start, source.indexOf("app.post('/api/model-images/import-asas'", start));
  assert.match(block, /\} catch \(upstreamError\) \{[\s\S]*?if\(!background\)throw upstreamError;[\s\S]*?upstreamDeferred: \{ code:/);
});
