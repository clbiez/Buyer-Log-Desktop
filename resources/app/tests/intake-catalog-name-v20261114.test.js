'use strict';

/* lcwtabular_s20 üzerindeki INTAKE veritabanının gerçek adı alt çizgilidir
   (WSSI_Intake_Raporu4); sunucunun katalog listesinde boşluklu ad yoktur.
   Boşluklu eski varsayılanla kayıtlı bağlantılar canlı sorguda düşüp her
   seferinde eski snapshot'a dönüyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../server/db');
const intake = require('../server/lib/intake-report');

const CATALOG = 'WSSI_Intake_Raporu4';

test('INTAKE varsayılan kataloğu sunucudaki gerçek veritabanı adıdır', () => {
  assert.equal(intake.INTAKE_CONNECTION.catalog, CATALOG);
  assert.equal(db.normalizeModelConnections([]).find(item => item.role === 'intake').catalog, CATALOG);
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  assert.match(app, /server:'lcwtabular_s20', catalog:'WSSI_Intake_Raporu4', role:'intake'/);
});

test('eski boşluklu varsayılanla kayıtlı INTAKE bağlantısı gerçek ada taşınır', () => {
  const migrated = db.normalizeModelConnection({ id: 'mc_intake_default', name: 'INTAKE', server: 'lcwtabular_s20', catalog: 'WSSI Intake Raporu4', role: 'intake', refreshEnabled: true });
  assert.equal(migrated.catalog, CATALOG);
  const fqdn = db.normalizeModelConnection({ id: 'mc_i2', server: 'LCWTABULAR_S20.lcwaikiki.local', catalog: 'WSSI Intake Raporu4', role: 'intake' });
  assert.equal(fqdn.catalog, CATALOG);
});

test('kullanıcının bilerek seçtiği başka katalog ve başka sunucu/rol değiştirilmez', () => {
  assert.equal(db.normalizeModelConnection({ id: 'a', server: 'lcwtabular_s20', catalog: 'WSSI_Intake_Raporu3', role: 'intake' }).catalog, 'WSSI_Intake_Raporu3');
  assert.equal(db.normalizeModelConnection({ id: 'b', server: 'other_srv', catalog: 'WSSI Intake Raporu4', role: 'intake' }).catalog, 'WSSI Intake Raporu4');
  assert.equal(db.normalizeModelConnection({ id: 'c', server: 'lcwtabular_s20', catalog: 'WSSI Intake Raporu4', role: 'custom' }).catalog, 'WSSI Intake Raporu4');
});
