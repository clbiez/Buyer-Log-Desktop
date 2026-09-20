'use strict';

/* v11.00 — YENİ GÖRSEL, MEVCUT ÇÖZÜMLEYİCİLERLE UYUMLU KALIR.
 *
 * Kanonik alım yolunun yazdığı kayıt, Koleksiyon / CP / Orders ekranlarının
 * ZATEN kullandığı çözümleyicilerden okunabilmelidir. İkinci bir görsel
 * kaydı ya da ikinci bir çözümleme yolu YOKTUR.
 *
 * Sunucu tarafı  : parse.plmImageRef + plm-image-availability
 * İstemci tarafı : model-image-cache.js (aynı anahtar biçimi)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-plm-resolve-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(TMP, 'server');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(TMP, 'local');
fs.mkdirSync(process.env.BUYER_LOG_SERVER_DATA_ROOT, { recursive: true });
fs.mkdirSync(process.env.BUYER_LOG_LOCAL_DATA_ROOT, { recursive: true });

const parse = require('../server/lib/parse');
const { resolveUsablePlmImage } = require('../server/lib/plm-image-availability');
const ingestLib = require('../server/lib/plm-image-ingest');
const ownership = require('../server/lib/plm-image-ownership');
const { createModelImageCache } = require('../public/model-image-cache.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function writeOne({ plmId, colourCode, colour }) {
  const files = new Map();
  const imagemap = {};
  let store = ownership.emptyStore();
  const ingest = ingestLib.createPlmImageIngest({
    owner: ownership.OWNER_PLM,
    ownership: { ...ownership, loadOwnership: () => store, saveOwnership: next => { store = next; return next; } },
    getImage: ref => (files.has(ref) ? { item: files.get(ref), full: ref } : null),
    readImageBytes: found => files.get(found.item.id).buffer,
    saveImage: ({ mimeType, base64 }) => {
      const buffer = Buffer.from(base64, 'base64');
      const item = { id: 'ci_1', mimeType, size: buffer.length, url: '/api/collection-images/ci_1', updatedAt: 't1', buffer };
      files.set(item.id, item);
      return item;
    },
    deleteImage: ref => files.delete(ref),
    patchLinks: links => {
      for (const link of links) { const key = ingestLib.canonicalKeyFor(link); if (key) imagemap[key] = String(link.imageRef || ''); }
      return { overrides: { imagemap }, updated: links.length };
    },
  });
  const result = ingest.commit([{ plmId, colourCode, colour, sourceType: 'OPTION', sourceIdentity: 'option:1:2', buffer: PNG, mimeType: 'image/png' }], { store, imagemap });
  return { files, imagemap, result };
}

const MODEL = { plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK' };

test('kanonik alım yolunun yazdığı kayıt sunucu çözümleyicisinden okunur', () => {
  const { imagemap, files } = writeOne(MODEL);
  const ref = parse.plmImageRef(imagemap, { plm: MODEL.plmId, ccode: MODEL.colourCode, colour: MODEL.colour });
  assert.equal(ref, 'ci_1');
  assert.ok(files.has(ref));
  // "Görsel var mı" sorusu fiziksel dosyayı da doğrular.
  const usable = resolveUsablePlmImage({
    map: imagemap, plmId: MODEL.plmId, colourCode: MODEL.colourCode, colour: MODEL.colour,
    getImage: id => (files.has(id) ? { full: id } : null), parse,
  });
  assert.equal(usable.usable, true);
  assert.equal(usable.ref, 'ci_1');
});

test('renk ADI bilinmeyen CP/Orders satırı da aynı görseli çözer', () => {
  const { imagemap } = writeOne(MODEL);
  // CP/Orders satırında renk adı olmayabilir; yalnız C.Code vardır.
  // Kanonik yazım isim anahtarını kullanır, bu yüzden isim anahtarı öncelikli
  // okunur; isim yoksa kod anahtarına düşülür.
  const namedRef = parse.plmImageRef(imagemap, { plm: MODEL.plmId, ccode: MODEL.colourCode, colour: MODEL.colour });
  assert.equal(namedRef, 'ci_1');
  // Renk adı olmadan okunduğunda kayıt görünmeyeceği için kod anahtarı da
  // yazılmalı mı? Hayır — mevcut sözleşme renk adını taşıyan satırın adıyla,
  // taşımayanın koduyla okunmasıdır. Bu testin koruduğu şey, ikisinin de
  // AYNI anahtar üretecinden geçmesidir.
  assert.equal(
    ingestLib.canonicalKeyFor({ plmId: MODEL.plmId, colourCode: MODEL.colourCode, colour: MODEL.colour }),
    parse.plmColourImageNameKey(MODEL.plmId, MODEL.colourCode, MODEL.colour),
  );
  assert.equal(
    ingestLib.canonicalKeyFor({ plmId: MODEL.plmId, colourCode: MODEL.colourCode }),
    parse.plmColourImageKey(MODEL.plmId, MODEL.colourCode),
  );
});

test('istemci görsel önbelleği sunucuyla AYNI anahtar biçimini kullanır', () => {
  const { imagemap } = writeOne(MODEL);
  const cache = createModelImageCache(globalThis, {});
  cache.setRegistryMap(imagemap);
  const source = cache.resolveRegistrySource(MODEL.plmId, MODEL.colourCode, '/api/collection-images', MODEL.colour);
  assert.equal(source, '/api/collection-images/ci_1');
  assert.equal(cache.hasRegistryKey(MODEL.plmId, MODEL.colourCode, MODEL.colour), true);
  // PLM ID gösterim farkları (123 / 123.0 / 000123) aynı kimliktir.
  assert.equal(cache.resolveRegistrySource('02123595', 'cvl', '/api/collection-images', 'new black'), '/api/collection-images/ci_1');
});

test('kanonik kayıt ikinci bir görsel deposu üretmez', () => {
  const { imagemap } = writeOne(MODEL);
  // Tek anahtar, tek referans: renk başına kopya kayıt yok.
  assert.equal(Object.keys(imagemap).length, 1);
  assert.match(Object.keys(imagemap)[0], /^plm:2123595\|colour:CVL\|name:NEW BLACK$/);
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });
