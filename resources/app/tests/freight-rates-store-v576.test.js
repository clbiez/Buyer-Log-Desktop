'use strict';

// v5.76 — Navlun ücretleri kalıcı ayar deposu.
// Gerekçe: ücretler kaynak Excel'de tablonun başında elle güncelleniyordu.
// Programda tek merkezde tutulur; her yazımda revizyon artar ki iki pencere
// birbirinin güncellemesini sessizce ezmesin.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-v576-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
const db = require('../server/db');
const freight = require('../public/freight-calc');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('v5.76 kurulum kaynak Excel’in üç navlun satırıyla başlar', () => {
  const overrides = db.loadOverrides();
  assert.deepEqual(overrides.freightRates, freight.defaultSettings());
  assert.equal(Number(overrides._revisions.freightRates) || 0, 0);
});

test('v5.76 ücret güncellemesi kalıcıdır ve revizyonu artırır', () => {
  const first = db.replaceFreightRates({
    rates: [
      { id: 'air', mode: 'air', label: 'Uçak (AIR)', rate: 6.1 },
      { id: 'seaair-colombo', mode: 'seaAir', label: 'Gemi+Uçak (SEA+AIR) COLOMBO', rate: 4.4 },
    ],
    volumetricFactor: 167,
  }, 0);
  assert.equal(first.revision, 1);
  assert.equal(first.freight.rates.length, 2);
  assert.equal(first.freight.rates[0].rate, 6.1);

  // Yeni bir okuma aynı değeri görmeli: hesap açıldığında güncel ücret gelir.
  assert.deepEqual(db.loadOverrides().freightRates, first.freight);

  const second = db.replaceFreightRates({ ...first.freight, volumetricFactor: 200 }, 1);
  assert.equal(second.revision, 2);
  assert.equal(second.freight.volumetricFactor, 200);
});

test('v5.76 eski revizyonla yazmak reddedilir', () => {
  assert.throws(
    () => db.replaceFreightRates(freight.defaultSettings(), 0),
    err => err.code === 'REVISION_CONFLICT' && err.revisionKey === 'freightRates'
  );
});

test('v5.76 bozuk kayıt okunurken normalize edilir, hesap tarafı geçerli liste görür', () => {
  const current = Number(db.loadOverrides()._revisions.freightRates) || 0;
  db.replaceFreightRates({ rates: [{ label: 'Sadece Ad' }], volumetricFactor: 'abc' }, current);
  const stored = db.loadOverrides().freightRates;
  assert.equal(stored.rates.length, 1);
  assert.equal(stored.rates[0].mode, 'seaAir');
  assert.equal(stored.volumetricFactor, 167);
  assert.equal(freight.calculate({
    kgPerPiece: 0.132, qtyTotal: 5747, qtyPerCarton: 132,
    cartonL: 58, cartonH: 38, cartonW: 40, stylePrice: 1.65,
  }, stored).complete, true);
});
