const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const connector = require('../server/lib/agent-browser-connector');

test('CoreNectum ID normalizasyonu grouped, underscore ve .0 biçimlerini aynı PLM ID yapar', () => {
  assert.equal(connector.coreNectumId('2108736'), '2108736');
  assert.equal(connector.coreNectumId('_2108736'), '2108736');
  assert.equal(connector.coreNectumId('2.108.736'), '2108736');
  assert.equal(connector.coreNectumId('2108736.0'), '2108736');
  assert.equal(connector.coreNectumId('2.108.736.00'), '2108736');
  assert.equal(connector.coreNectumId('2108736.5'), '');
});

test('GetStyleList satırları PLM Code ile styleId ayrımını korur ve yalnız PLM Code ile tekilleştirir', () => {
  const payload = { data: { nested: { result: [
    { styleId: '_2468230.0', plmCode: '2.108.736', styleName: 'A', model: { imageUrl: '/lcw/live/corenectum/service/api/Attachment/GetAttachment/a' } },
    { styleId: '2468230', plmCode: '2108737', styleName: 'duplicate style' },
    { styleId: '2468231', plmCode: '_2108738.0', styleName: 'B', seasonName: 'S7' },
  ] } } };

  assert.deepEqual(connector.coreNectumStyleListRows(payload), [
    {
      plmId: '2108736',
      styleId: '2468230',
      styleName: 'A',
      specialCode: '',
      imageUrl: 'https://corenectum.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/a',
    },
    { plmId: '2108737', styleId: '2468230', styleName: 'duplicate style', specialCode: '' },
    { plmId: '2108738', styleId: '2468231', styleName: 'B', specialCode: '', season: 'S7' },
  ]);
});

test('CoreNectum parser and browser scanner support fallback response arrays and nested imageUrl', () => {
  assert.equal(typeof connector.coreNectumRecordsOf, 'function');
  assert.deepEqual(connector.coreNectumRecordsOf({ data: { result: [{ styleId: 1, plmCode: 2 }] } }), [{ styleId: 1, plmCode: 2 }]);
  assert.deepEqual(connector.coreNectumRecordsOf({ data: { coreNectumResultData: { styleListResult: [] }, result: [{ styleId: 1, plmCode: 2 }] } }), [{ styleId: 1, plmCode: 2 }]);

  const scan = SOURCE.slice(SOURCE.indexOf('function coreNectumScanExpression'), SOURCE.indexOf('function coreNectumReplayHeaders'));
  assert.match(scan, /const recordsOf=payload=>/);
  assert.match(scan, /const recordImageUrl=/);
  assert.doesNotMatch(scan, /foundStyleIds=new Set\(\)/);
  assert.match(scan, /replace\(\/\^_\+\//);
  assert.match(scan, /const styleId=normalizePlmId\(model&&model\.styleId\),plmId=normalizePlmId\(model&&model\.plmCode\)/);
});

test('CoreNectum capture errors are retained for diagnostics instead of being silently discarded', () => {
  const capture = SOURCE.slice(SOURCE.indexOf('async function coreNectumListCapture'), SOURCE.indexOf('function coreNectumBatchSignature'));
  assert.match(capture, /errors=\[\]/);
  assert.match(capture, /errors\.push/);
  assert.match(capture, /errors/);
});
