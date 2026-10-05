'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const setStyleApi = require('../server/lib/corenectum-set-style-api');
const styleApi = require('../server/lib/corenectum-style-api');
const bomApi = require('../server/lib/corenectum-bom-api');
const bomSync = require('../server/lib/plm-bom-sync');
const { createStore } = require('../server/lib/plm-bom-store');

function associationPayload() {
  return {
    data: {
      coreNectumResultData: {
        rfIdTypeId: 2,
        rfIdTypeName: 'RFID Internal Barcode Label',
        setStyleChildStyleColorAssociations: [
          {
            rowId: 10027947,
            relatedStyleOptions: [{
              relatedStyleOptionAssociationId: 288929,
              setStyleId: 2538479,
              childStyleId: 2538480,
              setStyleOptionId: 4390308,
              setStyleColorCode: 'R34',
              childStylePlmCode: 2133722,
              childStyleName: 'SHADOW-1-TKM-A-YI',
              childStyleOptionId: 4390309,
              childStyleColorCode: 'R34',
              perAssemblyCount: 1,
            }],
          },
          {
            rowId: 10027948,
            relatedStyleOptions: [{
              relatedStyleOptionAssociationId: 288930,
              setStyleId: 2538479,
              childStyleId: 2538481,
              setStyleOptionId: 4390308,
              setStyleColorCode: 'R34',
              childStylePlmCode: 2133723,
              childStyleName: 'SHADOW-1-TKM-B-YI',
              childStyleOptionId: 4390310,
              childStyleColorCode: 'R34',
              perAssemblyCount: 1,
            }],
          },
        ],
      },
      success: true,
      message: null,
      statusType: 0,
    },
  };
}

function styleListPayload() {
  return {
    data: {
      coreNectumResultData: {
        styleListResult: [
          {
            styleId: 2538480,
            plmCode: 2133722,
            styleName: 'SHADOW-1-TKM-A-YI',
            specialCode: 'S7B73174',
            mainFabricInfo: 'Orme,Süprem,150 gsm,100% Cotton',
            productMainDefinitionName: 'T-Shirt',
          },
          {
            styleId: 2538481,
            plmCode: 2133723,
            styleName: 'SHADOW-1-TKM-B-YI',
            specialCode: 'S7B73374',
            mainFabricInfo: 'Two Thread Loop Back,220 gsm,100% Cotton',
            productMainDefinitionName: 'Shorts',
          },
        ],
      },
      success: true,
    },
  };
}

function bomPayload(styleId, code, description) {
  return {
    data: {
      coreNectumResultData: {
        styleBom: {
          styleId,
          styleBomId: styleId + 1000000,
          createdDate: '2026-09-29T05:30:32.853Z',
          modifiedDate: null,
          styleBomComponents: [{
            styleBomId: styleId + 1000000,
            styleBomComponentId: styleId + 2000000,
            componentId: styleId + 3000000,
            componentCode: code,
            description,
            componentType: 'Trim',
            mainCategoryId: 1,
            mainCategoryName: 'Embellishment',
            categoryId: 21,
            categoryName: 'Print',
            categoryGroupId: 123,
            categoryGroupName: 'Pigment',
            quantity: 1,
            graphicApprovalStatusName: 'FMH Approved',
          }],
        },
      },
      success: true,
    },
  };
}

test('canlı SetStyleChildStyleColorAssociation yanıtı A/B child style ilişkisini çıkarır', () => {
  const children = setStyleApi.childStyleAssociations(associationPayload());
  assert.deepEqual(children.map(item => ({
    label: item.label,
    childStyleId: item.childStyleId,
    childPlmId: item.childPlmId,
    childStyleName: item.childStyleName,
  })), [
    { label: 'A', childStyleId: '2538480', childPlmId: '2133722', childStyleName: 'SHADOW-1-TKM-A-YI' },
    { label: 'B', childStyleId: '2538481', childPlmId: '2133723', childStyleName: 'SHADOW-1-TKM-B-YI' },
  ]);
});

test('Set Style PLM Sync parent satırı korur; Fabric ve BOM/Artwork bilgisini A/B child stylelardan toplar', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-set-style-'));
  const store = createStore(path.join(tmp, 'plm-bom.json'));
  const bomStyleIds = [];
  let associationCalls = 0;
  let styleListCalls = 0;

  const getJson = async (url, query) => {
    assert.equal(url, setStyleApi.SET_STYLE_CHILD_ASSOCIATION_URL);
    assert.deepEqual(query, { styleId: 2538479 });
    associationCalls += 1;
    return associationPayload();
  };
  const postJson = async (url, body) => {
    if (url === styleApi.GET_STYLE_LIST_URL) {
      styleListCalls += 1;
      assert.match(body.filterCriterias[0].filterValue, /2133722/);
      assert.match(body.filterCriterias[0].filterValue, /2133723/);
      return styleListPayload();
    }
    assert.equal(url, bomApi.GET_STYLE_BOM_INFORMATION_URL);
    bomStyleIds.push(Number(body.styleId));
    if (Number(body.styleId) === 2538479) throw new Error('Parent Set Style BOM çağrılmamalı');
    if (Number(body.styleId) === 2538480) return bomPayload(2538480, 'PRINT-A', 'ÖN BEDEN / FRONT BODY');
    if (Number(body.styleId) === 2538481) return bomPayload(2538481, 'PRINT-B', 'SAĞ BACAK / RIGHT LEG');
    throw new Error('Beklenmeyen styleId ' + body.styleId);
  };

  const result = await bomSync.syncPlmBoms([{
    plmId: '2133721',
    styleId: '2538479',
    styleName: 'SHADOW-1-TKM-YI',
    productType: 'Set Style',
    fabric: '',
  }], { ownerId: 'u1', store, getJson, postJson });

  assert.equal(associationCalls, 1);
  assert.equal(styleListCalls, 1);
  assert.deepEqual(bomStyleIds.sort((a, b) => a - b), [2538480, 2538481]);
  assert.equal(result.entries.size, 1, 'child modeller ayrı Buyer Log/BOM kaydı olmamalı');
  assert.equal(result.entries.has('2133722'), false);
  assert.equal(result.entries.has('2133723'), false);

  const entry = result.entries.get('2133721');
  assert.equal(entry.plmId, '2133721');
  assert.equal(entry.styleId, '2538479');
  assert.equal(entry.isSetStyle, true);
  assert.equal(entry.setComponents.length, 2);
  assert.deepEqual(entry.setComponents.map(item => [item.label, item.childPlmId, item.childStyleId]), [
    ['A', '2133722', '2538480'],
    ['B', '2133723', '2538481'],
  ]);
  assert.equal(entry.fabricSummary, 'A - Orme,Süprem,150 gsm,100% Cotton\nB - Two Thread Loop Back,220 gsm,100% Cotton');
  assert.equal(entry.artworkSummary, 'A - Ön: 1 | Pigment | Toplam: 1\nB - Sağ Bacak: 1 | Pigment | Toplam: 1');
  assert.equal(entry.totalPrintCount, 2);
  assert.deepEqual(entry.placements.map(item => item.setPart), ['A', 'B']);

  const override = result.recordOverrides.get('2133721');
  assert.equal(override.fabric, entry.fabricSummary, 'mevcut Buyer Log Fabric hücresi A/B biçiminde güncellenmeli');
  assert.equal(override.artworkSummary, entry.artworkSummary);
  assert.deepEqual(override.setStyleComponents.map(item => item.plmId), ['2133722', '2133723']);

  const saved = store.entry('2133721');
  assert.equal(saved.isSetStyle, true);
  assert.equal(saved.setComponents[0].specialCode, 'S7B73174');
  assert.equal(saved.setComponents[1].specialCode, 'S7B73374');
  assert.equal(saved.fabricSummary, entry.fabricSummary);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Single Style eski akışta kalır; child association endpointi çağrılmaz', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-single-style-'));
  const store = createStore(path.join(tmp, 'plm-bom.json'));
  let associationCalls = 0;
  const result = await bomSync.syncPlmBoms([{
    plmId: '2133719', styleId: '2538477', styleName: 'SINGLE', productType: 'Single Style',
  }], {
    ownerId: 'u1',
    store,
    getJson: async () => { associationCalls += 1; throw new Error('çağrılmamalı'); },
    postJson: async (url, body) => {
      assert.equal(url, bomApi.GET_STYLE_BOM_INFORMATION_URL);
      assert.deepEqual(body, { styleId: 2538477 });
      return bomPayload(2538477, 'PRINT-S', 'ÖN BEDEN / FRONT BODY');
    },
  });
  assert.equal(associationCalls, 0);
  assert.equal(result.entries.get('2133719').isSetStyle, false);
  assert.equal(result.entries.get('2133719').summary, 'Ön: 1 | Pigment | Toplam: 1');
  assert.equal(result.recordOverrides.size, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
