'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../server/lib/model-image-registry');
const { createModelImageCache } = require('../public/model-image-cache');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const QUOTATIONS = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test('canonical identity normalizes PLM IDs but preserves colour-code text', () => {
  assert.deepEqual(registry.identity('000215013.0', ' 0012 '), {
    plmId: '215013', colourCode: '0012', key: 'plm:215013|colour:0012',
  });
});

test('resolver returns only the exact PLM + Colour Code mapping', () => {
  const map = {
    'plm:215013|colour:0012': 'navy.jpg',
    'plm:215013|colour:0044': 'white.jpg',
    'plm:215013': 'legacy.jpg',
  };
  assert.equal(registry.resolveRef(map, '215013', '0012'), 'navy.jpg');
  assert.equal(registry.resolveRef(map, '215013', '0044'), 'white.jpg');
  assert.equal(registry.resolveRef(map, '215013', '0099'), '');
  assert.equal(registry.resolveRef(map, '215013', ''), '');
});

test('normalizing a write batch does not fan one image out to other colours', () => {
  assert.deepEqual(registry.normalizeItems([{ plmId: '000215013.0', colourCode: '0012', imageRef: 'navy.jpg' }]), [{
    plmId: '215013', colourCode: '0012', imageRef: 'navy.jpg',
  }]);
});

test('client resolver uses the same exact-key rule and no model-name fallback', () => {
  const cache = createModelImageCache(globalThis, { thumbnailer: async blob => blob });
  const map = { 'plm:215013|colour:0012': 'navy.jpg', 'plm:215013': 'legacy.jpg' };
  assert.equal(cache.canonicalImageKey('000215013.0', '0012'), 'plm:215013|colour:0012');
  assert.equal(cache.resolveImageRef(map, '215013', '0012'), 'navy.jpg');
  assert.equal(cache.resolveImageRef(map, '215013', '0044'), '');
  cache.setRegistryMap(map);
  assert.equal(cache.resolveRegistrySource('215013', '0012'), '/api/collection-images/navy.jpg');
  assert.equal(cache.resolveRegistrySource('215013', '0044'), '');
});

test('Collection upload and removal retain the colour name when a colour code is shared, and Collection/Pricing read the registry first', () => {
  assert.match(APP, /const items=\[\{plmId,colourCode,colour,imageRef:imageRef==null\?'':imageRef\}\];/);
  assert.match(APP, /const canonicalImageSource=canonicalModelImageSource\(r\.plmId,r\.colourCode,r\.colour\);/);
  assert.match(APP, /const collectionImageSource=canonicalImageSource\|\|r\.img/);
  assert.match(APP, /if\(canonical\)await kolPlmLinkImageEverywhere\(row,''\);/);
  // Renk adı da geçilir; kanonik kayıt plm:X|colour:Y|name:Z anahtarını tutar.
  assert.match(QUOTATIONS, /resolveRegistrySource\?\.\(plmId,colourCode,'\/api\/collection-images',colourName\)/);
  assert.match(QUOTATIONS, /colourCode:qNorm\(row\.colourCode\|\|row\['C\.Code'\]/);
});

test('migration report distinguishes canonical records, legacy records and tombstones', () => {
  assert.deepEqual(registry.migrationReport({
    'plm:1': 'legacy.jpg',
    'plm:1|colour:001': 'red.jpg',
    'plm:1|colour:002': '',
  }), { total: 3, canonical: 2, legacy: 1, tombstones: 1, canonicalNonEmpty: 1 });
});

test('server exposes a read-only migration report without exposing image contents', () => {
  assert.match(SERVER, /app\.get\('\/api\/model-images\/registry\/report'/);
  assert.match(SERVER, /modelImageRegistry\.migrationReport\(overrides&&overrides\.imagemap\)/);
});
