const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const connector = require('../server/lib/agent-browser-connector');

test('v6.12 extracts the exact model.imageUrl Attachment URL from GetStyleList', () => {
  const imageUrl = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/a80f9adffd69a3aab37e2fd28df00360';
  const payload = {data:{coreNectumResultData:{styleListResult:[{
    styleId:2468230, plmCode:2108736, styleName:'LIVERPOOL-4-YI', model:{imageUrl}
  }]}}};
  assert.deepEqual(connector.coreNectumStyleListRows(payload), [{
    plmId:'2108736', styleId:'2468230', styleName:'LIVERPOOL-4-YI', specialCode:'', imageUrl
  }]);
});

test('Style List üst-seviye imageUrl, model.imageUrl ile çakışınca ön+arka görsel kazanır', () => {
  const frontBack = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/front-back';
  const singleOption = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/single-option';
  const payload = {data:{coreNectumResultData:{styleListResult:[{
    styleId:2502647, plmCode:2121571, styleName:'MUSTANG-Y1', imageUrl:frontBack, model:{imageUrl:singleOption}
  }]}}};
  assert.equal(connector.coreNectumStyleListRows(payload)[0].imageUrl, frontBack);
});

test('v6.12 rejects unrelated imageUrl hosts and non-Attachment paths', () => {
  const payload = {data:{coreNectumResultData:{styleListResult:[
    {styleId:1,plmCode:101,styleName:'A',model:{imageUrl:'https://example.com/Attachment/GetAttachment/a'}},
    {styleId:2,plmCode:102,styleName:'B',model:{imageUrl:'https://mym-api.lcwaikiki.com/not-an-attachment/a'}},
  ]}}};
  assert.deepEqual(connector.coreNectumStyleListRows(payload), [
    {plmId:'101',styleId:'1',styleName:'A',specialCode:''},
    {plmId:'102',styleId:'2',styleName:'B',specialCode:''},
  ]);
});

test('PLM GetStyleList keeps ASAS PIM technical image URLs out of the PLM source', () => {
  const imageUrl = 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/CoreNectumAttachmentOperation/GetAttachment/641124178be353a0331610c20546b5bc';
  const payload = {data:{coreNectumResultData:{styleListResult:[{
    styleId:2468230, plmCode:2108736, styleName:'LIVERPOOL-4-YI', imageUrl
  }]}}};
  assert.deepEqual(connector.coreNectumStyleListRows(payload), [
    {plmId:'2108736', styleId:'2468230', styleName:'LIVERPOOL-4-YI', specialCode:''},
  ]);
});

test('PLM GetStyleList rejects PIM style-image URLs generated from a style ID', () => {
  const imageUrl = 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/PLMImageOperation/GetStyleImageById/2468230';
  const payload = {data:{coreNectumResultData:{styleListResult:[{
    styleId:2468230, plmCode:2108736, styleName:'LIVERPOOL-4-YI', model:{imageUrl}
  }]}}};
  assert.equal(connector.coreNectumStyleListRows(payload)[0].imageUrl, undefined);
});

test('v6.12 captures Attachment response bodies without persisting authentication data', () => {
  const capture = SOURCE.slice(SOURCE.indexOf('async function coreNectumListCapture'), SOURCE.indexOf('function coreNectumBatchSignature'));
  assert.match(capture, /images=new Map\(\)/);
  assert.match(capture, /Attachment\\\/GetAttachment/);
  assert.match(capture, /Network\.getResponseBody/);
  assert.match(capture, /coreNectumImageMime/);
  assert.doesNotMatch(capture, /images\.set\([^\n]*(cookie|authorization|requestHeaders)/i);
  assert.doesNotMatch(capture, /return[^\n]*(cookie|authorization|requestHeaders)/i);
});

test('v6.12 uses API image URL before legacy row hover fallback', () => {
  const collector = SOURCE.slice(SOURCE.indexOf('async function collectCoreNectumStyleLinks'), SOURCE.indexOf('async function startRecording'));
  const bulk = SOURCE.slice(SOURCE.indexOf('async function coreNectumBulkImages'), SOURCE.indexOf('async function coreNectumStyleListRowImage'));
  assert.ok(bulk.indexOf('coreNectumWaitCapturedImage') >= 0);
  assert.ok(bulk.indexOf('coreNectumImageFromUrl') >= 0,
    'API URL yolu bulk indirmede kullanilmali (sira artik URL-once)');
  assert.match(collector, /coreNectumBulkImages/);
  assert.match(collector, /coreNectumStyleListRowImage/);
  assert.match(collector, /record\.imageUrl/);
});

test('v6.12 replays the captured GetStyleList request and scans API pages directly', () => {
  const scan = SOURCE.slice(SOURCE.indexOf('async function coreNectumDirectApiScan'), SOURCE.indexOf('async function coreNectumWaitCapturedImage'));
  assert.match(SOURCE, /Network\.requestWillBeSent/);
  assert.match(scan, /capture\.templates/);
  assert.match(scan, /fetch\(cfg\.url/);
  assert.match(scan, /pageOffset\*pageSize/);
  assert.match(scan, /duplicates>=2/);
  assert.doesNotMatch(scan, /\.click\(/);
});

test('v6.12 downloads Attachment images with six browser workers', () => {
  // v9.53: cagri ek secenek alabiliyor; korunan sey alti isci.
  assert.match(SOURCE, /coreNectumBulkImages\(page,capture,imageRecords,6[,)]/);
  assert.match(SOURCE, /Promise\.all\(Array\.from/);
});
