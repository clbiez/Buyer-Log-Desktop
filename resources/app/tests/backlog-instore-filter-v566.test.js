'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const parse = require('../server/lib/parse');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

const OV = { notesmap:{}, submap:{}, suppfobmap:{}, suppfobmetamap:{}, delmap:{}, licensormap:{}, datemap:{}, pricingRules:[], transitRules:[] };
let seq=0;
function order(extra={}){
  seq += 1;
  return Object.assign({
    ocode: 6600000+seq, model:'MODEL '+seq, ccode:'C'+seq, colour:'SIYAH',
    season:'W6', countryRaw:'MISIR', manufacturer:'URETICI', license:'', category:'KAZAK',
    merch:'12', ageGroup:'A1', buyer:'BUYER', buyerGrup:'KIDS', line:'LINE', qty:100, kalan:100, fob:5,
    opd:new Date(2026,0,1), ex:new Date(2026,5,1), retail:new Date(2026,9,1), mb:new Date(2026,8,1),
  }, extra);
}

function backlog(orders, opts={}){
  return parse.buildBacklogGrouped(orders, {}, OV, Object.assign({groupBy:['buyerGrup']}, opts));
}

test('v5.66 Backlog üst zaman filtrelerinde In Store başlangıç/bitiş alanları bulunur', ()=>{
  assert.match(INDEX, /id="backlogInStoreFrom"/);
  assert.match(INDEX, /id="backlogInStoreTo"/);
  assert.match(INDEX, /data-i18n-tr="In Store"/);
});

test('v5.66 In Store filtresi Model Bütçe tarihini kullanır ve iki uçlu/tek uçlu çalışır', ()=>{
  const rows=[
    order({mb:new Date(2026,7,15)}),
    order({mb:new Date(2026,8,10)}),
    order({mb:new Date(2026,9,5)}),
  ];
  assert.equal(backlog(rows).totalOrders, 3);
  assert.equal(backlog(rows,{inStoreFrom:'2026-09-01'}).totalOrders, 2);
  assert.equal(backlog(rows,{inStoreTo:'2026-09-30'}).totalOrders, 2);
  const exact=backlog(rows,{inStoreFrom:'2026-09-01',inStoreTo:'2026-09-30'});
  assert.equal(exact.totalOrders, 1);
  assert.equal(exact.inStoreFrom, '2026-09-01');
  assert.equal(exact.inStoreTo, '2026-09-30');
});

test('v5.66 In Store filtresi boş Model Bütçe tarihli satırı yalnız filtre aktifken dışarıda bırakır', ()=>{
  const rows=[order({mb:null}), order({mb:new Date(2026,8,10)})];
  assert.equal(backlog(rows).totalOrders, 2);
  assert.equal(backlog(rows,{inStoreFrom:'2026-01-01'}).totalOrders, 1);
});

test('v5.66 UI state, API sorgusu, detay ve Excel export aynı In Store aralığını taşır', ()=>{
  assert.match(APP, /inStoreFrom:\s*document\.getElementById\('backlogInStoreFrom'\)/);
  assert.match(APP, /inStoreTo:\s*document\.getElementById\('backlogInStoreTo'\)/);
  assert.match(APP, /setVal\('backlogInStoreFrom',saved\.inStoreFrom\)/);
  assert.match(APP, /In Store tarih aralığı/);
  assert.match(SERVER, /const \{ retailFrom, retailTo, inStoreFrom, inStoreTo,[^}]+\} = req\.query/);
  assert.match(SERVER, /inStoreFrom: body\.inStoreFrom \|\| '', inStoreTo: body\.inStoreTo \|\| ''/);
  assert.match(SERVER, /filterOpts=\{retailFrom,retailTo,inStoreFrom,inStoreTo,/);
});
