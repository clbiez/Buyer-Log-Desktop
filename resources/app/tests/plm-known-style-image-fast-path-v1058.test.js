'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const connector = require('../server/lib/agent-browser-connector');
const CONNECTOR = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test('kayıtlı Style ID bulunan PLM görseli tam Style List taramasına girmez', () => {
  const plan = connector.coreNectumImageRecordPlan([
    { plmId: '2123595', styleId: '2508501', styleName: 'SOFT-1-TR' },
    { plmId: '2121459', styleName: 'FORCE-1-RPT' },
  ]);

  assert.deepEqual(plan.knownRecords, [
    { plmId: '2123595', styleId: '2508501', styleName: 'SOFT-1-TR', imageUrl: '' },
  ]);
  assert.deepEqual(plan.scanIds, ['2121459']);
});

test('görsel endpointi Style ID bilgisini istemciden değil kalıcı PLM link deposundan çözer', () => {
  const route = SERVER.slice(
    SERVER.indexOf("app.post('/api/model-images/import-plm'"),
    SERVER.indexOf("app.post('/api/model-images/import-asas'"),
  );

  assert.match(route, /loadPlmStyleLinks\(\)\.links/);
  assert.match(route, /styleId:String\(styleLink&&styleLink\.styleId\|\|''\)/);
  assert.doesNotMatch(route, /item&&item\.styleId|item\.styleId/);
});

test('connector Style ID bilgisini aday kayıtta korur ve bilinen kayıtları taramasız plana katar', () => {
  const start = CONNECTOR.indexOf('async function collectCoreNectumStyleLinks');
  const block = CONNECTOR.slice(start, CONNECTOR.indexOf('// Umbrella QTX Library bridge', start));

  assert.match(block, /styleId:coreNectumId\(item&&item\.styleId\)/);
  assert.match(block, /coreNectumImageRecordPlan\(candidates\)/);
});

/* v11.00 — "Style Overview ana görseli ... main-image alanından okunur"
   testi emekli edildi. Ana görselin Style Overview sayfasından DOM ile
   okunması (coreNectumStyleOverviewMainImageUrl) kaynaktan kaldırıldı;
   model görseli artık canlı CoreNectum GetStyleImages API'sinden geliyor.
   Bu dosyanın asıl konusu olan "bilinen Style ID taramayı atlar" hızlı
   yolu yukarıdaki üç testte korunuyor. */

