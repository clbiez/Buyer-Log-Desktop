'use strict';

/*
 * COLLECTION DIRECT PLM SYNC — VERİ KAYNAĞI (server tarafı)
 *
 * TARİHÇE.
 *   1) Başlangıçta ek iş alanları (Product Main Definition, Line, Category…)
 *      GetStyleList'in ham alan adları TAHMİN EDİLEREK çıkarılıyordu.
 *   2) Üretimde kullanıcı bildirdi: "Koleksiyonda PLM model bilgilerini
 *      yanlış çekiyor." Aday listesi bu yüzden TAMAMEN BOŞALTILMIŞTI —
 *      yalnız kanıtlanmış 6 alan (plmId, styleId, styleName, specialCode,
 *      season, imageUrl) üretiliyordu.
 *   3) Kullanıcının kendi CoreNectum oturumunda CANLI bir GetStyleList
 *      yanıtı incelendi (Buyer'ın Style List ekranı sütun başlıkları ile
 *      ham JSON anahtarları birebir karşılaştırıldı, değer örnekleriyle
 *      doğrulandı). Bu dosya artık DOĞRULANMIŞ alan adlarının doğru
 *      çıkarıldığını kilitler.
 *
 * AYRICA KİLİTLENEN İKİNCİ KÖK NEDEN ("X modeline Y modelinin license
 * bilgisi geliyordu"): licensor bu API'de HİÇ mevcut değil (internalBrandName
 * /externalBrandName her kayıtta null) — bu yüzden licensor kasıtlı olarak
 * DIŞARIDA bırakıldı; "lisans" (license) alanı GetStyleList'ten değil,
 * kolPlmBrandToken + ASAS onaylı çeviri sözlüğünden gelir ve o mekanizmanın
 * düzeltmesi tests/plm-sync-collection-engine-v908.test.js'te kilitli.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONNECTOR_SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const SERVER = require('./helpers/server-source')();
const connector = require('../server/lib/agent-browser-connector');

/* Kullanıcının kendi CoreNectum oturumunda görülen GERÇEK bir GetStyleList
   kaydının küçültülmüş biçimi — alan adları UYDURULMADI, canlı yanıttan
   kopyalandı. */
function realSampleModel(overrides = {}) {
  return {
    styleId: 2100968, plmCode: 2100968, styleName: 'BRAWLS-8-M', specialCode: 'S7OT04Z4',
    seasonName: 'S7-2027 YAZ',
    productMainDefinitionName: 'T-Shirt',
    merchSubGroupName: 'CU4E - CU4E-Kids Boy',
    merchBrandAgeGroupName: 'CUW4 - Boys',
    buyerGroupName: 'LİSANS',
    lineName: 'BS',
    productCategoryName: '2639 - KEY JERSEY BODY SHORT SLEEVED-LICENSE',
    mainFabricInfo: '3859-Jersey,30,Ne Compact Combed 150 gsm,100%Cotton Reactive Dyed',
    labelFitName: 'REGULAR FIT',
    workflowStatusName: '5-Approved / Create Product Card',
    orderStatusName: 'Order Ready',
    productTypeName: 'Single Style',
    buyer: null,
    ageGroupName: 'CHILD',
    internalBrandName: null, externalBrandName: null,
    colors: [{ id: 4251993, name: 'LIGHT NAVY', hexCode: '#28426c', pantone: null, colorCode: '7CZ' }],
    ...overrides,
  };
}

/* ------------------------------------------------ EK ALAN ÇIKARIMI: DOĞRULANDI */

test('CORENECTUM_EXTRA_FIELDS doğrulanmış (gerçek yanıttan) alan adlarını içerir', () => {
  const targets = connector.CORENECTUM_EXTRA_FIELDS.map(([target]) => target).sort();
  assert.deepEqual(targets, [
    'ageGroup', 'buyerRaw', 'buyingGroup', 'categoryRaw', 'designSourceRaw', 'fabric', 'fit', 'lineRaw',
    'magRaw', 'mmygRaw', 'orderStatusRaw', 'productMainDefinition', 'productType', 'statusRaw',
  ].sort());
});

test('coreNectumExtraFields gerçek bir kayıttan Excel importer’ın tüm hedef alanlarını doğru üretir', () => {
  const out = connector.coreNectumExtraFields(realSampleModel());
  assert.deepEqual(out, {
    productMainDefinition: 'T-Shirt',
    magRaw: 'CU4E - CU4E-Kids Boy',
    mmygRaw: 'CUW4 - Boys',
    buyingGroup: 'LİSANS',
    lineRaw: 'BS',
    categoryRaw: '2639 - KEY JERSEY BODY SHORT SLEEVED-LICENSE',
    fabric: '3859-Jersey,30,Ne Compact Combed 150 gsm,100%Cotton Reactive Dyed',
    fit: 'REGULAR FIT',
    statusRaw: '5-Approved / Create Product Card',
    orderStatusRaw: 'Order Ready',
    productType: 'Single Style',
    ageGroup: 'CHILD',
    // buyerRaw yok: bu kayıtta buyer null — boş alan yazılmaz.
  });
});

test('licensor/colourCode/colour BİLEREK dışarıda — GetStyleList’te güvenilir karşılığı yok', () => {
  const targets = connector.CORENECTUM_EXTRA_FIELDS.map(([target]) => target);
  assert.ok(!targets.includes('licensor'), 'licensor: internalBrandName/externalBrandName gerçek yanıtta null geliyor');
  assert.ok(!targets.includes('colourCode'), 'colourCode: style seviyesinde dizi (colors[]), tekil alan değil');
  assert.ok(!targets.includes('colour'), 'colour: aynı sebepten dışarıda');
  // Gerçek kayıtta bir "colors" dizisi var ama coreNectumExtraFields ona hiç dokunmuyor.
  const out = connector.coreNectumExtraFields(realSampleModel());
  assert.equal(out.colourCode, undefined);
  assert.equal(out.colour, undefined);
  assert.equal(out.licensor, undefined);
});

test('coreNectumExtraFields eksik/null alanlarda o hedefi SESSİZCE ATLAR, boş yazmaz', () => {
  const out = connector.coreNectumExtraFields(realSampleModel({ buyer: null, productTypeName: '' }));
  assert.equal(out.buyerRaw, undefined);
  assert.equal(out.productType, undefined);
  assert.deepEqual(connector.coreNectumExtraFields({}), {});
  assert.deepEqual(connector.coreNectumExtraFields(null), {});
});

test('coreNectumExtraFields değerleri kırpar ve makul bir üst sınırla sınırlar', () => {
  const out = connector.coreNectumExtraFields(realSampleModel({ lineName: '  BS  ', workflowStatusName: 'x'.repeat(500) }));
  assert.equal(out.lineRaw, 'BS');
  assert.equal(out.statusRaw.length, 300);
});

test('CDP ile sayfa içinde çalışan extraFields metni, Node fonksiyonuyla AYNI (doğrulanmış) sonucu üretir', () => {
  const fn = eval(connector.CORENECTUM_EXTRA_FIELDS_JS);
  const raw = realSampleModel();
  assert.deepEqual(fn(raw), connector.coreNectumExtraFields(raw));
  assert.deepEqual(fn({}), {});
});

/* -------------------------------------------- KANITLANMIŞ 6 ALAN + EK ALANLAR */

test('coreNectumStyleListRows (Node) gerçek bir kayıttan hem 6 temel hem doğrulanmış ek alanları üretir', () => {
  const payload = { data: { coreNectumResultData: { styleListResult: [realSampleModel()] } } };
  const rows = connector.coreNectumStyleListRows(payload);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
     plmId: '2100968', styleId: '2100968', styleName: 'BRAWLS-8-M', specialCode: 'S7OT04Z4', season: 'S7-2027 YAZ',
     colors: [{ id: 4251993, name: 'LIGHT NAVY', colorCode: '7CZ', hexCode: '#28426c' }],
    productMainDefinition: 'T-Shirt', magRaw: 'CU4E - CU4E-Kids Boy', mmygRaw: 'CUW4 - Boys',
    buyingGroup: 'LİSANS', lineRaw: 'BS', categoryRaw: '2639 - KEY JERSEY BODY SHORT SLEEVED-LICENSE',
    fabric: '3859-Jersey,30,Ne Compact Combed 150 gsm,100%Cotton Reactive Dyed', fit: 'REGULAR FIT',
    statusRaw: '5-Approved / Create Product Card', orderStatusRaw: 'Order Ready',
    productType: 'Single Style', ageGroup: 'CHILD',
  });
});

test('eski (ek alansız) çağıranlar için şekil AYNEN korunur — geriye dönük uyumlu', () => {
  const payload = { data: { coreNectumResultData: { styleListResult: [
    { styleId: 2468230, plmCode: 2108736, styleName: 'LIVERPOOL-4-YI', specialCode: 'S7OT04Z4' },
  ] } } };
  assert.deepEqual(connector.coreNectumStyleListRows(payload), [
    { plmId: '2108736', styleId: '2468230', styleName: 'LIVERPOOL-4-YI', specialCode: 'S7OT04Z4' },
  ]);
});

test('coreNectumBulkApiScan (CDP replay, gerçekten ÇALIŞTIRILARAK) doğrulanmış ek alanları da döndürür — "Dosyalar"/TP akışı bu fonksiyona bağımlı', async () => {
  const payloads = [
    { data: { coreNectumResultData: { styleListResult: [realSampleModel({ plmCode: 200, styleId: 300, styleName: 'MODEL-A' })] } } },
  ];
  const page = {
    _evaluateValue(expression) {
      const mockFetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        const index = Number(body.pageIndex) || 0;
        return { ok: true, json: async () => payloads[index] || { data: { coreNectumResultData: { styleListResult: [] } } } };
      };
      return Function('fetch', 'setTimeout', `return ${expression}`)(mockFetch, setTimeout);
    },
  };
  const capture = {
    templates: [{ url: 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/StyleList/GetStyleList', method: 'POST', headers: {}, body: { pageIndex: 0, pageSize: 50 } }],
    async waitForTemplate() { return true; },
  };
  const result = await connector.coreNectumBulkApiScan(page, capture, new Set(['200']));
  assert.equal(result.rows.length, 1, JSON.stringify(result));
  assert.equal(result.rows[0].plmId, '200');
  assert.equal(result.rows[0].styleName, 'MODEL-A');
  assert.equal(result.rows[0].lineRaw, 'BS');
  assert.equal(result.rows[0].categoryRaw, '2639 - KEY JERSEY BODY SHORT SLEEVED-LICENSE');
  assert.equal(result.rows[0].statusRaw, '5-Approved / Create Product Card');
  assert.equal(result.rows[0].licensor, undefined, 'licensor hiçbir zaman üretilmemeli');
});

/* ------------------------------------------ İKİNCİ BİR UYGULAMA YOK (§37) */

test('/api/plm-sync/fetch İKİNCİ bir GetStyleList/pagination uygulaması YAZMAZ — mevcut collectCoreNectumStyleLinks’i çağırır', () => {
  const routeStart = SERVER.indexOf("app.post('/api/plm-sync/fetch'");
  assert.ok(routeStart >= 0, 'rota bulunamadı');
  const route = SERVER.slice(routeStart, SERVER.indexOf('\n});', routeStart) + 4);
  assert.match(route, /agentBrowserConnector\.collectCoreNectumStyleLinks/);
  assert.doesNotMatch(route, /GetStyleList/i, 'rota GetStyleList URL’ini KENDİ BAŞINA bilmemeli — tek kaynak connector’dadır');
  assert.doesNotMatch(route, /StyleList\/GetStyleList/i);
});

test('/api/plm-sync/fetch koleksiyon yetkisi ister ve girdi doğrulaması yapar', () => {
  const routeStart = SERVER.indexOf("app.post('/api/plm-sync/fetch'");
  const header = SERVER.slice(routeStart, routeStart + 200);
  assert.match(header, /userAccess\.requireArea\('koleksiyon'\)/);
  const route = SERVER.slice(routeStart, SERVER.indexOf('\n});', routeStart) + 4);
  assert.match(route, /VALIDATION_ERROR/);
  assert.match(route, /PLM_ID_REQUIRED/);
});

test('/api/plm-sync/fetch görsel istemez (needImage:false) — görsel altyapısı ayrı akışın işi (§13)', () => {
  const routeStart = SERVER.indexOf("app.post('/api/plm-sync/fetch'");
  const route = SERVER.slice(routeStart, SERVER.indexOf('\n});', routeStart) + 4);
  assert.match(route, /needImage:\s*false/);
});

test('/api/plm-sync/fetch PLM link sözlüğünü de tazeler (upsertPlmStyleLinks) — bedava bir yan fayda', () => {
  const routeStart = SERVER.indexOf("app.post('/api/plm-sync/fetch'");
  const route = SERVER.slice(routeStart, SERVER.indexOf('\n});', routeStart) + 4);
  assert.match(route, /upsertPlmStyleLinks/);
});

test('/api/plm-sync/fetch ilerleme durumunu paylaşılan model-operation-status ile raporlar', () => {
  const routeStart = SERVER.indexOf("app.post('/api/plm-sync/fetch'");
  const route = SERVER.slice(routeStart, SERVER.indexOf('\n});', routeStart) + 4);
  assert.match(route, /setModelOperationProgress/);
  assert.match(route, /clearModelOperationProgress/);
});

/* ---------------------------------------- MEVCUT ALAN LİSTESİ TEK YERDE */

test('CORENECTUM_EXTRA_FIELDS tanımı yalnız BİR yerde var, dosyaya dağıtılmamış', () => {
  const matches = CONNECTOR_SOURCE.match(/const CORENECTUM_EXTRA_FIELDS=Object\.freeze/g) || [];
  assert.equal(matches.length, 1);
});

test('yeni alanlar Excel importer’ın kolPlmHeaderAliases hedef adlarıyla BİREBİR eşleşir', () => {
  const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  const aliasBlockStart = APP.indexOf('function kolPlmHeaderAliases()');
  const aliasBlock = APP.slice(aliasBlockStart, APP.indexOf('\n}', aliasBlockStart));
  const excelTargets = [...aliasBlock.matchAll(/add\('([a-zA-Z]+)'/g)].map(m => m[1]);
  const extraTargets = connector.CORENECTUM_EXTRA_FIELDS.map(([target]) => target);
  for (const target of extraTargets) {
    assert.ok(excelTargets.includes(target), `${target} Excel importer’ın alan adlarında yok — iki sistem AYRIŞIYOR`);
  }
});
