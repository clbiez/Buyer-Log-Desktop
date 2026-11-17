'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const resolver = require('../server/lib/model-image-identity-resolver');
const lfl = require('../server/lib/lfl');
const scope = require('../public/model-asset-scope.js');

const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const LFL_UI = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('LFL kaynağındaki Plm Kod görünür sütun olmadan plmId metadata olarak korunur', () => {
  const row = {
    'Sipariş Kod': '1389762', 'Model Adı': 'KK.BDY.TEST-1', 'Plm Kod': 1202929,
    'Renk Kod': 'HFB', 'Sezon': 'S7', 'FOB Fiyatı': 4.5, 'Net Alım Sipariş Miktarı': 100,
    'MAG': 'CK1E', 'MMYG': 'CKW1', 'Klasman': 'BODY', 'Üretici': 'MFR',
    'Siparişin Üretildiği Ülke': 'HİNDİSTAN', 'Buyer Grup (TR)': 'LİSANS',
    'Buyer': 'GÖKBERK', 'In-Store': '2027-05-03',
  };
  const parsed = lfl.parseLFLRows([row]);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].plmId, '1202929');
  assert.equal(parsed.rows[0].orderCode, '1389762');
});

test('çakışan model+renk PLM ID order code ile kesin çözülür', () => {
  const orders = [
    { ocode: 1001, model: 'STYLE-A', ccode: 'RED', plm: 111 },
    { ocode: 1002, model: 'STYLE-A', ccode: 'RED', plm: 222 },
  ];
  const result = resolver.resolveItems([{ orderCode: '1002', styleName: 'STYLE-A', colourCode: 'RED' }], { orders });
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.resolved[0].plmId, '222');
});

test('order code yoksa çakışan model+renk için PLM ID tahmin edilmez', () => {
  const orders = [
    { ocode: 1001, model: 'STYLE-A', ccode: 'RED', plm: 111 },
    { ocode: 1002, model: 'STYLE-A', ccode: 'RED', plm: 222 },
  ];
  const result = resolver.resolveItems([{ styleName: 'STYLE-A', colourCode: 'RED' }], { orders });
  assert.equal(result.resolved.length, 0);
  assert.equal(result.unresolved[0].code, 'MODEL_PLM_ID_UNRESOLVED');
});

test('ASAS target snapshotları ana liste boş olsa da kimlik çözümüne katılır', () => {
  const runtime = {
    asasOrders: [],
    asasOrdersByTarget: {
      lfl: [{ ocode: 1003, model: 'STYLE-B', ccode: 'BLK', plm: 333 }],
      orders: [{ ocode: 1003, model: 'STYLE-B', ccode: 'BLK', plm: 333 }],
    },
  };
  const orders = resolver.ordersFromRuntime(runtime);
  assert.equal(orders.length, 1);
  const result = resolver.resolveItems([{ orderCode: '1003', styleName: 'STYLE-B', colourCode: 'BLK' }], { orders });
  assert.equal(result.resolved[0].plmId, '333');
});

test('model asset scope unresolved kimliklerde orderCode bilgisini korur ve farklı siparişleri çökertmez', () => {
  const identities = scope.dedupe([
    { styleName: 'STYLE-C', colourCode: 'WHT', orderCode: '2001' },
    { styleName: 'STYLE-C', colourCode: 'WHT', orderCode: '2002' },
  ]);
  assert.equal(identities.length, 2);
  assert.equal(identities[0].orderCode, '2001');
  assert.equal(identities[1].orderCode, '2002');
});

test('LFL, OAB ve Price Analysis alt detayları gizli kimlik metadata taşır', () => {
  assert.match(LFL_UI, /orderCode:norm\(row&&row\.orderCode\)/);
  assert.match(OAB, /function oabDrillModelIdentity\(source\)/);
  assert.match(OAB, /orderCode: row\['Sipariş Kod'\]/);
  assert.match(APP, /orderCode:norm\(item&&\(item\.orderKey\|\|item\.orderCode/);
  assert.match(APP, /list\.push\(\{plmId,colourCode,colour,styleName,orderCode,rowId/);
});

test('sunucu boş ASAS dizisini yüklenmiş authoritative snapshot sanmaz', () => {
  assert.match(SERVER, /if\(runtime\.loadedAt && Array\.isArray\(runtime\.asasOrders\) && runtime\.lflLoadedAt\) return runtime;/);
  assert.match(SERVER, /modelImageIdentityOrders\(runtime\)/);
});

test('OAB kategori önekli Option Adı yalın ASAS model adına çözülür', () => {
  const orders = [{ ocode: 1004, model: 'BARRY-YD', ccode: 'BLK', plm: 444 }];
  const result = resolver.resolveItems([{ styleName: 'PNT,BARRY-YD', colourCode: 'BLK' }], { orders });
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.resolved[0].plmId, '444');
  assert.deepEqual(resolver.modelKeys('KK.BDY,GARFIELD-1-YD'), ['KK.BDY,GARFIELD-1-YD', 'GARFIELD-1-YD']);
  assert.deepEqual(resolver.modelKeys('GARFIELD-1-YD'), ['GARFIELD-1-YD']);
});

test('sipariş geçilmemiş opsiyon PLM ID’yi Koleksiyon satırından alır', () => {
  const collectionRows = [{ modelKod: 'GARFIELD-1-YD', plmId: '2112907' }];
  const result = resolver.resolveItems([{ styleName: 'KK.BDY,GARFIELD-1-YD', colourCode: 'ECRU' }], { orders: [], collectionRows });
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.resolved[0].plmId, '2112907');
  assert.match(SERVER, /collectionRows:\s*modelImageIdentityCollectionRows\(req\.currentUser\.id,\s*raw\)/);
});

test('istemci kanonik PLM çözümü önekli adı da dener', () => {
  assert.match(APP, /const bare=key\.replace\(\/\^\[\^\\s,\]\{1,16\},\\s\*\(\?=\\S\)\/,''\)/);
});

test('ortak detay çekmecesi Backlog iç meta kimliğini (_plmId/_colourCode/_imageRef) okur', () => {
  const DRAWER = fs.readFileSync(path.join(ROOT, 'public', 'detail-drawer.js'), 'utf8');
  assert.match(DRAWER, /const rawPlmId=get\('plmId','plm','_plmId'/);
  assert.match(DRAWER, /colourCode:get\('colourCode','ccode','_colourCode'/);
  assert.match(DRAWER, /orderCode:get\('orderCode','ocode','orderKey'/);
  assert.match(DRAWER, /'Option Name','_modelName'\)/);
  assert.match(DRAWER, /directRef\?'\/api\/cp-images\/'\+encodeURIComponent\(directRef\)/);
});
