'use strict';

/* v9.21 — MODULE REGISTRY: Buyer Log kendini ajana tanıtıyor.
 *
 * Bugüne kadar "hangi modüller var" sorusunun tek bir cevabı yoktu; bilgi üç
 * ayrı yerde ÖRTÜK duruyordu ve hiçbiri diğerini bilmiyordu:
 *   - userAccess.requireArea('...')  → yetki alanları (server.js)
 *   - data-tab="..."                 → ekranlar (index.html)
 *   - DATASET_SOURCES                → okunabilir veri (agent-tool-registry.js)
 *
 * Ajanın "ne yapabilirim" sorusunu ezberlenmiş bir prompt yerine VERİDEN
 * cevaplayabilmesi için üçünü birleştiren bir kayıt defteri gerekiyordu.
 *
 * Bu dosyanın asıl işi kayıt defterini gerçek kaynaklarla KARŞILAŞTIRMAK.
 * Yeni bir modül/ekran/yetki alanı eklendiğinde bu testler kırılır — yani
 * geliştirici modülü kaydetmeyi unutamaz, ajan da hayalî bir modül göremez.
 * §38'in (yeni modül gelince AI'ya kod yazmadan genişlesin) bedeli budur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const registry = require('../server/lib/module-registry');
const SERVER = require('./helpers/server-source')();
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/* Gerçek kaynaklardan okunan doğrular. Elle yazılmaz: kayıt defteri ile
   birlikte kaymasınlar diye kodun kendisinden çıkarılır. */
const realAreas = [...new Set([...SERVER.matchAll(/requireArea\('([a-z]+)'\)/g)].map(m => m[1]))].sort();
const realRoutes = [...new Set([...INDEX.matchAll(/data-tab="([a-z]+)"/g)].map(m => m[1]))].sort();

/* ------------------------------------------------- 1) GERÇEKLE UYUM */

test('v9.21 kayıt defteri gerçek yetki alanları ve ekranlarla uyumlu', () => {
  const result = registry.validate({ areas: realAreas, routes: realRoutes });
  assert.deepEqual(result.problems, [], 'kayıt defteri gerçekle ayrışmış');
  assert.equal(result.ok, true);
});

test('v9.21 her yetki alanının bir modülü, her ekranın bir kaydı var', () => {
  // Ayrışmanın iki yönü de yakalanmalı: eksik kayıt DA fazla kayıt DA hata.
  const registeredAreas = [...new Set(registry.list().map(m => m.area))].sort();
  assert.deepEqual(registeredAreas, realAreas, 'yetki alanları birebir eşleşmeli');
  const registeredRoutes = registry.list().map(m => m.route).filter(Boolean).sort();
  assert.deepEqual(registeredRoutes, realRoutes, 'ekranlar birebir eşleşmeli');
});

test('v9.21 datasetler native kaynak erişim alanlarıyla aynı listeden geliyor', () => {
  // Ajan dataset.query'yi bu adlarla çağıracak; ikisi ayrışırsa "modül var
  // ama verisi okunamıyor" gibi sessiz bir çukur oluşur.
  const areaMap=SERVER.match(/function agentDatasetArea\(source\) \{\s*return \(?\{([^}]+)\}/);
  assert.ok(areaMap, 'native dataset alan eşlemesi bulunmalı');
  const sources=[...areaMap[1].matchAll(/([a-z]+):/g)].map(m=>m[1]).sort();
  assert.deepEqual([...registry.DATASETS].sort(), sources);
  // Ve hiçbir modül kayıtlı olmayan bir dataset iddia etmemeli.
  for (const module of registry.list()) {
    for (const dataset of module.datasets) {
      assert.ok(sources.includes(dataset), `${module.id} bilinmeyen dataset istiyor: ${dataset}`);
    }
  }
});

/* ------------------------------------------------------ 2) DOĞRULAMA */

test('v9.21 doğrulama gerçek ayrışmaları yakalıyor', () => {
  // Testin kendisi de sınanmalı: her şeye "ok" diyen bir doğrulama işe yaramaz.
  const uydurmaAlan = registry.validate({ areas: ['cp'], routes: realRoutes });
  assert.equal(uydurmaAlan.ok, false);
  assert.ok(uydurmaAlan.problems.some(p => p.includes('gerçek bir yetki alanı değil')));

  const eksikEkran = registry.validate({ areas: realAreas, routes: [...realRoutes, 'yeni-ekran'] });
  assert.equal(eksikEkran.ok, false);
  assert.ok(eksikEkran.problems.some(p => p.includes('kayıt defterinde yok')));

  const bilinmeyenDataset = registry.validate({ areas: realAreas, routes: realRoutes, datasets: ['cp'] });
  assert.equal(bilinmeyenDataset.ok, false);
  assert.ok(bilinmeyenDataset.problems.some(p => p.includes('bilinmeyen dataset')));
});

test('v9.21 yetenek sözlüğü kapalı', () => {
  // Serbest metin yetenek, tool keşfini (§22) işe yaramaz hâle getirirdi.
  for (const module of registry.list()) {
    assert.ok(module.capabilities.length > 0, `${module.id} en az bir yetenek bildirmeli`);
    for (const capability of module.capabilities) {
      assert.ok(registry.CAPABILITIES.includes(capability), `${capability} sözlükte yok`);
    }
  }
  assert.ok(registry.CAPABILITIES.includes('read'));
  assert.ok(registry.CAPABILITIES.includes('patch-row'));
});

/* --------------------------------------------------------- 3) KEŞİF */

test('v9.21 ajan yeteneğe ve verisine göre modül bulabiliyor', () => {
  const yazilabilir = registry.withCapability('patch-row').map(m => m.id);
  assert.ok(yazilabilir.includes('cp') && yazilabilir.includes('koleksiyon'));
  // Salt okunur modül yazma yeteneği iddia etmemeli.
  assert.ok(!yazilabilir.includes('lfl'), 'LFL analiz ekranı, satır düzenlenmiyor');

  const koleksiyonu = registry.withDataset('collection').map(m => m.id);
  assert.ok(koleksiyonu.includes('koleksiyon'));
  assert.ok(koleksiyonu.includes('overview'), 'Genel Bakış da koleksiyon verisini okuyor');
});

test('v9.21 yetkisi olmayan modül keşfedilemiyor', () => {
  /* Ajan erişemeyeceği bir modülü görmemeli; görürse "yapabilirim" deyip
     403 alır ve kullanıcıya yanlış söz vermiş olur. */
  const userAccess = { hasArea: (profile, area) => (profile.areas || []).includes(area) };
  const buyer = { areas: ['cp', 'orders'] };
  const gorunen = registry.forProfile(buyer, userAccess).map(m => m.id).sort();
  // v7.0.229: Üreticiler sayfası Siparişler verisini okur ve Siparişler
  // yetki alanını paylaşır; Siparişler yetkisi olan onu da görür.
  assert.deepEqual(gorunen, ['cp', 'licensecards', 'manufacturers', 'orders']);
  // Katalog da aynı süzgeçten geçmeli.
  const katalog = registry.catalog('tr', buyer, userAccess).map(m => m.id).sort();
  assert.deepEqual(katalog, ['cp', 'licensecards', 'manufacturers', 'orders']);
  assert.ok(registry.forProfile({areas:['cp']},userAccess).some(module=>module.id==='licensecards'));
  assert.ok(registry.forProfile({areas:['source']},userAccess).some(module=>module.id==='licensecards'));
  assert.ok(!registry.forProfile({areas:['lfl']},userAccess).some(module=>module.id==='licensecards'));
  // Profil verilmezse tam liste döner (sunucu içi kullanım).
  assert.equal(registry.catalog('tr').length, registry.list().length);
});

/* ------------------------------------------------- 4) TOKEN BÜTÇESİ */

test('v9.21 describe karar için gerekeni verir, tam kaydı değil', () => {
  const cp = registry.describe('cp', 'tr');
  // v9.23: tableKey eklendi — UI komut katmanı hangi tabloya yazacağını
  // tahmin etmek zorunda kalmasın (modül 'koleksiyon', tablo 'kol').
  assert.deepEqual(Object.keys(cp).sort(), ['agentFilter', 'capabilities', 'datasets', 'id', 'label', 'navigable', 'route', 'summary', 'tableKey']);
  /* 'filter' yeteneği KULLANICI için doğrudur; agentFilter ajanın komut
     yolunun o ekranı kapsayıp kapsamadığını söyler. Koleksiyon kullanıcı
     için filtrelenebilir ama kendi mekanizmasını kullandığı için ajan
     filtreleyemez — ikisini tek alana sıkıştırmak ya uygulama hakkında
     yalan söylemek ya da ajana tutamayacağı söz verdirmek olurdu. */
  assert.equal(registry.describe('koleksiyon').agentFilter, false);
  assert.ok(registry.get('koleksiyon').capabilities.includes('filter'));
  assert.equal(cp.agentFilter, true);
  assert.equal(cp.tableKey, 'cp');
  assert.equal(registry.describe('koleksiyon').tableKey, 'kol', 'modül kimliği ile tablo anahtarı farklı olabilir');
  assert.equal(registry.describe('priceanalysis').tableKey, null, 'tablosu olmayan modül null taşır');
  assert.equal(cp.label, 'CP Tracker');
  assert.equal(cp.navigable, true);
  assert.equal(registry.describe('agents'), null);
  // v7.81 — Kaynak Veri artık gidilebilir bir ekran.
  assert.equal(registry.describe('source').navigable, true);
  assert.equal(registry.describe('source').route, 'source');
  assert.equal(registry.describe('yok-boyle-bir-modul'), null);
});

test('v9.21 katalog LLM bağlamına sığacak kadar küçük', () => {
  /* Tüm kayıt defterini her istekte prompta basmak §31'e aykırı. Katalog
     bir "içindekiler" olmalı; ayrıntı describe ile istenir. */
  const bytes = Buffer.byteLength(JSON.stringify(registry.catalog('tr')), 'utf8');
  assert.ok(bytes < 4096, `katalog ${bytes} bayt — bağlam için fazla büyük`);
});

test('v9.21 iki dil de destekleniyor', () => {
  assert.equal(registry.label('koleksiyon', 'tr'), 'Koleksiyon');
  assert.equal(registry.label('koleksiyon', 'en'), 'Collection');
  assert.notEqual(registry.describe('shipping', 'en').summary, registry.describe('shipping', 'tr').summary);
});

test('v9.21 döndürülen kayıtlar kopyadır, defter dışarıdan bozulamaz', () => {
  const first = registry.get('cp');
  first.capabilities.push('uydurma');
  assert.ok(!registry.get('cp').capabilities.includes('uydurma'), 'kayıt defteri dışarıdan değiştirilememeli');
});
