'use strict';

/* PLM SYNC iki aşamalı akış regresyonu — v11.12
 *
 * Scope önce, asset seçimi sonra yapılır. Complete Missing planı link ve
 * görsel kuyruklarını birbirinden bağımsız üretir; seçilmeyen asset hiçbir
 * zaman kuyruğa girmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const scopeApi = require(path.join(ROOT, 'public', 'model-asset-scope.js'));

test('Collection, CP ve Orders aynı scope sırasını ve ortak asset seçiciyi kullanır', () => {
  const scopeStart = APP.indexOf('function plmSyncScopeActions');
  const scopeEnd = APP.indexOf('function plmSyncActionModal', scopeStart);
  const scopeBlock = APP.slice(scopeStart, scopeEnd);
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart, 'ortak scope karar fonksiyonu bulunamadı');
  assert.ok(scopeBlock.indexOf("id:'all'") < scopeBlock.indexOf("id:'selected'"));
  assert.ok(scopeBlock.indexOf("id:'selected'") < scopeBlock.indexOf("id:'missing'"));
  assert.match(scopeBlock, /disabled:!scope\?\.selectedIdentities\?\.length/);
  assert.match(scopeBlock, /All models in the current list/);
  assert.match(scopeBlock, /Limit the update to selected models/);
  assert.match(scopeBlock, /Only update missing PLM assets/);

  const chooserStart = APP.indexOf('function showPlmSyncPropertyChooser');
  const chooserEnd = APP.indexOf('function collectionPlmRowsForScope', chooserStart);
  const chooser = APP.slice(chooserStart, chooserEnd);
  assert.match(chooser, /page==='kol'/);
  assert.match(chooser, /key:'links'[\s\S]*?Model Links/);
  assert.match(chooser, /key:'images'[\s\S]*?Model Images/);
  assert.match(chooser, /key:'details'[\s\S]*?Model Details/);
  assert.match(chooser, /key:'files'[\s\S]*?Model Files/);
  assert.match(chooser, /Start/);
  assert.match(chooser, /plmSyncPropertyCard/);
  assert.match(chooser, /continueBtn\.disabled=!checks\.some\(input=>input\.checked\)/);
  assert.match(chooser, /PLM model links/);
  assert.match(chooser, /Model görsellerini güncelle/);

  const actionModalStart = APP.indexOf('function plmSyncActionModal');
  const actionModalEnd = APP.indexOf('function showPlmSyncPropertyChooser', actionModalStart);
  const actionModal = APP.slice(actionModalStart, actionModalEnd);
  assert.match(actionModal, /confirmSelection=false/);
  assert.match(actionModal, /plmSyncOptionCard/);
  assert.match(actionModal, /aria-pressed/);
  assert.match(actionModal, /plmSyncContinueBtn/);
  assert.match(actionModal, /continueBtn\.disabled=!selectedId/);

  const openStart = APP.indexOf('async function openPlmSyncCategoryPanel');
  const openEnd = APP.indexOf("document.addEventListener('click'", openStart);
  const open = APP.slice(openStart, openEnd);
  assert.match(open, /plmSyncScopeActions\(scope,\{collection\}\)/);
  assert.match(open, /confirmSelection:true/);
  assert.match(open, /Güncellenecek model kapsamını seçin/);
  assert.match(open, /runPlmUpdateFlow\(page,action,root,scope\)/);
  assert.doesNotMatch(open, /Update All Images|Update Selected Models’ Images|updates PLM model images only/);
  assert.doesNotMatch(open, /ensureCoreNectumApiConnection/, 'scope ve asset seçilmeden ağ doğrulaması başlamamalı');
});

test('Complete Missing link ve görsel kuyruklarını dört kanonik durum için bağımsız planlar', () => {
  const identities = [
    { plmId: 'A', styleName: 'A', linkPresent: true, imagePresent: true },
    { plmId: 'B', styleName: 'B', linkPresent: true, imagePresent: false },
    { plmId: 'C', styleName: 'C', linkPresent: false, imagePresent: true },
    { plmId: 'D', styleName: 'D', linkPresent: false, imagePresent: false },
  ];
  const scope = { identities, selectedIdentities: [] };
  const linksPresent = new Set(['A', 'B']);
  const imagesPresent = new Set(['A', 'C']);
  const plan = scopeApi.planAssetQueues(scope, {
    mode: 'missing',
    assets: ['links', 'images'],
    missing: {
      links: item => !linksPresent.has(item.plmId),
      images: item => !imagesPresent.has(item.plmId),
    },
  });

  assert.deepEqual(plan.queues.links.map(item => item.plmId), ['C', 'D']);
  assert.deepEqual(plan.queues.images.map(item => item.plmId), ['B', 'D']);
  assert.equal(plan.queues.links.some(item => item.plmId === 'A'), false, 'tam model link kuyruğuna girmemeli');
  assert.equal(plan.queues.images.some(item => item.plmId === 'A'), false, 'tam model görsel kuyruğuna girmemeli');

  const linkOnly = scopeApi.planAssetQueues(scope, {
    mode: 'missing', assets: ['links'], missing: { links: item => !linksPresent.has(item.plmId) },
  });
  assert.deepEqual(Object.keys(linkOnly.queues), ['links']);
  assert.equal(linkOnly.queues.images, undefined, 'seçilmeyen görsel asset’i kuyruk üretmemeli');
});

test('PLM Sync modalı Buyer Log design tokenlarını kullanır ve hard-coded tema yüzeyi üretmez', () => {
  const start = CSS.indexOf('/* PLM SYNC iki aşamalı seçim yüzeyi.');
  const end = CSS.indexOf('.modelImageLimitCard', start);
  const block = CSS.slice(start, end);
  assert.ok(start >= 0 && end > start, 'PLM Sync modal CSS bloğu bulunamadı');
  assert.match(block, /--bl-surface-raised/);
  assert.match(block, /--bl-surface-panel/);
  assert.match(block, /--bl-surface-soft/);
  assert.match(block, /--bl-stroke-subtle/);
  assert.match(block, /--bl-stroke-strong/);
  assert.match(block, /var\(--ink\)/);
  assert.match(block, /var\(--muted\)/);
  assert.match(block, /var\(--acc-bg\)/);
  assert.match(block, /:focus-visible/);
  assert.match(block, /:disabled/);
  assert.doesNotMatch(block, /background:\s*#[0-9a-f]{3,8}/i);
});

test('Selected boşken plan sessizce All kapsamına genişlemez', () => {
  const plan = scopeApi.planAssetQueues({
    identities: [{ plmId: 'A' }],
    selectedIdentities: [],
  }, {
    mode: 'selected', assets: ['links', 'images'], missing: {},
  });
  assert.deepEqual(plan.identities, []);
  assert.deepEqual(plan.queues.links, []);
  assert.deepEqual(plan.queues.images, []);
});

test('runtime planı kanonik link ve görsel missing kontrollerini kullanır', () => {
  const start = APP.indexOf('function plmSyncAssetPlan');
  const end = APP.indexOf('function plmSyncQueuedScope', start);
  const block = APP.slice(start, end);
  assert.match(block, /links:modelAssetLinkMissing/);
  assert.match(block, /images:modelAssetIdentityMissing/);

  const linksStart = APP.indexOf('async function updateModelLinks(mode,button');
  const linksEnd = APP.indexOf('/* --- 2) MODEL GÖRSELLERİ', linksStart);
  assert.match(APP.slice(linksStart, linksEnd), /operation\.identities\.filter\(modelAssetLinkMissing\)/);
  assert.match(APP, /operation\.identities\.filter\(modelAssetIdentityMissing\)/);
});
