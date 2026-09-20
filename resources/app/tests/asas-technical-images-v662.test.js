'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-asas-images-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = testRoot;

const parse = require('../server/lib/parse');
const modelFields = require('../server/lib/model-fields');
const technical = require('../server/lib/asas-technical-images');
const browserConnector = require('../server/lib/agent-browser-connector');
const modelRefresh = require('../server/lib/model-refresh');

function imageResult(candidate, suffix = 'new') {
  return { key: candidate.key, mimeType: 'image/jpeg', base64: Buffer.from(`image-${suffix}`).toString('base64'), filename: `${suffix}.jpg` };
}

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

test('ASAS alan kataloğu gerçek Teknik Görsel sütununu otomatik eşler', () => {
  const mapped = modelFields.autoMapColumns('asas', ['Sipariş Kod', 'Teknik Görsel']);
  assert.equal(mapped.mapping['Teknik Resim'], 'Teknik Görsel');
});

test('eski eksiksiz Data Model bağlantısı yeni Teknik Resim alanını bir kez öğrenir', async () => {
  const mapping = {};
  modelFields.fieldsForRole('asas').filter(field => field.required).forEach(field => {
    mapping[field.header] = { table: 'ASAS', name: field.header, kind: 'column' };
  });
  const connection = { role: 'asas', server: 'server', catalog: 'catalog', mapping };
  let schemaReads = 0;
  const repaired = await modelRefresh.ensureConnectionMapping(connection, {
    discoverSchema: async () => {
      schemaReads += 1;
      return { columns: [{ table: 'ASAS', name: 'Teknik Resim', kind: 'column' }], measures: [] };
    },
  });
  assert.equal(schemaReads, 1);
  assert.equal(repaired.repaired, true);
  assert.equal(connection.mapping['Teknik Resim'].name, 'Teknik Resim');
});

test('ASAS parser Teknik Görsel bağlantısını PLM Kod ile aynı siparişe taşır', () => {
  const url = 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/PLMImageOperation/GetStyleImageById/453117';
  const parsed = parse.parseASASRows([{
    'Sipariş Kod': 1001, 'Renk': 'Siyah', 'Renk Kod': '3E8',
    'Net Alım Sipariş Miktarı': 10, 'Kalan Alım Sipariş Miktarı': 5,
    'PLM Kod': 453117, 'Model Adı': 'MODEL', 'Buyer Grup (TR)': 'LİSANS',
    'Teknik Görsel': url,
  }]);
  assert.equal(parsed.orders.length, 1);
  assert.equal(parsed.orders[0].plm, 453117);
  assert.equal(parsed.orders[0].technicalImageUrl, url);
});

test('ASAS Tümünü Güncelle mevcut görselin üzerine yazar', async () => {
  const order = { plm: 453117, ccode: '3E8', model: 'MODEL', technicalImageUrl: 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/PLMImageOperation/GetStyleImageById/453117' };
  const key = parse.plmImageKey(order.plm);
  const overrides = { imagemap: { [key]: 'old-plm-ref' } };
  let counter = 0, deleted = [];
  const result = await technical.syncAsasTechnicalImages({
    orders: [order], overrides, mode:'all', forceRetry:true, getImage: () => true,
    collect: async items => ({ images: new Map([[items[0].key, imageResult(items[0])]]), failures: new Map() }),
    saveImage: () => ({ id: `asas-ref-${++counter}` }),
    patchLinks: items => { for (const item of items) overrides.imagemap[parse.plmImageKey(item.plmId)] = item.imageRef; return { overrides }; },
    deleteImage: ref => deleted.push(ref),
  });
  assert.equal(result.mode, 'all');
  assert.equal(result.saved, 1);
  assert.equal(overrides.imagemap[key], 'asas-ref-1');
  assert.deepEqual(deleted, ['old-plm-ref']);
});

test('ASAS Eksikleri Tamamla kayıtlı görseli korur ve yalnız yeni eksiği tamamlar', async () => {
  const existing = { plm: 453117, ccode: '3E8', model: 'MODEL', technicalImageUrl: 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/PLMImageOperation/GetStyleImageById/453117' };
  const missing = { plm: 453118, ccode: '4F9', model: 'MODEL 2', technicalImageUrl: 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/CoreNectumAttachmentOperation/GetAttachment/641124178be353a0331610c20546b5bc' };
  const existingKey = parse.plmImageKey(existing.plm), missingKey = parse.plmImageKey(missing.plm);
  const overrides = { imagemap: { [existingKey]: 'asas-ref-1' } };
  let requested = [];
  const result = await technical.syncAsasTechnicalImages({
    orders: [existing, missing], overrides, mode:'missing', forceRetry:true, getImage: ref => ref === 'asas-ref-1',
    collect: async items => { requested = items.slice(); return { images: new Map([[items[0].key, imageResult(items[0], 'missing')]]), failures: new Map() }; },
    saveImage: () => ({ id: 'asas-ref-2' }),
    patchLinks: items => { for (const item of items) overrides.imagemap[parse.plmImageKey(item.plmId)] = item.imageRef; return { overrides }; },
    deleteImage: () => {},
  });
  assert.equal(result.mode, 'missing');
  assert.equal(requested.length, 1);
  assert.equal(requested[0].key, missingKey);
  assert.equal(overrides.imagemap[existingKey], 'asas-ref-1');
  assert.equal(overrides.imagemap[missingKey], 'asas-ref-2');
});

test('ASAS görsel adayları aynı PLM ID için renklerden bağımsız tekilleşir', async () => {
  const orders = [
    { plm: 453117, ccode: '3E8', model: 'MODEL', technicalImageUrl: 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/PLMImageOperation/GetStyleImageById/453117' },
    { plm: 453117, ccode: '4F9', model: 'MODEL', technicalImageUrl: 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/PLMImageOperation/GetStyleImageById/453117' },
  ];
  const key = parse.plmImageKey(orders[0].plm);
  const overrides = { imagemap: {} };
  let requested = [], linked = [];
  const result = await technical.syncAsasTechnicalImages({
    orders, overrides, mode:'all', forceRetry:true, keys:new Set([key]),
    collect: async items => { requested = items.slice(); return { images: new Map([[items[0].key, imageResult(items[0])]]), failures: new Map() }; },
    saveImage: () => ({ id: 'asas-ref-1' }),
    patchLinks: items => { linked = items.slice(); return { overrides }; },
    deleteImage: () => {},
  });
  assert.equal(result.candidates, 1);
  assert.equal(result.saved, 1);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].key, key);
  assert.deepEqual(linked, [{ plmId: 453117, colourCode: '', imageRef: 'asas-ref-1' }]);
});

test('ASAS görsel adayı Teknik Görsel alanı yoksa style ID tahmin etmez', () => {
  const candidates = technical.candidatesFromOrders([
    { plm: 453119, ccode: '3E8', model: 'MODEL WITHOUT URL' },
  ]);
  assert.equal(candidates.length, 0);
});

test('ASAS aynı PLM Kod için çelişkili Teknik Görsel bağlantısını indirmez', async () => {
  const plm = 953117, key = parse.plmImageKey(plm);
  let collectCalled = false;
  const result = await technical.syncAsasTechnicalImages({
    orders: [
      { plm, technicalImageUrl: 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/CoreNectumAttachmentOperation/GetAttachment/first' },
      { plm, technicalImageUrl: 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/CoreNectumAttachmentOperation/GetAttachment/second' },
    ],
    overrides: { imagemap: {} }, mode:'all', forceRetry:true, keys:new Set([key]),
    collect: async () => { collectCalled = true; return { images:new Map(), failures:new Map() }; },
  });
  assert.equal(collectCalled, false);
  assert.equal(result.saved, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.failedItems[0].code, 'ASAS_TECHNICAL_IMAGE_AMBIGUOUS');
});

test('ASAS görsel adayları 250 kayıtla sınırlanmaz', () => {
  const candidates = technical.candidatesFromOrders(Array.from({ length: 8000 }, (_, index) => ({
    plm: 460000 + index,
    model: `MODEL ${index}`,
    technicalImageUrl: `https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/CoreNectumAttachmentOperation/GetAttachment/${460000 + index}`,
  })));
  assert.equal(candidates.length, 8000);
});

test('yalnız izinli PIM Teknik Resim yolları kabul edilir', () => {
  assert.ok(technical.technicalImageUrl('https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/PLMImageOperation/GetStyleImageById/453117'));
  assert.ok(technical.technicalImageUrl('https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/CoreNectumAttachmentOperation/GetAttachment/641124178be353a0331610c20546b5bc'));
  assert.equal(technical.technicalImageUrl('https://example.com/image.jpg'), '');
  assert.equal(technical.technicalImageUrl('https://pim.prod.lcwaikiki.com/admin/delete/all'), '');
});

test('PIM görsel fetch betiği doğrulanmış Teknik Resim URL sini kullanır', () => {
  const url = 'https://pim.prod.lcwaikiki.com/productimageoperation/service/customer/api/PLMImageOperation/GetStyleImageById/453117';
  const expression = browserConnector.pimTechnicalImageFetchExpression(url);
  assert.match(expression, /pim\.prod\.lcwaikiki\.com/);
  assert.match(expression, /GetStyleImageById\/453117/);
  assert.match(expression, /credentials:'include'/);
});
