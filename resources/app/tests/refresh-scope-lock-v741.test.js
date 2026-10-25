'use strict';

/*
 * v7.41 — YENİLEME KİLİDİ YALNIZ YENİDEN ÇİZİLEN EKRANLARA KONUR
 *
 * Kullanıcı talebi (birebir):
 *   "Yenileme işlemi ile etkilenmeyecek alanları düzenlemeye kapatmayalım.
 *    Mesela CP yenilerken koleksiyon editlemesi kilitleniyor, gerek yok gibi.
 *    bir kontrol eder misin yenileme işlemi sırasında hangi alanlar edite açık
 *    kalabilir"
 *
 * DENETİMİN SONUCU (kodun kendisinden okundu, tahmin değil):
 *   · Yenileme başarıyla bittiğinde KOŞULSUZ olarak renderCP + renderOrders +
 *     renderOverview çalışır. Yani hedef ne olursa olsun bu üç ekran çizilir ve
 *     o sırada açık bir düzenleme kaybolur — bu üçü kapalı KALMALI.
 *   · lfl hedefi ayrıca LFL'yi, backlog hedefi (etkin sekmedeyse) Backlog'u çizer.
 *   · Koleksiyon, Nakliye, Ön Maliyet ve Otomasyonlar HİÇBİR yenileme yolunda
 *     çizilmez → yenileme boyunca düzenlemeye açık kalabilir. Kullanıcının
 *     bildirdiği gereksiz kilit buydu.
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *   1) v6.34'ün asıl güvencesi bozulmadı: çizilen tabloya yazılamaz.
 *   2) Çizilmeyen ekranlar açık kalır.
 *   3) Kilit bırakılırken tüm işaretler temizlenir (ekran kilitli kalmaz).
 *   4) Koleksiyon açıkken yapılan tazeleme, açık bir düzenlemeyi bozmaz (§142).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('public/app-main.js');
const CSS = require('./helpers/manifest-css')();
const INDEX = read('public/index.html');

/* Kaynaktan tek bir işlevi söker. ÖNCE parametre parantezi atlanır: varsayılan
   değerli bir parametre (options={}) süslü parantez içerir ve doğrudan süslü
   saymak imzayı gövde sanardı. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  let i = source.indexOf('(', start), paren = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')') { paren--; if (paren === 0) { i++; break; } }
  }
  while (i < source.length && source[i] !== '{') i++;
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const ch = source[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(start, j + 1); }
  }
  throw new Error(`${name} kapanmıyor`);
}
const frozenAreas = new Function(
  `${extractFunction(APP, 'refreshFrozenAreas')}
   ${APP.slice(APP.indexOf('const REFRESH_ALWAYS_REDRAWN'), APP.indexOf('function refreshFrozenAreas'))}
   return refreshFrozenAreas;`)();

/* ------------------------------------------------------------------ */
/* 1) DENETİM: HANGİ EKRAN GERÇEKTEN ÇİZİLİYOR                         */
/* ------------------------------------------------------------------ */

test('v7.41 · yenileme kilidi CP, Siparişler ve Genel Bakış için açık kaynak sözleşmesine dayanır', () => {
  assert.match(APP, /const REFRESH_ALWAYS_REDRAWN = \['cp', 'orders', 'overview'\];/);
  assert.match(APP, /cp: \[\.\.\.REFRESH_ALWAYS_REDRAWN\]/);
  assert.match(APP, /orders: \[\.\.\.REFRESH_ALWAYS_REDRAWN\]/);
  assert.match(APP, /overview: \[\.\.\.REFRESH_ALWAYS_REDRAWN\]/);
});

test('v7.41 · bu yüzden HER hedef CP/Siparişler/Genel Bakış’ı dondurur', () => {
  for (const target of ['cp', 'orders', 'overview', 'backlog', 'lfl', 'all']) {
    const areas = frozenAreas([target]);
    for (const always of ['cp', 'orders', 'overview']) {
      assert.ok(areas.includes(always), `${target} hedefi ${always} ekranını dondurmalı`);
    }
  }
});

test('v7.41 · Siparişler yenilemesi CP’yi de dondurur (v6.34 kusuru geri gelmesin)', () => {
  /* "cp hedefi yalnız CP'yi çizer" varsayımı, Siparişler yenilemesi sırasında
     CP'ye yazılan bir hücreyi kaybettirirdi. */
  assert.ok(frozenAreas(['orders']).includes('cp'));
});

test('v7.41 · LFL ve Backlog yalnız kendi hedeflerinde donar', () => {
  assert.ok(frozenAreas(['lfl']).includes('lfl'));
  assert.ok(!frozenAreas(['cp']).includes('lfl'), 'CP yenilemesi LFL’yi çizmez');
  assert.ok(frozenAreas(['backlog']).includes('backlog'));
  assert.ok(!frozenAreas(['orders']).includes('backlog'));
  const all = frozenAreas(['all']);
  assert.ok(all.includes('lfl') && all.includes('backlog'), 'tam yenileme ikisini de çizer');
});

test('v7.41 · KOLEKSİYON hiçbir hedefte donmaz — talebin özü', () => {
  for (const target of ['cp', 'orders', 'overview', 'backlog', 'lfl', 'all']) {
    assert.ok(!frozenAreas([target]).includes('koleksiyon'), `${target} hedefi Koleksiyon’u kilitlememeli`);
  }
});

test('v7.41 · Nakliye, Ön Maliyet ve Otomasyonlar da açık kalır', () => {
  const all = frozenAreas(['all']);
  for (const area of ['shipping', 'opencosting', 'automations']) {
    assert.ok(!all.includes(area), `${area} hiçbir yenileme yolunda çizilmiyor`);
  }
});

test('v7.41 · bilinmeyen hedef GÜVENLİ tarafa düşer (hepsini dondurur)', () => {
  const areas = frozenAreas(['bilinmeyen-hedef']);
  for (const area of ['cp', 'orders', 'overview', 'backlog', 'lfl']) assert.ok(areas.includes(area));
});

test('v7.41 · hedef verilmezse tam yenileme sayılır', () => {
  assert.deepEqual(frozenAreas([]).sort(), frozenAreas(['all']).sort());
  assert.deepEqual(frozenAreas(null).sort(), frozenAreas(['all']).sort());
});

/* ------------------------------------------------------------------ */
/* 2) YAZMA KAPILARI                                                   */
/* ------------------------------------------------------------------ */

test('v7.41 · yazma kapıları ALANA göre çalışır', () => {
  assert.match(APP, /function isAreaFrozen\(area\)\{ return _readOnlyMode && _readOnlyAreas\.includes\(String\(area \|\| ''\)\); \}/);
  assert.match(extractFunction(APP, 'commitCpEditor'), /if\(isAreaFrozen\('cp'\)\) return false;/);
  assert.match(extractFunction(APP, 'commitKolEditor'), /if\(isAreaFrozen\('koleksiyon'\)\)return false;/);
});

test('v7.41 · açık düzenleyici yalnız DONACAK alanda kapatılır', () => {
  /* Koleksiyon'da fiyat yazarken CP yenilemesi başladığında imlecin alandan
     atılması için bir sebep yok; o tablo yeniden çizilmiyor. */
  const fn = extractFunction(APP, 'commitOpenCellEditors');
  assert.match(fn, /const frozen = refreshFrozenAreas\(targets\);/);
  assert.match(fn, /if\(area && !frozen\.includes\(area\)\) return false;/);
  assert.match(APP, /commitOpenCellEditors\(targets\)/, 'çağrı hedefi geçmeli');
});

test('v7.41 · kabı bulunamayan düzenleyici yine kapatılır (güvenli taraf)', () => {
  const fn = extractFunction(APP, 'commitOpenCellEditors');
  assert.match(fn, /if\(area && !frozen\.includes\(area\)\)/, 'alan boşsa koşul çalışmaz, blur uygulanır');
});

/* ------------------------------------------------------------------ */
/* 3) İŞARETLEME VE CSS                                                */
/* ------------------------------------------------------------------ */

test('v7.41 · donan ekranların KABI işaretlenir, kural oradan okur', () => {
  const fn = extractFunction(APP, 'setReadOnlyMode');
  assert.match(fn, /document\.querySelectorAll\('main section\[id\^="view-"\]'\)/);
  assert.match(fn, /section\.setAttribute\('data-bl-frozen', ''\)/);
  assert.match(fn, /section\.removeAttribute\('data-bl-frozen'\)/);
  assert.match(CSS, /body\.bl-readonly \[data-bl-frozen\] \.editCell/);
  assert.match(CSS, /body\.bl-readonly \[data-bl-frozen\] \.kolPriceApprove/);
});

test('v7.41 · her ekranın kendi #view-* kabı var (işaretleme buna dayanır)', () => {
  for (const area of ['cp', 'orders', 'overview', 'koleksiyon', 'backlog', 'lfl', 'shipping']) {
    assert.ok(INDEX.includes(`id="view-${area}"`), `#view-${area} kabı bulunmalı`);
  }
});

test('v7.41 · kilit bırakılırken işaretler temizlenir', () => {
  const fn = extractFunction(APP, 'setReadOnlyMode');
  assert.match(fn, /else document\.body\.removeAttribute\('data-bl-refreshing'\);/);
  assert.match(APP, /window\.BL_REFRESH_BUSY='';\s*setReadOnlyMode\(false\)/);
});

test('v7.41 · şerit hangi alanların donduğunu ve diğerlerinin açık olduğunu yazar', () => {
  assert.match(APP, /yenileniyor — hiçbir giriş kaybolmasın diye YALNIZ bu alanlarda düzenleme duraklatıldı\. Diğer ekranlar açık\./);
  assert.match(APP, /editing is paused there so no entry is lost\. Other screens stay editable\./);
});

test('v7.41 · uyarı metni de donan alanı adıyla söyler', () => {
  const fn = extractFunction(APP, 'readOnlyGuard');
  assert.match(fn, /if\(area && !isAreaFrozen\(area\)\) return false;/);
  assert.match(fn, /_readOnlyAreas\.map\(areaLabel\)/);
});

/* ------------------------------------------------------------------ */
/* 4) KOLEKSİYON AÇIKKEN VERİ KAYBI YOK                                */
/* ------------------------------------------------------------------ */

test('v7.41 · yenileme sonrası Koleksiyon tazelemesi açık düzenlemeyi bozmaz (§142)', () => {
  /* Koleksiyon artık açık kaldığı için, yenilemenin sonundaki katalog
     tazelemesi renderKol çağırıyorsa o an yazılan hücreyi silerdi. */
  const block = APP.slice(APP.indexOf('async function ensureCollectionCatalogLoaded'), APP.indexOf('function setOrdersLoadingState'));
  assert.match(block, /#view-koleksiyon input,#view-koleksiyon textarea,#view-koleksiyon select/);
  // Koruma korundu, üstüne bir de deferRender geçidi eklendi: düzenleme
  // sırasında çizim yok, çağıran açıkça ertelemek istediğinde de yok.
  assert.match(block, /&&!kolEditing&&!options\.deferRender\)renderKol\(\);/);
  assert.match(block, /Filtre katalogları state'e yazılmış durumda/, 'ertelemenin veri kaybettirmediği yazılmalı');
});

/* v7.42 — GÜNCELLENDİ (§156). Amaç aynı: sürüm tüm dosyalarda BİRLİKTE ilerlesin.
   Sabit '7.41' beklemek bu testi her yükseltmede engele çevirirdi; artık sürüm
   package.json'dan okunuyor ve v7.41 kaydının geçmişte durduğu doğrulanıyor. */
test('v7.41/v7.42 · sürüm tüm dosyalarda birlikte ilerledi — canonical runtime source', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const index = INDEX;
  assert.ok(index.includes('Version __BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('buyerlog.bootRetry.v__BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('?v=__BL_ASSET_VERSION__'));
  assert.equal(/\?v=7\.\d+/.test(index), false, 'statik sürüm cache etiketi kalmamalı');
  assert.match(read('public/version-history.js'), /v: '7\.41'/, 'geçmiş sürüm kaydı korunmalı');
});
