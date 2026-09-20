'use strict';

/* v810 — KAYITLI ASAS VE IAS BAĞLANTILARI GÖRÜNÜR OLMALI.
 *
 * Korunan kusur (canlı ölçümde görüldü): IAS bağlantısı, Antrepo kaynağı
 * "Excel" seçiliyken ekranda HİÇ görünmüyordu. Kullanıcı kayıtlı bağlantısını
 * bulamıyor, silinmiş sanıyordu. Bir bağlantının GÖRÜNÜRLÜĞÜ, o anda hangi
 * kaynak modunun seçili olduğuna bağlanamaz — kayıt duruyorsa görünmelidir.
 *
 * v7.81: bağlantı listesi eski bağlantı modalından Veri Yönetimi ekranına
 * taşındı. Kusur aynı kusur; testler yeni yerini kilitliyor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-v810-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const ROOT = path.join(__dirname, '..');
const db = require('../server/db');
const readModel = require('../server/lib/data-domain/read-model');

test('kayıtlı ASAS ve IAS bağlantılarının ikisi de listelenir', () => {
  const items = db.replaceModelConnections([
    { id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'A', role: 'asas', refreshEnabled: true,
      scopes: [{ id: 'sc_a', targets: ['cp'], enabled: true, horizon: {} }] },
    { id: 'mc_ias', name: 'IAS', server: 's', catalog: 'I', role: 'antrepo', refreshEnabled: true,
      scopes: [{ id: 'sc_i', targets: ['cp'], enabled: true, horizon: {} }] },
  ], null).items;

  const model = readModel.build(items, { language: 'tr' });
  const byId = new Map(model.sources.map(entry => [entry.id, entry]));
  assert.ok(byId.has('mc_asas'));
  assert.ok(byId.has('mc_ias'));
  // Hangisinin ne olduğu okunabilir olmalı; kullanıcı rol adı ezberlememeli.
  assert.equal(byId.get('mc_asas').profileId, 'asas-orders');
  assert.equal(byId.get('mc_ias').profileId, 'ias-warehouse');
  assert.ok(byId.get('mc_ias').profileLabel, 'kaynak türü etiketi boş olmamalı');
});

test('IAS görünürlüğü Antrepo kaynak moduna BAĞLANMAZ', () => {
  /* Projeksiyon overrides'ı hiç okumaz: antrepoSourceMode'un bu karara
     karışabileceği bir yol yok. Kural koda değil, yapıya gömülü. */
  const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'data-domain', 'read-model.js'), 'utf8');
  assert.doesNotMatch(source, /antrepoSourceMode|loadOverrides/);
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.doesNotMatch(ui, /antrepoSourceMode/);
});

test('kapalı bir kaynak listeden DÜŞMEZ, durumuyla görünür', () => {
  // "Yenilemede kullanma" kararı, kaydı gizlemek anlamına gelmemeli.
  const items = db.replaceModelConnections([
    { id: 'mc_ias', name: 'IAS', server: 's', catalog: 'I', role: 'antrepo', refreshEnabled: false,
      scopes: [{ id: 'sc_i', targets: ['cp'], enabled: true, horizon: {} }] },
  ], null).items;
  const model = readModel.build(items, { language: 'tr' });
  const ias = model.sources.find(entry => entry.id === 'mc_ias');
  assert.ok(ias, 'kapalı kaynak listeden düşmemeli');
  assert.equal(ias.enabled, false);
  assert.equal(ias.status, 'disabled');
});
