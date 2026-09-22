'use strict';

/* v6.42 — Koleksiyon: yeni durum, duplicate seçim temizliği, Endeksmatik
 * sürükle-kopyala, Endeksmatik/Overseas Landed dışa aktarım eksikleri.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'design-butunluk.css'), 'utf8');
const STATUS_CATALOG = require('../public/collection-status-catalog.js');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* ---------------------------------------------------- 1) DUMMY PO PLACED */

test('v6.42 "Dummy PO Placed" canonical status kataloğunda ve İngilizce karşılığı var', () => {
  const opts = STATUS_CATALOG.seed().map(entry=>entry.name);
  assert.ok(opts.includes('Dummy PO Placed'));
  assert.match(APP, /'Dummy PO Placed':'Dummy PO Placed',/);
});

test('v6.42 status Excel rengi artık canonical katalog resolverından gelir', () => {
  const entry=STATUS_CATALOG.seed().find(item=>item.name==='Dummy PO Placed');
  assert.ok(entry);
  assert.match(entry.color,/^#[0-9A-F]{6}$/i);
  assert.equal(STATUS_CATALOG.toArgb(entry.color).length,8);
  assert.match(APP,/kolStatusExcelArgb/);
  assert.doesNotMatch(APP,/const pal = \{/);
});

/* -------------------------------------------------- 2) DUPLICATE SEÇİM TEMİZLİĞİ */

test('v6.42 duplicate sonrası hiçbir satır seçili kalmıyor', () => {
  const body = bodyOf(APP, 'duplicateKolSelectedRows');
  // Eski davranış: kolSelected=new Set(plan.newIds) — yeni satırları seçiyordu.
  assert.doesNotMatch(body, /kolSelected=new Set\(plan\.newIds\)/);
  assert.match(body, /kolSelected=new Set\(\);/);
});

/* --------------------------- 3) ENDEKSMATIK SÜRÜKLE-KOPYALA — KALDIRILDI */

/* v7.81 — Endeksmatik hücresinin sağ alt köşesindeki sürükle-kopyala noktası
   kullanıcı talebiyle kaldırıldı. Burada duran dört test tutamacın VARLIĞINI
   kilitliyordu (markup, pointerup dinleyicisi, boş kaynak koruması, konum
   CSS'i); hepsi artık yanlış kararı savunuyordu. Yerlerine kaldırmanın
   kalıcı olduğunu kilitleyen tek bir test kondu: özellik sessizce geri
   gelirse burası söyler.

   Kaldırılmayan: hücrenin kendisi ve tıklayınca açılan Endeksmatik
   penceresi duruyor — kaldırılan yalnız sürükleyerek çoğaltma. */
test('v7.81 Endeksmatik sürükle-kopyala tutamacı geri gelmedi', () => {
  assert.doesNotMatch(APP, /endeksmatikFillHandle/);
  assert.doesNotMatch(APP, /_kolEndeksmatikDrag/);
  assert.doesNotMatch(APP, /attachKolEndeksmatikDragCopy/);
  assert.doesNotMatch(CSS, /endeksmatikFillHandle|kolEndeksmatikDragging/);
  // Hücre ve detay penceresi yerinde:
  assert.match(APP, /function endeksmatikCellHtml\(/);
  assert.match(APP, /data-endeksmatik-id/);
});

/* -------------------------------------------- 4) ENDEKSMATIK EXCEL DIŞA AKTARIM */

test('v6.42 Excel dışa aktarımı ekrandaki iki satırı (fiyat + index) taşıyor', () => {
  // Eskiden yalnız endeksmatikCompactText (tek satır fiyat) kullanılıyordu;
  // index satırı Excel'e hiç gitmiyordu. Kopyalama yolu zaten doğruydu, ikisi
  // artık aynı kaynağı (endeksmatikExcelText) kullanıyor.
  const exportBlock = APP.slice(APP.indexOf('function buildKolStyledSheet'), APP.indexOf('function buildKolStyledSheet') + 3000);
  assert.match(exportBlock, /v6\.42[\s\S]*const textValue=endeksmatikExcelText\(r\);/);
  assert.doesNotMatch(exportBlock, /const textValue=endeksmatikCompactText\(r\);/);
});

/* ---------------------------------------------- 5) OVERSEAS LANDED KÂR YÜZDESİ */

test('v6.42 kâr yüzdesi kopyalama metnine ekleniyor, sayısal yapıştırmaya karışmıyor', () => {
  const body = bodyOf(APP, 'kolLandedCopyAttrs');
  assert.match(body, /const profit=profitPct==null\|\|!Number\.isFinite\(Number\(profitPct\)\)\?null:Number\(profitPct\);/);
  // data-copy-num hâlâ SAF landed değeri olmalı; kâr yalnız metne eklenir.
  assert.match(body, /data-copy-num="\$\{escapeHtml\(num\.toFixed\(2\)\)\}"/);
  assert.match(body, /suffix/);
});

test('v6.42 Overseas Landed çağrısı kâr argümanını geçiyor, TR Landed geçmiyor', () => {
  assert.match(APP, /kolLandedCopyAttrs\(k\.ydLanded,profit\)/);
  assert.match(APP, /kolLandedCopyAttrs\(k\.trLanded\)\}/);
});

test('v6.42 Excel notunda da kâr yüzdesi yer alıyor', () => {
  const block = APP.slice(APP.indexOf("else if(c.ydLanded){if(landed&&Number.isFinite(landed.ydLanded))"));
  const slice = block.slice(0, block.indexOf('else if(c.trLanded)'));
  assert.match(slice, /landed\.profitPct/);
  assert.match(slice, /Advantage vs TR Landed|TR Landed.*göre avantaj/);
});

test('v6.42 kâr metni kesme işaretiyle dizgiyi bozmuyor', () => {
  // TUZAK (v3.55/v3.63/v6.40 dersi): kesme işaretli TR metni kaçışsız bir
  // dizginin içine konursa dosya SÖZDİZİMSEL olarak çöker. node --check zaten
  // yakalar; burada üretilen metnin doğru olduğunu da doğruluyoruz.
  const note = new Function("return 'TR Landed\u2019a göre avantaj';")();
  assert.equal(note, 'TR Landed\u2019a göre avantaj');
  assert.doesNotMatch(APP, /TR Landed\\'a göre avantaj/, 'kaçışlı tek tırnak kalmamalı');
});
