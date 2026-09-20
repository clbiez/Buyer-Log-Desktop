const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

test('PLM bulk scan normalizes API PLM Code before matching requested PLM IDs', () => {
  const scan = CONNECTOR.slice(
    CONNECTOR.indexOf('function coreNectumScanExpression'),
    CONNECTOR.indexOf('function coreNectumReplayHeaders')
  );

  assert.match(scan, /const normalizePlmId=value=>/);
  assert.match(scan, /const styleId=normalizePlmId\(model&&model\.styleId\),plmId=normalizePlmId\(model&&model\.plmCode\)/);
  assert.doesNotMatch(scan, /coreNectumId/);
  /* v9.13: tarama parçalı hâle gelince eşleşen kayıt artık bir Map'e
     yazılmıyor; bulunanlar durumda işaretlenip satır Node'a döndürülüyor.
     Sınanan kural aynı: satır NORMALİZE EDİLMİŞ plmId ve styleId taşır. */
  assert.match(scan, /st\.found\.add\(plmId\)/);
  assert.match(scan, /const row=\{plmId,styleId,/);
  assert.match(scan, /newRows\.push\(row\)/);
});
