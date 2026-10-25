'use strict';

/* Modele bağlı varyant hücreleri düzenlemeye kapalı.
 *
 * Kullanıcı talebi: "Bir modelin alt rengi modele bağlanmışsa linklenmiş
 * hücrelerini düzenlemeye kapat. Sağ tık ile Make this field color specific
 * özelliği zaten var."
 *
 * KORUNAN KUSUR: eskiden bağlı bir hücreye yazmak bağı SESSİZCE koparıp renk
 * özelinde bir override yaratıyordu (kaynaktaki yorum: "Editing an inherited
 * child is an intentional colour-level override"). Kullanıcı o rengin artık
 * modelden beslenmediğini fark etmiyordu; model güncellenince o hücre geride
 * kalıyordu. Artık bağ yalnız sağ tık menüsünden bilerek koparılır.
 *
 * Üç kapı birden kapatıldı — biri açık kalsaydı kilit delinirdi:
 *   1) satır içi düzenleyici  → commitKolEditor
 *   2) yapıştırma             → kolSpreadsheetValidateValue
 *   3) çizim                  → disabled input + .kolLinkedCell
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
const SPREADSHEET = fs.readFileSync(path.join(ROOT, 'public', 'collection-spreadsheet.js'), 'utf8');

/* Yordamı kaynaktan çıkarıp GERÇEKTEN çalıştırıyoruz; metin eşleştirmesi
   bu kadar koşullu bir kuralda yanlış güven verirdi. */
function loadPredicate(rows) {
  const start = APP.indexOf('function kolCellLinkedToModel(row,key){');
  assert.ok(start > -1, 'kolCellLinkedToModel bulunamadı');
  const end = APP.indexOf('\n}', start);
  assert.ok(end > -1, 'gövde kapanmıyor');
  const body = APP.slice(start, end + 2);

  const colorSpecific = new Set(['colour', 'colourCode', 'quantity', 'img', 'imgRef', 'durum']);
  const projection = { endeksmatik:['endeksmatikData'], trLanded:['trPrice','trLandedMult','trFx'], ydLanded:['ydLandedMult'] };
  const overrideSpec = key => colorSpecific.has(key)
    ? { storageKeys:[key], alreadyColorSpecific:true, eligible:false }
    : { storageKeys:projection[key] || [key], eligible:true };
  const overrideKeys = key => overrideSpec(key).storageKeys;
  const factory = new Function('kolIsColorSpecific', 'kolColourOverrideSpec', 'kolColourOverrideStorageKeys', 'kolHasVariantOverride', 'kolRows', 'window', `${body} return kolCellLinkedToModel;`);
  return factory(
    (key) => colorSpecific.has(key),
    overrideSpec,
    overrideKeys,
    (row,key) => Boolean(row && row.variantOverrides && Object.prototype.hasOwnProperty.call(row.variantOverrides,key)),
    rows,
    { BLCollectionModelGroups: { groupFor: (all, id) => all.filter(r => String(r.modelGroupId) === String(id)) } },
  );
}

const parent = { id: 1, modelGroupId: 'g1', modelGroupRole: 'parent' };
const variant = { id: 2, modelGroupId: 'g1', modelGroupRole: 'variant' };
const GROUP = [parent, variant];

test('varyantın miras alınan hücresi BAĞLI sayılır', () => {
  const linked = loadPredicate(GROUP);
  assert.equal(linked(variant, 'fabric'), true);
});

test('override konmuş hücre bağlı değildir — kullanıcı bağı zaten koparmış', () => {
  const linked = loadPredicate(GROUP);
  const withOverride = { ...variant, variantOverrides: { fabric: 'X' } };
  assert.equal(linked(withOverride, 'fabric'), false,
    'Sağ tık ile renk özelinde yapılan alan yeniden kilitlenirse kullanıcı onu hiç düzenleyemez');
});

test('renk özelindeki alanlar hiçbir zaman bağlı değildir', () => {
  const linked = loadPredicate(GROUP);
  for (const key of ['colour', 'colourCode', 'quantity']) {
    assert.equal(linked(variant, key), false, `${key} rengin kendi alanı`);
  }
});

test('model (parent) satırı kilitlenmez — paylaşılan değeri o düzenler', () => {
  const linked = loadPredicate(GROUP);
  assert.equal(linked(parent, 'fabric'), false);
});

test('gruba girmemiş tek satır kilitlenmez', () => {
  const solo = { id: 9, modelGroupId: 'g9', modelGroupRole: 'variant' };
  const linked = loadPredicate([solo]);
  assert.equal(linked(solo, 'fabric'), false, 'grupta tek satır varsa bağ da yok');
});

test('kapı 1 — satır içi düzenleyici reddediyor ve bunu undo yazmadan ÖNCE yapıyor', () => {
  const start = APP.indexOf('function commitKolEditor(');
  const guard = APP.indexOf('kolCellLinkedToModel(row,k)', start);
  const undo = APP.indexOf('kolPushUndo()', start);
  assert.ok(guard > -1, 'commitKolEditor bağlı hücreyi kontrol etmiyor');
  assert.ok(guard < undo, 'kontrol undo kaydından sonra: reddedilen düzenleme geri-al yığınına çöp bırakır');
});

test('kapı 2 — yapıştırma reddediyor', () => {
  const start = APP.indexOf('function kolSpreadsheetValidateValue(');
  const end = APP.indexOf('\nfunction kolSpreadsheetMakeEditor(', start);
  assert.ok(start > -1 && end > start, 'kolSpreadsheetValidateValue bulunamadı');
  const block = APP.slice(start, end);
  /* v7.81 — trLanded/Endeksmatik/Picture'ın kendi özel yapıştırma dalları
     eklendiğinde fonksiyon büyüdü; kontrol artık iki biçimde görünüyor:
     Endeksmatik/Picture doğrudan `key` ile (kendileri hedef alan), diğer
     tüm alanlar `targetKey` ile (trLanded → trPrice yönlendirmesi dahil). */
  assert.match(block, /kolCellLinkedToModel\(row,key\)\)return \{ok:false,reason:'linked'\}/,
    'Endeksmatik/Picture dalı bağlı hücreyi kontrol etmiyor');
  assert.match(block, /kolCellLinkedToModel\(row,targetKey\)\)return \{ok:false,reason:'linked'\}/,
    'genel dal (trLanded→trPrice dahil) bağlı hücreyi kontrol etmiyor');
});

test("'linked' geçersiz değer değil, salt okunur sayılır", () => {
  /* Yanlış kovaya düşerse yapıştırma önizlemesi kullanıcıya "geçersiz değer"
     der; oysa değer geçerli, hücre kilitli. */
  assert.ok(SPREADSHEET.includes("result?.reason==='linked'"),
    'targetPlan linked nedenini tanımıyor');
});

test('kapı 3 — çizim bağlı hücrenin düzenleyicisini kapatıyor', () => {
  assert.match(APP, /tr\[data-model-group-role="variant"\]/);
  assert.match(APP, /td\.classList\.add\('kolLinkedCell'\)/);
  assert.match(APP, /el\.disabled=true/);
  assert.match(CSS, /\.kolLinkedCell\{/);
});

test('sessizce override yaratan eski dal kaldırıldı', () => {
  /* Yorumlar ayıklanır: bu dosyadaki açıklama yorumları aynı cümleyi anıyor
     (CLAUDE.md §2'de kayıtlı tuzak). */
  const code = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');
  assert.ok(!code.includes('setVariantOverride(kolRows,row.id,k,val)'),
    'commitKolEditor hâlâ otomatik override yaratıyor — kilit delinir');
  /* Sağ tık yolu DURMALI: bağı koparmanın tek meşru yolu o. */
  assert.match(APP, /function kolMakeFieldColorSpecific\(/);
  assert.match(APP, /api\.setVariantOverride\(kolRows,row\.id,key/);
});
