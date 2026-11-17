'use strict';

/* scripts/source-parity-check.js — uçtan uca sözleşme.
   Gerçek BL motoru (loadFromModelConnections, parseASAS... / parseAntrepo...,
   findAntrepoHits) çalışır; yalnız SSAS çağrısı (runModelRows) ve Excel COM
   yenilemesi taklit edilir. Amaç: aracın aynı veride GEÇTİ demesi ve
   bilinçli yerleştirilen her farkı kaçırmadan BAŞARISIZ demesi. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-source-parity-'));
const dataRoot = path.join(tmp, 'server');
process.env.BUYER_LOG_SERVER_DATA_ROOT = dataRoot;
process.env.BUYER_LOG_DATA_ROOT = path.join(tmp, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(tmp, 'local');
process.env.BUYER_LOG_TEMP_ROOT = path.join(tmp, 'temp');
process.env.BUYER_LOG_CONFIG_PATH = path.join(tmp, 'config.json');
delete process.env.BL_DELTA_STORE_MODE;

const root = path.join(__dirname, '..');
const XLSX = require(path.join(root, 'node_modules', 'xlsx'));
const modelFields = require(path.join(root, 'server', 'lib', 'model-fields.js'));
const parity = require(path.join(root, 'scripts', 'source-parity-check.js'));

const ASAS_T = 'ASAS';
const IAS_FACT = 'Ithalat';
const IAS_DIM = 'Siparis Bilgileri';
const sourceFolder = path.join(tmp, 'kaynak');

function asasMapping() {
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) mapping[field.header] = { table: ASAS_T, name: field.header, kind: 'column' };
  return mapping;
}
function iasMapping() {
  return {
    'İthalat Dosya No': { table: IAS_FACT, name: 'İthalat Dosya No', kind: 'column' },
    'Sipariş Kod': { table: IAS_DIM, name: 'Sipariş Kod', kind: 'column' },
    'Model Adı': { table: IAS_DIM, name: 'Ürün Ad', kind: 'column' },
    'Renk Kod': { table: IAS_DIM, name: 'Renk Kod', kind: 'column' },
    'Supplier Portal Statü': { table: IAS_FACT, name: 'Supplier Portal Statü', kind: 'column' },
    'Tahmini Antrepo Giriş Tarihi': { table: IAS_FACT, name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
    'Yükleme Toplam Adet': { table: IAS_FACT, name: 'Yükleme Toplam Adet', kind: 'column' },
    'Sezon': { table: IAS_DIM, name: 'Sezon', kind: 'column' },
  };
}

const ORDERS = [
  { 'Sipariş Kod': 1001, 'Model Adı': 'MODEL A', 'Renk Kod': '001', 'Renk': 'SIYAH', 'Net Alım Sipariş Miktarı': 500, 'FOB Fiyatı': 4.5, 'Üretici': 'URETICI 1', 'Sezon': 'W6', 'Orijinal Exfactory Merch Tarih': '2026-09-10' },
  { 'Sipariş Kod': 1002, 'Model Adı': 'MODEL B', 'Renk Kod': '002', 'Renk': 'BEYAZ', 'Net Alım Sipariş Miktarı': 300, 'FOB Fiyatı': 3.2, 'Üretici': 'URETICI 2', 'Sezon': 'W6', 'Orijinal Exfactory Merch Tarih': '2026-10-01' },
];
const IAS = [
  { 'İthalat Dosya No': 'D-1', 'Sipariş Kod': 1001, 'Model Adı': 'MODEL A', 'Renk Kod': '001', 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2026-09-20', 'Yükleme Toplam Adet': 200 },
  { 'İthalat Dosya No': 'D-2', 'Sipariş Kod': 1001, 'Model Adı': 'MODEL A', 'Renk Kod': '001', 'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-09-25', 'Yükleme Toplam Adet': 300 },
  { 'İthalat Dosya No': 'D-3', 'Sipariş Kod': 1002, 'Model Adı': 'MODEL B', 'Renk Kod': '002', 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2026-10-15', 'Yükleme Toplam Adet': 300 },
];

function writeWorkbook(file, sheetName, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  XLSX.writeFile(wb, file);
}

function setup() {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(sourceFolder, { recursive: true });
  const connections = [
    { id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 'srv', catalog: 'ASAS', refreshEnabled: true,
      horizon: { table: ASAS_T, seasonTable: ASAS_T, seasonField: 'Sezon', seasons: ['W6'], groups: [] }, mapping: asasMapping() },
    { id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 'srv', catalog: 'IASv2', refreshEnabled: true,
      horizon: { table: IAS_DIM, seasonTable: IAS_DIM, seasonField: 'Sezon', seasons: ['W6'], groups: [] }, mapping: iasMapping() },
  ];
  fs.writeFileSync(path.join(dataRoot, 'settings.json'), JSON.stringify({ _revision: 1, modelConnections: connections, sourceFolders: { moderator: sourceFolder } }));
  fs.writeFileSync(path.join(dataRoot, 'overrides.json'), JSON.stringify({ _revision: 1 }));
  writeWorkbook(path.join(sourceFolder, 'asas.xlsx'), 'ASAS', ORDERS.map(o => ({ ...o, 'Ana Kumaş Mı': 1, 'Kumaşçı': 'MILL' })));
  writeWorkbook(path.join(sourceFolder, 'antrepo.xlsx'), 'Antrepo', IAS.map(r => ({ ...r, 'Ürün Ad': r['Model Adı'] })));
}
setup();

/* Sorgu metnine göre "veritabanı" cevabı. mutate ile varyant bazında fark yerleştirilir. */
function fakeDb(mutate = {}) {
  const queries = [];
  const runModelRows = async plan => {
    const q = plan.query;
    queries.push(q);
    let rows;
    if (q.includes(`'${IAS_FACT}'`)) {
      const variant = /RELATED\(/.test(q) ? 'candidate' : 'current';
      rows = IAS.map(r => ({ ...r }));
      if (mutate[`ias-${variant}`]) rows = mutate[`ias-${variant}`](rows);
    } else {
      const fabric = q.includes('[Ana Kumaş Mı]');
      rows = fabric
        ? ORDERS.flatMap(o => [{ ...o, 'Ana Kumaş Mı': 1, 'Kumaşçı': 'MILL' }, { ...o, 'Ana Kumaş Mı': 0, 'Kumaşçı': 'ASTAR' }])
        : ORDERS.map(o => ({ ...o }));
      const key = fabric ? 'asas-fabric' : 'asas-nofabric';
      if (mutate[key]) rows = mutate[key](rows);
    }
    return { rows, rowCount: rows.length, elapsedMs: 5, executeMs: 3 };
  };
  return { runModelRows, queries };
}

async function run(args, { mutate, refreshFails } = {}) {
  const db = fakeDb(mutate);
  const out = path.join(tmp, `rapor-${Math.random().toString(36).slice(2)}`);
  const logs = [];
  const code = await parity.main(['--root', tmp, '--cikti', out, ...args], {
    skipEnvironment: true,
    log: text => logs.push(text),
    refreshExcelFile: async () => { if (refreshFails) throw new Error('Excel COM yok'); return 'ok'; },
    loadOptions: { runModelRows: db.runModelRows, discoverSchema: async () => ({ columns: [], measures: [] }), columnType: false },
  });
  const summary = JSON.parse(fs.readFileSync(path.join(out, 'ozet.json'), 'utf8'));
  const report = fs.readFileSync(path.join(out, 'rapor.txt'), 'utf8');
  const verdict = id => (summary.checks.find(check => check.id === id || check.id.startsWith(id)) || {}).verdict;
  return { code, summary, report, verdict, out, queries: db.queries, logs };
}

test('aynı veri: üç kaynak birebir → GEÇTİ, kaynak Excel dosyaları değişmez', async () => {
  const before = fs.readFileSync(path.join(sourceFolder, 'asas.xlsx'));
  const r = await run([]);
  assert.equal(r.verdict('ias-aday'), 'GEÇTİ', r.report);
  assert.equal(r.verdict('kumas'), 'GEÇTİ', r.report);
  assert.notEqual(r.verdict('excel-asas'), 'BAŞARISIZ', r.report);
  assert.equal(r.verdict('excel-ias-mevcut'), 'GEÇTİ', r.report);
  assert.equal(r.verdict('excel-ias-aday'), 'GEÇTİ', r.report);
  assert.equal(r.verdict('excel-eslesme-mevcut'), 'GEÇTİ', r.report);
  assert.equal(r.code, 0, r.report);
  assert.ok(r.queries.some(q => /RELATED\(/.test(q)), 'aday sorgu gerçekten çalıştı');
  assert.ok(r.queries.some(q => q.includes(`'${IAS_FACT}'`) && !/RELATED\(/.test(q)), 'mevcut sorgu gerçekten çalıştı');
  assert.ok(fs.existsSync(path.join(r.out, 'sorgular', 'ias-aday-related-1.dax')));
  assert.deepEqual(fs.readFileSync(path.join(sourceFolder, 'asas.xlsx')), before, 'kaynak dosya değişmemeli');
  // BL ayarlarına yazılmadı.
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataRoot, 'settings.json'), 'utf8'))._revision, 1);
});

test('aday sorgu tek parsiyelde farklı adet döndürürse IAS adayı BAŞARISIZ', async () => {
  const r = await run([], { mutate: { 'ias-candidate': rows => rows.map((row, i) => i === 1 ? { ...row, 'Yükleme Toplam Adet': 299 } : row) } });
  assert.equal(r.verdict('ias-aday'), 'BAŞARISIZ', r.report);
  assert.equal(r.verdict('excel-ias-aday'), 'BAŞARISIZ', r.report);
  assert.equal(r.verdict('excel-ias-mevcut'), 'GEÇTİ', r.report);
  assert.equal(r.code, 1);
});

test('aday sorgu sipariş kodunu BLANK döndürürse (ilişki sorunu) yakalanır', async () => {
  const r = await run([], { mutate: { 'ias-candidate': rows => rows.map((row, i) => i === 2 ? { ...row, 'Sipariş Kod': null } : row) } });
  assert.equal(r.verdict('ias-aday'), 'BAŞARISIZ', r.report);
  assert.equal(r.code, 1);
});

test('DB IAS, Excel referansından eksik parsiyel döndürürse BAŞARISIZ', async () => {
  const drop = rows => rows.filter(row => row['İthalat Dosya No'] !== 'D-3');
  const r = await run([], { mutate: { 'ias-current': drop, 'ias-candidate': drop } });
  assert.equal(r.verdict('excel-ias-mevcut'), 'BAŞARISIZ', r.report);
  assert.equal(r.verdict('excel-eslesme-mevcut'), 'BAŞARISIZ', r.report);
  assert.equal(r.verdict('ias-aday'), 'GEÇTİ', r.report);
  assert.match(fs.readFileSync(path.join(r.out, 'excel-db-ias-mevcut-cp.csv'), 'utf8'), /EXCEL VAR \/ DB YOK/);
});

test('ASAS DB miktarı Excel ile farklıysa BAŞARISIZ ve alan adı raporlanır', async () => {
  const bump = rows => rows.map(row => row['Sipariş Kod'] === 1002 ? { ...row, 'Net Alım Sipariş Miktarı': 301 } : row);
  const r = await run(['--kumas', 'dahil'], { mutate: { 'asas-fabric': bump } });
  assert.equal(r.verdict('excel-asas'), 'BAŞARISIZ', r.report);
  assert.match(r.report, /qty=1/);
  assert.equal(r.verdict('kumas'), undefined, 'kumas=dahil karşılaştırma yapmaz');
});

test('kumaşsız sorgu sipariş miktarını değiştirirse kumaş kontrolü BAŞARISIZ', async () => {
  const r = await run([], { mutate: { 'asas-nofabric': rows => rows.map(row => ({ ...row, 'Net Alım Sipariş Miktarı': row['Net Alım Sipariş Miktarı'] * 2 })) } });
  assert.equal(r.verdict('kumas'), 'BAŞARISIZ', r.report);
  assert.match(r.report, /GÜVENLİ DEĞİL/);
});

test('Excel pivot yenilenemezse Excel karşılaştırması GEÇERSİZ ve test tamamlanamadı (fail-closed)', async () => {
  const r = await run([], { refreshFails: true });
  assert.equal(r.verdict('excel'), 'GEÇERSİZ', r.report);
  assert.equal(r.code, 2);
});

test('--tekrar turlarında mevcut/aday sırası dönüşümlüdür ve süre tablosu medyan raporlar', async () => {
  const r = await run(['--tekrar', '2', '--excel', 'hayir']);
  const ias = r.queries.filter(q => q.includes(`'${IAS_FACT}'`));
  // tam yenileme (mevcut) + tur1: mevcut, aday + tur2: aday, mevcut
  assert.deepEqual(ias.map(q => /RELATED\(/.test(q) ? 'aday' : 'mevcut'), ['mevcut', 'mevcut', 'aday', 'aday', 'mevcut']);
  const row = r.summary.timings.find(t => t.label.startsWith('IAS aday'));
  assert.equal(row.n, 2);
  assert.equal(r.verdict('excel'), 'ATLANDI');
});

test('delta-only veri modunda yanlış ayarla çalışmamak için durur', async () => {
  process.env.BL_DELTA_STORE_MODE = 'delta-only';
  try {
    const logs = [];
    const code = await parity.main(['--root', tmp, '--cikti', path.join(tmp, 'x')], { skipEnvironment: true, log: t => logs.push(t) });
    assert.equal(code, 2);
    assert.match(logs.join('\n'), /delta-only/);
  } finally { delete process.env.BL_DELTA_STORE_MODE; }
});

test('geçersiz argüman net hata verir', () => {
  assert.throws(() => parity.parseArgs(['--kumas', 'belki']), /ikisi \| dahil \| haric/);
  assert.throws(() => parity.parseArgs(['--tekrar', '9']), /1 ile 5/);
});
