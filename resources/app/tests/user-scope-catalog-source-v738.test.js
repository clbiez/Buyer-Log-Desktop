'use strict';

/*
 * v7.38 — KULLANICI KAPSAMI SEÇENEKLERİ: KAYNAK VE KAPSAM DÜZELTMESİ
 *
 * Kullanıcı bulgusu (birebir):
 *   "Kullanıcı ayarlarında ASAS database'deki veriler gelmiyor MAG MMYG ve
 *    Buyer Grup alanlarında. Buyer Grup'larda da bir kısmı geliyor."
 *
 * İKİ AYRI KUSUR VARDI, İKİSİ DE BURADA KORUNUYOR:
 *
 *  1) KATALOĞUN KAYNAĞI DARDI. Katalog yalnız OKUNMUŞ sipariş satırlarından
 *     kuruluyordu; o satırlar ASAS kaynak filtresinden/ufkundan geçmiş
 *     satırlardır. Kurulum tek bir MAG/MMYG ile sınırlıysa katalog da ondan
 *     ibaret kalıyordu — ekranda görülen tam olarak buydu. Artık tekil değerler
 *     veri modelinden DOĞRUDAN okunabiliyor; bu okuma filtreye tabi değil.
 *
 *  2) LİSTE SEÇİLİ MAG/MMYG İLE SINIRLIYDI. Kataloğda var olan bir Buying Group
 *     bile, kullanıcının MAG/MMYG'sinde geçmiyorsa listede hiç görünmüyordu —
 *     "bir kısmı geliyor" bundandı. Artık katalogun TAMAMI listelenir; ilgili
 *     değerler yalnız üstte gruplanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const UM = read('public/user-management.js');
const SERVER = read('server/server.js');
const ACCESS = read('server/lib/user-access.js');

/* ------------------------------------------------------------------ */
/* 1) KUSURUN SEBEBİ KAYNAĞINDA                                        */
/* ------------------------------------------------------------------ */

test('v7.38 · katalog hâlâ okunmuş satırlardan da beslenir (eski yol korunur)', () => {
  assert.match(ACCESS, /const scopeCatalog = mergeScopeCatalog\(store\.scopeCatalog, scopeCatalogFromOrders\(orders\)\);/,
    'sipariş satırlarından besleme kaldırılmadı; üstüne ikinci bir kaynak eklendi');
});

test('v7.38 · sipariş satırlarından beslenen katalog, o satırlarla SINIRLIDIR (kusurun sebebi)', () => {
  const access = require(path.join(ROOT, 'server', 'lib', 'user-access.js'));
  // Kurulumun tek bir MAG/MMYG ile sınırlı olduğu durum: kullanıcının gördüğü tablo.
  const dar = access.scopeCatalogFromOrders([
    { merch: 'CU4E', ageGroup: 'CUW4', buyerGrup: 'DOKUMA ÜST' },
    { merch: 'CU4E', ageGroup: 'CUW4', buyerGrup: 'ÖRME' },
  ]);
  assert.deepEqual(dar.mags, ['CU4E'], 'dar okumada tek MAG kalır — ekranda görülen buydu');
  assert.deepEqual(dar.mmygs, ['CUW4']);
  assert.equal(dar.buyingGroups.length, 2, 'Buyer Grupları da yalnız o kapsamdan gelir');
});

test('v7.38 · doğrudan model okuması bu sınırı aşar ve katalog KÜÇÜLMEZ (§142)', () => {
  assert.match(ACCESS, /function mergeCatalogValues\(values\)/);
  assert.match(ACCESS, /const scopeCatalog = mergeScopeCatalog\(store\.scopeCatalog, incoming\);/,
    'yeni değerler birleştirilmeli, eskisinin üzerine yazılmamalı');
  assert.match(ACCESS, /bu okuma ufuk\/kaynak filtresine TABİ DEĞİLDİR/);
});

test('v7.38 · değişiklik yoksa yazma yapılmaz', () => {
  const block = ACCESS.slice(ACCESS.indexOf('function mergeCatalogValues(values)'), ACCESS.indexOf('function syncProfiles(orders, options = {})'));
  assert.match(block, /if \(JSON\.stringify\(store\.scopeCatalog \|\| \{\}\) === JSON\.stringify\(scopeCatalog\)\) \{/);
});

/* ------------------------------------------------------------------ */
/* 2) SUNUCU UCU                                                       */
/* ------------------------------------------------------------------ */

test('v7.38 · tekil değerleri okuyan uç var ve üç alanı da kapsar', () => {
  assert.match(SERVER, /app\.post\('\/api\/user-scope-catalog\/refresh'/);
  assert.match(SERVER, /\{ key: 'mags', header: 'Merch Alt Grup Kod', label: 'MAG' \}/);
  assert.match(SERVER, /\{ key: 'mmygs', header: 'Merch Marka Yaş Grup Kod', label: 'MMYG' \}/);
  assert.match(SERVER, /\{ key: 'buyingGroups', header: 'Buyer Grup \(TR\)', label: 'Buying Group' \}/);
});

test('v7.38 · okuma ufuk/kaynak filtresi uygulamaz — DISTINCT sorgusu koşulsuzdur', () => {
  const block = SERVER.slice(SERVER.indexOf("app.post('/api/user-scope-catalog/refresh'"), SERVER.indexOf('// Şemayı ham haliyle döndürür'));
  assert.match(block, /EVALUATE TOPN\(\$\{limit\}, DISTINCT\(\$\{dax\}\), \$\{dax\}, ASC\)/);
  assert.doesNotMatch(block, /FILTER\(|horizon\.seasons|applyHorizon/, 'sorguya ufuk koşulu eklenmemeli');
});

test('v7.38 · yetki SUNUCUDA aranır (§32)', () => {
  assert.match(SERVER, /app\.post\('\/api\/user-scope-catalog\/refresh', userAccess\.requireArea\('source'\), userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(UM, /window\.BLHasPermission\('manageModelConnections'\)/, 'istemcide düğme yalnız kolaylık için gizlenir');
});

test('v7.38 · ASAS bağlantısı yoksa sebebi söylenir, sessizce boş dönülmez (§152)', () => {
  assert.match(SERVER, /ASAS Data Model bağlantısı bulunamadı\. Seçim listeleri ancak model bağlantısından okunabilir\./);
  assert.match(SERVER, /code: 'ASAS_CONNECTION_MISSING'/);
});

test('v7.38 · bir alan okunamazsa diğerleri yine gelir ve sebebi alan bazında bildirilir', () => {
  const block = SERVER.slice(SERVER.indexOf("app.post('/api/user-scope-catalog/refresh'"), SERVER.indexOf('// Şemayı ham haliyle döndürür'));
  assert.match(block, /fields\.push\(\{ key: field\.key, label: field\.label, header: field\.header, count: read, source, error: failure \}\)/);
  assert.match(block, /catch \(err\) \{ if \(!failure\) failure = err && err\.message \? err\.message : String\(err\); \}/);
  assert.match(block, /"\$\{field\.header\}" alanı bu bağlantıda eşlenmemiş\./, 'eşlenmemiş alan da sebep olarak yazılmalı');
});

test('v7.38 · tazeleme denetim kaydına yazılır', () => {
  assert.match(SERVER, /USER_SCOPE_CATALOG_REFRESH/);
});

test('v7.38 · birleştirici, server.js\'in kullandığı NESNEDE de açık', () => {
  /* Tarayıcıda ölçülürken çıkan gerçek kusur: işlev modülden dışa açılmıştı
     ama server.js buildUserAccess'in DÖNDÜRDÜĞÜ nesneyi kullanıyor; uç 500
     veriyordu. İki dışa açma da korunuyor. */
  const access = require(path.join(ROOT, 'server', 'lib', 'user-access.js'));
  assert.equal(typeof access.mergeCatalogValues, 'function', 'modül düzeyinde');
  assert.match(ACCESS, /syncProfiles: syncProfilesForAccess, mergeCatalogValues,/, 'örnek düzeyinde');
});

/* ------------------------------------------------------------------ */
/* 3) LİSTE HİÇBİR DEĞERİ GİZLEMEZ                                     */
/* ------------------------------------------------------------------ */

test('v7.38 · katalogun TAMAMI listelenir, ilgili değerler yalnız üstte gruplanır', () => {
  assert.match(UM, /function chipOptionsHtml\(related, all, chosen\)/);
  assert.match(UM, /<optgroup label="\$\{esc\(T\('Seçili MAG \/ MMYG kapsamında'/);
  assert.match(UM, /<optgroup label="\$\{esc\(T\('ASAS’taki diğer değerler'/);
});

test('v7.38 · Buying Group listesi artık seçili MAG/MMYG ile sınırlanmaz', () => {
  const form = UM.slice(UM.indexOf('function detailEdit(user)'), UM.indexOf('/* ===================== 7b'));
  assert.match(form, /allOptions: allBuyingGroups\(\)/, 'tam katalog da geçilmeli');
  assert.match(form, /options: buyingGroupsForScope\(mags, mmygs, ownedGroups\)/, 'ilgili olanlar üstte kalmalı');
  assert.match(UM, /refreshChipChoices\(groupField, buyingGroupsForScope\(mags, mmygs, \[\]\), allBuyingGroups\(\)\)/);
});

test('v7.38 · MMYG listesi de tam kataloğu kapsar', () => {
  assert.match(UM, /allOptions: mmygsForMag\(''\)/);
  assert.match(UM, /refreshChipChoices\(mmygField, mmygsForMags\(mags\), mmygsForMag\(''\)\)/);
});

test('v7.38 · liste boşsa ne yapılacağı yazılır', () => {
  assert.match(UM, /Veri tabanında seçenek yok — “ASAS’tan Tazele” ile okuyun/,
    'boş liste sessiz kalmamalı; kullanıcı ne yapacağını bilmeli');
});

/* ------------------------------------------------------------------ */
/* 4) ARAYÜZ AKIŞI                                                     */
/* ------------------------------------------------------------------ */

test('v7.38/v7.40 tazeleme düğmesi HER ZAMAN GÖRÜNEN araç çubuğunda ve sonuç alan bazında yazılır', () => {
  /* v7.40 — GÜNCELLENDİ (§156). İddia genişledi: düğme v7.39'da FİLTRE panelinin
     içindeydi, panel varsayılan olarak kapalı olduğu için kullanıcı "nerede"
     diye sordu. Artık arama kutusunun yanında, panel açılmadan görünür. */
  const toolbar = UM.slice(UM.indexOf('<div class="umToolbar">'), UM.indexOf('<div class="umStatusTabs"'));
  assert.match(toolbar, /data-act="refreshScopeCatalog"/, 'düğme her zaman görünen araç çubuğunda olmalı');
  const filters = UM.slice(UM.indexOf('function filtersPanel()'), UM.indexOf('function bulkBar()'));
  assert.doesNotMatch(filters, /refreshScopeCatalog/, 'kapalı panelin içinde kalmamalı');
  assert.match(UM, /Seçenekleri ASAS’tan Tazele/);
  assert.match(UM, /case 'refreshScopeCatalog': void refreshScopeCatalog\(trigger\); return;/);
  const block = UM.slice(UM.indexOf('async function refreshScopeCatalog(trigger)'), UM.indexOf('/* ===================== 4 · Kabuk'));
  assert.match(block, /field\.error/, 'okunamayan alan sebebiyle yazılmalı');
  assert.match(block, /listede toplam \$\{totals\.mags \|\| 0\} MAG/, 'sonuçta toplam sayı da söylenmeli');
  assert.match(block, /await reload\(\{ silent: true \}\)/, 'liste tazelendikten sonra ekran yenilenmeli');
});

test('v7.38 · tazeleme sırasında düğme kilitlenir ve her durumda açılır', () => {
  const block = UM.slice(UM.indexOf('async function refreshScopeCatalog(trigger)'), UM.indexOf('/* ===================== 4 · Kabuk'));
  assert.match(block, /if \(trigger\) trigger\.disabled = true;/);
  assert.match(block, /finally \{\s*\n\s*if \(trigger\) trigger\.disabled = false;/);
});

test('v7.38 · hata da kullanıcıya yazılır', () => {
  assert.match(UM, /Tazelenemedi: \$\{error\.message\}/);
});

/* v7.39 — GÜNCELLENDİ (§156). Amaç aynı: sürüm etiketi tüm dosyalarda birlikte
   ilerlesin, tek bir eski etiket kalmasın. v7.38 kaydının geçmişte durduğu da
   doğrulanır. */
test('v7.38/v7.39 sürüm tüm dosyalarda birlikte ilerliyor — canonical runtime source', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const index = read('public/index.html');
  assert.ok(index.includes('Version __BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('buyerlog.bootRetry.v__BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('?v=__BL_ASSET_VERSION__'));
  assert.equal(/\?v=7\.\d+/.test(index), false, 'statik sürüm cache etiketi kalmamalı');
  assert.match(read('public/version-history.js'), /v: '7\.38'/, 'geçmiş sürüm kaydı korunmalı');
});
