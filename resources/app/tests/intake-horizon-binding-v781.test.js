'use strict';

/* INTAKE raporu Data Management'ta tanımlanan ufku uygular.
 *
 * Kullanıcı bildirimi: "INTAKE horizonu düzgün çalışmıyor. Data Management'ta
 * yaptığım filtre, Overview'a yansımıyor."
 *
 * ÖLÇÜLEN NEDEN: intake-budget kaynak profili 'filters' yeteneğini taşıyor,
 * yani Data Management filtreyi kabul edip kaynağın scope.horizon alanına
 * yazıyordu. Ama buildIntakeQuery sorguyu YALNIZ kullanıcının kendi
 * viewConfig'inden kuruyordu; ufka hiç bakmıyordu. Filtre kaydediliyor,
 * hiçbir yere ulaşmıyordu.
 *
 * İKİNCİ YÜZÜ (ayrıca ölçüldü): intake-store.queryKey BEYAZ LİSTE ile
 * çalışıyor. Ufuk anahtara eklenmezse sorgu doğru kurulsa bile önbellek
 * anahtarı değişmez; kullanıcı filtreyi değiştirir, filtresiz eski satırlar
 * önbellekten döner ve filtre yine "yansımamış" görünürdü.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const intakeReport = require(path.join(ROOT, 'server', 'lib', 'intake-report.js'));
const modelHorizon = require(path.join(ROOT, 'server', 'lib', 'modelHorizon.js'));
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'intake-store.js'), 'utf8');

/* Alanlar ve görünüm GERÇEK API üzerinden kurulur: normalizeSchema +
   reconcileViewConfig. Elle uydurulmuş alan nesneleri measure olarak
   tanınmıyor — ilk yazımda tam bu yüzden beş test düştü. */
const FIELDS = intakeReport.normalizeSchema({
  columns: [
    { table: 'Dim', name: 'Country', kind: 'column' },
    { table: 'Dim', name: 'Sezon', kind: 'column' },
  ],
  measures: [{ table: 'Measures', name: 'Budget', kind: 'measure' }],
});
const COUNTRY = FIELDS.find(field => field.defaultLabel === 'Country');
const BUDGET = FIELDS.find(field => field.defaultLabel === 'Budget');

const VIEW = intakeReport.reconcileViewConfig({
  version: 1,
  query: { rows: [COUNTRY], columns: [], measures: [BUDGET], filters: [], filterValues: {} },
}, FIELDS);
test('ufuk yokken sorgu eskisi gibi kurulur (regresyon kilidi)', () => {
  const built = intakeReport.buildIntakeQuery({ fields: FIELDS, viewConfig: VIEW });
  assert.match(built.query, /SUMMARIZECOLUMNS/);
  assert.doesNotMatch(built.query, /TREATAS/, 'ufuk yokken ek filtre girmemeli');
});

test('sezon ufku sorguya TREATAS olarak giriyor', () => {
  const horizon = { table: 'Dim', seasonTable: 'Dim', seasonField: 'Sezon', seasons: ['2026 SS'] };
  const built = intakeReport.buildIntakeQuery({ fields: FIELDS, viewConfig: VIEW, horizon });
  assert.match(built.query, /TREATAS\(\{\s*"2026 SS"\s*\}, 'Dim'\[Sezon\]\)/,
    'Data Management ufku sorguya hiç girmiyor — bildirilen hata');
});

test('tarih ufku FILTER(ALL(...)) olarak giriyor', () => {
  const horizon = { table: 'Dim', dateTable: 'Dim', dateField: 'Tarih', dateStart: '2026-01-01', dateEnd: '2026-06-30' };
  const built = intakeReport.buildIntakeQuery({ fields: FIELDS, viewConfig: VIEW, horizon });
  assert.match(built.query, /FILTER\(ALL\('Dim'\[Tarih\]\)/);
  assert.match(built.query, /DATE\(2026, 1, 1\)/);
  assert.match(built.query, /DATE\(2026, 6, 30\)/);
});

test('ufuk, kullanıcının kendi pivot filtresini EZMEZ — ikisi birlikte uygulanır', () => {
  /* Ortak filtre ile kişisel pivot filtresi farklı şeylerdir; biri diğerini
     sessizce silerse kullanıcı neyi gördüğünü bilemez. */
  const viewWithFilter = intakeReport.reconcileViewConfig({
    version: 1,
    query: {
      rows: [COUNTRY], columns: [], measures: [BUDGET],
      filters: [COUNTRY],
      filterValues: { [COUNTRY.id]: ['Fas'] },
    },
  }, FIELDS);
  const horizon = { table: 'Dim', seasonTable: 'Dim', seasonField: 'Sezon', seasons: ['2026 SS'] };
  const built = intakeReport.buildIntakeQuery({ fields: FIELDS, viewConfig: viewWithFilter, horizon });
  assert.match(built.query, /"2026 SS"/, 'ufuk kayboldu');
  assert.match(built.query, /"Fas"/, 'kullanıcının kendi filtresi kayboldu');
});

test('geçersiz ufukta SESSİZCE filtresiz devam edilmez', () => {
  /* Sessiz düşmek, filtresiz veriyi "filtrelenmiş" sanmak demekti —
     düzeltilen hatanın ta kendisi. */
  /* ÖLÇÜLDÜ: normalizeHorizon çoğu eksiği toleransla düzeltiyor (boş
     seasonField varsayılana düşüyor). Gerçekten atan durum, tablosu
     çözülemeyen bir koşul grubu: CONDITION_NO_TABLE. */
  const horizon = { table: '', groups: [{ conditions: [{ field: 'Country', operator: 'in', values: ['X'] }] }] };
  assert.throws(
    () => intakeReport.buildIntakeQuery({ fields: FIELDS, viewConfig: VIEW, horizon }),
    error => String(error && error.code) === 'INTAKE_HORIZON_INVALID',
    'geçersiz ufuk sessizce yok sayılıyor',
  );
});

test('filtre argümanı üretimi model yenilemesiyle ORTAK', () => {
  /* İki ayrı kopya, sezon/tarih optimizasyonlarının ve grup VEYA
     semantiğinin zamanla ayrışması demekti. */
  assert.equal(typeof modelHorizon.summarizeFilterArgs, 'function',
    'ortak fonksiyon dışa aktarılmıyor');
  const filter = modelHorizon.buildHorizonFilter(
    { table: 'Dim', seasonTable: 'Dim', seasonField: 'Sezon', seasons: ['2026 SS'] }, null,
  );
  const args = modelHorizon.summarizeFilterArgs(filter, '');
  assert.equal(args.length, 1);
  assert.match(args[0], /^TREATAS/);
});

/* --- Önbellek anahtarı --------------------------------------------------- */

test('önbellek anahtarı ufku KAPSIYOR', () => {
  /* queryKey beyaz liste ile çalışıyor: eklenmeyen alan sessizce hash
     dışında kalır. Ufuk dışarıda kalırsa filtre değişse bile eski
     (filtresiz) satırlar önbellekten döner. */
  assert.match(STORE, /horizon: source\.horizon \|\| null,/,
    'intake-store.queryKey ufku hash\'e katmıyor');
});

test('sunucu ufku hem ekrana hem otomasyona veriyor', () => {
  /* Kaynaktaki kendi notu: "ekranda görünen risk ile mailde giden risk aynı
     motordan gelir". Ufku yalnız birine uygulamak o sözü bozardı. */
  const calls = SERVER.match(/buildIntakeQuery\(\{ fields: found\.fields, viewConfig, horizon \}\)/g) || [];
  assert.equal(calls.length, 2, `iki çağrı yeri de ufku geçirmeli, bulunan: ${calls.length}`);
  const keyCalls = SERVER.match(/intakeQueryKey\(built\.viewConfig, found\.connection, horizon\)/g) || [];
  assert.equal(keyCalls.length, 2, 'önbellek anahtarı iki yerde de ufku almalı');
});

test('ufuk tek gerçek kaynaktan okunuyor: kaynağın scope.horizon alanı', () => {
  /* Kişisel bir horizon katmanı YOK; kullanıcı kararı gereği ufuk yalnız
     Data Management'tan gelir. */
  const start = SERVER.indexOf('function intakeHorizon()');
  assert.ok(start > -1, 'intakeHorizon() yok');
  const block = SERVER.slice(start, SERVER.indexOf('\n}', start));
  assert.match(block, /entry\.role === 'intake'/);
  assert.match(block, /entry\.targets\.includes\('intake'\)/);
  assert.match(block, /scope && scope\.horizon/);
});

/* v7.84 — INTAKE KAYNAK FİLTRESİ ÇOK TABLOLUDUR.
 *
 * Kullanıcı bildirimi: "Intake'te filtre seçiliyken Yenile filtresiz veri
 * getiriyor." ÖLÇÜLEN NEDEN: kaydedilmiş kaynak filtresi (scope.horizon)
 * koşulları Dim_Urun / SupplyBasket / Dim_Sezon gibi AYRI tablolara
 * dağılıyor ve ufkun kendi `table` alanı boş kalıyor. summarizeFilterArgs
 * genel dalı `FILTER(<tablo>, ifade)` kurmaya çalışıp "Tablo adı boş
 * olamaz" ile düşüyordu: Yenile hata veriyor, ekrandaki filtresiz eski
 * satırlar duruyor, filtre rozeti ise seçili görünüyordu. */
const MULTI_TABLE_HORIZON = {
  table: '', groups: [{
    id: 'g1',
    conditions: [
      { id: 'c1', table: 'Dim_Urun', field: 'BuyerGrupTanim', op: 'in', valueType: 'text', values: ['LİSANS'] },
      { id: 'c2', table: 'SupplyBasket', field: 'Tedarik Cluster', op: 'in', valueType: 'text', values: ['Uzak Doğu'] },
    ],
  }],
};

test('çok tablolu kaynak filtresi sorguya giriyor (tablo adı boş olsa da)', () => {
  const built = intakeReport.buildIntakeQuery({ fields: FIELDS, viewConfig: VIEW, horizon: MULTI_TABLE_HORIZON });
  assert.match(built.query, /FILTER\(ALL\('Dim_Urun'\[BuyerGrupTanim\]\), 'Dim_Urun'\[BuyerGrupTanim\] IN \{ "LİSANS" \}\)/,
    'kaynak filtresi koşulu sorguya hiç girmiyor — bildirilen hata');
  assert.match(built.query, /FILTER\(ALL\('SupplyBasket'\[Tedarik Cluster\]\)/,
    'ikinci tablodaki koşul düşüyor');
});

test('çok tablolu kaynak filtresi kullanıcının kendi filtresiyle birlikte kalır', () => {
  const view = intakeReport.reconcileViewConfig({
    version: 1,
    query: {
      rows: [COUNTRY], columns: [], measures: [BUDGET], filters: [COUNTRY],
      filterValues: { [COUNTRY.id]: ['Fas'] },
    },
  }, FIELDS);
  const built = intakeReport.buildIntakeQuery({ fields: FIELDS, viewConfig: view, horizon: MULTI_TABLE_HORIZON });
  assert.match(built.query, /TREATAS\(\{ "Fas" \}, 'Dim'\[Country\]\)/, 'kullanıcı filtresi kayboldu');
  assert.match(built.query, /FILTER\(ALL\('Dim_Urun'\[BuyerGrupTanim\]\)/, 'kaynak filtresi kayboldu');
  assert.deepEqual(built.viewConfig.query.filterValues, { [COUNTRY.id]: ['Fas'] },
    'Yenile dönüşünde kullanıcının filtre seçimi korunmalı');
});

test('tek tablolu grup ufku eski FILTER(tablo, …) biçimini korur', () => {
  const horizon = {
    table: 'Dim', groups: [{
      id: 'g1', conditions: [{ id: 'c1', table: 'Dim', field: 'Sezon', op: 'in', valueType: 'text', values: ['2026 SS'] }],
    }],
  };
  const args = modelHorizon.summarizeFilterArgs(modelHorizon.buildHorizonFilter(horizon), '');
  assert.match(args.join('\n'), /FILTER\(\s*'Dim',/, 'model yenilemesinin mevcut biçimi bozulmamalı');
});
