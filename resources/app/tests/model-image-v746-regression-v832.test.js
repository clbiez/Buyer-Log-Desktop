'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONNECTOR_SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const connector = require('../server/lib/agent-browser-connector');
const asasImages = require('../server/lib/asas-technical-images');

const PIM_BASE = 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/CoreNectumAttachmentOperation/GetAttachment/';

test('CoreNectum replay removes only UI list filters and preserves paging, sorting and scope data', () => {
  assert.equal(typeof connector.coreNectumUnfilteredRequestBody, 'function');
  const original = {
    pageIndex: 4,
    pageSize: 50,
    filters: [{ column: 'Season', value: 'S7' }],
    query: {
      appliedFilters: [{ column: 'Buyer Group', value: 'LICENSE' }],
      sort: [{ column: 'plmCode', direction: 'desc' }],
    },
    securityScope: { roles: ['BUYER'], organizationId: 17, filters: [{ column: 'Business Unit', value: 'CU4' }] },
  };

  const replay = connector.coreNectumUnfilteredRequestBody(original);
  assert.deepEqual(replay.filters, []);
  assert.deepEqual(replay.query.appliedFilters, []);
  assert.deepEqual(replay.query.sort, original.query.sort);
  assert.deepEqual(replay.securityScope, original.securityScope);
  assert.equal(replay.securityScope.filters.length, 1);
  assert.deepEqual(original.filters, [{ column: 'Season', value: 'S7' }]);
});

test('CoreNectum replay follows the captured page size instead of probing a server-capped oversized page', () => {
  const scan = CONNECTOR_SOURCE.slice(
    CONNECTOR_SOURCE.indexOf('function coreNectumScanExpression'),
    CONNECTOR_SOURCE.indexOf('function coreNectumReplayHeaders'),
  );
  assert.match(scan, /coreNectumUnfilteredRequestBody/);
  // v9.13: parçalı taramada sayfa imleci ve boyut, çağrılar arasında korunan
  // durumda tutuluyor. Kural aynı: offset = sayfa × boyut.
  assert.match(scan, /st\.pageOffset\*st\.pageSize/);
  assert.doesNotMatch(scan, /preferredPageSize|overrideSize|firstPayload/);
});

test('CoreNectum replay reaches a requested PLM outside the open page filters', async () => {
  const requestBodies = [];
  const payloads = [
    { data:{ coreNectumResultData:{ styleListResult:[
      { styleId:200, plmCode:100, model:{ imageUrl:'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/a' } },
      { styleId:201, plmCode:101 },
    ] } } },
    { data:{ coreNectumResultData:{ styleListResult:[
      { styleId:202, plmCode:102, model:{ imageUrl:'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/c' } },
    ] } } },
  ];
  const page = {
    _evaluateValue(expression) {
      const mockFetch = async (_url, options) => {
          const body = JSON.parse(options.body);
          requestBodies.push(body);
          const index = Number(body.pageIndex) || 0;
          return { ok:true, json:async () => payloads[index] || { data:{ coreNectumResultData:{ styleListResult:[] } } } };
      };
      return Function('fetch', 'setTimeout', `return ${expression}`)(mockFetch, setTimeout);
    },
  };
  const capture = {
    templates:[{ url:'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/StyleList/GetStyleList', method:'POST', headers:{}, body:{pageIndex:0,pageSize:2,filters:[{field:'Season',value:'S7'}]} }],
    async waitForTemplate(){ return true; },
  };

  const result = await connector.coreNectumBulkApiScan(page, capture, new Set(['102']));
  assert.equal(result.rows.length, 1, JSON.stringify(result));
  assert.equal(result.rows[0].plmId, '102');
  assert.equal(result.rows[0].styleId, '202');
  assert.equal(result.scannedPages, 2);
  assert.deepEqual(requestBodies.map(body => body.filters), [[], []]);
  assert.deepEqual(requestBodies.map(body => body.pageSize), [2, 2]);
});

test('PLM accepts the CoreNectum Attachment URL but does not mix ASAS PIM endpoints into the PLM source', () => {
  const coreUrl = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/a80f9adffd69a3aab37e2fd28df00360';
  const asasUrl = `${PIM_BASE}641124178be353a0331610c20546b5bc`;
  assert.equal(connector.coreNectumAttachmentUrl(coreUrl), coreUrl);
  assert.equal(connector.coreNectumAttachmentUrl(asasUrl), '');
});

test('ASAS PLM matching rejects ambiguous Technical Image URLs instead of selecting the first model image', () => {
  assert.equal(typeof asasImages.analyzeCandidatesFromOrders, 'function');
  const analysis = asasImages.analyzeCandidatesFromOrders([
    { plm: 453117, technicalImageUrl: `${PIM_BASE}image-a`, model: 'MODEL A' },
    { plm: 453117, technicalImageUrl: `${PIM_BASE}image-b`, model: 'MODEL B' },
    { plm: 453118, technicalImageUrl: `${PIM_BASE}image-c`, model: 'MODEL C' },
  ]);

  assert.deepEqual(analysis.candidates.map(item => String(item.plmId)), ['453118']);
  assert.equal(analysis.conflicts.length, 1);
  assert.equal(String(analysis.conflicts[0].plmId), '453117');
  assert.deepEqual(analysis.conflicts[0].urls.sort(), [`${PIM_BASE}image-a`, `${PIM_BASE}image-b`].sort());
});
