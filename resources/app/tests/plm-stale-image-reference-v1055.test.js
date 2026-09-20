'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse = require('../server/lib/parse');
const { resolveUsablePlmImage } = require('../server/lib/plm-image-availability');

test('bozuk fiziksel dosyaya işaret eden renk görseli eksik sayılır', () => {
  const key = parse.plmColourImageNameKey('2123595', 'CVL', 'NEW BLACK');
  const result = resolveUsablePlmImage({
    map: { [key]: 'ci_missing' },
    plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK',
    getImage: () => null,
  });
  assert.deepEqual(result, { key, ref: 'ci_missing', usable: false });
});

test('renk adına ait kayıt yoksa geçerli eski renk-kodu kaydı kullanılabilir', () => {
  const key = parse.plmColourImageKey('2123595', 'CVL');
  const result = resolveUsablePlmImage({
    map: { [key]: 'ci_present' },
    plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK',
    getImage: ref => ref === 'ci_present' ? { full: 'present.jpg' } : null,
  });
  assert.deepEqual(result, { key, ref: 'ci_present', usable: true });
});

/* v11.00 — karar kanonik alım yoluna taşındı ama SÖZLEŞME AYNI: "görsel
   var mı" sorusu imagemap kaydına değil, depoda gerçekten duran dosyaya
   bakar. Kayıtta referans olup dosya silinmişse görsel EKSİKTİR. */
test('PLM eksik-görsel akışı bağlantı kaydı yerine fiziksel dosya varlığını kullanır', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const ingestSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'plm-image-ingest.js'), 'utf8');
  // Fiziksel varlık: getImage(ref) gerçekten dosyayı çözemezse "yok" sayılır.
  assert.match(ingestSource, /function hasStoredFile\(ref\) \{\s*\n\s*return Boolean\(clean\(ref, 120\) && getImage\(ref\)\);/);
  assert.match(ingestSource, /const usable = hasStoredFile\(currentRef\);/);
  assert.match(ingestSource, /mode === 'missing' && usable/);
  assert.match(server, /readImageBytes: found => fs\.readFileSync\(found\.full\)/);
  assert.match(server, /result\.imageFailedItems\|\|\[\]/);
  assert.match(server, /plmJobs\.update\(req\.currentUser\.id,imageJobRef\.id/);

  // Davranış kanıtı: kayıtta referans var ama dosya yok -> yeniden çekilir.
  const ingestApi = require(path.join(__dirname, '..', 'server', 'lib', 'plm-image-ingest.js'));
  const ownership = require(path.join(__dirname, '..', 'server', 'lib', 'plm-image-ownership.js'));
  const item = { plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK' };
  const key = ingestApi.canonicalKeyFor(item);
  const store = ownership.emptyStore();
  store.owners[key] = { owner: 'plm', imageRef: 'ci_gone', sourceType: 'OPTION', sourceIdentity: 'option:1:2', hash: '', styleId: '', at: null };
  const ingest = ingestApi.createPlmImageIngest({
    getImage: () => null, // dosya diskte YOK
    saveImage: () => { throw new Error('unused'); },
    patchLinks: () => ({ overrides: { imagemap: {} }, updated: 0 }),
  });
  const decision = ingest.decideBeforeFetch(item, { store, imagemap: { [key]: 'ci_gone' }, mode: 'missing' });
  assert.equal(decision.decision, 'fetch', 'dosya yoksa görsel EKSİK sayılmalı');
});
