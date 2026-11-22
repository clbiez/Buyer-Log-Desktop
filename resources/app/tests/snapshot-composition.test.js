'use strict';

/* scripts/snapshot-composition.js — saha teşhisi. Kullanıcının bilgisayarında
   kurulu Buyer Log'un Electron'u ile tek dosya olarak çalışır; bu yüzden (1)
   yalnız Node yerleşik modüllerini yükler, (2) hiçbir iş değeri / sipariş kodu /
   harita anahtarı yazdırmaz, (3) baytları tam hesaplar ve hedefler arası birebir
   kopyaları bulur. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { builtinModules } = require('node:module');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'snapshot-composition.js');
const composition = require(SCRIPT);

const SECRET_CODE = 987654321, SECRET_VALUE = 'GIZLI-DEGER-XYZ', SECRET_COLUMN = 'Gizli Ham Sütun Adı', SECRET_KEY = 'GIZLIANAHTAR|M1|C';
function order(i) {
  return { ocode: SECRET_CODE + i, model: `${SECRET_VALUE}-${i}`, qty: 10, _cpExtra: { __CPX_A: 'x' }, _sourceValues: { 'Sipariş Kod': SECRET_CODE + i },
    _sourceFields: { 'Sipariş Kod': SECRET_CODE + i, [SECRET_COLUMN]: `${SECRET_VALUE}-${i}`, 'Boş': null, 'Boş Metin': '' }, _matchValues: {} };
}
const ias = i => ({ ocode: String(SECRET_CODE + i), statu: 'Depoda', _sourceFields: { [SECRET_COLUMN]: SECRET_VALUE } });
function payloadContent() {
  const base = [order(1), order(2)];
  const copy = JSON.parse(JSON.stringify(base)); // ayrı nesne, aynı bayt: eski model-refresh davranışı
  const narrow = [order(1)];
  const map = { [SECRET_KEY]: ias(1), 'K2': [ias(2), ias(3)] };
  return {
    asasOrders: base, asasOrdersByTarget: { orders: copy, backlog: narrow },
    antrepoMap: map, antrepoMapByTarget: { orders: JSON.parse(JSON.stringify(map)) },
    lflRows: [{ orderCode: SECRET_CODE, modelName: SECRET_VALUE }], targetAliases: { asasOrdersByTarget: { cp: 'asasOrders' } },
  };
}
function writeSnapshot(dir, name, doc) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(doc))));
  return file;
}
function v2(content) {
  const payload = { savedAt: '2026-11-05T00:00:00.000Z', refreshWarnings: [SECRET_VALUE], ...content };
  const json = JSON.stringify(payload);
  const checksum = require('node:crypto').createHash('sha256').update(json).digest('hex');
  return { schemaVersion: 2, checksum, contentKey: '0'.repeat(64), payload };
}

test('betik yalnız Node yerleşik modüllerini yükler (tek dosya olarak taşınabilir)', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1].replace(/^node:/, ''));
  assert.ok(requires.length > 0);
  for (const name of requires) assert.ok(builtinModules.includes(name), `yerleşik olmayan modül: ${name}`);
});

test('rapor değer, sipariş kodu, harita anahtarı ve (bayraksız) sütun adı içermez', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-composition-'));
  try {
    const file = writeSnapshot(dir, 'u.json.gz', v2(payloadContent()));
    const report = composition.analyzeFile(file, { verify: true, top: 25, columnNames: false });
    const outputs = [composition.formatReport(report), JSON.stringify(report)];
    for (const text of outputs) {
      for (const secret of [SECRET_VALUE, String(SECRET_CODE), SECRET_COLUMN, SECRET_KEY, 'K2', 'Boş Metin']) {
        assert.ok(!text.includes(secret), `rapor gizli içerik sızdırdı: ${secret}`);
      }
    }
    const named = composition.analyzeFile(file, { verify: true, top: 25, columnNames: true });
    const namedText = composition.formatReport(named);
    assert.ok(namedText.includes(SECRET_COLUMN), '--column-names yalnız sütun adını açar');
    assert.ok(!namedText.includes(SECRET_VALUE) && !namedText.includes(String(SECRET_CODE)), 'değerler yine yazılmaz');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('baytlar tam hesaplanır; birebir aynı hedef ve satır tekrarları bulunur', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-composition-'));
  try {
    const doc = v2(payloadContent());
    const file = writeSnapshot(dir, 'u.json.gz', doc);
    const r = composition.analyzeFile(file, { verify: true, top: 25, columnNames: false });
    const rawLength = Buffer.byteLength(JSON.stringify(doc));
    assert.equal(r.uncompressedBytes, rawLength);
    assert.equal(r.checksumOk, true);
    assert.equal(r.schemaVersion, 2);
    // payload = "{" + girdiler (virgüller dahil) + "}"; zarf geri kalanı.
    assert.equal(r.topLevel.reduce((sum, t) => sum + t.bytes, 0) + 2 + r.envelopeBytes, rawLength);
    const top = Object.fromEntries(r.topLevel.map(t => [t.key, t.bytes]));
    assert.equal(top.asasOrders, Buffer.byteLength(`"asasOrders":${JSON.stringify(doc.payload.asasOrders)},`));

    const parts = Object.fromEntries(r.sources.asas.parts.map(p => [p.name, p]));
    assert.equal(parts['asasOrdersByTarget.orders'].identicalTo, 'asasOrders');
    assert.equal(parts['asasOrdersByTarget.backlog'].identicalTo, null);
    assert.equal(parts['asasOrdersByTarget.backlog'].rowsAlsoInEarlierPart, 1, 'dar hedefin tek satırı tabanda birebir var');
    const iasParts = Object.fromEntries(r.sources.ias.parts.map(p => [p.name, p]));
    assert.equal(iasParts.antrepoMap.mapKeys, 2);
    assert.equal(iasParts.antrepoMap.mapArrayValues, 1);
    assert.equal(iasParts.antrepoMap.rows, 3);
    assert.equal(iasParts['antrepoMapByTarget.orders'].identicalTo, 'antrepoMap');

    // _sourceFields: tekil bölümler (asasOrders + backlog) üzerinden ad/değer baytı.
    const unique = [...doc.payload.asasOrders, ...doc.payload.asasOrdersByTarget.backlog];
    let keyBytes = 0, valueBytes = 0;
    for (const row of unique) {
      const entries = Object.entries(row._sourceFields);
      entries.forEach(([k, v], i) => {
        keyBytes += Buffer.byteLength(`${JSON.stringify(k)}:`);
        valueBytes += Buffer.byteLength(JSON.stringify(v)) + (i < entries.length - 1 ? 1 : 0);
      });
    }
    const sf = r.sources.asas.sourceFields;
    assert.equal(sf.distinctColumns, 4);
    assert.equal(sf.rowsWithSourceFields, 3);
    assert.equal(sf.keyNameBytes, keyBytes);
    assert.equal(sf.valueBytes, valueBytes);
    const sfCategory = r.sources.asas.categories.find(c => c.name === '_sourceFields');
    const expected = unique.reduce((sum, row) => sum + Buffer.byteLength(`"_sourceFields":${JSON.stringify(row._sourceFields)},`), 0);
    assert.equal(sfCategory.bytes, expected);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('eski schema v1, klasör girişi, yedek dosya atlama ve --out çalışır', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-composition-'));
  try {
    writeSnapshot(dir, 'legacy.json.gz', { schemaVersion: 1, ...payloadContent() });
    writeSnapshot(dir, 'legacy.json.gz.bak', { schemaVersion: 1 });
    const out = path.join(dir, 'rapor.txt');
    const run = spawnSync(process.execPath, [SCRIPT, dir, '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const text = fs.readFileSync(out, 'utf8');
    assert.match(text, /== legacy\.json\.gz/);
    assert.ok(!text.includes('.bak'));
    assert.match(text, /schema v1/);
    assert.ok(!text.includes(SECRET_VALUE));
    const missing = spawnSync(process.execPath, [SCRIPT, path.join(dir, 'yok')], { encoding: 'utf8' });
    assert.equal(missing.status, 1, 'okunamayan dosya hata kodu döner');
    assert.ok(!missing.stdout.includes(SECRET_VALUE));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
