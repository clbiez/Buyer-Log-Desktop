'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
const connector = require('../server/lib/agent-browser-connector');
const Groups = require('../public/collection-model-groups.js');
const parse = require('../server/lib/parse');
const { createModelImageCache } = require('../public/model-image-cache.js');

test('aynı PLM ve C.Code altındaki farklı renk adları ayrı PLM görsel işi olur', () => {
  const black = connector.coreNectumColourImageKey({ plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK' });
  const navy = connector.coreNectumColourImageKey({ plmId: '2123595', colourCode: 'CVL', colour: 'NEW NAVY' });
  assert.notEqual(black, navy);
});

test('kalıcı görsel anahtarı aynı renk kodundaki ad varyantlarını da ayırır', () => {
  const black = parse.plmColourImageNameKey('2123595', 'CVL', 'NEW BLACK');
  const navy = parse.plmColourImageNameKey('2123595', 'CVL', 'NEW NAVY');
  assert.notEqual(black, navy);
  const cache = createModelImageCache({});
  assert.equal(cache.resolveImageRef({ [black]: 'black-image', [navy]: 'navy-image' }, '2123595', 'CVL', 'NEW NAVY'), 'navy-image');
});

/* v11.00 — "PLM seçenek görseli araması renk adıyla eşleşen isteği korur"
   testi emekli edildi. Style Overview Options kazıması (coreNectumStyle-
   OverviewImageRows) kaynaktan kaldırıldı; görseller canlı CoreNectum
   API'sinden geliyor. Renk ADININ istek boyunca korunması ayrıca aşağıdaki
   "sunucu ve CoreNectum köprüsü renk adını isteğin sonuna kadar korur"
   testiyle güvence altında. */

test('istemci gerçek renk adını PLM görsel isteğine taşır ve renk adına göre tekilleştirir', () => {
  const start = app.indexOf('function plmToolRows(source,scope=\'filtered\')');
  const end = app.indexOf('function versionedPlmImageUrl', start);
  const block = app.slice(start, end);
  assert.match(block, /colour:row&&row\.colour/);
  assert.match(block, /turknorm\(colour\)/);
  assert.match(block, /next=\{plmId,styleName,colourCode,colour,imageRole\}/);
  assert.match(app, /async function fetchPlmImageForModel\(\{plmId,colourCode,colour,styleName\}/);
  assert.match(app, /colour:requestedColourName/);
});

/* v11.00 — kanıt yeri değişti, sözleşme aynı: renk ADI kanonik görsel
   kimliğinin parçasıdır ve istek boyunca kaybolmaz. Karar artık paylaşılan
   kanonik alım yolunda (plm-image-ingest) yaşıyor; canlı senkron ve paket
   içe aktarma ikisi de oradan geçer. */
test('sunucu ve CoreNectum köprüsü renk adını isteğin sonuna kadar korur', () => {
  const ingest = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-ingest.js'), 'utf8');
  assert.match(ingest, /plmColourImageNameKey\(plmId, code, clean\(colour, 160\)\)/);
  // İstek renk ADINI taşır: rota renk kodunu da adını da gönderir.
  assert.match(server, /requests\.push\(\{plmId,colourCode,colour,/);
  assert.match(server, /colour=String\(item&&item\.colour\|\|item&&item\.color\|\|''\)\.trim\(\)/);
  const ingestApi = require(path.join(root, 'server', 'lib', 'plm-image-ingest.js'));
  const withName = ingestApi.canonicalKeyFor({ plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK' });
  const withoutName = ingestApi.canonicalKeyFor({ plmId: '2123595', colourCode: 'CVL' });
  assert.notEqual(withName, withoutName, 'renk adı kimliğin parçası olmalı');
  assert.match(withName, /\|name:NEW BLACK$/);
});

test('PLM içe aktarımı aynı PLM ID ve model adına ait ilk rengi ana, diğerlerini bağlı varyant yapar', () => {
  const linked = Groups.linkImportedColourVariants([
    { id: 41, plmId: '2123595', modelKod: 'SOFT-1-TR', colourCode: 'CVL', colour: 'NEW BLACK' },
    { id: 42, plmId: '2123595', modelKod: 'SOFT-1-TR', colourCode: 'CVL', colour: 'NEW NAVY' },
    { id: 43, plmId: '2123595', modelKod: 'SOFT-1-TR', colourCode: 'CVL', colour: 'DARK BROWN' },
  ]).rows;
  assert.equal(linked[0].modelGroupRole, 'parent');
  assert.deepEqual(linked.slice(1).map(row => row.modelGroupRole), ['variant', 'variant']);
  assert.equal(new Set(linked.map(row => row.modelGroupId)).size, 1);
});

test('PLM içe aktarımı farklı PLM veya model adlarını yanlışlıkla birleştirmez', () => {
  const linked = Groups.linkImportedColourVariants([
    { id: 51, plmId: '2123595', modelKod: 'SOFT-1-TR', colourCode: 'CVL', colour: 'NEW BLACK' },
    { id: 52, plmId: '2123596', modelKod: 'SOFT-1-TR', colourCode: 'CVL', colour: 'NEW NAVY' },
    { id: 53, plmId: '2123595', modelKod: 'SOFT-2-TR', colourCode: 'CVL', colour: 'DARK BROWN' },
  ]).rows;
  assert.ok(linked.every(row => !row.modelGroupId));
});

test('iki aktarım yolu da yeni renk varyantlarını bağlama yardımcısını çağırır', () => {
  const occurrences = app.match(/created=kolLinkImportedColourVariants\(created\);/g) || [];
  assert.equal(occurrences.length, 2);
});
