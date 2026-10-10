'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/license-cards-engine');
const C = require('../public/canonical-fields');

test('card face only shows contracts active today, keeps separate season scopes and full history', () => {
  const rules = [
    { id:'old', opdEnd:'2025-12-31', royalty:3 },
    { id:'current', opdStart:'2026-01-01', opdEnd:'2026-12-31', seasons:['SS26'], royalty:5 },
    { id:'other', opdStart:'2026-01-01', seasons:['AW26'], royalty:7 },
    { id:'future', opdStart:'2027-01-01', royalty:8 },
    { id:'invalid', opdStart:'2026-02-31', royalty:9 },
  ];
  const result=E.contracts(rules,'2026-10-09');
  assert.deepEqual(result.active.map(x=>x.id),['current','other']);
  assert.equal(result.history.length,5);
  assert.equal(result.history.find(x=>x.rule.id==='old').status,'expired');
  assert.equal(result.history.find(x=>x.rule.id==='future').status,'future');
  assert.equal(result.history.find(x=>x.rule.id==='invalid').status,'invalid');
  assert.equal(E.contracts([{opdStart:'2026-10-09',opdEnd:'2026-10-09'}],'2026-10-09').active.length,1);
});

test('loaded order statistics respect exact license/licensor and deduplicate order/model/colour', () => {
  const row=(extra={})=>({'License':'Disney','Licensor':'DTR','Order Code':'O1','Model Name':'M1','C.Code':'RED','Order Quantity':100,...extra});
  const result=E.statistics([row(),row(),row({'C.Code':'BLUE','Order Quantity':50}),row({'Order Code':'O2','Order Quantity':200}),row({'Licensor':'WB'}),row({'License':'Disney Junior'})],{license:'Disney',licensor:'DTR'},'orders',C);
  assert.equal(result.orders,2);
  assert.equal(result.quantity,350);
  assert.equal(result.lines,3);
  assert.equal(result.module,'orders');
});

test('statistics accept CP canonical module, missing identities do not inflate orders and unknown quantities stay unknown', () => {
  const result=E.statistics([{'License':'Batman','Licensor':'WB','Order Quantity':''},{'License':'Batman','Licensor':'WB','Order Quantity':'1.250'}],{license:'Batman',licensor:'WB'},'cp',C);
  assert.equal(result.orders,0);
  assert.equal(result.lines,2);
  assert.equal(result.quantity,1250);
  assert.equal(result.unknownQuantities,1);
});

test('portal links and raster symbol data reject executable content', () => {
  assert.equal(E.portalHref('javascript:alert(1)'), '');
  assert.equal(E.portalHref('https://portal.example.com'),'https://portal.example.com/');
  assert.equal(E.symbolUrl('data:image/svg+xml;base64,AAAA'),'');
  assert.equal(E.symbolUrl('data:image/png;base64,AAAA'),'data:image/png;base64,AAAA');
});
