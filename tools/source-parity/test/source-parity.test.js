'use strict';

/* Çalıştırma: node --test tools/source-parity/test
   Gerçek Buyer Log motoru (resources/app) kullanılır; yalnız SSAS çağrısı ve
   Excel COM yenilemesi taklit edilir. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const CORE = path.join(REPO, 'resources', 'app');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-kaynak-dogrulama-'));
const dataRoot = path.join(tmp, 'server');
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: dataRoot, BUYER_LOG_DATA_ROOT: path.join(tmp, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(tmp, 'local'), BUYER_LOG_TEMP_ROOT: path.join(tmp, 'temp'),
  BUYER_LOG_CONFIG_PATH: path.join(tmp, 'config.json'),
});
delete process.env.BL_DELTA_STORE_MODE;

const XLSX = require(path.join(CORE, 'node_modules', 'xlsx'));
const modelFields = require(path.join(CORE, 'server', 'lib', 'model-fields.js'));
const modelHorizon = require(path.join(CORE, 'server', 'lib', 'modelHorizon.js'));
const tool = require(path.join(__dirname, '..', 'source-parity.js'));
const builder = require(path.join(__dirname, '..', 'build.js'));

const ASAS_T = 'ASAS', FACT = 'Ithalat', DIM = 'Siparis Bilgileri';
const sourceFolder = path.join(tmp, 'kaynak');

function asasMapping() {
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) mapping[field.header] = { table: ASAS_T, name: field.header, kind: 'column' };
  return mapping;
}
const iasMapping = () => ({
  'İthalat Dosya No': { table: FACT, name: 'İthalat Dosya No', kind: 'column' },
  'Sipariş Kod': { table: DIM, name: 'Sipariş Kod', kind: 'column' },
  'Model Adı': { table: DIM, name: 'Ürün Ad', kind: 'column' },
  'Renk Kod': { table: DIM, name: 'Renk Kod', kind: 'column' },
  'Supplier Portal Statü': { table: FACT, name: 'Supplier Portal Statü', kind: 'column' },
  'Tahmini Antrepo Giriş Tarihi': { table: FACT, name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
  'Yükleme Toplam Adet': { table: FACT, name: 'Yükleme Toplam Adet', kind: 'column' },
  'Sezon': { table: DIM, name: 'Sezon', kind: 'column' },
});
const ORDERS = [
  { 'Sipariş Kod': 1001, 'Model Adı': 'MODEL A', 'Renk Kod': '001', 'Renk': 'SIYAH', 'Net Alım Sipariş Miktarı': 500, 'FOB Fiyatı': 4.5, 'Üretici': 'URETICI 1', 'Sezon': 'W6', 'Orijinal Exfactory Merch Tarih': '2026-09-10' },
  { 'Sipariş Kod': 1002, 'Model Adı': 'MODEL B', 'Renk Kod': '002', 'Renk': 'BEYAZ', 'Net Alım Sipariş Miktarı': 300, 'FOB Fiyatı': 3.2, 'Üretici': 'URETICI 2', 'Sezon': 'W6', 'Orijinal Exfactory Merch Tarih': '2026-10-01' },
];
const IAS = [
  { 'İthalat Dosya No': 'D-1', 'Sipariş Kod': 1001, 'Model Adı': 'MODEL A', 'Renk Kod': '001', 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2026-09-20', 'Yükleme Toplam Adet': 200 },
  { 'İthalat Dosya No': 'D-2', 'Sipariş Kod': 1001, 'Model Adı': 'MODEL A', 'Renk Kod': '001', 'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-09-25', 'Yükleme Toplam Adet': 300 },
  { 'İthalat Dosya No': 'D-3', 'Sipariş Kod': 1002, 'Model Adı': 'MODEL B', 'Renk Kod': '002', 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2026-10-15', 'Yükleme Toplam Adet': 300 },
];
function writeWorkbook(file, sheet, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet);
  XLSX.writeFile(wb, file);
}
const settingsJson = () => JSON.stringify({ _revision: 7, sourceFolders: { moderator: sourceFolder }, modelConnections: [
  { id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 'srv', catalog: 'ASAS', refreshEnabled: true, mappingEnhancementScanVersion: 4,
    horizon: { table: ASAS_T, seasonTable: ASAS_T, seasonField: 'Sezon', seasons: ['W6'], groups: [] }, mapping: asasMapping() },
  { id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 'srv', catalog: 'IASv2', refreshEnabled: true,
    horizon: { table: DIM, seasonTable: DIM, seasonField: 'Sezon', seasons: ['W6'], groups: [] }, mapping: iasMapping() },
] });
fs.mkdirSync(dataRoot, { recursive: true });
fs.mkdirSync(sourceFolder, { recursive: true });
fs.writeFileSync(path.join(dataRoot, 'settings.json'), settingsJson());
fs.writeFileSync(path.join(dataRoot, 'overrides.json'), JSON.stringify({ _revision: 3 }));
writeWorkbook(path.join(sourceFolder, 'asas.xlsx'), 'ASAS', ORDERS.map(o => ({ ...o, 'Ana Kumaş Mı': 1, 'Kumaşçı': 'MILL' })));
writeWorkbook(path.join(sourceFolder, 'antrepo.xlsx'), 'Antrepo', IAS.map(r => ({ ...r, 'Ürün Ad': r['Model Adı'] })));
// BL'ın kendi yenileme geçmişi (salt-okunur okunmalı)
fs.mkdirSync(path.join(tmp, 'local', 'refresh-performance', 'history'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'local', 'refresh-performance', 'history', '2026-11.jsonl'),
  JSON.stringify({ status: 'done', finishedAt: '2026-11-17T10:00:00Z', durationMs: 95000, profile: { targets: ['cp'], sourceModes: { asas: 'database', antrepo: 'database' } } }) + '\n');

function fakeDb(mutate = {}) {
  const queries = [];
  const runModelRows = async plan => {
    const q = plan.query;
    queries.push(q);
    let rows, key;
    if (q.includes(`'${FACT}'`)) { key = /RELATED\(/.test(q) ? 'ias-candidate' : 'ias-current'; rows = IAS.map(r => ({ ...r })); }
    else if (q.includes('[Ana Kumaş Mı]')) { key = 'asas-fabric'; rows = ORDERS.flatMap(o => [{ ...o, 'Ana Kumaş Mı': 1, 'Kumaşçı': 'MILL' }, { ...o, 'Ana Kumaş Mı': 0, 'Kumaşçı': 'ASTAR' }]); }
    else { key = 'asas-nofabric'; rows = ORDERS.map(o => ({ ...o })); }
    if (mutate[key]) rows = mutate[key](rows);
    return { rows, rowCount: rows.length, elapsedMs: 9, executeMs: 5, writeMs: 2, parseMs: 1, connectionOpenMs: 1 };
  };
  return { runModelRows, queries };
}

async function run(args = [], { mutate, refreshFails } = {}) {
  const db = fakeDb(mutate);
  const out = path.join(tmp, `rapor-${Math.random().toString(36).slice(2)}`);
  const logs = [];
  const code = await tool.main(['--root', tmp, '--core', CORE, '--cikti', out, ...args], {
    skipEnvironment: true, log: t => logs.push(t),
    runModelRows: db.runModelRows, discoverSchema: async () => ({ columns: [], measures: [] }),
    refreshExcelFile: async () => { if (refreshFails) throw new Error('Excel COM yok'); return 'ok'; },
    loadOptions: { columnType: false },
  });
  const read = name => fs.readFileSync(path.join(out, name), 'utf8');
  const summary = JSON.parse(read('ozet.json'));
  const verdict = id => (summary.checks.find(c => c.id === id || c.id.startsWith(id)) || {}).verdict;
  return { code, summary, verdict, out, read, queries: db.queries, report: read('rapor.txt'), perf: read('performans.txt') };
}

test('aynı veri: üç kaynak birebir → GEÇTİ; BL ayarları, kaynak Excel ve BL fonksiyonları değişmez', async () => {
  const settingsBefore = fs.readFileSync(path.join(dataRoot, 'settings.json'));
  const excelBefore = fs.readFileSync(path.join(sourceFolder, 'asas.xlsx'));
  const originalBuild = modelHorizon.buildFactRowQuery, originalMissing = modelFields.missingRequired;
  const r = await run();
  for (const id of ['ias-aday', 'kumas', 'excel-ias-mevcut', 'excel-ias-aday', 'excel-eslesme-mevcut', 'excel-eslesme-aday']) assert.equal(r.verdict(id), 'GEÇTİ', `${id}\n${r.report}`);
  assert.notEqual(r.verdict('excel-asas'), 'BAŞARISIZ', r.report);
  assert.equal(r.code, 0, r.report);
  assert.ok(r.queries.some(q => /RELATED\('Siparis Bilgileri'\[Sipariş Kod\]\)/.test(q)), 'aday sorgu RELATED ile çalıştı');
  assert.ok(r.queries.some(q => q.includes(`'${FACT}'`) && /SELECTEDVALUE/.test(q)), 'mevcut sorgu değişmeden çalıştı');
  assert.ok(r.queries.some(q => q.includes(`'${ASAS_T}'`) && !q.includes('[Ana Kumaş Mı]') && !q.includes('[Kumaşçı]')), 'kumaşsız sorgu çalıştı');
  assert.equal(modelHorizon.buildFactRowQuery, originalBuild, 'sarmalayıcı geri alındı');
  assert.equal(modelFields.missingRequired, originalMissing, 'sarmalayıcı geri alındı');
  assert.deepEqual(fs.readFileSync(path.join(dataRoot, 'settings.json')), settingsBefore);
  assert.deepEqual(fs.readFileSync(path.join(sourceFolder, 'asas.xlsx')), excelBefore);
  // Hız günlüğü
  const events = r.read('olaylar.jsonl').trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e => e.type === 'model-query' && e.role === 'antrepo' && e.run.startsWith('BL yenilemesi') && e.executeMs === 5));
  assert.ok(events.some(e => e.type === 'bl-telemetry'), 'BL telemetrisi kaydedildi');
  assert.ok(events.some(e => e.type === 'cpu-probe' && /eşleştirme/.test(e.label)));
  assert.match(r.perf, /KUMAŞ ETKİSİ/);
  assert.match(r.perf, /kumaş satırları 2\.00 kat çoğaltıyor/);
  assert.match(r.perf, /1m 35|95\.0 sn/);
  assert.ok(fs.readdirSync(path.join(r.out, 'sorgular')).some(name => /aday/.test(name)));
});

test('aday sorgu tek parsiyelde farklı adet döndürürse IAS adayı BAŞARISIZ', async () => {
  const r = await run([], { mutate: { 'ias-candidate': rows => rows.map((row, i) => i === 1 ? { ...row, 'Yükleme Toplam Adet': 299 } : row) } });
  assert.equal(r.verdict('ias-aday'), 'BAŞARISIZ', r.report);
  assert.equal(r.verdict('excel-ias-aday'), 'BAŞARISIZ');
  assert.equal(r.verdict('excel-ias-mevcut'), 'GEÇTİ');
  assert.equal(r.code, 1);
});

test('aday sorgu sipariş kodunu BLANK döndürürse (ilişki sorunu) yakalanır', async () => {
  const r = await run([], { mutate: { 'ias-candidate': rows => rows.map((row, i) => i === 2 ? { ...row, 'Sipariş Kod': null } : row) } });
  assert.equal(r.verdict('ias-aday'), 'BAŞARISIZ', r.report);
});

test('DB IAS Excel referansından eksik parsiyel döndürürse BAŞARISIZ ve CSV yazılır', async () => {
  const drop = rows => rows.filter(row => row['İthalat Dosya No'] !== 'D-3');
  const r = await run([], { mutate: { 'ias-current': drop, 'ias-candidate': drop } });
  assert.equal(r.verdict('excel-ias-mevcut'), 'BAŞARISIZ', r.report);
  assert.equal(r.verdict('excel-eslesme-mevcut'), 'BAŞARISIZ');
  assert.match(r.read('excel-db-ias-mevcut-cp.csv'), /EXCEL VAR \/ DB YOK/);
});

test('ASAS DB miktarı Excel\'den farklıysa BAŞARISIZ ve alan raporlanır', async () => {
  const r = await run(['--kumas', 'dahil', '--aday', 'hayir'], { mutate: { 'asas-fabric': rows => rows.map(row => row['Sipariş Kod'] === 1002 ? { ...row, 'Net Alım Sipariş Miktarı': 301 } : row) } });
  assert.equal(r.verdict('excel-asas'), 'BAŞARISIZ', r.report);
  assert.match(r.report, /qty=1/);
  assert.equal(r.verdict('kumas'), undefined);
  assert.equal(r.verdict('ias-aday'), undefined);
});

test('kumaşsız sorgu sipariş miktarını değiştirirse kumaş kontrolü BAŞARISIZ', async () => {
  const r = await run([], { mutate: { 'asas-nofabric': rows => rows.map(row => ({ ...row, 'Net Alım Sipariş Miktarı': row['Net Alım Sipariş Miktarı'] * 2 })) } });
  assert.equal(r.verdict('kumas'), 'BAŞARISIZ', r.report);
  assert.match(r.report, /GÜVENLİ DEĞİL/);
});

test('Excel pivot yenilenemezse Excel karşılaştırması GEÇERSİZ (fail-closed)', async () => {
  const r = await run([], { refreshFails: true });
  assert.equal(r.verdict('excel'), 'GEÇERSİZ', r.report);
  assert.equal(r.code, 2);
});

test('--tekrar turlarında mevcut/aday sırası dönüşümlü; medyan raporlanır', async () => {
  const r = await run(['--tekrar', '2', '--excel', 'hayir']);
  const ias = r.queries.filter(q => q.includes(`'${FACT}'`)).map(q => /RELATED\(/.test(q) ? 'aday' : 'mevcut');
  assert.deepEqual(ias, ['mevcut', 'mevcut', 'aday', 'aday', 'mevcut']);
  assert.match(r.perf, /IAS aday \(RELATED\): .* koşu 2/);
  assert.equal(r.verdict('excel'), 'ATLANDI');
});

test('etkin çekirdek: current.json işaretçisi, taşınmış klasör ve daha yeni temel kurulum', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-root-'));
  const makeCore = (dir, version) => {
    fs.mkdirSync(path.join(dir, 'electron'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'server', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'electron', 'main.js'), '');
    fs.writeFileSync(path.join(dir, 'server', 'lib', 'model-refresh.js'), '');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
  };
  makeCore(path.join(root, 'resources', 'app'), '7.0.300');
  assert.match(tool.resolveActiveCore(root).core, /resources[\\/]app$/);
  makeCore(path.join(root, '.buyerlog-versions', '7.0.362', 'app'), '7.0.362');
  fs.mkdirSync(path.join(root, 'data', 'local', 'updater'), { recursive: true });
  // Başka bilgisayardan taşınmış mutlak yol: yerel .buyerlog-versions'a bağlanır.
  fs.writeFileSync(path.join(root, 'data', 'local', 'updater', 'current.json'),
    JSON.stringify({ schemaVersion: 1, version: '7.0.362', appCoreRoot: 'C:\\Users\\baska\\BL\\.buyerlog-versions\\7.0.362\\app' }));
  const active = tool.resolveActiveCore(root);
  assert.equal(active.version, '7.0.362');
  assert.match(active.core, /\.buyerlog-versions[\\/]7\.0\.362[\\/]app$/);
  // Üstüne daha yeni tam paket konduysa temel kurulum kazanır.
  makeCore(path.join(root, 'resources', 'app'), '7.0.400');
  assert.equal(tool.resolveActiveCore(root).version, '7.0.400');
});

test('RELATED dönüşümü yalnız tam kalıbı değiştirir', () => {
  const q = "\"A\", CALCULATE(SELECTEDVALUE('Siparis Bilgileri'[Ürün Ad]), CALCULATETABLE('Ithalat')),\n\"B\", CALCULATE(SELECTEDVALUE('It''s'[Col]]x]), CALCULATETABLE('Ithalat')),\n\"C\", CALCULATE([Ölçü])";
  assert.equal(tool.toRelatedQuery(q), "\"A\", RELATED('Siparis Bilgileri'[Ürün Ad]),\n\"B\", RELATED('It''s'[Col]]x]),\n\"C\", CALCULATE([Ölçü])");
});

test('CMD derlemesi: gömülü dosyalar birebir, komut kısmı ASCII ve CRLF', () => {
  const out = builder.build();
  const text = fs.readFileSync(out, 'utf8');
  const files = builder.extract(text);
  for (const name of builder.FILES) {
    const original = fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r?\n/g, '\r\n');
    assert.equal(files[name], original, name);
  }
  const header = text.split(builder.MARKER)[0];
  assert.ok(/^[\x00-\x7F]*$/.test(header), 'komut kısmı ASCII olmalı');
  assert.ok(!/[^\r]\n/.test(header), 'komut kısmı CRLF olmalı');
  assert.ok(!text.startsWith('\uFEFF'), 'BOM olmamalı');
});
