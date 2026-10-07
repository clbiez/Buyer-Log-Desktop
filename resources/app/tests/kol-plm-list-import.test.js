'use strict';
/* Koleksiyon › PLM ID Listesinden Ekle.
   - Saf motor (public/kol-plm-list-import.js) canlı test edilir.
   - LCW AI 'plm-id-extract' sözleşmesi tek AI yolundan (lcwai-prompt) geçer.
   - app-main.js akışı mevcut PLM SYNC ekleme hattını yeniden kullanır
     (kaynak sözleşmesi). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

globalThis.BLCanonicalFields = require('../public/canonical-fields.js');
const mapping = require('../public/excel-import-mapping.js');
const engine = require('../public/kol-plm-list-import.js');
const { normalizePlmId } = require('../server/lib/plm-id.js');
const prompts = require('../server/lib/lcwai/lcwai-prompt');

const APP = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const STORAGE = fs.readFileSync(path.join(__dirname, '../public/user-storage.js'), 'utf8');

const FIELDS = [
  { id: 'plmId', label: 'PLM ID', labelEn: 'PLM ID', canonicalId: 'plmId', aliases: ['PLM ID'] },
  { id: 'targetPrice', label: 'Target Price', labelEn: 'Target Price', canonicalId: globalThis.BLCanonicalFields.canonicalId('collection', 'targetPrice'), aliases: ['Target Price'] },
  { id: 'not', label: 'Notes', labelEn: 'Notes', canonicalId: globalThis.BLCanonicalFields.canonicalId('collection', 'not'), aliases: ['Notes'] },
];

test('PLM ID normalizasyonu sunucu plm-id.js ile birebir aynıdır', () => {
  for (const value of ['1234567', '_1234567', '1.234.567', '1234567.0', '0012345', '0', '', 'abc', '12a', '-5', 1234567, null, '7.10.2026']) {
    assert.equal(engine.normalizePlmId(value), normalizePlmId(value), String(value));
  }
});

test('yapıştırılan liste: ayırıcılar, tekrar, geçersiz ve başlık', () => {
  const parsed = engine.parseIdText('PLM Code\n1234567, 7654321;1234567\t12a 0 _987654 | 1.111.222');
  assert.deepEqual(parsed.ids, ['1234567', '7654321', '987654', '1111222']);
  assert.deepEqual(parsed.duplicates, ['1234567']);
  assert.deepEqual(parsed.invalid, ['12a', '0']);
  assert.equal(parsed.ignored, 2);
});

test('ön kontrol Koleksiyon’da olan ID’leri ayırır; büyük liste sunucu sınırında parçalanır', () => {
  const split = engine.classify(['1', '2', '3'], new Set(['2']));
  assert.deepEqual(split, { fresh: ['1', '3'], existing: ['2'] });
  const ids = Array.from({ length: 4500 }, (_, i) => String(100000 + i));
  assert.deepEqual(engine.chunk(ids, engine.FETCH_CHUNK_SIZE).map(part => part.length), [2000, 2000, 500]);
});

test('Excel/CSV: PLM sütunu ortak eşleme motoruyla bulunur, ek Buyer Log sütunları okunur', () => {
  const matrix = [['Drop 2 listesi'], ['PLM Code', 'Target Price', 'Notes'], ['_1.234.567', 4.5, 'ilk'], ['7654321', '', 'ikinci'], ['7654321', 9, 'tekrar'], ['abc', 1, '']];
  const layout = engine.detectSheet(matrix, FIELDS, mapping);
  assert.equal(layout.headerRow, 1);
  assert.equal(layout.plmIndex, 0);
  assert.deepEqual(layout.extras.map(extra => extra.fieldId), ['targetPrice', 'not']);
  const rows = engine.readSheetRows(matrix, layout, layout.extras);
  assert.deepEqual(rows.ids, ['1234567', '7654321']);
  assert.deepEqual(rows.duplicates, ['7654321']);
  assert.deepEqual(rows.invalid, ['abc']);
  assert.deepEqual(rows.valuesById, { 1234567: { targetPrice: 4.5, not: 'ilk' }, 7654321: { not: 'ikinci' } });
  // Seçilmeyen ek sütun yazılmaz.
  assert.deepEqual(engine.readSheetRows(matrix, layout, []).valuesById, {});
});

test('Excel/CSV: başlığı PLM’e benzeyen ama ID taşımayan sütun seçilmez; başlıksız tek sütun kabul edilir', () => {
  assert.equal(engine.detectSheet([['PLM ID'], ['Approved'], ['Open']], FIELDS, mapping), null);
  const bare = engine.detectSheet([['1234567'], ['7654321']], FIELDS, mapping);
  assert.equal(bare.headerRow, -1);
  assert.deepEqual(engine.readSheetRows([['1234567'], ['7654321']], bare, []).ids, ['1234567', '7654321']);
});

test('LCW AI adayı yalnız kaynak metinde gerçekten yazılıysa kabul edilir', () => {
  const text = 'Merhaba, PLM 1.234.567 ve 7654321 modellerini ekleyelim. Sipariş tarihi 07.10.2026.';
  const checked = engine.validateAiIds(['1234567', '9999999', '7654321', '1.234.567', 'abc'], text);
  assert.deepEqual(checked.accepted, ['1234567', '7654321']);
  assert.deepEqual(checked.rejected, ['9999999', 'abc']);
});

test('renk modu: her renk ayrı satır ya da PLM ID başına ilk renk', () => {
  const records = [{ plmId: '1', colors: [{ colorCode: 'A' }, { colorCode: 'B' }] }];
  assert.equal(engine.applyColourMode(records, 'each'), records);
  const single = engine.applyColourMode(records, 'single');
  assert.deepEqual(single[0].colors, [{ colorCode: 'A' }]);
  assert.equal(records[0].colors.length, 2, 'kaynak kayıt değişmez');
});

test('bekleyen liste: bulunamayan eklenir/deneme sayılır, bulunan çıkar', () => {
  let list = engine.updatePending([], { found: [], notFound: ['111111', '222222'] }, '2026-10-01T00:00:00Z');
  assert.deepEqual(list.map(item => [item.plmId, item.attempts]), [['111111', 1], ['222222', 1]]);
  list = engine.updatePending(list, { found: ['111111'], notFound: ['222222'] }, '2026-10-02T00:00:00Z');
  assert.deepEqual(list.map(item => [item.plmId, item.attempts, item.addedAt.slice(0, 10), item.lastTriedAt.slice(0, 10)]), [['222222', 2, '2026-10-01', '2026-10-02']]);
  assert.deepEqual(engine.removePending(list, ['222222']), []);
  assert.match(engine.pendingKey('user 1'), /^lcw\.koleksiyon\.plmPending\.user_1\.v1$/);
});

test('LCW AI plm-id-extract sözleşmesi tek AI yolundan geçer ve şekli denetlenir', () => {
  const contract = prompts.contractFor('plm-id-extract');
  assert.ok(contract);
  assert.equal(contract.fields.plmIds.required, true);
  const built = prompts.buildPrompt({ source: 'plm-id-extract', task: 'bul', context: { text: ['PLM 1234567'] }, lang: 'tr' });
  assert.equal(built.contract, 'plm-id-extract');
  assert.deepEqual(built.modules, ['collection']);
  assert.match(built.prompt, /"plmIds": string\[\]/);
  assert.match(built.prompt, /metinde olmayan atılır/);
  const ok = prompts.parseStructured('{"plmIds":["1234567",7654321],"explanation":"x"}', 'plm-id-extract');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.plmIds, ['1234567', '7654321']);
  // Boş liste geçerli bir cevaptır: istemci "0 ID bulundu" der, uydurma yapılmaz.
  assert.deepEqual(prompts.parseStructured('{"explanation":"x"}', 'plm-id-extract').data.plmIds, []);
});

test('Koleksiyon akışı mevcut PLM SYNC ekleme hattını yeniden kullanır', () => {
  assert.match(APP, /id:'import-list'/);
  assert.match(APP, /action==='import-list'\)await openKolPlmListImport\(root\)/);
  const run = APP.slice(APP.indexOf('async function kolPlmListImportRun('), APP.indexOf('async function openKolPlmListImport('));
  for (const step of ['kolPlmSyncFetchRecords(', 'kolPlmNormalizeAndTranslate(', 'kolBuildPlmImportPlan(', 'showKolPlmImportPreview(', 'kolResolvePlmExistingDecisions(', 'kolPushUndo()', 'kolLinkImportedColourVariants(', 'saveKolRows()', 'updatePending(']) {
    assert.ok(run.includes(step), step);
  }
  assert.doesNotMatch(run, /fetch\('\/api\/plm-sync\/fetch'/, 'ikinci PLM istemcisi yazılmaz');
  // Varsayılan/dosya değerleri yalnız yeni satırlara, PLM alanları hariç.
  const values = APP.slice(APP.indexOf('function kolPlmListApplyNewRowValues('), APP.indexOf('async function kolPlmListReadFile('));
  assert.match(values, /fieldId==='plmId'\|\|managed\.has\(fieldId\)/);
  assert.match(run, /kolPlmListApplyNewRowValues\(kolApplyNewModelDefaults\(migrateKolRow\(row\)\)/);
  // AI adayları doğrulanmadan listeye girmez.
  assert.match(APP, /source:'plm-id-extract'/);
  assert.match(APP, /validateAiIds\(Array\.isArray\(data\.plmIds\)/);
  // Bekleyen liste Model Detayları senkronundan sonra yeniden denenir.
  const flow = APP.slice(APP.indexOf('async function runPlmUpdateFlow('), APP.indexOf('async function runCollectionPlmUpdateFlow('));
  assert.match(flow, /if\(collection&&props\.details\)await kolPlmPendingAutoRetry\(root,language\)/);
});

test('motor app-main.js’ten önce yüklenir; kişisel anahtarlar kullanıcıya ayrılır', () => {
  const engineAt = HTML.indexOf('kol-plm-list-import.js');
  assert.ok(engineAt > 0 && engineAt < HTML.indexOf('app-main.js?v='));
  assert.ok(STORAGE.includes("'lcw.koleksiyon.plmPending.'"));
  assert.ok(STORAGE.includes("'lcw.koleksiyon.plmListOptions.'"));
});
