'use strict';

/* Snapshot v3 (sütun sözlüklü satır torbaları).
 *
 * Faz 1 okuyucuyu getirdi; faz 2 yazıcıyı v3'e geçirir. v2 dosyaları okunmaya
 * devam eder. Sözleşme: v3 dosyası açıldığında bellekteki veri, aynı yükün v2
 * dosyasından açılan hâliyle birebir aynıdır; başlıktaki decodedBytes v2 payload
 * baytına eşittir ve işçi/bellek tahmini bunu kullanır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-v3-reader-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = root;
const snapshots = require('../server/lib/model-snapshot');

test.after(() => fs.rmSync(root, { recursive:true, force:true }));

const HEADERS = ['Sipariş Kod', 'Model Adı', 'Sezon', 'Net Alım Sipariş Miktarı', 'Sipariş Yerleştirme MerchTarih'];
function sourceFields(i) {
  return { [HEADERS[0]]:`ORD-${i}`, [HEADERS[1]]:`MODEL ${i % 7}`, [HEADERS[2]]:'6S27', [HEADERS[3]]:i * 10, [HEADERS[4]]:'2026-03-09T21:00:00.000Z' };
}
function payload(rowCount = 200) {
  const orders = Array.from({ length:rowCount }, (_, i) => ({
    ocode:`ORD-${i}`, model:`MODEL ${i % 7}`, qty:i * 10, opd:new Date(Date.UTC(2026, 2, 9, 21)),
    _sourceFields:sourceFields(i),
    _cpExtra:{ '__CPX_Tedarikçi Grup':`GRUP ${i % 3}` },
    _sourceValues:{}, // boş torba
    _matchValues:i % 2 ? { 'Sipariş Kod':`ORD-${i}` } : { 'Sipariş Kod':`ORD-${i}`, Renk:'BLUE' }, // iki farklı şema
  }));
  // Kenar durumları: undefined değer (JSON'da düşer), __proto__ adlı ham sütun, dizi biçimli torba.
  orders[1]._sourceFields = { ...orders[1]._sourceFields, Bos:undefined };
  orders[2]._sourceFields = JSON.parse(`{"__proto__":"ham değer","Sezon":"6S27"}`);
  orders[3]._cpExtra = ['dizi', 'torba'];
  const backlog = orders.slice(0, 50).map(row => ({ ...row, backlogOnly:true }));
  const antrepoMap = Object.fromEntries(orders.slice(0, 80).map((row, i) => [row.ocode, i % 2
    ? { qty:i, _sourceFields:{ 'Konteyner No':`MSKU${i}`, 'Gemi Ad':'MSC IZMIR' } }
    : [{ qty:i, _sourceFields:{ 'Konteyner No':`MSKU${i}` } }, { qty:i + 1, _sourceFields:{ 'Konteyner No':`MSKX${i}` } }]]));
  const lflRows = orders.map((row, i) => ({ id:`Model:${i + 2}`, season:'6S27', fob:4.5, quantity:i + 1, _asas:{ ...row._sourceFields } }));
  return {
    loadedAt:'2026-11-05T08:00:00.000Z', sources:{ asas:'Model: ASAS' },
    asasOrders:orders, asasOrdersByTarget:{ cp:orders, orders, backlog, priceanalysis:orders },
    antrepoMap, antrepoMapByTarget:{ cp:antrepoMap, orders:antrepoMap, backlog:antrepoMap },
    lflRows, lflMeta:{ rowCount:lflRows.length }, lflLoadedAt:'2026-11-05T08:00:00.000Z',
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
function writeRaw(userId, rawJson, suffix = '') {
  const file = snapshots.snapshotPath(userId) + suffix;
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, zlib.gzipSync(rawJson));
  return file;
}
function v2PayloadBytes(raw) {
  const start = raw.indexOf(Buffer.from('"payload":')) + '"payload":'.length;
  return raw.length - 1 - start;
}
// 8.0.6 ve öncesi okuyucunun kabul kuralı (decodeSnapshotRaw, v1/v2): yalnız bu sürümler açılır.
function legacyV2Reader(raw) {
  const parsed = JSON.parse(raw.toString('utf8'));
  if (parsed.schemaVersion === 1) return parsed;
  if (parsed.schemaVersion !== 2 || !parsed.payload) throw new Error('Snapshot schema sürümü desteklenmiyor.');
  const marker = Buffer.from('"payload":'), start = raw.indexOf(marker);
  const sum = crypto.createHash('sha256').update(raw.subarray(start + marker.length, -1)).digest('hex');
  if (sum !== parsed.checksum) throw new Error('Snapshot checksum uyuşmuyor.');
  return parsed.payload;
}

// v2 dosyası (8.0.6 ve öncesinin yazdığı biçim) — faz 2'de yalnız geriye uyum için üretilir.
const saveV2 = (userId, source) => writeRaw(userId, snapshots.encodeLegacyV2Snapshot(source).json);

test('faz 2: yazıcı v3 yazar (async ve sync); 8.0.6 okuyucusu reddeder — faz 1 bir sürüm önce yayında olmalı', async () => {
  for (const saved of [await snapshots.saveModelSnapshotAsync('writer-v3', payload()), snapshots.saveModelSnapshot('writer-v3-sync', payload())]) {
    const raw = zlib.gunzipSync(fs.readFileSync(saved.file));
    const wrapper = JSON.parse(raw.toString('utf8'));
    assert.equal(snapshots.SNAPSHOT_SCHEMA_VERSION, 3);
    assert.equal(wrapper.schemaVersion, 3);
    assert.equal(wrapper.decodedBytes, saved.uncompressedBytes, 'uncompressedBytes işçi ayırması için çözülmüş boyuttur');
    assert.equal(saved.fileBytes, raw.length);
    assert.ok(saved.fileBytes < saved.uncompressedBytes);
    assert.ok(Array.isArray(wrapper.payload.asasOrders[0]._sourceFields));
    assert.throws(() => legacyV2Reader(raw), /desteklenmiyor/);
  }
});

test('v3 bayt bayt tur: kaydet → aç → yeniden kodla aynı içerik baytlarını üretir; kaynak değişmez', async () => {
  const source = payload();
  const before = JSON.stringify(source);
  const first = snapshots.encodeColumnarSnapshot(source);
  assert.equal(JSON.stringify(source), before, 'kodlayıcı kaynak satırları değiştirmemeli');
  writeRaw('byte-roundtrip', first.json);
  const loaded = await snapshots.loadModelSnapshotAsync('byte-roundtrip');
  const second = snapshots.encodeColumnarSnapshot(loaded);
  assert.equal(second.contentKey, first.contentKey);
  const strip = buffer => buffer.toString('utf8').replace(/"checksum":"[0-9a-f]{64}"/, '').replace(/"savedAt":"[^"]+"/, '');
  assert.equal(strip(second.json), strip(first.json));
  // Async kayıt yolu da aynı içerik baytlarını üretir.
  const saved = await snapshots.saveModelSnapshotAsync('byte-roundtrip-async', source);
  assert.equal(strip(zlib.gunzipSync(fs.readFileSync(saved.file))), strip(first.json));
});

test('v3 kodlayıcı torbaları sütun sözlüğüne çevirir, eski okuyucu v3 dosyasını reddeder', () => {
  const encoded = snapshots.encodeColumnarSnapshot(payload());
  const wrapper = JSON.parse(encoded.json.toString('utf8'));
  assert.equal(wrapper.schemaVersion, 3);
  assert.equal(snapshots.COLUMNAR_SNAPSHOT_SCHEMA_VERSION, 3);
  assert.ok(Array.isArray(wrapper.payload._bagColumns) && wrapper.payload._bagColumns.length >= 4);
  assert.ok(Array.isArray(wrapper.payload.asasOrders[0]._sourceFields));
  assert.ok(Array.isArray(wrapper.payload.lflRows[0]._asas));
  assert.throws(() => legacyV2Reader(encoded.json), /desteklenmiyor/);
});

test('v3 okuma, aynı yükün v2 okumasıyla birebir aynı veriyi ve tipleri üretir', async () => {
  const source = payload();
  saveV2('same-v2', source);
  const fromV2 = await snapshots.loadModelSnapshotAsync('same-v2');
  writeRaw('same-v3', snapshots.encodeColumnarSnapshot(source).json);
  const fromV3 = await snapshots.loadModelSnapshotAsync('same-v3');
  const fromV3Sync = snapshots.loadModelSnapshot('same-v3');
  const strip = value => { const { savedAt, ...rest } = plain(value); return rest; };
  assert.deepEqual(strip(fromV3), strip(fromV2));
  assert.deepEqual(strip(fromV3Sync), strip(fromV2));
  // Hedef takma adları ve Date dönüşümü v2 ile aynı.
  assert.equal(fromV3.asasOrdersByTarget.cp, fromV3.asasOrders);
  assert.ok(fromV3.asasOrders[0].opd instanceof Date);
  assert.ok(fromV3.asasOrders[0]._sourceFields[HEADERS[4]] instanceof Date);
  // Kenar durumları: undefined düşer, __proto__ kendi alanı olarak kalır, dizi torba dizi kalır.
  assert.equal(Object.prototype.hasOwnProperty.call(fromV3.asasOrders[1]._sourceFields, 'Bos'), false);
  assert.equal(Object.getPrototypeOf(fromV3.asasOrders[2]._sourceFields), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(fromV3.asasOrders[2]._sourceFields, '__proto__').value, 'ham değer');
  assert.deepEqual(fromV3.asasOrders[3]._cpExtra, ['dizi', 'torba']);
  assert.deepEqual(Object.keys(fromV3.lflRows[5]._asas), HEADERS);
  assert.equal(fromV3._bagColumns, undefined);
});

test('v3 decodedBytes v2 payload baytına eşittir ve yükleme metriği bunu bildirir', async () => {
  const source = payload();
  const encoded = snapshots.encodeColumnarSnapshot(source);
  const v2Raw = snapshots.encodeLegacyV2Snapshot(source).json;
  const wrapper = JSON.parse(encoded.json.toString('utf8'));
  // savedAt her iki dosyada da sabit uzunlukta ISO metnidir; payload baytları birebir karşılaştırılabilir.
  assert.equal(encoded.decodedBytes, v2PayloadBytes(v2Raw));
  assert.equal(wrapper.decodedBytes, encoded.decodedBytes);
  assert.ok(encoded.json.length < v2Raw.length * 0.85, `v3 küçük olmalı: ${encoded.json.length}/${v2Raw.length}`);
  writeRaw('bytes-v3', encoded.json);
  const loaded = await snapshots.loadModelSnapshotAsync('bytes-v3');
  assert.equal(loaded._snapshotMetrics.decodedBytes, encoded.decodedBytes);
});

test('karışık sürüm: bozuk v3 ana kopyada v2 yedeğe, bozuk v2 ana kopyada v3 yedeğe düşer', async () => {
  const source = payload(60);
  const v3 = snapshots.encodeColumnarSnapshot(source).json;
  const corruptV3 = Buffer.from(v3.toString('utf8').replace('ORD-5', 'ORD-X'));
  saveV2('mixed-a', source); fs.renameSync(snapshots.snapshotPath('mixed-a'), snapshots.snapshotPath('mixed-a') + '.bak');
  writeRaw('mixed-a', corruptV3);
  const a = await snapshots.loadModelSnapshotAsync('mixed-a');
  assert.equal(a._snapshotMetrics.fallback, true);
  assert.equal(a.asasOrders[5].ocode, 'ORD-5');

  writeRaw('mixed-b', Buffer.from('{"schemaVersion":2,"checksum":"00","payload":{"asasOrders":[]}}'));
  writeRaw('mixed-b', v3, '.bak');
  const b = await snapshots.loadModelSnapshotAsync('mixed-b');
  assert.equal(b._snapshotMetrics.fallback, true);
  assert.equal(b.lflRows[5]._asas[HEADERS[0]], 'ORD-5');
  assert.equal(snapshots.loadModelSnapshot('mixed-b').lflRows[5]._asas[HEADERS[0]], 'ORD-5');
});

test('geçiş: v2 dosyası açılır, sonraki kayıt v3 olarak tam yazılır; aynı içerik tekrar kaydedilince yeniden kullanılır', async () => {
  const source = payload(40);
  saveV2('migrate', source);
  const loaded = await snapshots.loadModelSnapshotAsync('migrate');
  const saved = await snapshots.saveModelSnapshotAsync('migrate', loaded);
  assert.equal(saved.reused, false, 'v2 tabanı v3 içerik anahtarıyla eşleşmemeli');
  const raw = zlib.gunzipSync(fs.readFileSync(saved.file));
  assert.equal(JSON.parse(raw).schemaVersion, 3);
  const again = await snapshots.saveModelSnapshotAsync('migrate', loaded);
  assert.equal(again.reused, true);
  assert.equal(again.uncompressedBytes, saved.uncompressedBytes);
  const reopened = await snapshots.loadModelSnapshotAsync('migrate');
  assert.equal(reopened.lflRows[3]._asas[HEADERS[0]], 'ORD-3');
});

test('bilinmeyen sürüm ve bozuk v3 sözlük referansı reddedilir', () => {
  writeRaw('v4', Buffer.from('{"schemaVersion":4,"checksum":"00","payload":{"asasOrders":[]}}'));
  assert.equal(snapshots.loadModelSnapshot('v4'), null);
  const wrapper = JSON.parse(snapshots.encodeColumnarSnapshot(payload(10)).json.toString('utf8'));
  wrapper.payload.asasOrders[0]._sourceFields[0] = 999;
  const payloadJson = JSON.stringify(wrapper.payload);
  const sum = crypto.createHash('sha256').update(payloadJson).digest('hex');
  writeRaw('bad-ref', Buffer.from(`{"schemaVersion":3,"checksum":"${sum}","contentKey":"","decodedBytes":1,"payload":${payloadJson}}`));
  assert.equal(snapshots.loadModelSnapshot('bad-ref'), null);
});

test('snapshotByteEstimate: v2 için gzip açık boyutu, v3 için başlıktaki decodedBytes', async () => {
  const source = payload();
  const v2 = snapshots.encodeLegacyV2Snapshot(source);
  assert.equal(await snapshots.snapshotByteEstimate(writeRaw('estimate-v2', v2.json)), v2.json.length);
  const saved = await snapshots.saveModelSnapshotAsync('estimate-saved', source);
  assert.equal(await snapshots.snapshotByteEstimate(saved.file), saved.uncompressedBytes);
  const encoded = snapshots.encodeColumnarSnapshot(source);
  const file = writeRaw('estimate-v3', encoded.json);
  assert.ok(encoded.decodedBytes > encoded.json.length);
  assert.equal(await snapshots.snapshotByteEstimate(file), encoded.decodedBytes);
  assert.equal(await snapshots.snapshotByteEstimate(path.join(root, 'yok.json.gz')), null);
});

test('server computeSnapshotByteEstimate disk yolunda snapshotByteEstimate ipucunu kullanır', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const start = source.indexOf('async function computeSnapshotByteEstimate(');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  assert.match(body, /snapshotByteEstimate\(/);
  assert.doesNotMatch(body, /readUInt32LE/);
});

test('snapshot-composition teşhisi v3 dosyasında sütun adlarını sözlükten okur', async () => {
  const composition = require('../scripts/snapshot-composition');
  const saved = await snapshots.saveModelSnapshotAsync('composition-v3', payload(30));
  const report = composition.analyzeFile(saved.file, { verify:true, top:10, columnNames:true });
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.checksumOk, true);
  assert.ok(report.bagColumns && report.bagColumns.schemas >= 4);
  const sf = report.sources.asas.sourceFields;
  assert.equal(sf.rowsWithSourceFields, 60); // asasOrders 30 + ayrı backlog bölümü 30
  assert.equal(sf.keyNameBytes, 0, 'v3 satırlarında sütun adı yazılmaz');
  assert.ok(sf.heaviestColumns.some(column => column.column === HEADERS[0]));
  assert.match(composition.formatReport(report), /v3 sütun sözlüğü/);
});
