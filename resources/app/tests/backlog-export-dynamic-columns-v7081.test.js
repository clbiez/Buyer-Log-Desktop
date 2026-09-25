'use strict';

/* Backlog Excel Ayarları "Sütun Ekle" kataloğu aktif ASAS/Antrepo şemasından gelir ve
   varsayılan export sütunları kullanıcı tarafından kaldırılabilir. Bu testler iki
   regresyonu korur:
   - katalog hardcoded bir alan listesine düşmemeli (yeni şema sütunu kod değişmeden görünmeli),
   - kullanıcının kaydettiği sütun seçimi/sırası export'ta sessizce sunucunun tam
     varsayılan listesiyle değiştirilmemeli. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse = require('../server/lib/parse');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

const overrides = { notesmap:{}, submap:{}, suppfobmap:{}, suppfobmetamap:{}, delmap:{}, licensormap:{}, datemap:{}, pricingRules:[], transitRules:[] };

function order(extra = {}) {
  return {
    ocode:1001, model:'MODEL', ccode:'01', colour:'SİYAH', season:'S7', countryRaw:'TÜRKİYE',
    manufacturer:'ÜRETİCİ', category:'KAZAK', merch:'12', ageGroup:'A1', buyer:'BUYER', buyerGrup:'KIDS',
    line:'LINE', qty:100, kalan:100, opd:new Date(2026,0,1), ex:new Date(2026,1,1),
    retail:new Date(2026,2,1), mb:new Date(2026,1,15), merkezSevkeHazirKalan:0,
    ...extra,
  };
}

test('Katalog ASAS şemasındaki HER ham başlığı taşır (hardcoded alan listesi yok)', () => {
  const headers = {};
  for (let i = 0; i < 120; i++) headers[`Şema Sütunu ${i}`] = `değer-${i}`;
  headers['Kod Tarafında Hiç Bilinmeyen Yeni Sütun'] = 'yeni';
  const context = parse.backlogCustomDimensionContext([order({ _sourceFields: headers })], {});
  const asas = context.customDimensions.filter(item => item.source === 'asas');
  Object.keys(headers).forEach(header => {
    assert.ok(asas.some(item => item.header === header), `${header} katalogda bulunmalı`);
  });
});

test('Benzer isimli iki şema sütunu ayrı kimlik alır ve doğru değere bağlanır', () => {
  const orders = [order({ _sourceFields: {
    'Planlama Takımı': 'BİRİNCİ',
    'Planlama Takımı 2': 'İKİNCİ',
    'planlama takimi': 'ÜÇÜNCÜ',
  } })];
  const columns = parse.backlogCustomDimensionContext(orders, {}).customDimensions
    .filter(item => item.source === 'asas');
  const ids = columns.map(item => item.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'her başlık ayrı kimlik almalı');

  const pick = header => {
    const column = columns.find(item => item.header === header);
    assert.ok(column, `${header} katalogda bulunmalı`);
    return column;
  };
  const requested = [pick('Planlama Takımı'), pick('Planlama Takımı 2'), pick('planlama takimi')];
  const rows = parse.buildBacklogTemplateRows(orders, {}, overrides, {}, requested);
  assert.ok(rows.length, 'export satırı üretilmeli');
  assert.strictEqual(rows[0][requested[0].label], 'BİRİNCİ');
  assert.strictEqual(rows[0][requested[1].label], 'İKİNCİ');
  assert.strictEqual(rows[0][requested[2].label], 'ÜÇÜNCÜ');
});

test('Sunucu katalog uç noktası aktif kaynağın ham başlıklarından üretilir', () => {
  const start = SERVER.indexOf("app.get('/api/backlog-source-columns'");
  assert.ok(start > -1, '/api/backlog-source-columns tanımlı olmalı');
  const block = SERVER.slice(start, SERVER.indexOf("app.get('/api/backlog-export'", start));
  assert.match(block, /await ensureBacklogSourceFields\(id\)/);
  assert.match(block, /parseLib\.backlogCustomDimensionContext\(/);
  assert.doesNotMatch(block, /BACKLOG_DEFAULT_EXPORT_HEADERS/);
});

test('İstemci kataloğu uç noktadan tazeler ve ona öncelik verir', () => {
  assert.match(APP, /fetchJSON\('\/api\/backlog-source-columns'\)/);
  const start = APP.indexOf('function backlogExportSourceCatalog()');
  const block = APP.slice(start, APP.indexOf('\n}', start));
  assert.match(block, /const sources=\[backlogSourceColumnCatalog,/);
  const modalStart = APP.indexOf('function openBacklogExportColumns()');
  const modalBlock = APP.slice(modalStart, APP.indexOf('\ndocument.getElementById(\'backlogExcelOptionsBtn\')', modalStart));
  assert.match(modalBlock, /fetchBacklogSourceColumns\(\)\.then\(/);
  assert.match(modalBlock, /catalog=backlogExcelColumnCatalog\(\)/);
});

test('Export sütunları her zaman kullanıcının seçimi ve sırasıdır', () => {
  const start = APP.indexOf('async function exportBacklogToExcel');
  const block = APP.slice(start, APP.indexOf('let backlogLoadedOnce', start));
  assert.match(block, /const selectedHeaders=backlogSelectedDataHeaders\(data\.headers\|\|\[\]\)/);
  assert.match(block, /const exportHeaders=selectedHeaders\.length\?selectedHeaders:\(data\.headers\|\|\[\]\)/);
  // Seçim ile sunucu başlık SAYISI eşit olduğunda sunucu listesine düşen eski dal
  // geri gelmemeli: sıralama değişikliği ve "bir varsayılanı sil + bir ASAS sütunu ekle"
  // senaryosu bu dalda sessizce iptal oluyordu.
  assert.doesNotMatch(block, /exportHeaders\.length!==\(data\.headers\|\|\[\]\)\.length/);
  assert.match(block, /const expanded=backlogExpandDateDimensions\(exportHeaders,data\.rows\|\|\[\]\)/);
  assert.match(block, /buildBacklogDetailSheet\(expanded\.headers,expanded\.rows,transitPlan,\{includeImages,dateDimensionSources:expanded\.derivedHeaderSources\}\)/);
});

test('Kaldırılan varsayılan sütun kalıcıdır; yalnız boş kayıt veya "Varsayılana Dön" geri getirir', () => {
  const start = APP.indexOf('function backlogExcelColumns()');
  const block = APP.slice(start, APP.indexOf('\n}', start));
  // Kaydedilmiş liste olduğu gibi döner; varsayılanlar yalnız hiç kayıt yokken eklenir.
  assert.match(block, /if\(Array\.isArray\(value\)\)return value\.filter/);
  assert.match(block, /return backlogDefaultExcelColumns\(\);/);
  const defaultUses = APP.split('backlogDefaultExcelColumns()').length - 1;
  assert.strictEqual(defaultUses, 3, 'varsayılan liste yalnız tanım, boş kayıt yedeği ve sıfırlama düğmesinde kullanılmalı');
  assert.match(APP, /data-col-reset-selection\]\'\)\.addEventListener\('click',\(\)=>\{\r?\n\s*workingSelected=backlogDefaultExcelColumns\(\)/);
});

test('Aynı başlık export listesine iki kez girmez', () => {
  const start = APP.indexOf('function backlogSelectedDataHeaders(');
  const block = APP.slice(start, APP.indexOf('\n}', start));
  assert.match(block, /seen\.has\(header\)/);
  assert.match(block, /seen\.add\(header\)/);
});
