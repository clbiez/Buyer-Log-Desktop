'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const diagnostics = require('../server/lib/refresh-error-diagnostics');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

test('IAS calculated-column processing error is explained as a source-model problem, not VPN', () => {
  const error = Object.assign(new Error(
    "The expression referenced column 'Ithalat'[Retail - YüklemeTalep Durum] which does not hold any data because it needs to be recalculated or refreshed."
  ), { code: 'MODEL_QUERY_FAILED' });
  const result = diagnostics.diagnoseRefreshError(error);

  assert.equal(result.category, 'source-model-processing');
  assert.equal(result.source, 'IAS Database');
  assert.equal(result.confidence, 'high');
  assert.equal(result.vpnRelated, false);
  assert.equal(result.table, 'Ithalat');
  assert.equal(result.column, 'Retail - YüklemeTalep Durum');
  assert.match(result.title.tr, /yeniden işlenmeli/i);
  assert.match(result.summary.tr, /ağ veya VPN hatası değil/i);
  assert.match(result.action.tr, /Process\/Recalculate/i);
  assert.match(result.owner.tr, /Kaynak BI/i);
});

test('real network/VPN failures are classified separately from query timeouts', () => {
  const network = diagnostics.diagnoseRefreshError(
    Object.assign(new Error('Cannot connect to IAS server. VPN unavailable.'), { code: 'MODEL_QUERY_FAILED' })
  );
  assert.equal(network.category, 'network');
  assert.equal(network.vpnRelated, true);
  assert.match(network.title.tr, /ulaşılamıyor/i);

  const timeout = diagnostics.diagnoseRefreshError(
    Object.assign(new Error('Model query timed out while executing DAX.'), { code: 'MODEL_QUERY_TIMEOUT' })
  );
  assert.equal(timeout.category, 'timeout');
  assert.notEqual(timeout.category, network.category);
});

test('field mapping and source-schema failures tell the user what to repair', () => {
  const mapped = diagnostics.diagnoseRefreshError(Object.assign(
    new Error("Column 'Buyer Grup (TR)' in table 'Siparis Bilgileri' cannot be found."),
    {
      code: 'MODEL_REFRESH_FIELD_MAPPING_REQUIRED',
      repairAction: {
        kind: 'field-mapping',
        sourceId: 'ias-main',
        header: 'Buyer Grup (TR)',
        table: 'Siparis Bilgileri',
        column: 'Buyer Grup (TR)',
      },
    }
  ));
  assert.equal(mapped.category, 'field-mapping');
  assert.equal(mapped.repairable, true);
  assert.match(mapped.summary.tr, /VPN hatası değil/i);
  assert.match(mapped.action.tr, /Field Mapping/i);

  const schema = diagnostics.diagnoseRefreshError(
    Object.assign(new Error("Column 'Old Field' in table 'Ithalat' cannot be found or may not be used in this expression."), { code: 'MODEL_QUERY_FAILED' })
  );
  assert.equal(schema.category, 'schema-change');
  assert.equal(schema.table, 'Ithalat');
  assert.equal(schema.column, 'Old Field');
});

test('unknown failures no longer invent a VPN diagnosis', () => {
  const result = diagnostics.diagnoseRefreshError(
    Object.assign(new Error('Unexpected provider state 0x81'), { code: 'MODEL_QUERY_FAILED' })
  );
  assert.equal(result.category, 'unknown');
  assert.equal(result.confidence, 'low');
  assert.match(result.summary.tr, /Ağ\/VPN varsayımı yapılmadı/i);
  assert.equal(result.technical, 'Unexpected provider state 0x81');
});

test('refresh API exposes diagnosis to both background and synchronous clients', () => {
  assert.match(SERVER, /const refreshErrorDiagnostics = require\('\.\/lib\/refresh-error-diagnostics'\)/);
  assert.match(SERVER, /diagnosis:\s*job\.diagnosis \|\| null/);
  assert.match(SERVER, /job\.diagnosis=refreshErrorDiagnostics\.diagnoseRefreshError\(err,/);
  assert.match(SERVER, /const diagnosis = refreshErrorDiagnostics\.diagnoseRefreshError\(err,/);
  assert.match(SERVER, /repairAction: err && err\.repairAction \|\| null,[\s\S]{0,80}?diagnosis,/);
});

test('refresh UI shows classified cause, responsibility and action instead of a generic VPN guess', () => {
  const modalStart = APP.indexOf('function showSourceRefreshFailureModal(');
  const modalEnd = APP.indexOf('// ================= YENİLEMEYİ DURDURMA', modalStart);
  assert.ok(modalStart >= 0 && modalEnd > modalStart, 'refresh failure modal block exists');
  const modal = APP.slice(modalStart, modalEnd);

  assert.match(modal, /diagnosis=null/);
  assert.match(modal, /Sorumlu alan/);
  assert.match(modal, /Ne yapmalısınız/);
  assert.match(modal, /Teknik ayrıntı/);
  assert.doesNotMatch(modal, /ASAS ve Antrepo veri modelleri sorgulanamadı\. Ağ bağlantınızı kontrol edin/);
  assert.doesNotMatch(modal, /The ASAS and Bonded Warehouse data models could not be queried\. Check your network connection/);

  assert.match(APP, /err\.diagnosis=jobState\.diagnosis\|\|null/);
  assert.match(APP, /err\.diagnosis=e\.diagnosis\|\|null/);
  assert.match(APP, /showSourceRefreshFailureModal\(err\.message,err\.repairAction\|\|null,err\.diagnosis\|\|null\)/);
  assert.match(APP, /const diagnosisDetails=failed&&diagnosis/);
  assert.match(APP, /failed\?\(diagnosisSummary\|\|/);
  assert.match(APP, /function showAntrepoFallbackWarning\(fallback\)/);
  assert.match(APP, /IAS canlı verisi güncellenemedi — son başarılı veri korunuyor/);
  assert.match(APP, /if\(antrepoFallback\)showAntrepoFallbackWarning\(antrepoFallback\)/);
  assert.match(APP, /Yenileme kaynak uyarısıyla tamamlandı/);
});
