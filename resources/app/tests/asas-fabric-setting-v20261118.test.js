'use strict';

/* Kaynak Veri › Kaynak modu › ASAS Kumaş Bilgileri (Açık / Kapalı).
   Açık = ayrı kumaş sorgusu (separate), Kapalı = kumaş çekilmez (off).
   Kayıt yoksa açık; eski tek sorgu (inline) ayardan seçilemez. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-fabric-setting-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});
const db = require('../server/db');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('kayıt yoksa kumaş açık (separate); yalnız off kapatır; revizyon çakışması korunur', () => {
  assert.equal(db.loadOverrides().asasFabricMode, 'separate');
  const off = db.replaceAsasFabricMode('off', 0);
  assert.deepEqual(off, { mode: 'off', revision: 1 });
  assert.equal(db.loadOverrides().asasFabricMode, 'off');
  assert.throws(() => db.replaceAsasFabricMode('separate', 0), err => err.code === 'REVISION_CONFLICT');
  assert.equal(db.replaceAsasFabricMode('inline', 1).mode, 'separate', 'eski tek sorgu ayardan seçilemez');
});

test('sunucu ayarı Database yenilemesine iletir ve ekrana yayımlar', () => {
  const server = read('server/server.js');
  assert.match(server, /includeLfl: lflMode === 'database',\n\s+\/\/ Kaynak Veri › ASAS Kumaş Bilgileri[^\n]*\n\s+asasFabricMode: overrides\.asasFabricMode === 'off' \? 'off' : 'separate',/);
  assert.match(server, /asasFabricMode: overrides\.asasFabricMode === 'off' \? 'off' : 'separate',\n\s+lflSourceMode:/);
  assert.match(server, /asasFabricMode: Number\(overrides\._revisions&&overrides\._revisions\.asasFabricMode\)\|\|0/);
  const routes = read('server/routes/asas-source-routes.js');
  assert.match(routes, /app\.put\('\/api\/asas-fabric', userAccess\.requireArea\('source'\), userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(routes, /if \(!\['separate', 'off'\]\.includes\(mode\)\) return res\.status\(400\)/);
  assert.match(routes, /publishSharedMasterChange\('asasFabricMode', req\)/);
});

test('ekip ayarı Moderatör yayımıyla dağılır ve istemci yeniden okur', () => {
  const policy = read('server/lib/shared-sync-policy.js');
  assert.match(policy, /'asasSourceMode', 'asasFabricMode', 'lflSourceMode'/);
  const app = read('public/app-main.js');
  assert.equal((app.match(/'asasSourceMode','asasFabricMode','lflSourceMode'/g) || []).length, 3);
});

test('Kaynak modu paneli: Açık / Kapalı düğmeleri, TR/EN etiket ve ipucu, durum metni', () => {
  const dm = read('public/data-management.js');
  assert.match(dm, /id: 'asasFabricControl', attr: 'data-asas-fabric-mode', fileId: 'asasFabricState'/);
  assert.match(dm, /label: \{ tr: 'ASAS Kumaş Bilgileri', en: 'ASAS Fabric Details' \}/);
  assert.match(dm, /modes: \[\['separate', \{ tr: 'Açık', en: 'On' \}\], \['off', \{ tr: 'Kapalı', en: 'Off' \}\]\]/);
  assert.match(dm, /set: mode => setAsasFabricMode\(mode\)/);
  assert.match(dm, /'renderAsasSourceControl', 'renderAsasFabricControl'/);
  const app = read('public/app-main.js');
  assert.match(app, /fetchJSON\('\/api\/asas-fabric',\{method:'PUT'/);
  assert.match(app, /'Kumaş çekilmez'/);
  assert.match(app, /'Fabric is not fetched'/);
  assert.match(app, /renderAsasSourceControl\(data\);\n\s+renderAsasFabricControl\(data\);/);
});
