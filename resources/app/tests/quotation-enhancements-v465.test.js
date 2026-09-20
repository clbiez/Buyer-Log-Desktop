'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const JS=fs.readFileSync(path.join(ROOT,'public','quotations.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const store=require('../server/lib/quotations-store');

test('v4.65 quotation note and capacity confirmation persist at request level',()=>{
  const normalized=store.normalizeRequest({
    id:'quotation-test',ownerId:'user-1',note:'  Long term capacity checked  ',capacityConfirmed:true,
    manufacturers:[{name:'Factory A'}],items:[{id:'line-1',modelKey:'kol:1',manufacturer:'Factory A'}],
  });
  assert.equal(normalized.note,'Long term capacity checked');
  assert.equal(normalized.capacityConfirmed,true);
  assert.match(JS,/note:qNorm\(req\?\.note\)\.slice\(0,10000\)/);
  assert.match(JS,/capacityConfirmed:!!req\?\.capacityConfirmed/);
  assert.match(JS,/function qOpenQuotationNote\(req\)/);
  assert.match(JS,/data-quotation-capacity/);
  assert.match(CSS,/\.quotationMetaStrip\{/);
});

test('v4.66 quotation table returns to its original fixed column order',()=>{
  assert.match(JS,/const COLUMN_WIDTHS_KEY = 'lcw\.quotations\.columnWidths\.v1'/);
  assert.match(JS,/const qColumnDefaults = Object\.freeze\(\{model:260,category:140,manufacturer:180,target:125,best:190,price:170,approved:90,dropped:105\}\)/);
  assert.doesNotMatch(JS,/COLUMN_ORDER_KEY/);
  assert.doesNotMatch(JS,/function qMoveColumn\(/);
  assert.doesNotMatch(JS,/function qBindColumnReorder\(/);
  assert.doesNotMatch(JS,/data-qmove=/);
  assert.doesNotMatch(JS,/key:'confirmedManufacturer'/);
  assert.doesNotMatch(JS,/key:'confirmedFob'/);
  assert.doesNotMatch(CSS,/\.quotationColDropBefore\{/);
  assert.doesNotMatch(CSS,/\.quotationConfirmedValue\{/);
});

test('v4.65 pricing history defaults to Price Order and shows capacity tick',()=>{
  assert.match(JS,/class="qhViewBtn isActive" data-qhview="ranked"/);
  assert.match(JS,/let sortKey='model', sortDir=1, viewMode='ranked'/);
  assert.match(JS,/capacityConfirmed:!!req\.capacityConfirmed/);
  assert.match(JS,/function qhCapacityMarkup\(cell\)/);
  assert.match(JS,/qhCapacityMarkup\(c\)/);
  assert.match(CSS,/\.qhCapacityTick\{/);
});

test('v4.65 pricing history images use contain and hover preview',()=>{
  assert.match(JS,/class="qhModelImage"/);
  assert.match(JS,/function qhBindImagePreviews\(modal\)/);
  assert.match(JS,/kolShowImgPopup\(img\.currentSrc\|\|img\.src,event\)/);
  assert.match(JS,/qhBindImagePreviews\(modal\)/);
  assert.match(CSS,/\.qhPictureCell img\.qhModelImage\{[^}]*object-fit:contain!important/);
});
