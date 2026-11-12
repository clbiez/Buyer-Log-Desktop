'use strict';
// Koleksiyon → Nakliye Kıyaslama aktarımında fiyatlar (Onaylı → Best → Target)
// kaybolmamalı. Regresyon: yerel biçimli "4,33" Number() ile NaN, boş metin 0
// oluyordu; modeller $0 FOB / 0 TL ile aktarılıyordu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Engine = require('../public/shipping-engine');
const Groups = require('../public/collection-model-groups');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-collection-ship-price-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
const db = require('../server/db');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const toNum = v => { const n = Number(v); return isNaN(n) ? null : n; };
const deps = { toISODate: () => '', toNum, norm: v => String(v ?? '').trim(), normalizeTransitDelType: v => v || 'Gemi', parseMoney: Groups.kolParseMoneyNum };

test('engine parses locale money and carries the collection base price as Supp. FOB', () => {
  const row = Engine.mapCollectionRow({ plmId: 'P1', modelKod: 'NBA SHORT 2', fob: '4,33', targetPrice: '2,50', trPrice: '384,98', trFx: '52,69' }, { ...deps, basePrice: 2.65 });
  assert.equal(row.fob, 4.33);
  assert.equal(row.suppFob, 2.65);
  assert.equal(row.trFiyatTl, 384.98);
  assert.equal(row.kur, 52.69);
});

test('engine falls back to target price and leaves missing prices blank instead of 0', () => {
  const row = Engine.mapCollectionRow({ plmId: 'P2', modelKod: 'X', fob: '', targetPrice: '2,50', trPrice: '' }, deps);
  assert.equal(row.suppFob, 2.5);
  assert.equal(row.fob, '');
  assert.equal(row.trFiyatTl, '');
});

test('collection wrapper sends effective prices with confirmed → best priority', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
  const fn = src.match(/function mapCollectionRowToShip\(row\)\{[\s\S]*?\n\}/)[0];
  const pricing = { 'KDS APPARELS LTD.': '2,65', OTHER: '2,90' };
  const ctx = {
    BLShippingEngine: Engine, toISODate: () => '', toNum, norm: deps.norm, normalizeTransitDelType: deps.normalizeTransitDelType,
    kolParseMoneyNum: Groups.kolParseMoneyNum,
    kolEffectiveValue: (row, key) => (key === 'fob' ? '4,33' : row[key]),
    kolConfirmedPricing: row => (row.confirmedManufacturer ? { name: row.confirmedManufacturer, price: Groups.kolParseMoneyNum(pricing[row.confirmedManufacturer]) } : null),
    kolBestPricing: () => Groups.bestPricing(pricing, Groups.kolParseMoneyNum),
    kolLandedIsNonDtr: row => Boolean(row.licensor && row.licensor !== 'DTR'),
    kolLandedCalc: row => (row.licensor === 'NO-RULE' ? { trRuleMissing: true } : { trRuleMissing: false, trRoyaltyPct: 12, trHologramCost: 0.05 }),
  };
  vm.createContext(ctx); vm.runInContext(fn, ctx);
  const best = ctx.mapCollectionRowToShip({ plmId: 'P3', modelKod: 'NBA TEE 5', targetPrice: '1,50', fob: '' });
  assert.equal(best.suppFob, 2.65);
  assert.equal(best.fob, 4.33);
  const confirmed = ctx.mapCollectionRowToShip({ plmId: 'P3', modelKod: 'NBA TEE 5', confirmedManufacturer: 'OTHER' });
  assert.equal(confirmed.suppFob, 2.9);
  assert.equal(confirmed.trRoyaltyPct, undefined, 'DTR rows carry no TR licence cost');
  const licensed = ctx.mapCollectionRowToShip({ plmId: 'P4', modelKod: 'NBA TKM 3', licensor: 'NBA' });
  assert.equal(licensed.trRoyaltyPct, 12);
  assert.equal(licensed.trHologramCost, 0.05);
  assert.equal(ctx.mapCollectionRowToShip({ plmId: 'P5', modelKod: 'X', licensor: 'NO-RULE' })._trLicenseRuleMissing, true);
});

test('shipping engine applies TR royalty and hologram like Collection TR Landed, and only when carried', () => {
  const compute = row => Engine.compute(row, { coerceDateLoose: () => null, toNum, toISODate: () => '', days: { Gemi: 60, 'Gemi+Uçak': 30, 'Uçak': 10 }, multipliers: { tr: 1.05, overseas: 1.11 } });
  const plain = compute({ trFiyatTl: 400, kur: 40, fob: 5 });
  assert.equal(plain.trFiyatUsd, 10);
  const licensed = compute({ trFiyatTl: 400, kur: 40, fob: 5, trRoyaltyPct: 20, trHologramCost: 0.1 });
  assert.ok(Math.abs(licensed.trFiyatUsd - (10 / 0.8 + 0.1)) < 1e-9);
  assert.ok(Math.abs(licensed.trFiyatFobUsdLanded - (10 / 0.8 + 0.1) * 1.05) < 1e-9);
  const missing = compute({ trFiyatTl: 400, kur: 40, fob: 5, _trLicenseRuleMissing: true });
  assert.equal(missing.trFiyatUsd, '');
  assert.equal(missing.trFiyatFobUsdLanded, '');
});

test('re-sending a collection model fills prices previously transferred as 0 without overwriting user values', () => {
  const userId = 'collection-price-refill';
  db.addShippingRows([{ _sourceModule: 'collection', _modelKey: 'PLM:R1', fob: 0, suppFob: '', trFiyatTl: 0 }, { _sourceModule: 'collection', _modelKey: 'PLM:R2', fob: 5.1, suppFob: 3, trFiyatTl: 400 }], null, userId);
  const saved = db.addShippingRows([{ _sourceModule: 'collection', _modelKey: 'PLM:R1', fob: 4.33, suppFob: 2.65, trFiyatTl: 384.98 }, { _sourceModule: 'collection', _modelKey: 'PLM:R2', fob: 9, suppFob: 9, trFiyatTl: 9 }], db.loadShipping(userId)._revision, userId);
  assert.equal(saved.skippedCount, 2);
  const rows = db.loadShipping(userId).rows;
  const r1 = rows.find(r => r._modelKey === 'PLM:R1'), r2 = rows.find(r => r._modelKey === 'PLM:R2');
  assert.deepEqual([r1.fob, r1.suppFob, r1.trFiyatTl], [4.33, 2.65, 384.98]);
  assert.deepEqual([r2.fob, r2.suppFob, r2.trFiyatTl], [5.1, 3, 400]);
  db.addShippingRows([{ _sourceModule: 'collection', _modelKey: 'PLM:R1', trRoyaltyPct: 12, trHologramCost: 0.05 }], db.loadShipping(userId)._revision, userId);
  const r1b = db.loadShipping(userId).rows.find(r => r._modelKey === 'PLM:R1');
  assert.deepEqual([r1b.trRoyaltyPct, r1b.trHologramCost], [12, 0.05]);
});
