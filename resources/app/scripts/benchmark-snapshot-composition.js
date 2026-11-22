#!/usr/bin/env node
'use strict';

/*
 * Sentetik model snapshot bileşimi + kayıt/yükleme ölçümü.
 *
 * scripts/generate-demo-data.js satırları, üretim ASAS/IAS katalog başlıklarıyla
 * (server/lib/model-fields.js) genişletilir ve GERÇEK ayrıştırıcılardan
 * (parseASASRows / parseAntrepoRows / parseLFLRows) geçirilir. İki kaynak modu:
 *
 *   excel  — server.js Excel yolu: tek ayrıştırma, dört hedef aynı diziyi paylaşır.
 *   model  — GERÇEK model-refresh.js loadFromModelConnections yolu; DAX yürütücüsü
 *            (runModelRows) aynı sentetik satırları döndürür. Tek kapsam
 *            cp/orders/backlog/priceanalysis (IAS: cp/orders/backlog) hedeflerini besler.
 *
 * Aynı betik main ve aday çalışma kopyasında koşturularak L2 A/B yapılır.
 *
 * Snapshot gerçek saveModelSnapshotAsync/loadModelSnapshotAsync ile geçici bir
 * köke yazılır; ardından scripts/snapshot-composition.js raporu basılır.
 *
 *   node --expose-gc scripts/benchmark-snapshot-composition.js [--rows 30000] [--mode model|excel] [--root <geçici klasör>] [--json|--summary] [--keep]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const rows = Number(arg('--rows', 30000)) || 30000;
const mode = arg('--mode', 'model');
const root = path.resolve(arg('--root', fs.mkdtempSync(path.join(os.tmpdir(), 'bl-snapshot-composition-'))));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = root;
process.env.BUYER_LOG_DATA_ROOT = process.env.BUYER_LOG_DATA_ROOT || root;

const { build } = require('./generate-demo-data');
const parse = require('../server/lib/parse');
const { parseLFLRows } = require('../server/lib/lfl');
const modelRefresh = require('../server/lib/model-refresh');
const modelFields = require('../server/lib/model-fields');
const snapshot = require('../server/lib/model-snapshot');
const composition = require('./snapshot-composition');

// Üretim katalog başlıkları (model-fields.js) — demo kitapta olmayanlar deterministik değerle doldurulur.
const ASAS_EXTRA = ['Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo', 'Teknik Resim', 'Lisansör', 'Marka Müdürlükleri',
  'Para Birimi', 'Initial Inspection Geçme Tarih', 'Ürün Tanım'];
const CPX = ['__CPX_Tedarikçi Grup', '__CPX_Planlama Statü', '__CPX_Sezon Tipi'];
const IAS_EXTRA = ['İthalat Dosya No', 'Konteyner No', 'Gemi Ad', 'Supplier Portal Statü Detay', 'Yükleme Talep Tarih',
  'Yükleme İthalat Onay Tarih', 'ETA Tarih', 'Antrepo Firma', 'Sezon', 'Merch Alt Grup Kod', 'Merch Marka Yaş Grup Kod',
  'Marka Müdürlükleri', 'Buyer Grup (TR)'];

function records(aoa, headerIndex) {
  const header = aoa[headerIndex];
  return aoa.slice(headerIndex + 1).map(row => Object.fromEntries(header.map((name, i) => [name, row[i] ?? null])));
}
function enrichAsas(list) {
  return list.map((r, i) => ({ ...r,
    [ASAS_EXTRA[0]]: i % 7 ? 0 : 120, [ASAS_EXTRA[1]]: `https://plm.example.invalid/images/style/${r['Plm Kod']}/technical-front.jpg`,
    [ASAS_EXTRA[2]]: ['Disney', 'Warner Bros', 'Mattel'][i % 3], [ASAS_EXTRA[3]]: ['ÇOCUK MÜDÜRLÜĞÜ', 'GENÇ MÜDÜRLÜĞÜ'][i % 2],
    [ASAS_EXTRA[4]]: 'USD', [ASAS_EXTRA[5]]: r['Initial Inspection Geçme Tarih Gün Ay Yıl'], [ASAS_EXTRA[6]]: r['Ürün Ana Tanım'],
    [CPX[0]]: `GRUP ${i % 9}`, [CPX[1]]: i % 4 ? 'Planlandı' : '', [CPX[2]]: 'Ana Sezon',
  }));
}
function enrichIas(list, asasByCode) {
  return list.map((r, i) => {
    const a = asasByCode.get(r['Sipariş Kod']) || {};
    return { ...r,
      [IAS_EXTRA[0]]: `ITH-2026-${String(100000 + i)}`, [IAS_EXTRA[1]]: `MSKU${String(7000000 + i)}`, [IAS_EXTRA[2]]: ['MAERSK EDIRNE', 'MSC IZMIR'][i % 2],
      [IAS_EXTRA[3]]: r['Supplier Portal Statü'], [IAS_EXTRA[4]]: r['Tahmini Antrepo Giriş Tarihi'], [IAS_EXTRA[5]]: r['HANDOVER Tarihi'] || null,
      [IAS_EXTRA[6]]: r['Tahmini Antrepo Giriş Tarihi'], [IAS_EXTRA[7]]: 'DEMO ANTREPO', [IAS_EXTRA[8]]: a['Sezon'] || null,
      [IAS_EXTRA[9]]: a['Merch Alt Grup Kod'] || null, [IAS_EXTRA[10]]: a['Merch Marka Yaş Grup Kod'] || null,
      [IAS_EXTRA[11]]: ['ÇOCUK MÜDÜRLÜĞÜ', 'GENÇ MÜDÜRLÜĞÜ'][i % 2], [IAS_EXTRA[12]]: a['Buyer Grup (TR)'] || null,
    };
  });
}

function modelItems() {
  const asasMapping = {}, iasMapping = {};
  for (const field of modelFields.fieldsForRole('asas')) asasMapping[field.header] = { table: 'Model Özellikleri', name: field.header, kind: 'column' };
  for (const field of modelFields.fieldsForRole('antrepo')) iasMapping[field.header] = { table: 'Ithalat', name: field.header, kind: 'column' };
  return [
    { id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 's', catalog: 'ASAS', refreshEnabled: true, mappingEnhancementScanVersion: 4,
      horizon: { table: 'Model Özellikleri', seasonTable: 'Model Özellikleri', seasonField: 'Sezon', seasons: ['6W26', '6S27'], groups: [] }, mapping: asasMapping },
    { id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'IASv2', refreshEnabled: true,
      horizon: { table: 'Ithalat', groups: [] }, mapping: iasMapping },
  ];
}

async function buildPayload() {
  const data = build({ rows, seed: 7, today: new Date(Date.UTC(2026, 10, 5)) });
  const asasRecords = enrichAsas(records(data.asas, 2));
  const asasByCode = new Map(asasRecords.map(r => [r['Sipariş Kod'], r]));
  const iasRecords = enrichIas(records(data.antrepo, 0), asasByCode);
  const lfl = parseLFLRows(records(data.lfl, 1), 'Synthetic');
  const started = Date.now();
  let asasOrdersByTarget, antrepoMapByTarget;
  if (mode === 'excel') {
    const orders = parse.parseASASRows(asasRecords).orders, map = parse.parseAntrepoRows(iasRecords);
    asasOrdersByTarget = { cp: orders, orders, backlog: orders, priceanalysis: orders };
    antrepoMapByTarget = { cp: map, orders: map, backlog: map };
  } else {
    const result = await modelRefresh.loadFromModelConnections(modelItems(), {
      targets: ['cp', 'orders', 'backlog', 'priceanalysis'], includeLfl: false, columnType: false,
      discoverSchema: async () => ({ columns: [], measures: [] }),
      runModelRows: async plan => {
        const source = /'Ithalat'/.test(plan.query) ? iasRecords : asasRecords;
        return { rows: source.map(r => ({ ...r })), rowCount: source.length };
      },
    });
    asasOrdersByTarget = result.asasOrdersByTarget; antrepoMapByTarget = result.antrepoMapByTarget;
  }
  const sourceMs = Date.now() - started;
  return { sourceMs, payload: {
    loadedAt: '2026-11-05T08:00:00.000Z', sources: { asas: `${mode}: synthetic`, antrepo: `${mode}: synthetic`, lfl: 'synthetic' },
    asasOrders: asasOrdersByTarget.cp, asasOrdersByTarget, antrepoMap: antrepoMapByTarget.cp, antrepoMapByTarget,
    antrepoHeaderInfo: null, fabricHeaderInfo: null, lflRows: lfl.rows, lflMeta: lfl.meta, lflLoadedAt: '2026-11-05T08:00:00.000Z',
    cpupdateInfo: null, cpupdateOverrides: null, refreshWarnings: [], refreshWarningDetails: [], modelRefresh: null, lastRefreshResult: null,
  } };
}

async function main() {
  const gc = typeof global.gc === 'function' ? global.gc : () => {};
  const MiB = n => +(n / 1048576).toFixed(1);
  let built = await buildPayload();
  const { sourceMs } = built;
  gc();
  const heapWithSource = process.memoryUsage().heapUsed;
  const saveStarted = Date.now();
  const saved = await snapshot.saveModelSnapshotAsync('synthetic', built.payload);
  const saveMs = Date.now() - saveStarted;
  const orders = built.payload.asasOrders.length;
  built = null;
  // Yükleme + heap ayrı, temiz bir süreçte ölçülür (kaynak verisinin kalıntısı karışmaz).
  const child = require('child_process').spawnSync(process.execPath,
    ['--expose-gc', `--max-old-space-size=${8192}`, __filename, '--load-only', '--root', root], { encoding: 'utf8', env: process.env });
  if (child.status !== 0) throw new Error(`Yükleme ölçümü başarısız: ${child.stderr}`);
  const load = JSON.parse(child.stdout.trim().split('\n').pop());
  if (load.orders !== orders) throw new Error('Snapshot geri yüklenemedi');
  const report = composition.analyzeFile(snapshot.snapshotPath('synthetic'), { verify: true, top: 15, columnNames: true });
  const summary = { mode, rows, orders, sourceMs, compressedBytes: saved.bytes, uncompressedBytes: saved.uncompressedBytes,
    aliasCount: saved.aliasCount, saveMs, heapWithSourceMiB: MiB(heapWithSource), ...load };
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ summary, report }, null, 2)}\n`);
  else if (process.argv.includes('--summary')) process.stdout.write(`${JSON.stringify(summary)}\n`);
  else process.stdout.write(`${JSON.stringify(summary)}\n\n${composition.formatReport(report)}\n`);
  if (!process.argv.includes('--keep')) fs.rmSync(root, { recursive: true, force: true });
}

async function loadOnly() {
  const gc = typeof global.gc === 'function' ? global.gc : () => {};
  gc(); gc();
  const baseline = process.memoryUsage().heapUsed;
  const started = Date.now();
  const loaded = await snapshot.loadModelSnapshotAsync('synthetic');
  const loadMs = Date.now() - started;
  gc(); gc();
  const heap = process.memoryUsage().heapUsed - baseline;
  // Açılıştaki türetilmiş girdi anahtarları (server/lib/derived-input-keys.js) aynı yüklenmiş veriyle.
  const keysStarted = Date.now();
  require('../server/lib/derived-input-keys').keys(loaded, 'benchmark', {}, { version: 'benchmark', day: '2026-11-05' });
  const derivedKeysMs = Date.now() - keysStarted;
  process.stdout.write(`${JSON.stringify({ orders: loaded ? loaded.asasOrders.length : -1, loadMs, loadMetrics: loaded && loaded._snapshotMetrics,
    heapLoadedSnapshotMiB: +(heap / 1048576).toFixed(1), derivedKeysMs })}\n`);
}

(process.argv.includes('--load-only') ? loadOnly() : main()).catch(error => { console.error(error); process.exitCode = 1; });
