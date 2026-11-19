'use strict';

// WS0 (#1072): parite yardımcısının kendi sözleşmesi. Diğer WS'ler bu kapıyı
// "eski istemci çıktısı = yeni arka uç çıktısı" kanıtı için kullanır.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const parity = require('./helpers/read-model-parity.cjs');

const QTY = 'Net Alım Sipariş Miktarı'; // i18n-ignore — ASAS kaynak başlığı
const COUNTRY = 'Siparişin Üretildiği Ülke'; // i18n-ignore — ASAS kaynak başlığı

// "Legacy": döngüyle toplam; "candidate": Map ile toplam, farklı ekleme sırası.
function legacyTotals(rows, context) {
  const out = { context: context.scope, byCountry: {}, total: 0, rows: rows.length };
  for (const row of rows) {
    const qty = Number(row[QTY]) || 0;
    out.byCountry[row[COUNTRY]] = (out.byCountry[row[COUNTRY]] || 0) + qty;
    out.total += qty;
  }
  return out;
}
async function candidateTotals(rows, context) {
  const map = new Map();
  for (const row of [...rows].reverse()) map.set(row[COUNTRY], (map.get(row[COUNTRY]) || 0) + (Number(row[QTY]) || 0));
  const byCountry = Object.fromEntries([...map].sort());
  return { rows: rows.length, total: [...map.values()].reduce((a, b) => a + b, 0), byCountry, context: context.scope };
}

test('fixture deterministik, küçük ve hızlı: aynı argüman aynı hash', () => {
  const started = performance.now();
  const a = parity.makeFixture(), b = parity.makeFixture();
  assert.equal(a.asas.length, 2000);
  assert.equal(a.hash, b.hash);
  assert.equal(parity.canonicalHash(a.asas), parity.canonicalHash(b.asas));
  assert.notEqual(parity.makeFixture({ seed: 8 }).hash, a.hash, 'tohum değişince fixture değişir');
  assert.ok(performance.now() - started < 5000, 'fixture üretimi test bütçesinde');
  a.asas[0][QTY] = -1;
  assert.notEqual(parity.makeFixture().asas[0][QTY], -1, 'çağıran kopyayı değiştirince önbellek bozulmaz');
});

test('kanonik JSON: anahtar sırası, tarih, sayı, Map/Set biçimi sabit', () => {
  const left = { b: 1, a: [new Date(Date.UTC(2026, 0, 2)), -0, NaN, undefined], m: new Map([['y', 2], ['x', 1]]), s: new Set([3, 1]), u: undefined };
  const right = { s: new Set([1, 3]), m: new Map([['x', 1], ['y', 2]]), a: ['2026-01-02T00:00:00.000Z', 0, NaN, null], b: 1 };
  assert.equal(parity.canonicalJson(left), parity.canonicalJson(right));
  assert.equal(parity.canonicalJson(left), '{"a":["2026-01-02T00:00:00.000Z",0,{"$num":"NaN"},null],"b":1,"m":{"$map":[["x",1],["y",2]]},"s":{"$set":[1,3]}}');
  assert.equal(parity.canonicalJson({ v: 0.1 + 0.2 }, { decimals: 6 }), '{"v":0.3}');
  assert.notEqual(parity.canonicalJson({ v: 0.1 + 0.2 }), '{"v":0.3}', 'varsayılan tam eşitliktir');
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => parity.canonicalJson(cyclic), /döngüsel/);
  assert.throws(() => parity.canonicalJson({ fn() {} }), /serileştirilemez/);
});

test('eşdeğer iki hesaplama aynı SHA-256 ile PASS verir', async () => {
  const fixture = parity.makeFixture();
  const result = await parity.assertParity({ name: 'country-totals', rows: fixture.asas, context: { scope: 'all' }, legacy: legacyTotals, candidate: candidateTotals });
  assert.equal(result.equal, true);
  assert.match(result.legacyHash, /^[0-9a-f]{64}$/);
  assert.equal(result.legacyHash, result.candidateHash);
  assert.equal(result.divergence, null);
});

test('bilerek farklı iki çıktı FAIL verir ve ilk ayrışan yolu gösterir', async () => {
  const fixture = parity.makeFixture();
  const broken = async (rows, context) => {
    const out = await candidateTotals(rows, context);
    out.byCountry[Object.keys(out.byCountry)[1]] += 100;
    out.total += 100;
    return out;
  };
  const expectedKey = Object.keys(legacyTotals(fixture.asas, {}).byCountry).sort()[1];
  await assert.rejects(
    parity.assertParity({ name: 'country-totals', rows: fixture.asas, context: { scope: 'all' }, legacy: legacyTotals, candidate: broken }),
    error => {
      assert.equal(error.name, 'ReadModelParityError');
      assert.equal(error.parity.equal, false);
      assert.notEqual(error.parity.legacyHash, error.parity.candidateHash);
      // Anahtar sıralı derinlik öncelikli: byCountry, total'dan önce gelir.
      const segment = /^[A-Za-z_$][\w$]*$/.test(expectedKey) ? `.${expectedKey}` : `[${JSON.stringify(expectedKey)}]`;
      assert.equal(error.parity.divergence.path, `$.byCountry${segment}`);
      assert.equal(error.parity.divergence.right - error.parity.divergence.left, 100);
      assert.match(error.message, /parite FAIL — ilk ayrışan yol \$\.byCountry/);
      return true;
    },
  );
});

test('ayrışma raporu: eksik anahtar, dizi uzunluğu ve tür farkı', () => {
  assert.equal(parity.diffCanonical({ a: 1 }, { a: 1, b: 2 }).path, '$.b');
  assert.match(parity.diffCanonical({ a: 1 }, { a: 1, b: 2 }).reason, /legacy tarafında anahtar yok/);
  const list = parity.diffCanonical({ rows: [1, 2, 3] }, { rows: [1, 2] });
  assert.equal(list.path, '$.rows[2]');
  assert.match(list.reason, /dizi uzunluğu farklı: 3 ≠ 2/);
  assert.equal(parity.diffCanonical([{ 'Sipariş Kod': '1' }], [{ 'Sipariş Kod': 1 }]).path, '$[0]["Sipariş Kod"]'); // i18n-ignore
  assert.equal(parity.diffCanonical({ a: [1] }, { a: [1] }), null);
});

test('hesaplama girdiyi değiştirse bile iki taraf ayrı kopya alır', async () => {
  const rows = [{ v: 1 }, { v: 2 }];
  const mutating = list => { list.push({ v: 99 }); return list.length; };
  const result = await parity.compareParity({ name: 'isolation', rows, legacy: mutating, candidate: mutating });
  assert.equal(result.equal, true);
  assert.equal(rows.length, 2);
});

test('DOM suz tarayıcı betiği vm ile yüklenir; require ile aynı API', () => {
  const viaVm = parity.loadBrowserGlobal('public/canonical-fields.js', 'BLCanonicalFields');
  const viaRequire = require(path.join(__dirname, '..', 'public', 'canonical-fields.js'));
  assert.deepEqual(Object.keys(viaVm).sort(), Object.keys(viaRequire).sort());
  assert.throws(() => parity.loadBrowserGlobal('../outside.js', 'X'), /uygulama kökü dışında/);
});

// ---- Ölçüm betiği (scripts/benchmark-erp-readmodel.js) saf analiz fonksiyonları ----
const probe = require('../scripts/lib/erp-readmodel-probe.js');

test('CPU profili: anchor ile performance.now hizalaması, self time ve en dıştaki app-main.js çerçevesi', () => {
  const app = 'http://127.0.0.1:1/app-main.js';
  const nodes = [
    { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2, 3, 4, 7] },
    { id: 2, callFrame: { functionName: probe.ANCHOR_NAME, url: '' } },
    { id: 3, callFrame: { functionName: '(idle)', url: '' } },
    { id: 4, callFrame: { functionName: 'renderOverview', url: app, lineNumber: 9 }, children: [5] },
    { id: 5, callFrame: { functionName: 'helper', url: app, lineNumber: 19 }, children: [6] },
    { id: 6, callFrame: { functionName: 'analyzeOrder', url: 'http://127.0.0.1:1/cp-readiness-engine.js', lineNumber: 4 } },
    { id: 7, callFrame: { functionName: '(garbage collector)', url: '' } },
  ];
  // 1 ms aralık; anchor örnekleri 10–11 ms (profil ekseni), performance.now'da 100 ms.
  const samples = [3, 3, 2, 2, 3, 6, 6, 6, 5, 7, 3];
  const timeDeltas = [9000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
  const out = probe.analyzeProfile({ nodes, startTime: 0, samples, timeDeltas }, { anchorPerfMs: 100, windows: [{ name: 'w', startMs: 102, endMs: 200 }] });
  assert.equal(out.aligned, true);
  const [w] = out.windows;
  // Hizalama: ilk anchor örneği 11 ms → ~100.5 ms; pencere 102+ → index 5..9 (analyzeOrder×3, helper, GC).
  assert.equal(w.busyMs, 5);
  assert.equal(w.gcMs, 1);
  assert.deepEqual(w.topSelf[0], { fn: 'analyzeOrder cp-readiness-engine.js:5', ms: 3 });
  assert.deepEqual(w.topAppMainOuter[0], { fn: 'renderOverview app-main.js:10', ms: 4 });
  assert.equal(probe.analyzeProfile({ nodes, startTime: 0, samples: [3], timeDeltas: [1] }, { anchorPerfMs: 1, windows: [] }).aligned, false);
});

test('uzun görev ve olay döngüsü gecikmesi pencereye kırpılır; timeline origin ile çevrilir', () => {
  assert.deepEqual(probe.longTaskStats([{ startTime: 90, duration: 30 }, { startTime: 150, duration: 400 }], 100, 300), { count: 2, totalMs: 170, maxMs: 150 });
  assert.deepEqual(probe.lagStats([[50, 500], [120, 250], [130, 10], [400, 999]], 100, 300), { samples: 2, maxMs: 250, over200Count: 1 });
  assert.deepEqual(probe.timelineToPerf([{ name: 'BACKGROUND_WARMUP_DONE', atMs: 900 }], 25), [{ name: 'BACKGROUND_WARMUP_DONE', atMs: 900, perfMs: 925, detail: null }]);
  assert.equal(probe.median([3, 1, 2, NaN]), 2);
  assert.equal(probe.median([4, 1, 2, 3]), 2.5);
  assert.ok(probe.isTrackedPayload('/api/page-projection/cp') && probe.isTrackedPayload('/api/data') && !probe.isTrackedPayload('/api/status'));
});

test('başka realm (vm) Map/Set/Date değerleri de kanonikleşir: farklı içerik FAIL verir', async () => {
  const vm = require('node:vm');
  const realm = vm.createContext({});
  const make = qty => vm.runInContext(`({ m: new Map([['qty', ${qty}]]), s: new Set([${qty}]), d: new Date(Date.UTC(2026, 0, ${qty % 28 + 1})) })`, realm);
  assert.equal(parity.canonicalJson(make(1)), parity.canonicalJson({ m: new Map([['qty', 1]]), s: new Set([1]), d: new Date(Date.UTC(2026, 0, 2)) }));
  const result = await parity.compareParity({ name: 'vm-map', legacy: () => make(1), candidate: () => make(999) });
  assert.equal(result.equal, false);
  assert.equal(result.divergence.path, '$.d');
  const mapOnly = await parity.compareParity({ name: 'vm-map-only', legacy: () => make(1).m, candidate: () => make(999).m });
  assert.equal(mapOnly.equal, false, 'VM Map {} olarak düzleşip sahte PASS vermez');
  assert.match(mapOnly.divergence.path, /^\$\.\$map\[0\]\[1\]$/);
});

test('benchmark Backlog hazır koşulu yükleme/hata yer tutucusunu kabul etmez', () => {
  const { MODULES } = require('../scripts/lib/erp-readmodel-run.js');
  const empty = { offsetParent: {}, dataset: {}, getAttribute: name => (name === 'aria-busy' ? empty.busy : null), busy: null };
  const previous = globalThis.document;
  let rows = null;
  globalThis.document = { querySelector: () => rows, getElementById: id => (id === 'backlogEmpty' ? empty : null) };
  try {
    empty.dataset.uiState = 'loading'; empty.busy = 'true';
    assert.equal(MODULES.backlog.ready(), false, 'yükleme durumu hazır değildir');
    empty.dataset.uiState = 'error'; empty.busy = null;
    assert.equal(MODULES.backlog.ready(), false);
    assert.equal(MODULES.backlog.failed(), true, 'hata durumu başarısız sayılır');
    delete empty.dataset.uiState;
    assert.equal(MODULES.backlog.ready(), true, 'tamamlanmış boş sonuç hazırdır');
    empty.offsetParent = null; rows = {};
    assert.equal(MODULES.backlog.ready(), true, 'rapor satırı hazırdır');
  } finally {
    globalThis.document = previous;
  }
});
