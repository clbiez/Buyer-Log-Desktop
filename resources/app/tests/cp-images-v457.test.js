'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse = require('../server/lib/parse');
const db = require('../server/db');

const ROOT = path.join(__dirname, '..');
const html = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const css = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const server = require('./helpers/server-source')();
const dbSource = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');

function order(overrides = {}) {
  return {
    ocode: 1234567, plm: 9001, model: 'TSHIRT A', ccode: 'C01', kalan: 100, qty: 100,
    countryRaw: 'TÜRKİYE', manufacturer: 'Factory', season: 'S7', colour: 'BLACK',
    category: 'T-SHIRT', fob: 1.2,
    ...overrides,
  };
}

test('v4.63 CP image references are keyed by normalized PLM ID + Colour Code', () => {
  assert.equal(parse.plmColourImageKey(9001, 'C01'), 'plm:9001|colour:C01');
  assert.equal(parse.plmColourImageKey('009001.0', ' c01 '), 'plm:9001|colour:C01');
  assert.equal(parse.plmColourImageKey(9001, ''), '');

  const blackKey = parse.plmColourImageKey(9001, 'C01');
  const whiteKey = parse.plmColourImageKey(9001, 'C09');
  const rows = parse.buildCPRowsFromASAS([
    order(),
    order({ ocode: 7654321, model: 'TSHIRT B', ccode: 'C09', colour: 'WHITE' }),
    order({ ocode: 7654322, model: 'TSHIRT C', ccode: 'C01', colour: 'BLACK' }),
  ], {}, {
    ...db.defaultOverrides(),
    imagemap: { [blackKey]: 'cp-image-black.png', [whiteKey]: 'cp-image-white.png' },
    transitRules: [],
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0]._imageKey, blackKey);
  assert.equal(rows[1]._imageKey, whiteKey);
  assert.equal(rows[2]._imageKey, blackKey);
  assert.equal(rows[0]._imageRef, 'cp-image-black.png');
  assert.equal(rows[1]._imageRef, 'cp-image-white.png');
  assert.equal(rows[2]._imageRef, 'cp-image-black.png');
});

test('v4.63 keeps PLM-only and legacy row images visible during migration', () => {
  const first = order();
  const secondColour = order({ ocode: 7654321, model: 'TSHIRT B', ccode: 'C09', colour: 'WHITE' });
  const legacyPlmKey = parse.plmImageKey(first.plm);
  const exactBlackKey = parse.plmColourImageKey(first.plm, first.ccode);

  const plmFallbackRows = parse.buildCPRowsFromASAS([first, secondColour], {}, {
    ...db.defaultOverrides(),
    imagemap: { [legacyPlmKey]: 'legacy-plm-image.png' },
    transitRules: [],
  });
  assert.equal(plmFallbackRows[0]._imageRef, 'legacy-plm-image.png');
  assert.equal(plmFallbackRows[1]._imageRef, 'legacy-plm-image.png');

  const tombstoneRows = parse.buildCPRowsFromASAS([first, secondColour], {}, {
    ...db.defaultOverrides(),
    imagemap: { [legacyPlmKey]: 'legacy-plm-image.png', [exactBlackKey]: '' },
    transitRules: [],
  });
  assert.equal(tombstoneRows[0]._imageRef, '');
  assert.equal(tombstoneRows[1]._imageRef, 'legacy-plm-image.png');

  const legacyRowKey = parse.orderLineKey(first.ocode, first.model, first.ccode);
  const legacyRowRows = parse.buildCPRowsFromASAS([first], {}, {
    ...db.defaultOverrides(),
    imagemap: { [legacyRowKey]: 'legacy-row-image.png' },
    transitRules: [],
  });
  assert.equal(legacyRowRows[0]._imageRef, 'legacy-row-image.png');
});

test('v4.63 CP image writes require PLM ID + Colour Code and persist under the combined key', () => {
  const defaults = db.defaultOverrides();
  assert.deepEqual(defaults.imagemap, {});
  assert.match(dbSource, /const imageKey = plmColourImageKey\(imagePlmId, imageColourCode\)/);
  assert.match(dbSource, /CP görseli için PLM ID ve Colour Code zorunludur/);
  assert.match(dbSource, /ov\.imagemap\[imageKey\] = ref/);
  assert.doesNotMatch(dbSource, /ov\.imagemap\[oc\] = ref/);
});

test('v6.20 keeps CP image writes restricted and allows authorized drill-down reads', () => {
  assert.match(server, /app\.post\('\/api\/cp-images', userAccess\.requireArea\('cp'\)/);
  assert.match(server, /app\.get\('\/api\/cp-images\/:id', userAccess\.requireAnyArea\('cp','orders','backlog','koleksiyon','lfl','overview','priceanalysis','opencosting','shipping'\)/);
  assert.match(server, /app\.delete\('\/api\/cp-images\/:id', userAccess\.requireArea\('cp'\)/);
  assert.match(server, /bağlantı PLM ID \+ Colour Code anahtarıyla overrides\.imagemap'e yazılır/);
});

test('v4.63 CP table saves and removes images for rows sharing PLM ID + Colour Code only', () => {
  assert.match(html, /\{k:'__picture', label:'Picture', type:'cpImage'/);
  assert.match(html, /function cpImageOverrideKey\(plmId,colourCode\)/);
  assert.match(html, /function cpRowsForImageIdentity\(plmId,colourCode\)/);
  assert.match(html, /imagePlmId:row\['PLM ID'\],imageColourCode:row\['C\.Code'\]/);
  assert.match(html, /linkedRows=cpRowsForImageIdentity\(row\['PLM ID'\],row\['C\.Code'\]\)/);
  assert.match(html, /async function cpSaveRowImage/);
  assert.match(html, /async function cpRemoveRowImage/);
  assert.match(html, /cpActiveImageRowId/);
  assert.match(html, /cpCycleImageSize/);
  /* v11.11: alt detay görselleri de ortak lazy-load/hover katmanına taşındı,
     bu yüzden `kolShowImgPopup(img.src,event)` biçimindeki satır içi bağ artık
     yok. Korunan regression aynı: CP thumbnail'ı üzerine gelince BÜYÜK model
     önizlemesi açılır — yalnız yol kanonik BLImageRuntime katmanıdır. */
  assert.match(html, /img\.addEventListener\('mouseenter',event=>\{try\{BLImageRuntime\.scheduleHover\(img,event\)/);
  assert.match(html, /kolShowImgPopup\(src,point\)/);
  assert.match(css, /#cpTable \.cpThumbFlash/);
  assert.doesNotMatch(html, /cpThumbActive/);
});


test('v4.69 CP picture header uses the shared continuous image-size slider', () => {
  assert.match(html, /const TABLE_IMAGE_SIZE_CONFIG=Object\.freeze\(/);
  assert.match(html, /cp:\{preferenceKey:'lcw\.cp\.imageSize\.v2'/);
  assert.match(html, /orders:\{preferenceKey:'lcw\.orders\.imageSize\.v2'/);
  assert.match(html, /function tableImageSizeBounds\(tableKey\)/);
  assert.match(html, /max:cfg\.max\.w\*3/);
  assert.match(html, /openTableImageSizePopover\(th,tableKey\)/);
  assert.doesNotMatch(html, /cpImageSize=cpImageSize==='medium'\?'large':'medium'/);
  assert.match(html, /colmgr\.cp\.widthPx\['__picture'\]=cpImageDims\(\)\.col/);
  assert.match(html, /colmgr\.orders\.widthPx\['__picture'\]=ordersImageDims\(\)\.col/);
});

test('v5.13 CP copy and Excel export embed actual images without SheetJS→ExcelJS round-trip', () => {
  assert.match(html, /td\.querySelector\('img\.kolThumb'\)/);
  assert.match(html, /async function exportStyledDomTable/);
  assert.match(html, /const wb=new ExcelJS\.Workbook\(\)/);
  // v10.90 — dışa aktarımdaki görsel ekrandaki <img>'in currentSrc'sinden değil
  // kanonik model kimliğinden çözülür (lazy/viewport bağımsız).
  // Paginated exports use detached record rows, so their zero DOM height falls
  // back to the configured image-cell height while retaining canonical sources.
  assert.match(html, /imageEntries\.push\(\{row:excelRow,col:col-1,identity,src:domImage,cellWidth:tdRect\.width\|\|0,cellHeight:trRect\.height\|\|\(managedRecords\?cpOrdersImageDims\(opts\.tableKey\)\.row:0\)\}\)/);
  assert.match(html, /cpOrdersRowImageIdentity\(record\)/);
  assert.match(html, /thumb\.dataset\.hasImage==='1'/);
  assert.match(html, /wb\.addImage\(\{base64:image\.dataUrl/);
  assert.doesNotMatch(html, /async function cpWriteWorkbookWithImages/);
});
