'use strict';

/* Yeni motor (IAS RELATED varsayılan, ASAS kumaş modu, C# aktarım) — araç
   varyantları BL'ın KENDİ seçenekleriyle üretir; BL fonksiyonu sarmalanmaz.
   Çalıştırma: node --test tools/source-parity/test/*.test.js */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE = path.resolve(__dirname, '..', '..', '..', 'resources', 'app');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-kaynak-dogrulama-yeni-'));
const dataRoot = path.join(tmp, 'server');
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: dataRoot, BUYER_LOG_DATA_ROOT: path.join(tmp, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(tmp, 'local'), BUYER_LOG_TEMP_ROOT: path.join(tmp, 'temp'),
  BUYER_LOG_CONFIG_PATH: path.join(tmp, 'config.json'),
});
delete process.env.BL_DELTA_STORE_MODE;

const XLSX = require(path.join(CORE, 'node_modules', 'xlsx'));
const modelFields = require(path.join(CORE, 'server', 'lib', 'model-fields.js'));
const modelRefresh = require(path.join(CORE, 'server', 'lib', 'model-refresh.js'));
const tool = require(path.join(__dirname, '..', 'source-parity.js'));
assert.equal(typeof modelRefresh.asasFabricMode, 'function', 'repo çekirdeği yeni motoru içermeli');

const ASAS_T = 'ASAS', FACT = 'Ithalat', DIM = 'Siparis Bilgileri';
const sourceFolder = path.join(tmp, 'kaynak');
const asasMapping = () => Object.fromEntries(modelFields.fieldsForRole('asas').map(f => [f.header, { table: ASAS_T, name: f.header, kind: 'column' }]));
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
  { 'İthalat Dosya No': 'D-1', 'Sipariş Kod': 1001, 'Model Adı': 'MODEL A', 'Renk Kod': '001', 'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-09-25', 'Yükleme Toplam Adet': 500 },
  { 'İthalat Dosya No': 'D-3', 'Sipariş Kod': 1002, 'Model Adı': 'MODEL B', 'Renk Kod': '002', 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2026-10-15', 'Yükleme Toplam Adet': 300 },
];
const FABRIC = { 'Ana Kumaş Mı': 1, 'Kumaşçı': 'MILL' };

fs.mkdirSync(dataRoot, { recursive: true });
fs.mkdirSync(sourceFolder, { recursive: true });
fs.writeFileSync(path.join(dataRoot, 'settings.json'), JSON.stringify({ _revision: 1, sourceFolders: { moderator: sourceFolder }, modelConnections: [
  { id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 'srv', catalog: 'ASAS', refreshEnabled: true, mappingEnhancementScanVersion: 4,
    horizon: { table: ASAS_T, seasonTable: ASAS_T, seasonField: 'Sezon', seasons: ['W6'], groups: [] }, mapping: asasMapping() },
  { id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 'srv', catalog: 'IASv2', refreshEnabled: true,
    horizon: { table: DIM, seasonTable: DIM, seasonField: 'Sezon', seasons: ['W6'], groups: [] }, mapping: iasMapping() },
] }));
fs.writeFileSync(path.join(dataRoot, 'overrides.json'), JSON.stringify({ _revision: 1 }));
const book = (file, sheet, rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet); XLSX.writeFile(wb, file); };
book(path.join(sourceFolder, 'asas.xlsx'), 'ASAS', ORDERS.map(o => ({ ...o, ...FABRIC })));
book(path.join(sourceFolder, 'antrepo.xlsx'), 'Antrepo', IAS.map(r => ({ ...r, 'Ürün Ad': r['Model Adı'] })));

const kind = q => q.includes(`'${FACT}'`) ? (/RELATED\(/.test(q) ? 'ias-related' : 'ias-selectedvalue')
  : (/& "" IN \{/.test(q) ? 'fabric-query' : (q.includes('[Ana Kumaş Mı]') ? 'asas-inline' : 'asas-main'));
function fakeDb(mutate = {}) {
  const queries = [];
  const runModelRows = async (plan, options = {}) => {
    const k = kind(plan.query);
    queries.push(k);
    if (options && typeof options.runner === 'function') {
      const dir = fs.mkdtempSync(path.join(tmp, 'q-'));
      const qf = path.join(dir, 'q.dax'), of = path.join(dir, 'r.csv');
      fs.writeFileSync(qf, plan.query);
      await options.runner(['-QueryFile', qf, '-OutFile', of, '-Server', 'srv', '-Catalog', plan.catalog], 1000, {});
    }
    let rows = {
      'ias-related': () => IAS, 'ias-selectedvalue': () => IAS,
      'fabric-query': () => ORDERS.map(o => ({ 'Sipariş Kod': o['Sipariş Kod'], 'Model Adı': o['Model Adı'], 'Renk Kod': o['Renk Kod'], ...FABRIC })),
      'asas-inline': () => ORDERS.flatMap(o => [{ ...o, ...FABRIC }, { ...o, 'Ana Kumaş Mı': 0, 'Kumaşçı': 'ASTAR' }]),
      'asas-main': () => ORDERS,
    }[k]().map(r => ({ ...r }));
    if (mutate[k]) rows = mutate[k](rows);
    return { rows, rowCount: rows.length };
  };
  return { runModelRows, queries };
}
const exec = (cmd, argv, opts, cb) => {
  fs.writeFileSync(argv[argv.indexOf('-OutFile') + 1], fs.readFileSync(argv[argv.indexOf('-QueryFile') + 1]));
  setImmediate(() => cb(null, '{"ok":true}', ''));
  return { kill() {} };
};

async function run(args = [], { mutate } = {}) {
  const db = fakeDb(mutate);
  const out = path.join(tmp, `rapor-${Math.random().toString(36).slice(2)}`);
  const code = await tool.main(['--root', tmp, '--core', CORE, '--cikti', out, ...args], {
    skipEnvironment: true, log: () => {}, runModelRows: db.runModelRows, discoverSchema: async () => ({ columns: [], measures: [] }),
    refreshExcelFile: async () => 'ok', loadOptions: { columnType: false }, transferExec: exec,
  });
  const read = name => fs.readFileSync(path.join(out, name), 'utf8');
  const summary = JSON.parse(read('ozet.json'));
  return { code, out, read, queries: db.queries, report: read('rapor.txt'), perf: read('performans.txt'), verdict: id => (summary.checks.find(c => c.id === id) || {}).verdict };
}

test('yeni motor: varyantlar BL seçenekleriyle üretilir ve aynı veride GEÇTİ', async () => {
  const blScript = path.join(CORE, 'server', 'lib', 'ModelQuery.ps1');
  const before = fs.readFileSync(blScript);
  const r = await run(['--tekrar', '1']);
  for (const id of ['ias-aday', 'kumas', 'kumas-ayri', 'aktarim']) assert.equal(r.verdict(id), 'GEÇTİ', `${id}\n${r.report}`);
  assert.equal(r.code, 0, r.report);
  assert.match(r.report, /Motor\s+: yeni/);
  // BL birebir koşu: kullanıcının ayarı (kayıt yok → ayrı kumaş) ve RELATED
  assert.ok(r.queries.includes('fabric-query') && r.queries.includes('asas-main') && r.queries.includes('asas-inline'));
  assert.ok(r.queries.includes('ias-selectedvalue') && r.queries.includes('ias-related'));
  const forced = fs.readFileSync(path.join(r.out, 'aktarim-deneyi', 'ModelQuery-powershell.ps1'), 'utf8');
  assert.match(forced, /PowerShell döngüsü zorlandı[^\n]*\r?\n\$script:fastCsv = \$false/);
  assert.deepEqual(fs.readFileSync(blScript), before, 'BL dosyası değişmez');
  assert.match(r.perf, /Ayrı kumaş sorgusu \(yeni varsayılan\)/);
});

test('yeni motor: eski tek sorgu kumaşsız siparişi düşürüyorsa ayrı sorgu fazlası UYARI (beklenen düzeltme)', async () => {
  const r = await run(['--excel', 'hayir', '--aktarim', 'hayir', '--aday', 'hayir'], { mutate: { 'asas-inline': rows => rows.filter(row => row['Sipariş Kod'] !== 1002) } });
  assert.equal(r.verdict('kumas-ayri'), 'UYARI', r.report);
  assert.match(r.report, /beklenen düzeltme/);
});

test('yeni motor: ayrı kumaş sorgusu farklı kumaş değeri üretirse BAŞARISIZ', async () => {
  const r = await run(['--excel', 'hayir', '--aktarim', 'hayir', '--aday', 'hayir'], { mutate: { 'fabric-query': rows => rows.map(row => ({ ...row, 'Kumaşçı': 'BAŞKA' })) } });
  assert.equal(r.verdict('kumas-ayri'), 'BAŞARISIZ', r.report);
  assert.match(r.report, /fabricSupplier=/);
  assert.match(r.report, /STABLE'a alınmamalı/);
});
