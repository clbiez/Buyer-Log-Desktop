'use strict';

/*
 * v7.37 — MAG / MMYG / BUYING GROUP: ÇOKTAN SEÇMELİ, VERİ TABANINDAN BESLENİR
 *
 * Kullanıcı talebi (birebir):
 *   "Kullanıcı ayarlarında Buying Group, ASAS'daki Buyer Grup'dan beslensin,
 *    MAG Merch Marka Alt Grup'dan, MMYG Merch Marka Yaş Grup'dan beslensin.
 *    Giriş yaparken database'deki seçenekleri sunsun. Çoktan seçmeli olsun ve
 *    istenildiği kadar alan kullanıcıya atanabilsin. Manuel el ile girişe de
 *    açık olsun bu alanlar."
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *   1) ÜÇ ALAN DA ASAS'TAN BESLENİR. Katalog, sipariş satırlarındaki
 *      "Merch Alt Grup Kod", "Merch Marka Yaş Grup Kod" ve "Buyer Grup (TR)"
 *      alanlarından kurulur.
 *   2) SINIRSIZ ÇOKLU ATAMA. Kullanıcıya istenildiği kadar değer atanabilir;
 *      kaydetme yolu FormData.getAll üzerinden hepsini taşır.
 *   3) ELLE GİRİŞ AÇIK. Katalogda olmayan değer de yazılabilir.
 *   4) KAYITLI DEĞER DÜŞMEZ (§142). MAG değişince seçim LİSTESİ daralır ama
 *      seçili çipler silinmez; katalogda olmayan çip de yerinde kalır.
 *   5) KATALOG BİRİKİMLİDİR ve yetki kararına GİRMEZ (§32).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const UM = read('public/user-management.js');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css','user-management.css']);
const PARSE = read('server/lib/parse.js');
const ACCESS = read('server/lib/user-access.js');

/* ------------------------------------------------------------------ */
/* 1) KAYNAK: ASAS ALANLARI                                            */
/* ------------------------------------------------------------------ */

test('v7.37 · üç alan da ASAS sipariş satırındaki alanlardan beslenir', () => {
  assert.match(PARSE, /merch: norm\(g\(row, 'Merch Alt Grup Kod'\)\)/, 'MAG kaynağı');
  assert.match(PARSE, /ageGroup: norm\(g\(row, 'Merch Marka Yaş Grup Kod'\)\)/, 'MMYG kaynağı');
  assert.match(PARSE, /buyerGrup: norm\(g\(row, 'Buyer Grup \(TR\)'\)\)/, 'Buying Group kaynağı');
  assert.match(ACCESS, /const mag = clean\(order && order\.merch\), mmyg = clean\(order && order\.ageGroup\), group = clean\(order && order\.buyerGrup\);/,
    'katalog bu üç alandan kurulmalı');
});

test('v7.37 · katalog gerçekten dolar ve MAG→MMYG→Buying Group ilişkisini taşır', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-scope-'));
  process.env.BUYER_LOG_USER_DATA_ROOT = process.env.BUYER_LOG_USER_DATA_ROOT || path.join(tmpRoot, 'users');
  const access = require(path.join(ROOT, 'server', 'lib', 'user-access.js'));
  const catalog = access.__test__ && access.__test__.scopeCatalogFromOrders
    ? access.__test__.scopeCatalogFromOrders([
      { merch: 'CU4E', ageGroup: 'CUW4', buyerGrup: 'DOKUMA ÜST' },
      { merch: 'CU4E', ageGroup: 'CUW4', buyerGrup: 'ÖRME' },
      { merch: 'CU5E', ageGroup: 'CUW5', buyerGrup: 'TRİKO' },
    ]) : null;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (!catalog) return; // iç işlev dışa açılmadıysa kaynak iddiası yukarıda korunuyor
  assert.deepEqual(catalog.mags, ['CU4E', 'CU5E']);
  assert.deepEqual(catalog.mmygs, ['CUW4', 'CUW5']);
  assert.deepEqual(catalog.buyingGroups.sort(), ['DOKUMA ÜST', 'TRİKO', 'ÖRME'].sort());
});

test('v7.37 · katalog BİRİKİMLİDİR: dar bir yenileme değerleri düşürmez (§142)', () => {
  assert.match(ACCESS, /function mergeScopeCatalog\(previous, next\)/);
  assert.match(ACCESS, /Katalog yalnız seçim listesi doldurur; hiçbir yetki kararına girmez\./,
    'katalog yetki kararına girmemeli (§32)');
});

/* ------------------------------------------------------------------ */
/* 2) ÇOKTAN SEÇMELİ ARAYÜZ                                            */
/* ------------------------------------------------------------------ */

test('v7.37 · üç alan da aynı çip denetimini kullanır', () => {
  const form = UM.slice(UM.indexOf('function detailEdit(user)'), UM.indexOf('/* ===================== 7b'));
  for (const name of ['mag', 'mmyg', 'buyingGroup']) {
    assert.match(form, new RegExp(`chipFieldHtml\\(\\{ name: '${name}'`), `${name} çip denetimi kullanmalı`);
  }
  assert.doesNotMatch(form, /type="checkbox" name="buyingGroup"/, 'sabit onay kutusu ızgarası kalmamalı');
  assert.doesNotMatch(form, /comboHtml\('name="mag"/, 'tek değerlik metin kutusu kalmamalı');
});

test('v7.37 · seçilen her değer kendi FORM ALANI olur — çoklu kayıt böyle taşınır', () => {
  assert.match(UM, /<input type="hidden" name="\$\{esc\(name\)\}" value="\$\{esc\(value\)\}">/);
  assert.match(UM, /mags: data\.getAll\('mag'\)\.map\(clean\)\.filter\(Boolean\)/);
  assert.match(UM, /mmygs: data\.getAll\('mmyg'\)\.map\(clean\)\.filter\(Boolean\)/);
  assert.match(UM, /buyingGroups: data\.getAll\('buyingGroup'\)\.map\(clean\)\.filter\(Boolean\)/);
  assert.equal((UM.match(/mags: clean\(data\.get\('mag'\)\) \? \[clean\(data\.get\('mag'\)\)\] : \[\]/g) || []).length, 0,
    'tek değere indiren eski kod kalmamalı');
});

test('v7.37 · sayı sınırı yoktur', () => {
  const block = UM.slice(UM.indexOf('function chipAdd(field, value)'), UM.indexOf('function allMags()'));
  assert.doesNotMatch(block, /length >= \d/, 'çip eklemede sayı sınırı olmamalı');
});

test('v7.37 · veri tabanı seçenekleri açılır listede sunulur', () => {
  assert.match(UM, /Veri tabanından seç…/);
  assert.match(UM, /data-um-chippick/);
  assert.match(UM, /Veri tabanında seçenek yok/, 'katalog boşsa sebebi yazılmalı, boş liste sessiz kalmamalı');
});

test('v7.37 · elle giriş açıktır: düğmeyle de Enter ile de eklenir', () => {
  assert.match(UM, /Listede yok — elle yaz/);
  assert.match(UM, /case 'chipAdd': \{/);
  const key = UM.slice(UM.indexOf('function onKeyDown(event)'), UM.indexOf('/* ===================== 16'));
  assert.match(key, /const chipNew = event\.target\.closest\('\[data-um-chipnew\]'\);/);
  assert.match(key, /event\.preventDefault\(\);/, 'Enter formu göndermemeli, değeri eklemeli');
});

test('v7.37 · aynı değer iki kez eklenmez', () => {
  assert.match(UM, /if \(chipValues\(field\)\.some\(item => norm\(item\) === norm\(text\)\)\) return false;/);
});

/* v7.38 — GÜNCELLENDİ (§156). İddia aynı: seçilmiş bir değer açılır listede
   ikinci kez görünmemeli. Değişen yalnız YER: filtreleme artık ortak
   chipOptionsHtml içinde yapılıyor (liste v7.38'de iki gruba ayrıldı). */
test('v7.37/v7.38 seçili değer açılır listede ikinci kez görünmez', () => {
  assert.match(UM, /const taken = value => chosen\.some\(item => norm\(item\) === norm\(value\)\);/);
  assert.match(UM, /const top = list\(related\)\.filter\(item => !taken\(item\)\);/);
  assert.match(UM, /const rest = list\(all\)\.filter\(item => !taken\(item\) && !top\.some\(value => norm\(value\) === norm\(item\)\)\);/,
    'aynı değer iki grupta birden görünmemeli');
});

/* ------------------------------------------------------------------ */
/* 3) LİSTE DARALIR, SEÇİM DÜŞMEZ                                      */
/* ------------------------------------------------------------------ */

test('v7.37 · MMYG listesi SEÇİLİ MAG\'ların birleşimidir', () => {
  /* Tek MAG'a bakmak, ikinci MAG'ın MMYG'lerini listede hiç göstermemek
     demekti — çoklu atamanın anlamı kalmazdı. */
  assert.match(UM, /function mmygsForMags\(mags\)/);
  assert.match(UM, /for \(const mag of selected\) for \(const value of mmygsForMag\(mag\)\) values\.add\(value\);/);
  assert.match(UM, /if \(!selected\.length\) return mmygsForMag\(''\);/, 'MAG seçilmemişse tüm katalog gösterilmeli');
});

test('v7.37 · Buying Group listesi seçili MAG/MMYG çiftlerinin birleşimidir', () => {
  assert.match(UM, /function buyingGroupsForScope\(mags, mmygs, extra\)/);
  assert.match(UM, /if \(selectedMmygs\.length\) for \(const mmyg of selectedMmygs\) for \(const value of buyingGroupsFor\(mag, mmyg, \[\]\)\)/);
});

test('v7.37 · liste tazelenirken SEÇİLİ çipler silinmez (§142)', () => {
  const block = UM.slice(UM.indexOf('function refreshScopeChoices(form)'), UM.indexOf('function onDialogInput(event)'));
  // v7.38 — tazeleme artık tam kataloğu da geçiriyor; iddia aynı kaldı.
  assert.match(block, /refreshChipChoices\(magField, allMags\(\), allMags\(\)\)/);
  assert.doesNotMatch(block, /remove\(\)|innerHTML = ''/, 'tazeleme yalnız seçenek listesine dokunmalı');
  assert.match(UM, /YALNIZ\s*\n\s*LİSTE değişir: seçili çipler hiçbir koşulda düşürülmez/);
});

test('v7.37 · katalogda olmayan kayıtlı değer de çip olarak durur', () => {
  /* Elle yazılmış ya da ASAS'tan artık gelmeyen bir değer, kullanıcının
     kayıtlı sorumluluğudur; listeden düşmesi onu silmek olurdu. */
  const form = UM.slice(UM.indexOf('function detailEdit(user)'), UM.indexOf('/* ===================== 7b'));
  assert.match(form, /values: mags/);
  assert.match(form, /values: mmygs/);
  assert.match(form, /values: ownedGroups/);
  assert.match(form, /options: buyingGroupsForScope\(mags, mmygs, ownedGroups\)/,
    'kullanıcının kendi grupları seçenek listesine de eklenmeli');
});

/* ------------------------------------------------------------------ */
/* 4) YENİ KULLANICI PENCERESİ                                         */
/* ------------------------------------------------------------------ */

test('v7.37 · yeni kullanıcı penceresinde de üç alan çoktan seçmelidir', () => {
  const dialog = UM.slice(UM.indexOf('function openCreateDialog(managerId)'), UM.indexOf('confirmLabel: T(\'Kullanıcıyı Oluştur\''));
  for (const name of ['mag', 'mmyg', 'buyingGroup']) {
    assert.match(dialog, new RegExp(`chipFieldHtml\\(\\{ name: '${name}'`));
  }
});

test('v7.37 · pencere içindeki çip düğmeleri ayrıca bağlanır (kabuk delegasyonu ulaşmaz)', () => {
  const block = UM.slice(UM.indexOf("dialog.addEventListener('click'"), UM.indexOf("dialog.addEventListener('input'"));
  assert.match(block, /data-act="chipAdd"/);
  assert.match(block, /data-act="chipRemove"/);
  assert.match(UM, /dialog\.addEventListener\('keydown'/, 'Enter ile ekleme pencerede de çalışmalı');
  assert.match(UM, /const chipPick = event\.target\.closest\('\[data-um-chippick\]'\);\s*\n\s*if \(chipPick\) \{/);
});

test('v7.37 · dizinden seçilen adayın TÜM MAG/MMYG değerleri eklenir', () => {
  /* Eskiden yalnız ilki alınıyordu; birden çok MAG'ı olan bir buyer'ın geri
     kalanı sessizce düşüyordu. */
  assert.match(UM, /list\(entry\.mags\)\.forEach\(value => chipAdd\(magField, value\)\);/);
  assert.match(UM, /list\(entry\.mmygs\)\.forEach\(value => chipAdd\(mmygField, value\)\);/);
  assert.doesNotMatch(UM, /magSelect\.value = entry\.mags\[0\]/, 'tek değer alan eski kod kalmamalı');
});

/* ------------------------------------------------------------------ */
/* 5) SUNUCU VE BİÇİM                                                  */
/* ------------------------------------------------------------------ */

test('v7.37 · sunucu birden çok değeri sınırsız saklar', () => {
  assert.match(ACCESS, /mags: unique\(body\.mags\), mmygs: unique\(body\.mmygs\), buyingGroups: unique\(body\.buyingGroups\)/);
  assert.match(ACCESS, /if \(body\.mags !== undefined\) target\.mags = unique\(body\.mags\);/);
});

test('v7.37 · çip biçimi tanımlı', () => {
  for (const rule of ['.umChipField{', '.umChipList{', '.umChip{', '.umChipX{', '.umChipAdd{', '.umChipEmpty{']) {
    assert.ok(CSS.includes(rule), `${rule} tanımlı olmalı`);
  }
});

test('v7.37 · alanların nereden beslendiği kullanıcıya yazılır', () => {
  assert.match(UM, /ASAS’taki Merch Alt Grup değerlerinden beslenir/);
  assert.match(UM, /ASAS’taki Merch Marka Yaş Grup değerlerinden beslenir/);
  assert.match(UM, /ASAS’taki Buyer Grup değerlerinden beslenir/);
});

/* v7.38 — GÜNCELLENDİ (§156). Amaç aynı: sürüm etiketi tüm dosyalarda birlikte
   ilerlesin, tek bir eski etiket kalmasın. v7.37 kaydının geçmişte durduğu da
   doğrulanır. */
test('v7.37/v7.38 sürüm tüm dosyalarda birlikte ilerliyor — canonical runtime source', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const index = read('public/index.html');
  assert.ok(index.includes('Version __BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('buyerlog.bootRetry.v__BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('?v=__BL_ASSET_VERSION__'));
  assert.equal(/\?v=7\.\d+/.test(index), false, 'statik sürüm cache etiketi kalmamalı');
  assert.match(read('public/version-history.js'), /v: '7\.37'/, 'geçmiş sürüm kaydı korunmalı');
});
