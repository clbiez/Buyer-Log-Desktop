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
  const runModelRows = async (plan, options = {}) => {
    const q = plan.query;
    queries.push(q);
    // Aktarım deneyi: BL'ın runner kancası gerçekten çağrılır (PowerShell yerine sahte).
    if (options && typeof options.runner === 'function') {
      const dir = fs.mkdtempSync(path.join(tmp, 'q-'));
      const qf = path.join(dir, 'query.dax'), of = path.join(dir, 'result.csv');
      fs.writeFileSync(qf, q);
      await options.runner(['-QueryFile', qf, '-OutFile', of], 1000, {});
    }
    let rows, key;
    if (q.includes(`'${FACT}'`)) { key = /RELATED\(/.test(q) ? 'ias-candidate' : 'ias-current'; rows = IAS.map(r => ({ ...r })); }
    else if (q.includes('[Ana Kumaş Mı]')) { key = 'asas-fabric'; rows = ORDERS.flatMap(o => [{ ...o, 'Ana Kumaş Mı': 1, 'Kumaşçı': 'MILL' }, { ...o, 'Ana Kumaş Mı': 0, 'Kumaşçı': 'ASTAR' }]); }
    else { key = 'asas-nofabric'; rows = ORDERS.map(o => ({ ...o })); }
    if (mutate[key]) rows = mutate[key](rows);
    return { rows, rowCount: rows.length, elapsedMs: 9, executeMs: 5, writeMs: 2, parseMs: 1, connectionOpenMs: 1 };
  };
  return { runModelRows, queries };
}

function fakeExec(differ) {
  return (cmd, argv, opts, cb) => {
    const script = argv[argv.indexOf('-File') + 1];
    const out = argv[argv.indexOf('-OutFile') + 1];
    const query = fs.readFileSync(argv[argv.indexOf('-QueryFile') + 1], 'utf8');
    fs.writeFileSync(out, `${query.length};satir\r\n${differ && /csharp/.test(script) ? 'X' : ''}`);
    setImmediate(() => cb(null, '{"ok":true}', ''));
    return { kill() {} };
  };
}

async function run(args = [], { mutate, refreshFails, inspect, transferDiffers } = {}) {
  const db = fakeDb(mutate);
  const out = path.join(tmp, `rapor-${Math.random().toString(36).slice(2)}`);
  const logs = [];
  const code = await tool.main(['--root', tmp, '--core', CORE, '--cikti', out, ...args], {
    skipEnvironment: true, log: t => logs.push(t),
    runModelRows: db.runModelRows, discoverSchema: async () => ({ columns: [], measures: [] }),
    refreshExcelFile: async () => { if (refreshFails) throw new Error('Excel COM yok'); return 'ok'; },
    loadOptions: { columnType: false }, inspect, transferExec: fakeExec(transferDiffers),
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
  const r = await run(['--tekrar', '2', '--excel', 'hayir', '--aktarim', 'hayir']);
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

test('bellek: her varyantta yalnız ilk sonuç veri tutar; ham satırlar ve kopya hedefler bırakılır', async () => {
  let db;
  const r = await run(['--tekrar', '3', '--excel', 'hayir'], { inspect: x => { db = x.db; } });
  assert.equal(r.code, 0, r.report);
  for (const list of [db.ias.current, db.ias.candidate, db.asas.fabric, db.asas.noFabric]) {
    assert.equal(list.length, 3);
    assert.equal(list.filter(step => step.value).length, 1, 'yalnız ilk sonuç tutulur');
    assert.ok(list.every(step => step.ok && typeof step.fp === 'string'), 'her turun parmak izi var');
  }
  const full = db.full.value;
  assert.ok(full.runs.every(run => run.rows.length === 0 && run.rowCount > 0), 'BL koşusunun ham satırları bırakıldı');
  assert.equal(full.asasOrdersByTarget.priceanalysis, undefined);
  assert.equal(full.asasOrdersByTarget.cp, full.asasOrdersByTarget.backlog, 'aynı içerikli hedefler tek dizi');
  assert.ok(db.asas.noFabric[0].value.runs.every(run => run.rows.length === 0));
  // IAS ham satırları mevcut ⇄ aday ham karşılaştırması için tutulur.
  assert.ok(db.ias.current[0].value.runs.some(run => run.rows.length === 3));
  assert.ok(db.probes.some(p => /kumaşsız/.test(p.label)) && db.probes.some(p => /eşleştirme/.test(p.label)));
  const events = r.read('olaylar.jsonl').trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e => e.type === 'phase-end' && Number.isFinite(e.heapMb)), 'aşama sonu bellek kaydı');
});

test('CMD menüsü: Hayir / Hayır / No / H cevapları hayır sayılır (ilk harf)', () => {
  const text = fs.readFileSync(builder.build(), 'utf8').split(builder.MARKER)[0];
  for (const [v, target, value] of [['K', 'KUMAS', 'dahil'], ['A', 'ADAY', 'hayir'], ['E', 'EXCEL', 'hayir']]) {
    assert.ok(text.includes(`set "${v}1=!${v}:~0,1!"`), v);
    assert.ok(text.includes(`if /I "!${v}1!"=="H" set "${target}=${value}"`), v);
    assert.ok(text.includes(`if /I "!${v}1!"=="N" set "${target}=${value}"`), v);
    assert.ok(!text.includes(`if /I "!${v}!"=="H"`), 'eski tam-eşleşme kontrolü kalmamalı');
  }
});

function withAntrepoExcel(rows, work) {
  const file = path.join(sourceFolder, 'antrepo.xlsx');
  const before = fs.readFileSync(file);
  writeWorkbook(file, 'Antrepo', rows.map(r => ({ ...r, 'Ürün Ad': r['Model Adı'] })));
  return Promise.resolve().then(work).finally(() => fs.writeFileSync(file, before));
}

test('saha durumu: Excel\'de statüsü boş parsiyel + "Dosyası Oluşmamıştır" → neden açıkça yazılır', async () => {
  const excelRows = [
    ...IAS.map(r => r['İthalat Dosya No'] === 'D-3' ? { ...r, 'İthalat Dosya No': 'Dosyası Oluşmamıştır' } : r),
    { 'İthalat Dosya No': 'Dosyası Oluşmamıştır', 'Sipariş Kod': 1002, 'Model Adı': 'MODEL B', 'Renk Kod': '002', 'Supplier Portal Statü': '', 'Tahmini Antrepo Giriş Tarihi': '', 'Yükleme Toplam Adet': 50 },
  ];
  const r = await withAntrepoExcel(excelRows, () => run(['--excel', 'evet', '--kumas', 'dahil', '--aday', 'hayir'], {
    mutate: { 'ias-current': rows => rows.map(row => row['İthalat Dosya No'] === 'D-3' ? { ...row, 'İthalat Dosya No': '' } : row) },
  }));
  const check = r.summary.checks.find(c => c.id === 'excel-ias-mevcut-cp');
  assert.equal(check.verdict, 'BAŞARISIZ', r.report);
  const text = check.lines.join('\n');
  assert.match(text, /Dosyası Oluşmamıştır.*eşdeğer/);
  assert.match(text, /1 parsiyelde Supplier Portal Statü BOŞ/);
  assert.match(text, /BİREBİR AYNI/);
});

test('Excel ASAS 0 sipariş okunursa karşılaştırma GEÇERSİZ; ortak sipariş 0 iken eşleştirme GEÇTİ demez', async () => {
  const file = path.join(sourceFolder, 'asas.xlsx');
  const before = fs.readFileSync(file);
  // Pivot "öğe etiketlerini yinele" kapalı: Sipariş Kod hücreleri boş
  writeWorkbook(file, 'ASAS (2)', ORDERS.map(o => ({ ...o, 'Sipariş Kod': null })));
  try {
    const r = await run(['--kumas', 'dahil', '--aday', 'hayir']);
    assert.equal(r.verdict('excel-asas'), 'GEÇERSİZ', r.report);
    assert.match(r.report, /0 sipariş okundu \(sayfa: ASAS \(2\)\)/);
    assert.equal(r.verdict('excel-eslesme-mevcut'), 'GEÇERSİZ');
    assert.equal(r.code, 2);
  } finally { fs.writeFileSync(file, before); }
});

test('kumaşlı sorgu bazı siparişleri düşürüyorsa yön ve olası neden yazılır', async () => {
  const r = await run(['--excel', 'hayir', '--aday', 'hayir'], { mutate: { 'asas-fabric': rows => rows.filter(row => row['Sipariş Kod'] !== 1002) } });
  const check = r.summary.checks.find(c => c.id === 'kumas');
  assert.equal(check.verdict, 'BAŞARISIZ');
  assert.match(check.lines.join('\n'), /kumaşsız sorgu 1 siparişi FAZLA getiriyor/);
  assert.match(check.lines.join('\n'), /COUNTROWS\('Kumaş'\)/);
  assert.match(r.read('kumas-etkisi-cp.csv'), /YOK;var;W6;300/);
});

test('aktarım deneyi: BL ModelQuery.ps1 kopyası yamalanır, sonuç dosyaları bayt bayt karşılaştırılır', async () => {
  const blScript = path.join(CORE, 'server', 'lib', 'ModelQuery.ps1');
  const before = fs.readFileSync(blScript);
  const r = await run(['--excel', 'hayir', '--kumas', 'dahil', '--aday', 'hayir', '--tekrar', '2']);
  assert.equal(r.verdict('aktarim'), 'GEÇTİ', r.report);
  const patched = fs.readFileSync(path.join(r.out, 'aktarim-deneyi', 'ModelQuery-csharp.ps1'), 'utf8');
  assert.match(patched, /\[BLFastCsv\]::WriteBatch/);
  assert.match(patched, /public static class BLFastCsv/);
  assert.deepEqual(fs.readFileSync(blScript), before, 'BL dosyası değişmez');
  assert.match(r.perf, /7\) AKTARIM DENEYİ/);
  assert.match(r.perf, /Veri eşitliği \(sonuç dosyası SHA-256\): GEÇTİ/);
  const events = r.read('olaylar.jsonl').trim().split('\n').map(JSON.parse);
  const files = events.filter(e => e.type === 'transfer-file');
  assert.ok(files.some(e => e.variant === 'baseline') && files.some(e => e.variant === 'csharp'));
  // Sıra dönüşümlü: tur 1 PowerShell önce, tur 2 C# önce
  const phases = events.filter(e => e.type === 'phase-start' && /^Aktarım/.test(e.run)).map(e => e.run.split(' · ')[0]);
  assert.deepEqual(phases, ['Aktarım PowerShell (BL bugünkü)', 'Aktarım C# derlenmiş', 'Aktarım C# derlenmiş', 'Aktarım PowerShell (BL bugünkü)']);
});

test('aktarım deneyi: C# çıktısı bir bayt bile farklıysa BAŞARISIZ', async () => {
  const r = await run(['--excel', 'hayir', '--kumas', 'dahil', '--aday', 'hayir'], { transferDiffers: true });
  assert.equal(r.verdict('aktarim'), 'BAŞARISIZ', r.report);
  assert.equal(r.code, 1);
});

test('aktarım deneyi: BL betiği beklenen yapıda değilse yarım yama çalıştırılmaz', () => {
  const transfer = require(path.join(__dirname, '..', 'transfer-experiment.js'));
  const real = fs.readFileSync(path.join(CORE, 'server', 'lib', 'ModelQuery.ps1'), 'utf8');
  assert.equal(transfer.buildPatchedScript(real).ok, true);
  const broken = transfer.buildPatchedScript(real.replace('Write-Row $columns $values $Format', 'Write-Row $values'));
  assert.equal(broken.ok, false);
  assert.ok(broken.problems.length > 0);
  // CRLF kopya da yamalanabilir
  assert.equal(transfer.buildPatchedScript(real.replace(/\n/g, '\r\n')).ok, true);
});

test('Database tarafında statüsü boş IAS satırları ham haliyle dışa aktarılır', async () => {
  const addBlank = rows => [...rows, { 'İthalat Dosya No': '', 'Sipariş Kod': 1002, 'Model Adı': 'MODEL B', 'Renk Kod': '002', 'Supplier Portal Statü': '', 'Tahmini Antrepo Giriş Tarihi': '', 'Yükleme Toplam Adet': 40 }];
  const r = await run(['--excel', 'hayir', '--kumas', 'dahil', '--aday', 'hayir', '--aktarim', 'hayir'], { mutate: { 'ias-current': addBlank } });
  const text = r.read('ias-statusu-bos-db.csv');
  assert.match(text, /^\uFEFFBL Siparişler\/Backlog siparişi;/);
  assert.match(text, /\r\nEvet;;1002;MODEL B;002;;;40/);
  assert.match(r.report, /IAS statüsü boş : Database ham sonucunda 1 satır/);
});
