'use strict';

/* Koleksiyon: Price / Endeksmatik / TR Landed / Picture hücrelerinde
 * Ctrl+C / Ctrl+V.
 *
 * Kullanıcı talebi: "Koleksiyondaki Price, Endeksmatik, TR landed, picture,
 * hücrelerini de CTRL+C / CTRL+V ile kopyala yapıştır yapabilmek istiyorum."
 *
 * ÖLÇÜLEN DURUM (canlı uygulamada, bu görevden önce): genel modalOpen()
 * düzeltmesi (v7.81) sayesinde Best Price / Conf. Manufacturer / Conf. FOB /
 * Endeksmatik hücrelerinde KOPYALAMA zaten çalışıyordu — kolSpreadsheetRawValue
 * bu dördü için gerçek değer döndürüyor. Yalnız Picture kopyalaması boş
 * dönüyordu (rawValue '__picture__' için '' sabitiydi) ve YAPIŞTIRMA hepsinde
 * kapalıydı (meta.editable=false, "calculated"/"system").
 *
 * KULLANICI KARARI (AskUserQuestion):
 *   - Best Price / Conf. Manufacturer / Conf. FOB: yalnız kopyalama.
 *     Bunlar tekliflerden HESAPLANIYOR; saklı bir alanları yok, yazılacak
 *     bir yer yok. Yapıştırma reddedilmeye devam eder.
 *   - TR Landed: yapıştırılan tek değer trPrice'a (TL fiyatı) yazılır —
 *     hesabın tek zorunlu girdisi; diğer ikisi (çarpan, kur) dokunulmaz.
 *   - Picture: yapıştırma AYNI görseli hedef satır(lar)a uygular — az önce
 *     kaldırılan Endeksmatik sürükle-kopyala ile aynı fikir, farklı tetik.
 *   - Endeksmatik: yapıştırma kaynak satırın TÜM sonuç nesnesini (fiyat +
 *     endeks + referans dönem + sınıflandırma anlık görüntüsü) hedefe
 *     kopyalar. Pano yalnız METİN taşıdığı için eşleşme METİN üzerinden
 *     yapılır; eşleşmezse reddedilir — asla uydurma sonuç üretilmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

/* --- 1) KOPYALAMA: rawValue dört türde de değer döndürüyor, Picture da artık --- */

test('kolSpreadsheetRawValue: Picture artık boş dönmüyor — img URL kopyalanabiliyor', () => {
  const start = APP.indexOf('function kolSpreadsheetRawValue(row,key){');
  assert.ok(start > -1, 'kolSpreadsheetRawValue bulunamadı');
  const block = APP.slice(start, start + 300);
  assert.doesNotMatch(block, /if\(key==='__picture__'\)return '';/,
    'Picture kopyalaması hâlâ boş sabit döndürüyor');
  assert.match(block, /if\(key==='__picture__'\)return row\.img\|\|'';/);
});

test('kolSpreadsheetRawValue: Best/Conf/Endeksmatik/TR Landed dalları duruyor (regresyon kilidi)', () => {
  const start = APP.indexOf('function kolSpreadsheetRawValue(row,key){');
  const block = APP.slice(start, start + 800);
  assert.match(block, /d\.kind==='best'.*kolBestPricing\(row\)/);
  assert.match(block, /d\.kind==='confirmedName'.*kolConfirmedDisplay\(row\)/);
  assert.match(block, /d\.kind==='confirmedPrice'.*kolConfirmedDisplay\(row\)/);
  assert.match(block, /c\.endeksmatik.*endeksmatikExcelText\(kolEffectiveEndeksmatikRow\(row\)\)/);
});

/* --- 2) YAPIŞTIRMA: Best/Conf. — kasıtlı olarak KAPALI --- */

test('Best Price / Conf. Manufacturer / Conf. FOB yapıştırma reddedilmeye devam ediyor', () => {
  /* Bunlar CALCULATED_FIELDS içinde (collection-model-groups.js); meta.editable
     hep false. validateValue'da özel bir dal AÇILMADI — yanlışlıkla yazılabilir
     hâle gelmediklerini doğrudan kaynaktan doğrula. */
  const modelGroups = fs.readFileSync(path.join(ROOT, 'public', 'collection-model-groups.js'), 'utf8');
  assert.match(modelGroups, /CALCULATED_FIELDS = new Set\(\[[^\]]*'__bestPrice__'[^\]]*'__confirmedName__'[^\]]*'__confirmedPrice__'/);
  const start = APP.indexOf('function kolSpreadsheetValidateValue(');
  const end = APP.indexOf('\nfunction kolSpreadsheetMakeEditor(', start);
  const block = APP.slice(start, end);
  assert.doesNotMatch(block, /__bestPrice__/, 'Best Price için özel bir yapıştırma dalı açılmış — kasıtsız mı?');
  assert.doesNotMatch(block, /__confirmedName__/);
  assert.doesNotMatch(block, /__confirmedPrice__/);
});

/* --- 3) YAPIŞTIRMA: TR Landed → trPrice --- */

function loadValidateValue() {
  const start = APP.indexOf('function kolSpreadsheetValidateValue(');
  const end = APP.indexOf('\nfunction kolSpreadsheetMakeEditor(', start);
  assert.ok(start > -1 && end > start, 'kolSpreadsheetValidateValue bulunamadı');
  return APP.slice(start, end);
}

test('TR Landed yapıştırma kararı kaynakta trPrice\'a yönlendiriyor', () => {
  const block = loadValidateValue();
  assert.match(block, /const targetKey=key==='trLanded'\?'trPrice':key;/,
    'trLanded artık trPrice\'a yönlendirilmiyor — kullanıcı kararı bozulmuş');
  assert.match(block, /kolSpreadsheetColumnMeta\(targetKey\)/);
});

test('TR Landed yapıştırma sayısal olmayan TL fiyatını reddediyor', () => {
  /* ÖLÇÜLEN GERÇEK HATA (bu görevde bulundu): trPrice'ın col nesnesi
     (KOL_STYLE_EXTRA_FIELDS) money:true DEĞİL moneyLocal:true taşıyor.
     Genel doğrulama c?.money||c?.percent||c?.hologram'a bakıyordu — trPrice
     hiçbirini taşımadığı için "abc" gibi sayısal olmayan bir yapıştırma
     doğrulamadan geçip trPrice'a yazılırdı. meta.type (kolSpreadsheetColumnMeta
     tarafından kaynaktan bağımsız normalize edilir) trPrice için 'money'
     döndürüyor; bu ek şart açığı kapatıyor. */
  const block = loadValidateValue();
  assert.match(block,
    /if\(\(c\?\.money\|\|c\?\.percent\|\|c\?\.hologram\|\|meta\.type==='money'\)&&raw&&!Number\.isFinite\(kolParseMoneyNum\(raw\)\)\)return \{ok:false,reason:'invalid-number'\};/,
    'meta.type==\'money\' ek şartı kayboldu — trPrice yapıştırması yine doğrulamasız');

  /* Doğrudan çalıştırarak da doğrula: sahte meta.type='money' ile "abc" reddedilmeli. */
  const check = new Function('c', 'meta', 'raw', 'kolParseMoneyNum', `
    if((c?.money||c?.percent||c?.hologram||meta.type==='money')&&raw&&!Number.isFinite(kolParseMoneyNum(raw))) return 'invalid-number';
    return 'ok';
  `);
  const parseMoneyLike = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
  assert.equal(check({ moneyLocal: true }, { type: 'money' }, 'abc', parseMoneyLike), 'invalid-number');
  assert.equal(check({ moneyLocal: true }, { type: 'money' }, '123,45', parseMoneyLike), 'ok');
});

/* --- 4) YAPIŞTIRMA: Picture --- */

test('Picture yapıştırma kararı kaynakta duruyor: metin eşleşen kaynağın img+imgRef çifti kopyalanıyor', () => {
  const block = loadValidateValue();
  assert.match(block, /if\(key==='__picture__'\)\{/);
  assert.match(block, /kolRows\.find\(r=>r\.img===text\)/,
    'Picture kaynağı birebir metin eşleşmesiyle bulunmuyor — rastgele metin görsel kabul edilebilir');

  const startBatch = APP.indexOf('function kolSpreadsheetBatchEdit(');
  const endBatch = APP.indexOf('\nfunction kolSpreadsheetSetColumnWidth(', startBatch);
  const batchBlock = APP.slice(startBatch, endBatch);
  assert.match(batchBlock, /op\.key==='__picture__'/);
  assert.match(batchBlock, /row\.img=source\.img\|\|'';row\.imgRef=source\.imgRef\|\|'';/,
    'img ve imgRef BİRLİKTE kopyalanmıyor — biri eksik kalırsa kırık görsel referansı oluşur');
});

/* --- 5) YAPIŞTIRMA: Endeksmatik --- */

test('Endeksmatik yapıştırma kararı kaynakta duruyor: kaynak satırın TÜM sonuç nesnesi kopyalanıyor', () => {
  const block = loadValidateValue();
  assert.match(block, /if\(key==='endeksmatik'\)\{/);
  assert.match(block, /kolRows\.map\(r=>kolEffectiveEndeksmatikRow\(r\)\)\.find\(r=>r\.endeksmatikData\?\.result&&norm\(endeksmatikExcelText\(r\)\)===norm\(text\)\)/,
    'Endeksmatik kaynağı effective inherited değer üzerinden bulunamıyor veya normalize edilmiş metinle karşılaştırmıyor');

  const startBatch = APP.indexOf('function kolSpreadsheetBatchEdit(');
  const endBatch = APP.indexOf('\nfunction kolSpreadsheetSetColumnWidth(', startBatch);
  const batchBlock = APP.slice(startBatch, endBatch);
  assert.match(batchBlock, /op\.key==='endeksmatik'/);
  assert.match(batchBlock, /sourceData=source\?kolEffectiveValue\(source,'endeksmatikData'\):null/,
    'Endeksmatik kopyalama linked source için effective persisted nesneyi okumuyor');
  assert.match(batchBlock, /kolWriteGroupedStorageValue\(row,'endeksmatikData',JSON\.parse\(JSON\.stringify\(sourceData\)\)\)/,
    'Endeksmatik derin kopyası canonical group persistence yolundan yazılmıyor');
});

test('Endeksmatik eşleşme metni Engine.tsv() ile aynı satır-sonu dönüşümünden geçiyor', () => {
  /* Endeksmatik hücresinin kopyalanan metni İKİ SATIRLIDIR (fiyat + endeks,
     \n ile ayrılmış). Engine.tsv() panoya yazarken gömülü \n'i BOŞLUĞA
     çevirir (aksi halde tek hücre iki pano satırına bölünürdü). Karşılaştırma
     bu dönüşümü UYGULAMAZSA hiçbir Endeksmatik yapıştırması asla eşleşmez —
     ölçülüp düzeltilen gerçek bir hata (ilk yazımda kaçırıldı). */
  const engine = fs.readFileSync(path.join(ROOT, 'public', 'collection-spreadsheet-engine.js'), 'utf8');
  assert.match(engine, /replace\(\/\\r\?\\n\/g,' '\)/, 'Engine.tsv() satır-sonu dönüşümü referans olarak bulunamadı');

  const block = loadValidateValue();
  assert.match(block, /const norm=v=>String\(v\|\|""\)\.replace\(\/\\r\?\\n\/g," "\);/,
    'norm() aynı \\r?\\n → boşluk dönüşümünü yapmıyor');
});

test('Endeksmatik: eşleşen kaynak bulunamazsa reddedilir, uydurma sonuç üretilmez', () => {
  const block = loadValidateValue();
  const endeksIdx = block.indexOf("if(key==='endeksmatik'){");
  const endeksEnd = block.indexOf('  const targetKey=', endeksIdx);
  const endeksBlock = block.slice(endeksIdx, endeksEnd > -1 ? endeksEnd : endeksIdx + 800);
  assert.match(endeksBlock, /if\(!source\)return \{ok:false,reason:'invalid'\};/);
  assert.doesNotMatch(endeksBlock, /new Object|\{result:/,
    'DOKÜMANTASYON: eşleşme yoksa kod bir sonuç nesnesi FABRİKASYONU yapmamalı');
});

/* --- 6) linked kilit üç yeni dalı da kapsıyor --- */

test('trLanded/endeksmatik/picture yapıştırması da modele bağlı hücre kilidinden geçiyor', () => {
  const block = loadValidateValue();
  const hits = (block.match(/kolCellLinkedToModel\(/g) || []).length;
  assert.ok(hits >= 3, `3 yeni dal + genel dal en az 3 kolCellLinkedToModel çağrısı beklerdi, bulunan: ${hits}`);
});
