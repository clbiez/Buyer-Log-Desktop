'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
const connector = fs.readFileSync(path.join(root, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

const routeStart = server.indexOf("app.post('/api/model-images/import-plm'");
assert.notEqual(routeStart, -1);
const route = server.slice(routeStart, server.indexOf("app.post('/api/model-images/import-asas'", routeStart));
assert.ok(route.length > 1000);

/* v11.00 — KULLANICI KARARIYLA DEĞİŞTİ. v10.72'de model görseli MODEL
   seviyesindeydi (Style List satırının Image sütunu) çünkü renk seviyesinin
   tek yolu model detay (Style Overview) DOM'unu gezmekti ve bu pahalıydı.
   Canlı doğrulanan GetStyleImages ucu o kısıtı kaldırdı: renk görseli artık
   API'den geliyor, DOM gezintisi YOK.

   v10.72'nin GERÇEK regression'ı korunuyor ve burada sınanıyor:
     1) hiçbir görsel yolu model detay sayfasına GİTMEZ,
     2) keyfi/varsayılan olmayan bir Style Image ASLA model görseli olmaz. */
test('görsel yolu model detay (Style Overview) sayfasına gitmez', () => {
  const syncService = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-sync-service.js'), 'utf8');
  const styleApi = fs.readFileSync(path.join(root, 'server', 'lib', 'corenectum-style-api.js'), 'utf8');
  for (const source of [syncService, styleApi]) {
    assert.doesNotMatch(source, /style-overview/i, 'görsel yolu model detay sayfasını kullanmamalı');
    assert.doesNotMatch(source, /querySelector|innerText|document\./, 'görsel yolu DOM okumamalı');
  }
  // Metadata yalnız canlı doğrulanmış iki API ucundan gelir.
  assert.match(styleApi, /StyleList\/GetStyleList/);
  assert.match(styleApi, /StyleMainInformation\/GetStyleImages/);
});

test('varsayılan olmayan Style Image (teknik çizim) ASLA otomatik seçilmez', () => {
  const styleApi = require(path.join(root, 'server', 'lib', 'corenectum-style-api.js'));
  const technical = [{ attachmentAssociationId: '1', isDefault: false, imageType: 'Style Image',
    imageUrl: 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/tech' }];
  const selection = styleApi.selectColourImage({ colourCode: 'CVL', optionImages: [], styleImages: technical, styleListImageUrl: '' });
  assert.equal(selection.sourceType, styleApi.SOURCE_MISSING);
  assert.equal(selection.imageUrl, '');
});

/* v11.00 — aynı içerik paylaşımı kanonik alım yoluna taşındı. Sözleşme
   aynı: BİREBİR aynı baytlar renk başına ayrı dosya olarak kopyalanmaz. */
test('aynı model görseli renk başına ayrı dosya olarak kopyalanmaz', () => {
  const ingest = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-ingest.js'), 'utf8');
  assert.match(ingest, /const storedByHash = new Map\(\);/);
  assert.match(ingest, /const shared = storedByHash\.get\(hash\);/);
  assert.match(ingest, /status: COMMIT_SHARED/);
  // Paylaşılan varlık YENİ kaydedilmiş sayılmaz: geri alma yolu yalnız bu
  // turda gerçekten oluşturulan dosyaları siler.
  assert.match(ingest, /const created = \[\];/);
  assert.match(ingest, /for \(const id of created\) \{ try \{ deleteImage\(id\); \}/);
  // Aynı Attachment birden çok renkte seçilse bile BAYT bir kez indirilir.
  const service = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-sync-service.js'), 'utf8');
  assert.match(service, /const byUrl = new Map\(\);/);
  assert.match(service, /api\.attachmentIdentity\(item\.imageUrl\)/);
});

test('paylaşılan referans başka bir renk hâlâ kullanıyorsa silinmez', () => {
  const ingest = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-ingest.js'), 'utf8');
  assert.match(ingest, /const activeRefs = new Set\(Object\.values\(\(patched\.overrides && patched\.overrides\.imagemap\) \|\| \{\}\)/);
  assert.match(ingest, /if \(activeRefs\.has\(outcome\.currentRef\)\) continue;/);
  assert.match(ingest, /if \(deleteImage\(outcome\.currentRef\)\) removedFiles \+= 1;/);
});

/* v11.00 — KORUMA GÜÇLENDİ. Eskiden manuel görsel yalnız "eksikleri
   tamamla" kipinde korunuyordu; "Tümünü Yenile" onu sessizce eziyordu.
   Artık manuel görsel HER KİPTE korunur ve yalnız kullanıcı AÇIKÇA
   "üzerine yaz" derse değişir. */
test('kullanıcının elle koyduğu renk görseli her kipte korunur', () => {
  const ingest = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-ingest.js'), 'utf8');
  assert.match(ingest, /const permission = ownership\.canWriteAutomatic\(store, item\.key, currentRef, \{ overwriteManual \}\);/);
  assert.match(ingest, /if \(!permission\.allowed\) \{[\s\S]{0,200}DECISION_MANUAL/);
  assert.match(ingest, /mode === 'missing' && usable/);

  const ownership = require(path.join(root, 'server', 'lib', 'plm-image-ownership.js'));
  const key = 'plm:2123595|colour:CVL|name:NEW BLACK';
  const store = ownership.emptyStore();
  // Sahiplik kaydı YOK + imagemap dolu => MANUEL.
  assert.equal(ownership.canWriteAutomatic(store, key, 'ci_manual').allowed, false, 'manuel görsel varsayılan olarak korunmalı');
  assert.equal(ownership.canWriteAutomatic(store, key, 'ci_manual', { overwriteManual: true }).allowed, true, 'açık onayla ezilebilmeli');
  // Otomatik yazılmış görsel daha yeni bir otomatik görselle değişebilir.
  store.owners[key] = { owner: 'plm', imageRef: 'ci_auto', sourceType: 'OPTION', sourceIdentity: 'option:1:2', hash: '', styleId: '', at: null };
  assert.equal(ownership.canWriteAutomatic(store, key, 'ci_auto').allowed, true);
});

test('renk kimliği görsel paylaşımına rağmen korunur', () => {
  const ingest = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-ingest.js'), 'utf8');
  assert.match(ingest, /if \(!code\) return parseLib\.plmImageKey\(plmId\);/);
  assert.match(ingest, /return parseLib\.plmColourImageNameKey\(plmId, code, clean\(colour, 160\)\);/);
  // Paylaşılan bayt bile OLSA her renk kendi kimliğiyle bağlanır.
  assert.match(ingest, /links\.push\(\{ plmId: item\.plmId, colourCode: item\.colourCode, colour: item\.colour, imageRef: shared\.id \}\)/);
});
