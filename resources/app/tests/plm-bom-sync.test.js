'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const bomApi = require('../server/lib/corenectum-bom-api');
const { createStore } = require('../server/lib/plm-bom-store');
const bomSync = require('../server/lib/plm-bom-sync');

function payload(components, overrides = {}) {
  return {
    data: {
      coreNectumResultData: {
        styleBom: {
          styleId: 2538477,
          styleBomId: 1882623,
          createdDate: '2026-09-29T05:30:32.853Z',
          modifiedDate: null,
          styleBomComponents: components,
          ...overrides,
        },
      },
      success: true,
    },
  };
}
function component(overrides = {}) {
  return {
    styleBomId: 1882623,
    styleBomComponentId: 11494310,
    componentId: 652669,
    componentCode: 'B652669',
    componentName: null,
    description: 'ÖN BEDEN / FRONT BODY',
    componentTypeId: 2,
    componentType: 'Trim',
    mainCategoryId: 1,
    mainCategoryName: 'Embellishment',
    categoryId: 21,
    categoryName: 'Print',
    categoryGroupId: 123,
    categoryGroupName: 'Pigment',
    imageUrl: 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/x',
    quantity: 1,
    graphicApprovalStatusName: 'FMH Approved',
    ...overrides,
  };
}

test('canlı doğrulanmış BOM request body styleId sayısını taşır', () => {
  assert.deepEqual(bomApi.bomRequestBody('2538477'), { styleId: 2538477 });
  assert.equal(bomApi.GET_STYLE_BOM_INFORMATION_URL.endsWith('/StyleMainInformation/GetStyleBomInformation'), true);
});

test('BOM parser Ön + Arka Pigment baskıyı 2 olarak çıkarır; SEE ARTWORK label baskı sayılmaz', () => {
  const data = payload([
    component(),
    component({ styleBomComponentId: 11494311, componentId: 652670, componentCode: 'B652670', description: 'ARKA BEDEN / BACK BODY' }),
    component({
      styleBomComponentId: 11494306, componentId: 638426, componentCode: 'LBPP638426',
      mainCategoryId: 2, mainCategoryName: 'Label', categoryId: 18, categoryName: 'Label',
      categoryGroupId: 183, categoryGroupName: 'License Label', description: '',
    }),
  ]);
  const result = bomApi.analyzeBom(data);
  assert.equal(result.hasPrint, true);
  assert.equal(result.totalPrintCount, 2);
  assert.equal(result.placements[0].placement, 'front_body');
  assert.equal(result.placements[1].placement, 'back_body');
  assert.equal(result.techniqueSummary, 'Pigment');
  assert.equal(result.summary, 'Ön: 1 • Arka: 1 | Pigment | Toplam: 2');
  assert.equal(result.components.length, 2, 'Label satırı normalize embellishment kanıtına girmemeli');
  assert.equal(result.needsAi, false);
});

test('tek Print satırı Ön + Arka bölgeyi kapsıyorsa iki baskı sayılır (SPIDERMAN-4-YD)', () => {
  const result = bomApi.analyzeBom(payload([
    component({ description: 'ÖN BEDEN + ARKA BEDEN + FRONT BODY + BACK BODY' }),
  ]));
  assert.deepEqual(result.placements.map(item => item.placement), ['front_body', 'back_body']);
  assert.equal(result.totalPrintCount, 2);
  assert.equal(result.summary, 'Ön: 1 • Arka: 1 | Pigment | Toplam: 2');
  assert.equal(result.needsAi, false);
});

test('All Over (TÜM BEDEN / ALL BODY) kumaşta yazdığı için Artwork özetine girmez (PSG-6-YD)', () => {
  const result = bomApi.analyzeBom(payload([
    component({ componentCode: 'B1', description: 'TÜM BEDEN / ALL BODY', categoryGroupName: 'Allover' }),
    component({ styleBomComponentId: 2, componentCode: 'B2', description: 'ÖN BEDEN / DRONT BODY' }),
  ]));
  assert.equal(result.placements[0].placement, 'all_over');
  assert.equal(result.needsAi, false);
  assert.equal(result.totalPrintCount, 1);
  assert.equal(result.techniqueSummary, 'Pigment');
  assert.equal(result.summary, 'Ön: 1 | Pigment | Toplam: 1');
  const onlyAllOver = bomApi.analyzeBom(payload([component({ description: 'ALL OVER' })]));
  assert.equal(onlyAllOver.hasPrint, false);
  assert.equal(onlyAllOver.summary, 'Baskı yok');
});

test('Ön ve Arka farklı teknikteyse her bölge kendi tekniğiyle yazılır', () => {
  const result = bomApi.analyzeBom(payload([
    component(),
    component({ styleBomComponentId: 2, componentCode: 'B2', description: 'ARKA BEDEN / BACK BODY', categoryGroupName: 'Transfer' }),
  ]));
  assert.equal(result.summary, 'Ön: 1 | Pigment • Arka: 1 | Transfer | Toplam: 2');
});

test('analiz kuralı sürümü fingerprint\'e girer; eski kayıtlar yeni kuralla yeniden çözümlenir', () => {
  assert.ok(bomApi.ANALYZER_VERSION >= 2);
  const a = bomApi.analyzeBom(payload([component()]));
  assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
});

test('belirsiz Print yerleşimi LCW AI sonucu yalnız aynı componentCode için kabul eder', () => {
  const base = bomApi.analyzeBom(payload([
    component({ componentCode: 'B-UNKNOWN', description: 'SPECIAL ART POSITION' }),
  ]));
  assert.equal(base.needsAi, true);
  const merged = bomApi.mergeAiAnalysis(base, {
    placements: [
      { componentCode: 'B-UNKNOWN', placement: 'left_sleeve', confidence: 'high', reason: 'description context' },
      { componentCode: 'HALLUCINATED', placement: 'back_body', confidence: 'high' },
    ],
    confidence: 'high',
  });
  assert.equal(merged.needsAi, false);
  assert.equal(merged.placements.length, 1);
  assert.equal(merged.placements[0].placement, 'left_sleeve');
  assert.equal(merged.placements[0].aiResolved, true);
});

test('BOM fingerprint değişmediyse ikinci PLM Sync LCW AI çağrısını tekrar etmez', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-bom-'));
  const store = createStore(path.join(tmp, 'plm-bom.json'));
  let aiCalls = 0, postCalls = 0;
  const postJson = async (_url, body) => {
    postCalls += 1;
    assert.deepEqual(body, { styleId: 2538477 });
    return payload([component({ componentCode: 'B-UNKNOWN', description: 'SPECIAL ART POSITION' })]);
  };
  const aiEngine = {
    async ask() {
      aiCalls += 1;
      return {
        text: JSON.stringify({
          placements: [{ componentCode: 'B-UNKNOWN', placement: 'chest', confidence: 'high', reason: 'interpreted placement' }],
          confidence: 'high',
          notes: [],
        }),
        model: { key: 'gpt-6-sol' },
      };
    },
  };
  const records = [{ plmId: '2133719', styleId: '2538477', styleName: 'MINECRAFT' }];
  const first = await bomSync.syncPlmBoms(records, { ownerId: 'u1', store, postJson, aiEngine, maxAiPerSync: 5 });
  assert.equal(first.changed, 1);
  assert.equal(first.aiConsulted, 1);
  assert.equal(first.aiResolved, 1);
  assert.equal(store.entry('2133719').placements[0].placement, 'chest');

  const second = await bomSync.syncPlmBoms(records, { ownerId: 'u1', store, postJson, aiEngine, maxAiPerSync: 5 });
  assert.equal(second.changed, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(second.aiConsulted, 0);
  assert.equal(aiCalls, 1);
  assert.equal(postCalls, 2, 'BOM yine okunur; yalnız AI değişmeyen fingerprintte atlanır');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('ertelenen/başarısız LCW AI analizi fingerprint aynı olsa da sonraki PLM Sync\'te yeniden denenir', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-bom-'));
  const store = createStore(path.join(tmp, 'plm-bom.json'));
  let aiCalls = 0;
  const postJson = async () => payload([component({ componentCode: 'B-UNKNOWN', description: 'SPECIAL ART POSITION' })]);
  const aiEngine = {
    async ask() {
      aiCalls += 1;
      return {
        text: JSON.stringify({ placements: [{ componentCode: 'B-UNKNOWN', placement: 'chest', confidence: 'high', reason: 'x' }], confidence: 'high', notes: [] }),
        model: { key: 'gpt-6-sol' },
      };
    },
  };
  const records = [{ plmId: '2133719', styleId: '2538477', styleName: 'MINECRAFT' }];
  const offline = { async ask() { throw Object.assign(new Error('offline'), { code: 'LCWAI_UNAVAILABLE' }); } };
  await bomSync.syncPlmBoms(records, { ownerId: 'u1', store, postJson, aiEngine: offline, maxAiPerSync: 5 });
  assert.equal(store.entry('2133719').ai.status, 'failed');

  const second = await bomSync.syncPlmBoms(records, { ownerId: 'u1', store, postJson, aiEngine, maxAiPerSync: 5 });
  assert.equal(second.unchanged, 0);
  assert.equal(second.changed, 1);
  assert.equal(aiCalls, 1);
  assert.equal(store.entry('2133719').ai.status, 'resolved');
  assert.equal(store.entry('2133719').placements[0].placement, 'chest');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('BOM fetch hatası daha önce saklanan başarılı kaydı silmez', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-bom-old-'));
  const store = createStore(path.join(tmp, 'plm-bom.json'));
  store.saveResults([{
    plmId: '2133719', styleId: '2538477', styleBomId: '1882623', fingerprint: 'old',
    placements: [{ componentCode: 'B1', placement: 'front_body', printType: 'Pigment', count: 1 }],
    components: [component({ componentCode: 'B1' })],
    ai: { status: 'not-needed' },
  }]);
  const result = await bomSync.syncPlmBoms(
    [{ plmId: '2133719', styleId: '2538477' }],
    { ownerId: 'u1', store, postJson: async () => { throw Object.assign(new Error('network'), { code: 'X' }); } }
  );
  assert.equal(result.failed.length, 1);
  assert.equal(result.entries.get('2133719').summary.includes('Ön: 1'), true);
  assert.ok(store.entry('2133719'), 'eski kayıt korunmalı');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('PLM Sync route BOM senkronunu aynı işin içine alır ve saklı BOM okuma ucu sunar', () => {
  const route = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'plm-sync-routes.js'), 'utf8');
  assert.match(route, /plmBomSync\.syncPlmBoms\(collected\.links/);
  assert.match(route, /bomSummary/);
  assert.match(route, /bom:\s*collected\.bomSync/);
  assert.match(route, /app\.get\('\/api\/plm-sync\/bom\/:plmId'/);
  assert.match(route, /plmBomStore\.entry\(plmId\)/);
});

test('CoreNectum allowlist doğrulanmış BOM endpointini içerir', () => {
  const client = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'corenectum-api-client.js'), 'utf8');
  assert.match(client, /corenectum-bom-api/);
  assert.match(client, /bomApi\.GET_STYLE_BOM_INFORMATION_URL/);
});

test('BOM görüntüleyici lazy yüklenir ve model sağ tık menüsünde açılır', () => {
  const perf = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');
  const menu = fs.readFileSync(path.join(ROOT, 'public', 'row-context-menu.js'), 'utf8');
  const view = fs.readFileSync(path.join(ROOT, 'public', 'plm-bom.js'), 'utf8');
  assert.match(perf, /plm-bom\.js[^\n]*row-context-menu\.js/);
  assert.match(menu, /PLM BOM \/ Baskı Detayı/);
  assert.match(menu, /plmBom\.openForRow/);
  assert.match(view, /\/api\/plm-sync\/bom\//);
  assert.match(view, /BOM net · LCW AI gerekmedi/);
});
