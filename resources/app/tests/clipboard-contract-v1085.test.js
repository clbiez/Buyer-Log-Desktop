'use strict';

/* v10.85 — CP/COLLECTION/ORDERS: BİRLEŞİK DIŞ PANO SÖZLEŞMESİ (Packet 10).
 *
 * Üç bulgu:
 *  1) Koleksiyon'un kayıt-kaynaklı kopyalama yolu (buildCollectionStyledCopy,
 *     bkz. tests/*: "KOLEKSİYON KOPYALAMA — KAYITTAN, EKRANDAN DEĞİL") görsel
 *     sütununu BİLEREK boş bırakıyordu — CP aynı satırda gerçek <img> gömerken
 *     Koleksiyon hiç göstermiyordu.
 *  2) "1 model = 1 satır" kuralı zaten BLTableExport'un kendi garantisiydi
 *     (buildMatrix kayıt sayısı ≠ satır sayısı olursa fırlatır); bu paket
 *     bunu BOZMADAN görsel gömmeyi ekliyor (image için ekstra <tr> yok).
 *  3) navCopy düğmesi CP için grup başlık satırını (leafHeadersOnly) zaten
 *     atıyordu, Orders için atmıyordu — Orders kopyasına fazladan üst
 *     başlık satırı sızıyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} kapanmıyor`);
}

/* --------------------------------------------------- 1) ORDERS FAZLA BAŞLIK */

test('navCopy: Orders artık CP ile aynı şekilde yalnız gerçek sütun başlığını kopyalıyor', () => {
  assert.match(APP, /leafHeadersOnly:info\.tableKey==='cp'\|\|info\.tableKey==='orders'/);
  // Eski, Orders'ı dışlayan koşul artık kalmamalı.
  assert.ok(!APP.includes("leafHeadersOnly:info.tableKey==='cp'}"), 'eski dışlayıcı koşul kalmamalı');
});

/* -------------------------------------------------- 2) KOLEKSİYON GÖRSELİ */

test('kolRecordImageCopyCell: görsel DOM değil KAYITTAN çözülür, CP ile aynı dönüştürücüyü kullanır', () => {
  const fn = extractFunction(APP, 'kolRecordImageCopyCell');
  // The record resolver now enumerates durable/shared/cache candidates before
  // trying the same CP converter. Preserve that chain and the empty-cell rule.
  const sources = extractFunction(APP, 'kolModelImageSources');
  assert.match(sources, /canonicalModelImageSource\(row\.plmId,row\.colourCode,row\.colour\)/);
  assert.match(sources, /row\.img/);
  assert.match(sources, /row\.imgRef\?modelImageRefUrl\(row\.imgRef\)/);
  assert.match(fn, /for\(const source of kolModelImageSources\(row\)\)/);
  assert.match(fn, /_copyImageDataUrlFor\(\{modelId,colourCode,source,fallbackSource:source\}\)/);
  assert.match(fn, /if\(!row\)return null;/);
  assert.ok(fn.includes("if(/^data:image\\/(?:png|jpeg|webp|gif);base64,/i.test(dataUrl))break;"));
  assert.match(fn, /if\(!dataUrl\)return null;/);
});

test('_copyImageDataUrlFor: CP (DOM) ve Koleksiyon (kayıt) AYNI dönüştürücüyü paylaşıyor', () => {
  assert.match(APP, /async function _copyImageDataUrlFor\(\{modelId='',colourCode='',source='',fallbackSource=''\}=\{\}\)/);
  const domWrapper = extractFunction(APP, '_copyImageDataUrl(img)');
  assert.match(domWrapper, /return _copyImageDataUrlFor\(\{/);
});

test('buildCollectionStyledCopy: görsel hücresi TEK <td> içinde gömülür, ekstra <tr> açmaz', () => {
  const fn = extractFunction(APP, 'buildCollectionStyledCopy');
  assert.match(fn, /pictureCells=await Promise\.all\(records\.map\(kolRecordImageCopyCell\)\);/);
  assert.match(fn, /BLTableExport\.toHTML\(matrix,\{/);
  // Görsel artık toSafeHTML (yalnız kaçışlı metin) İLE DEĞİL, toHTML + cell
  // callback ile üretiliyor — böylece Picture hücresine gerçek <img> girebiliyor.
  assert.ok(!fn.includes('BLTableExport.toSafeHTML'), 'toSafeHTML artık kullanılmamalı (görseli hiç taşımıyordu)');
  // "1 kayıt = 1 satır" kuralı BLTableExport.buildMatrix'in kendi garantisi;
  // bu fonksiyon satır sayısını KAYIT sayısından bağımsız üretmiyor.
  assert.match(fn, /BLTableExport\.buildMatrix\(\{/);
  assert.match(fn, /matrix\.headers\.unshift\(L\('Picture'\)\);/);
});

test('görsel eksikse hücre boş kalır, kopyalama durmaz (mevcut davranışla tutarlı)', () => {
  const fn = extractFunction(APP, 'buildCollectionStyledCopy');
  assert.match(fn, /const picked=pictureCells&&pictureCells\[rowIndex\];/);
  assert.match(fn, /return picked\|\|\{style:cellStyle\};/);
});

test('diğer sütunlar kaçışlı ve tek-satır güvenli: etkileşimli Collection DOM\'u clipboard\'a girmiyor', () => {
  const fn = extractFunction(APP, 'buildCollectionStyledCopy');
  assert.match(fn, /const htmlCellText\s*=\s*value\s*=>\s*escapeHtml\(BLTableExport\.normalizeCell\(value\)\)/);
  assert.doesNotMatch(fn, /\.split\('\\n'\)\.map\(escapeHtml\)\.join\('<br>'\)/,
    'rich clipboard hücre içi satır sonlarını yeniden üretmemeli');
  assert.doesNotMatch(fn, /textContent|innerHTML|outerHTML/,
    'clipboard değeri etkileşimli DOM üzerinden okunmamalı');
});
