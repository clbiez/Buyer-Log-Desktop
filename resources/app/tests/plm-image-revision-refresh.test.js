'use strict';

/* PLM REVİZYONU — model görseli.
 *
 * Kullanıcı kararı: PLM'de model revize edildiğinde Buyer Log senkronu yeni
 * görseli getirmelidir. CoreNectum revize görseli AYNI Attachment adresiyle
 * verebildiği için kaynak kimliği (URL yolu) tek başına "değişmedi" kanıtı
 * değildir. Açık yenileme ('all' = Tümü/Seçili/tek model) baytları indirip
 * içerik özetiyle karşılaştırır; "Eksikleri tamamla" ('missing') hızlı kalır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-plm-image-rev-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(TMP, 'server');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(TMP, 'local');
fs.mkdirSync(process.env.BUYER_LOG_SERVER_DATA_ROOT, { recursive: true });
fs.mkdirSync(process.env.BUYER_LOG_LOCAL_DATA_ROOT, { recursive: true });

const ingestLib = require('../server/lib/plm-image-ingest');
const ownership = require('../server/lib/plm-image-ownership');
const service = require('../server/lib/plm-image-sync-service');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const png = tag => Buffer.concat([PNG, Buffer.from(String(tag))]);
const ATTACH = name => `https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/${name}`;

function createFakeStore() {
  const files = new Map();
  const imagemap = {};
  let sequence = 0;
  let store = ownership.emptyStore();
  const fakeOwnership = { ...ownership, loadOwnership: () => store, saveOwnership: next => { store = next; return next; } };
  const ingest = ingestLib.createPlmImageIngest({
    owner: ownership.OWNER_PLM,
    ownership: fakeOwnership,
    getImage: ref => (files.has(ref) ? { item: files.get(ref), full: ref } : null),
    readImageBytes: found => files.get(found.item.id).buffer,
    saveImage: ({ rowId, filename, mimeType, base64 }) => {
      sequence += 1;
      const id = `ci_${sequence}`;
      const buffer = Buffer.from(base64, 'base64');
      const item = { id, rowId, filename, mimeType, size: buffer.length, url: `/api/collection-images/${id}`, updatedAt: `t${sequence}`, buffer };
      files.set(id, item);
      return item;
    },
    deleteImage: ref => files.delete(ref),
    patchLinks: links => {
      for (const link of links) { const key = ingestLib.canonicalKeyFor(link); if (key) imagemap[key] = String(link.imageRef || ''); }
      return { overrides: { imagemap }, updated: links.length };
    },
  });
  return { files, imagemap, ingest, store: () => store };
}

function setup() {
  const fake = createFakeStore();
  let content = 'v1';
  const downloads = [];
  const input = mode => ({
    requests: [{ plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK', imageRole: 'main' }],
    mode,
    ingest: fake.ingest,
    imagemap: fake.imagemap,
    store: fake.store(),
    dropOldFiles: mode === 'all',
    styleListLookup: async codes => ({ data: { coreNectumResultData: { styleListResult: codes.map(code => ({ plmCode: code, styleId: `25${code}`, styleName: 'X', model: { imageUrl: ATTACH('model-2123595') } })) } } }),
    styleImagesLookup: async () => ({ data: { styleImages: { StyleImages: [] }, styleOptionImages: { OptionImages: [] } } }),
    downloadImage: async url => { downloads.push(url); const buffer = png(content); return { url, mimeType: 'image/png', buffer, size: buffer.length }; },
  });
  const currentBytes = () => {
    const ref = Object.values(fake.imagemap)[0];
    const file = ref && fake.files.get(ref);
    return file ? file.buffer.toString('latin1') : '';
  };
  return { fake, input, downloads, currentBytes, revise: next => { content = next; } };
}

test('PLM aynı Attachment adresiyle revize görsel verirse Tümü/Seçili yenileme yeni görseli yazar', async () => {
  const ctx = setup();
  await service.runPlmImageSync(ctx.input('all'));
  assert.match(ctx.currentBytes(), /v1$/);

  ctx.revise('v2-revised');
  const run = await service.runPlmImageSync(ctx.input('all'));
  assert.equal(run.counts.cacheHits, 0, 'aynı adres revizyonu gizlememeli');
  assert.match(ctx.currentBytes(), /v2-revised$/, 'revize görsel kayda yazılmalı');
  assert.equal(ctx.fake.files.size, 1, 'eski otomatik görsel dosyası temizlenmeli');
});

test('içerik değişmediyse yenileme indirir ama yeni dosya YAZMAZ', async () => {
  const ctx = setup();
  await service.runPlmImageSync(ctx.input('all'));
  const before = { ...ctx.fake.imagemap };
  const run = await service.runPlmImageSync(ctx.input('all'));
  assert.equal(ctx.downloads.length, 2);
  assert.deepEqual(ctx.fake.imagemap, before);
  assert.equal(ctx.fake.files.size, 1);
  assert.equal(run.counts.linksUpdated || 0, 0);
});

test('Eksikleri tamamla modu mevcut görseli yeniden indirmez', async () => {
  const ctx = setup();
  await service.runPlmImageSync(ctx.input('all'));
  ctx.revise('v2-revised');
  await service.runPlmImageSync(ctx.input('missing'));
  assert.equal(ctx.downloads.length, 1);
  assert.match(ctx.currentBytes(), /v1$/);
});
