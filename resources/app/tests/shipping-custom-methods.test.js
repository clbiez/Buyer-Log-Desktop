'use strict';
/* Nakliye Kıyaslama — kullanıcı tanımlı ek nakliye şekilleri
   (ör. "Uçak+Uçak AKTARMALI"). Yöntem ortak navlun ayarında durur, ücret tipi
   olarak seçilir ve karşılaştırmada kendi Landed / avantaj / ETA sütununu açar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Freight = require('../public/freight-calc');
const Engine = require('../public/shipping-engine');
const { validateSettings } = require('../server/lib/freight-rate-service');
const parse = require('../server/lib/parse');

const APP = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const WORKFLOW = fs.readFileSync(path.join(__dirname, '../server/lib/shipping-workflow-service.js'), 'utf8');
const fn = name => {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  const end = APP.indexOf('\n}', start);
  return APP.slice(start, end + 2);
};

const METHOD = { id: 'm-air-air', label: 'Uçak+Uçak AKTARMALI', transitDays: 20 }; // i18n-ignore

function settingsWithMethod() {
  return Freight.normalizeSettings({
    ...Freight.defaultSettings(),
    methods: [METHOD],
    rates: [...Freight.defaultSettings().rates, { id: 'air-air', label: 'Aktarmalı', mode: METHOD.id, rate: 4 }], // i18n-ignore
  });
}

test('yöntem kimliği addan bağımsız sabit kalır, tekrarlar ve fazlası düşer', () => {
  const methods = Freight.normalizeMethods([
    { id: 'm-x1', label: '  Hızlı Gemi ', transitDays: '30' }, // i18n-ignore
    { id: 'm-x1', label: 'Kopya', transitDays: 10 }, // i18n-ignore
    { label: 'Uçak+Uçak', transitDays: 0 }, // i18n-ignore
    { label: '' },
  ]);
  assert.deepEqual(methods, [
    { id: 'm-x1', label: 'Hızlı Gemi', transitDays: 30 }, // i18n-ignore
    { id: 'm-ucak-ucak', label: 'Uçak+Uçak', transitDays: Freight.DEFAULT_METHOD_TRANSIT_DAYS }, // i18n-ignore
  ]);
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `m-${i}`, label: `M${i}`, transitDays: 5 }));
  assert.equal(Freight.normalizeMethods(many).length, Freight.MAX_METHODS);
  // Eski kayıt (methods alanı yok) bozulmadan boş listeyle okunur.
  assert.deepEqual(Freight.normalizeSettings({ rates: Freight.DEFAULT_RATES }).methods, []);
});

test('ücret özel yönteme bağlanabilir; yöntem silinirse ücret Gemi+Uçak\'a düşer', () => {
  const config = settingsWithMethod();
  assert.equal(config.rates.find(rate => rate.id === 'air-air').mode, METHOD.id);
  assert.deepEqual(Freight.modesFor(config), ['air', 'seaAir', METHOD.id]);
  const without = Freight.normalizeSettings({ ...config, methods: [] });
  assert.equal(without.rates.find(rate => rate.id === 'air-air').mode, 'seaAir');
});

test('Uygula, özel yöntemin Landed değerini kendi alanına yazar', () => {
  const config = settingsWithMethod();
  const result = Freight.calculate({ kgPerPiece: 0.2, qtyTotal: 1000, qtyPerCarton: 50, cartonL: 58, cartonH: 38, cartonW: 30, stylePrice: 5 }, config);
  const item = result.results.find(rate => rate.mode === METHOD.id);
  assert.ok(Number.isFinite(item.landed));
  assert.equal(Freight.landedFieldKey(METHOD.id), 'ydLanded__m-air-air');
  assert.equal(Engine.methodKeys(METHOD.id).landed, Freight.landedFieldKey(METHOD.id), 'motor ve navlun aynı alanı kullanmalı');
  const patch = Freight.landedPatch(item, 'T', config);
  assert.equal(patch['ydLanded__m-air-air'], Number(item.landed.toFixed(2)));
  assert.equal(patch._freightAppliedRate.mode, METHOD.id);
  // Kayıtlı ayarda olmayan yönteme yazılmaz.
  assert.equal(Freight.landedPatch(item, 'T', Freight.defaultSettings()), null);
  // Yerleşik tipler eskisi gibi.
  assert.equal(Freight.landedFieldKey('air'), 'ydFiyatUsdLandedUcak');
  assert.equal(Freight.landedFieldKey('seaAir'), 'ydFiyatUsdLandedGemiUcak');
  assert.equal(Freight.landedFieldKey('bogus'), null);
});

test('motor özel yöntem için avantaj, ETA ve toplam etkiyi hesaplar', () => {
  const toNum = v => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const toISODate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const deps = { coerceDateLoose: parse.parseDateOnly, toNum, toISODate, days: { Gemi: 60, 'Gemi+Uçak': 30, 'Uçak': 10 }, multipliers: { tr: 1.05, overseas: 1.11 } }; // i18n-ignore
  const raw = { exFactory: '2026-08-01', quantity: 1000, fob: 10, kur: 40, trFiyatTl: 440, 'ydLanded__m-air-air': 13 };
  const row = Engine.compute({ ...raw }, { ...deps, methods: [METHOD] });
  assert.equal(Number(row['ydAvantaj__m-air-air'].toFixed(4)), Number((13 / 11.55 - 1).toFixed(4)));
  assert.equal(row['ydTeslim__m-air-air'], '2026-08-21');
  assert.equal(Math.round(row['_total__m-air-air']), 1450);
  // Yöntem yoksa satıra hiçbir ek alan yazılmaz; mevcut hesap aynen korunur.
  const plain = Engine.compute({ ...raw }, deps);
  assert.equal(plain['ydAvantaj__m-air-air'], undefined);
  const { 'ydAvantaj__m-air-air': _a, 'ydTeslim__m-air-air': _e, '_total__m-air-air': _t, ...rest } = row;
  assert.deepEqual(rest, plain);
});

test('sunucu doğrulaması yöntemi kabul eder, hatalı yöntemi reddeder', () => {
  const base = { ...Freight.defaultSettings(), methods: [METHOD], rates: [{ id: 'aa', label: 'AA', mode: METHOD.id, rate: 4 }] };
  const saved = validateSettings(base);
  assert.deepEqual(saved.methods, [METHOD]);
  assert.equal(saved.rates[0].mode, METHOD.id);
  // Eski istemci (methods göndermeyen) kırılmaz.
  assert.deepEqual(validateSettings(Freight.defaultSettings()).methods, []);
  const bad = patch => assert.throws(() => validateSettings({ ...base, ...patch }), err => err.code === 'FREIGHT_INVALID');
  bad({ methods: [] }); // ücret artık tanımsız bir yönteme bağlı
  bad({ methods: [{ ...METHOD, label: ' ' }] });
  bad({ methods: [{ ...METHOD, transitDays: 0 }] });
  bad({ methods: [METHOD, { ...METHOD }] });
  bad({ methods: Array.from({ length: Freight.MAX_METHODS + 1 }, (_, i) => ({ id: `m-${i}`, label: `M${i}`, transitDays: 5 })) });
});

test('karşılaştırma tablosu, kopyalama ve navlun modalı yöntemleri dinamik okur', () => {
  assert.match(fn('shipDecisionOptions'), /\.\.\.shipCustomMethods\(\)\.map\(/);
  assert.match(fn('shipCompareHeadCells'), /shipCustomMethods\(\)/);
  assert.match(fn('shipCompareColumns'), /SHIP_COMPARE_COLUMNS\.concat\(shipCustomMethods\(\)/);
  assert.match(fn('shipComparisonClipboardColumns'), /shipCustomMethods\(\)\.flatMap/);
  assert.match(fn('computeShipFormulas'), /methods:shipCustomMethods\(\)/);
  // Kart/tablo düzenleyicisi özel Landed alanını tanır.
  assert.match(fn('commitShipEditor'), /shipColForKey\(key\)/);
  assert.match(fn('previewShipCardInput'), /shipColForKey\(key\)/);
  // Navlun modalı: ücret tipi listesi yöntemleri içerir, Uygula ortak alan eşlemesini kullanır.
  assert.match(APP, /\(settings\.methods\|\|\[\]\)\.map\(method=>`<option value="\$\{escapeHtml\(method\.id\)\}"/);
  assert.match(APP, /const key = BLFreight\.landedFieldKey\(item\.mode\);/);
  // Sunucu projeksiyonu yöntem alanlarını da taşır.
  assert.match(WORKFLOW, /INPUTS\.concat\(CALCULATED,methodFields\(state\)\)/);
});

test('methods alanını göndermeyen eski istemci kaydı ortak yöntemleri silmez', async () => {
  const { createFreightRateService } = require('../server/lib/freight-rate-service');
  let stored = { freightRates: { ...Freight.defaultSettings(), methods: [METHOD] }, _revisions: { freightRates: 3 } };
  const db = {
    loadOverrides: () => JSON.parse(JSON.stringify(stored)),
    mutateSharedResource: (_name, work) => work({ commit: async () => {} }),
    replaceFreightRates: (next, revision) => {
      stored = { freightRates: next, _revisions: { freightRates: revision + 1 } };
      return { freight: next, revision: revision + 1 };
    },
  };
  const service = createFreightRateService({ db });
  const { methods, ...legacy } = Freight.defaultSettings();
  assert.deepEqual(methods, []);
  const saved = await service.replace({ ...legacy, volumetricFactor: 170 }, { revision: 3 }, { assertAuthority: () => {} });
  assert.deepEqual(saved.freight.methods, [METHOD]);
  assert.equal(saved.freight.volumetricFactor, 170);
  // Açıkça boş liste gönderen yeni istemci yöntemleri kaldırabilir.
  const cleared = await service.replace({ ...legacy, methods: [] }, { revision: 4 }, { assertAuthority: () => {} });
  assert.deepEqual(cleared.freight.methods, []);
});
