'use strict';

/*
 * KULLANICI EXCEL'İ İÇERİ AKTARMA — PROFİLLER VE BAĞLANTI SÖZLEŞMESİ
 *
 * Çivilenen davranışlar:
 *   1) Eşleme profili KULLANICIYA ve MODÜLE aittir; başka kullanıcının veya
 *      başka modülün profili listelenmez.
 *   2) Profil yalnız YAPILANDIRMA saklar; çalışma kitabı verisi saklanmaz.
 *   3) Aynı şemada ön doldurma çalışır; şema değiştiyse gözden geçirme
 *      ZORUNLU olur ve profil kendiliğinden ÇALIŞMAZ.
 *   4) Profil deposu Buyer Log'un mevcut kullanıcı senkron listesindedir.
 *   5) CP ve Koleksiyon AYNI motoru ve AYNI sihirbazı kullanır; ayrı ikinci
 *      bir içe aktarma yolu yoktur.
 *   6) Sihirbaz onaydan ÖNCE hiçbir yazma yapmaz ve uygulamadan hemen önce
 *      planı yeniden doğrular.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
// Yorum satırları kanıt değildir: olumsuz iddialar yorumsuz kaynakta aranır.
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/* ---------------- PROFİLLER ---------------- */

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    _map: map,
  };
}

const Profiles = require('../public/excel-import-profiles.js');

test('profil kullanıcıya ve modüle aittir', () => {
  globalThis.BLStorage = memoryStorage();
  globalThis.BL_USER_CONTEXT = { id: 'ayse' };
  Profiles.save('collection', { name: 'Ayşe koleksiyon', sheetName: 'S1', headerRow: 0, fingerprint: 'wb1:a', columnKeys: ['PLM ID'], assignments: {}, matchFieldIds: ['plmId'] });
  Profiles.save('cp', { name: 'Ayşe CP', sheetName: 'S1', headerRow: 0, fingerprint: 'wb1:a', columnKeys: ['ORDER CODE'], assignments: {}, matchFieldIds: ['Order Code'] });
  assert.equal(Profiles.list('collection').length, 1);
  assert.equal(Profiles.list('cp').length, 1);
  assert.equal(Profiles.list('collection')[0].name, 'Ayşe koleksiyon');

  globalThis.BL_USER_CONTEXT = { id: 'mehmet' };
  assert.equal(Profiles.list('collection').length, 0, 'başka kullanıcının profili görünmez');
});

test('profilde yalnız yapılandırma saklanır, çalışma kitabı verisi saklanmaz', () => {
  globalThis.BLStorage = memoryStorage();
  globalThis.BL_USER_CONTEXT = { id: 'ayse' };
  const saved = Profiles.save('collection', {
    name: 'Fiyat listesi', sheetName: 'Fiyat', headerRow: 2, fingerprint: 'wb1:x',
    columnKeys: ['PLM ID', 'TARGET PRICE'],
    assignments: { 'col:0': { targetId: 'plmId', headerKey: 'PLM ID' } },
    matchFieldIds: ['plmId'], options: { blankClears: true },
    rows: [{ secret: 'iş verisi' }], password: 'gizli',   // saklanmamalı
  });
  assert.equal(saved.rows, undefined);
  assert.equal(saved.password, undefined);
  assert.equal(saved.headerRow, 2);
  assert.equal(saved.options.blankClears, true);
  const raw = globalThis.BLStorage.getItem('bl.excelImport.profiles.collection.v1');
  assert.ok(raw.indexOf('iş verisi') < 0);
  assert.ok(raw.indexOf('gizli') < 0);
});

test('aynı şema birebir eşleşir, değişen şema gözden geçirme ister', () => {
  globalThis.BLStorage = memoryStorage();
  globalThis.BL_USER_CONTEXT = { id: 'ayse' };
  Profiles.save('collection', {
    name: 'Standart', sheetName: 'S1', headerRow: 0, fingerprint: 'wb1:aaa',
    columnKeys: ['PLM ID', 'TARGET PRICE'],
    assignments: {
      'col:0': { targetId: 'plmId', headerKey: 'PLM ID' },
      'col:1': { targetId: 'targetPrice', headerKey: 'TARGET PRICE' },
    },
    matchFieldIds: ['plmId'],
  });
  const fields = [{ id: 'plmId' }, { id: 'targetPrice' }];

  const exact = Profiles.match('collection', { fingerprint: 'wb1:aaa', sheetName: 'S1', columnKeys: ['PLM ID', 'TARGET PRICE'] });
  assert.equal(exact.length, 1);
  assert.equal(exact[0].quality, 'exact');
  const appliedExact = Profiles.applyProfile(exact[0].profile, [
    { id: 'col:0', key: 'PLM ID' }, { id: 'col:1', key: 'TARGET PRICE' },
  ], fields);
  assert.equal(appliedExact.requiresReview, false);
  assert.equal(appliedExact.assignments['col:0'].targetId, 'plmId');

  // Sütun kaymış ve biri kaybolmuş: yalnız güvenli alan doldurulur.
  const changed = Profiles.applyProfile(exact[0].profile, [
    { id: 'col:0', key: 'BAŞKA' }, { id: 'col:1', key: 'PLM ID' },
  ], fields);
  assert.equal(changed.requiresReview, true);
  assert.equal(changed.assignments['col:1'].targetId, 'plmId', 'başlık anahtarıyla bulunur');
  assert.ok(changed.missing.includes('TARGET PRICE'));

  // Hedef alan artık yoksa eşleme düşürülür, uydurulmaz.
  const dropped = Profiles.applyProfile(exact[0].profile, [
    { id: 'col:0', key: 'PLM ID' }, { id: 'col:1', key: 'TARGET PRICE' },
  ], [{ id: 'plmId' }]);
  assert.equal(dropped.requiresReview, true);
  assert.equal(dropped.assignments['col:1'], undefined);
});

test('profil deposu kullanıcı senkron listesine kayıtlıdır', () => {
  assert.match(read('public/user-storage.js'), /'bl\.excelImport\.profiles\.'/);
  assert.equal(Profiles.PREFIX, 'bl.excelImport.profiles.');
});

/* ---------------- BAĞLANTI SÖZLEŞMESİ ---------------- */

const WIZARD = read('public/excel-import-wizard.js');
const APP = read('public/app-main.js');
const INDEX = read('public/index.html');
const SERVER = require('./helpers/server-source')();

test('CP ve Koleksiyon aynı motoru ve aynı sihirbazı kullanır', () => {
  assert.match(INDEX, /data-excel-import="cp"/);
  assert.match(INDEX, /data-excel-import="collection"/);
  ['excel-import-workbook.js', 'excel-import-mapping.js', 'excel-import-match.js',
    'excel-import-plan.js', 'excel-import-profiles.js', 'excel-import-wizard.js'].forEach(file => {
      assert.ok(INDEX.includes(file), `${file} index.html'e bağlanmalı`);
    });
  assert.match(INDEX, /excel-import\.css/);
  // Tek köprü, iki adaptör.
  assert.match(APP, /window\.BLExcelImportBridge\s*=/);
  assert.match(APP, /if\(moduleId==='cp'\)return\s*\{/);
  assert.match(APP, /if\(moduleId==='collection'\)return\s*\{/);
});

test('CP adaptörü satır oluşturamaz ve bunu açıkça bildirir', () => {
  const cpBlock = APP.slice(APP.indexOf("if(moduleId==='cp')return"), APP.indexOf("if(moduleId==='collection')return"));
  assert.ok(cpBlock.length > 200, 'CP adaptör bloğu bulunamadı');
  assert.match(cpBlock, /canCreate:false/);
  assert.match(cpBlock, /op\.op==='create'/);
});

test('sihirbaz onaydan önce yazmaz ve uygulama anında planı yeniden doğrular', () => {
  const code = stripComments(WIZARD);
  // Yazma YALNIZ runImport içinde ve yalnız plan doğrulandıktan sonra.
  const runImport = code.slice(code.indexOf('async function runImport'), code.indexOf('function audit('));
  assert.ok(runImport.length > 400);
  assert.ok(runImport.indexOf('Plan.assertApplicable') < runImport.indexOf('adapter.execute'),
    'plan doğrulaması yazmadan ÖNCE gelmeli');
  assert.match(runImport, /canEdit\(\)/);
  assert.match(runImport, /STALE|değişti|changed while/);
  // Adım fonksiyonlarında (goNext) yazma çağrısı yok; yalnız plan kurulur.
  const goNext = code.slice(code.indexOf('async function goNext'), code.indexOf('function goBack'));
  assert.ok(goNext.indexOf('adapter.execute') < 0, 'plan kurulurken yazma yapılmaz');
  assert.match(goNext, /Plan\.buildImportPlan/);
});

test('önizleme ve uygulama aynı planı kullanır; girdi değişince plan çöpe atılır', () => {
  const code = stripComments(WIZARD);
  assert.match(code, /function invalidatePlan\(\)/);
  assert.match(code, /state\.plan = null/);
  // Uygulama planı yeniden HESAPLAMAZ, plan.operations'ı yazar.
  const cpExec = APP.slice(APP.indexOf('function cpImportBuildItems'), APP.indexOf('function kolImportFieldType'));
  assert.match(cpExec, /plan\.operations\.forEach/);
  assert.match(APP, /plan\.operations\.forEach\(\(op,index\)=>\{/);
});

test('Koleksiyon içe aktarımı atomik partiyi ister ve başarısızlıkta belleği geri alır', () => {
  assert.match(APP, /kolSaveWorkspaceNow\(\{atomic:true\}\)/);
  assert.match(APP, /payload\.atomic=true/);
  assert.match(APP, /kolRows=snapshot\.map\(migrateKolRow\)/);
  assert.match(read('server/lib/collection-workspaces.js'), /COLLECTION_ATOMIC_CONFLICT/);
});

test('özel sütunlar Buyer Log\'un mevcut sistemlerini kullanır', () => {
  // CP: not sütunu tanımları (/api/note-columns). Koleksiyon: kolCustomCols.
  assert.match(APP, /async function cpImportCreateCustomColumns/);
  assert.match(APP, /saveCpNoteColumnDefs\(next\)/);
  assert.match(APP, /kolCustomCols\.push\(\{k,label:def\.label/);
  assert.match(APP, /kolNormalizeCustomCols\(kolCustomCols\)/);
  // Paralel bir özel alan deposu kurulmadı.
  const bridge = APP.slice(APP.indexOf('window.BLExcelImportBridge='), APP.indexOf('function kolEffectiveProjection'));
  assert.ok(stripComments(bridge).indexOf('localStorage') < 0, 'özel sütunlar yerel bir depoya yazılmaz');
});

test('denetim kaydı sınırlıdır ve çalışma kitabı verisi taşımaz', () => {
  assert.match(SERVER, /\/api\/excel-import\/audit/);
  const route = SERVER.slice(SERVER.indexOf("app.post('/api/excel-import/audit'"), SERVER.indexOf("app.post('/api/excel-import/audit'") + 1800);
  assert.match(route, /appendAudit\(req\.currentUser, 'EXCEL_IMPORT'/);
  assert.match(route, /fileName/);
  assert.ok(stripComments(route).indexOf('body.rows') < 0, 'satır verisi denetim kaydına girmez');
  // Başarısız aktarım başarılı raporlanmaz.
  assert.match(stripComments(WIZARD), /status: 'failed'/);
});
