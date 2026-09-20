'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const { resolveHorizonValueSource, selectConnection } = require(path.join(ROOT, 'server', 'lib', 'horizon-value-source.js'));
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('page Horizon resolves the target database column from the canonical field mapping', () => {
  const connections = [
    {
      id: 'asas-main', role: 'asas', refreshEnabled: true,
      server: 'lcwtabular_s30', catalog: 'ASAS_30',
      horizon: { table: 'Fallback Table' },
      scopes: [
        { enabled: true, targets: ['orders'], horizon: { table: 'Orders Table' } },
        { enabled: true, targets: ['cp'], horizon: { table: 'CP Table' } },
      ],
      mapping: {
        'Merch Alt Grup Kod': { table: 'ASAS Orders', name: 'MAG Kod', kind: 'column' },
      },
    },
  ];

  assert.deepEqual(resolveHorizonValueSource(connections, 'cp', 'Merch Alt Grup Kod'), {
    connectionId: 'asas-main',
    server: 'lcwtabular_s30',
    catalog: 'ASAS_30',
    table: 'ASAS Orders',
    field: 'MAG Kod',
  });
});

test('page Horizon never invents a database column for an unmapped canonical field', () => {
  const connections = [{
    id: 'asas-main', role: 'asas', refreshEnabled: true,
    server: 'server', catalog: 'catalog', horizon: { table: 'Orders' }, mapping: {},
    scopes: [{ enabled: true, targets: ['cp'], horizon: { table: 'Orders' } }],
  }];

  assert.equal(resolveHorizonValueSource(connections, 'cp', 'Buyer'), null);
});

test('unknown or unmatched Horizon targets fail closed instead of using CP connection', () => {
  const connections = [{id:'cp-main',role:'asas',refreshEnabled:true,server:'server',catalog:'catalog',scopes:[{enabled:true,targets:['cp']}]}];
  assert.equal(selectConnection(connections, 'intake'), null);
  assert.equal(selectConnection(connections, 'unknown-module'), null);
});

test('INTAKE Horizon fields and offline values stay datasource-specific', () => {
  const fieldsRoute = SERVER.slice(SERVER.indexOf("app.get('/api/horizon/fields'"), SERVER.indexOf("app.get('/api/horizon/values'"));
  const valuesRoute = SERVER.slice(SERVER.indexOf("app.get('/api/horizon/values'"), SERVER.indexOf("app.post('/api/horizon/preview'"));
  assert.match(fieldsRoute, /target === 'intake'/);
  assert.match(fieldsRoute, /intakeLiveFields/);
  assert.match(fieldsRoute, /intakeHorizonFields/);
  assert.match(valuesRoute, /intake-snapshot-fallback/);
  assert.doesNotMatch(valuesRoute.slice(valuesRoute.indexOf("if (target === 'intake')"), valuesRoute.indexOf('const cache = cacheForUser')), /asasOrders/);
  /* v7.81 — Kişisel ufuk düzenleyicisi kaldırıldı; INTAKE etiketi ve
     kaydetme gövdesi artık orada değil. Korunan karar sunucuda: INTAKE
     ufku KENDİ kaynağından çözülür ve raporuna gerçekten uygulanır
     (bu, bildirilen "filtre Overview'a yansımıyor" hatasının düzeltmesi). */
  assert.match(SERVER, /function intakeHorizon\(\)/);
  assert.match(SERVER, /buildIntakeQuery\(\{ fields: found\.fields, viewConfig, horizon \}\)/);
});

test('page Horizon value endpoint queries the database and selects scope by page target', () => {
  const route = SERVER.slice(
    SERVER.indexOf("app.get('/api/horizon/values'"),
    SERVER.indexOf("app.post('/api/horizon/preview'"),
  );

  assert.match(route, /resolveHorizonValueSource/, 'the page endpoint must resolve the configured ASAS database field');
  assert.match(route, /queryModelDistinctValues/, 'the page endpoint must use the shared database DISTINCT query');
  assert.match(route, /cacheForUser\(req\)/, 'loaded local rows must remain as an offline fallback');
  /* v7.81 — Hedefi eskiden düzenleyici gönderiyordu; o kalktı. Uç hâlâ
     sayfa hedefine göre doğru kapsamı seçmeli — korunan karar bu. */
  assert.match(route, /req\.query[\s\S]{0,80}target/, 'the endpoint must still select scope by page target');
});
