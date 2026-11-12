'use strict';
/* Koleksiyon › PLM ID Listesinden Ekle / PLM'de Seçili Modelleri Aktar:
   içe aktarılan modellerin görselleri ve teknik föyleri.

   Kök nedenler:
   1) Görsel adımı mevcut tablo kapsamını (filtre ∩ seçim) okuyordu. Etkin bir
      filtre/arama yeni satırları gizlediğinde görseller hiç istenmiyordu.
   2) Teknik föy ucu ham satırları 500'de kesip SONRA PLM ID'ye göre
      tekilleştiriyordu; renk satırları kapasiteyi tüketip modelleri sessizce
      düşürüyordu. İstemci de 500'den büyük listeyi bölmüyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const registerPlmSyncRoutes = require('../server/routes/plm-sync-routes');
const { normalizePlmId } = require('../server/lib/plm-id.js');

function technicalSheets(links) {
  const app = { post() {}, get() {} };
  const deps = {
    express: { json: () => () => {} },
    userAccess: { requireAnyArea: () => () => {}, requireArea: () => () => {} },
    normalizePlmId,
    loadPlmStyleLinks: () => ({ links }),
    technicalSheetOwnership: { canonicalTechnicalSheetKey: plmId => `plm:${plmId}` },
  };
  return registerPlmSyncRoutes(app, deps).technicalSheets;
}

function fnBody(name) {
  const start = APP.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  const next = APP.indexOf('\nasync function ', start + 10);
  const nextSync = APP.indexOf('\nfunction ', start + 10);
  const end = Math.min(...[next, nextSync].filter(index => index > 0));
  return APP.slice(start, end);
}

test('teknik föy hazırlığı renk satırlarını tekilleştirdikten SONRA sınırlar', () => {
  const links = {};
  const raw = [];
  for (let model = 0; model < 200; model += 1) {
    const plmId = String(3000000 + model);
    links[plmId] = { styleId: String(9000000 + model) };
    for (let colour = 0; colour < 4; colour += 1) raw.push({ plmId, modelLabel: `M${model}`, filename: `M${model}.pdf` });
  }
  const items = technicalSheets(links).prepare(raw);
  assert.equal(items.length, 200, '800 renk satırı 200 modelin hepsini taşımalı');
  assert.equal(items[199].styleId, '9000199');
});

test('teknik föy hazırlığı tek istekte en fazla 500 model kabul eder', () => {
  const raw = Array.from({ length: 650 }, (_, index) => ({ plmId: String(4000000 + index) }));
  assert.equal(technicalSheets({}).prepare(raw).length, 500);
});

test('istemci teknik föy isteğini PLM ID başına tekil ve 500’lük partilerle gönderir', () => {
  const body = fnBody('kolPlmSyncModelFilesRun');
  assert.match(body, /KOL_PLM_TECHNICAL_SHEET_BATCH/);
  assert.match(body, /seen\.has\(plmId\)/);
  assert.match(APP, /const KOL_PLM_TECHNICAL_SHEET_BATCH=500;/);
  assert.match(body, /for\(let index=0;index<items\.length;index\+=KOL_PLM_TECHNICAL_SHEET_BATCH\)/);
});

test('içe aktarma görselleri tablo filtresinden değil yazılan satırlardan kapsam alır', () => {
  assert.match(APP, /function kolImportedRowsImageScope\(rows\)\{/);
  for (const name of ['kolPlmListImportRun', 'importSelectedKolPlmModels']) {
    const body = fnBody(name);
    assert.match(body, /updateModelImages\(\{source:MODEL_ASSET_SOURCE_PLM,mode:'selected',button:null,scope:kolImportedRowsImageScope\(fileRows\)\}\)/, name);
  }
});
