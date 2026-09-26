'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const quotations = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
const server = require('./helpers/server-source')();

function block(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `missing end ${end}`);
  return source.slice(from, to);
}

test('Tech Pack resolution queries one canonical PLM key in addition to row-scoped user attachments', () => {
  const list = block(app, 'async function kolListStoredModelFiles(rows){', 'async function kolStoredMetaToFile');
  assert.match(app, /function kolCanonicalTechnicalSheetKey\(row\)/);
  assert.match(list, /kolCanonicalTechnicalSheetKey\(row\)/);
  assert.match(app, /function kolStoredModelFileMatchesRow\(file,row\)/);
});

test('PLM Tech Pack download sends canonical ownership rather than a Collection row key', () => {
  const run = block(app, 'async function kolPlmSyncModelFilesRun(button, suppliedRows=null, options={}){', "/* Eski tek \"Model Dosyalarını PLM'den Çek\" düğmesi kaldırıldı;");
  assert.match(run, /kolCanonicalTechnicalSheetKey\(row\)/);
  assert.doesNotMatch(run, /modelKey:kolModelFileKey\(row\)/);
  const route = block(server, "app.post('/api/plm-sync/model-files'", "app.post('/api/plm-sync/model-files/status'");
  assert.match(route, /technicalSheetOwnership\.canonicalTechnicalSheetKey\(plmId\)/);
});

test('Send to Pricing preflight independently checks numeric Target Price and PLM Tech Pack status', () => {
  const build = block(app, 'async function kolPricingBuildPreflight(rows){', 'function kolPricingPreflightRowsHtml');
  assert.match(app, /function kolPricingTargetPriceMissing\(row\)[\s\S]*kolEffectiveValue\(row,'targetPrice'\)/);
  assert.match(build, /\/api\/plm-sync\/model-files\/status/);
  assert.match(build, /targetPriceMissing/);
  assert.match(build, /techPackMissing/);
  const modal = block(app, 'function kolOpenPricingPreflightDialog(initial,recheck){', 'async function kolPricingPreflight(rows){');
  assert.match(modal, /Tech Pack’leri Tamamla/);
  assert.match(modal, /Target Price olmadan devam et/);
});

test('quotation entry point waits for Collection preflight before rendering manufacturer workflow', () => {
  const open = block(quotations, 'async function openSendToPricing(ctx={}){', '\n\n  setTimeout(qDetachLegacyCollectionDrops,0);');
  assert.match(open, /await window\.BLCollection\.pricingPreflight\(selected\)/);
  assert.match(open, /if\(!preflight\?\.proceed\)return false/);
});

test('stored Tech Pack attachments are deduplicated by canonical PLM identity, never filename alone', () => {
  const load = block(app, 'async function loadStoredPricingFiles(){', 'function syncStoredFilesForTopic');
  assert.match(app, /function pricingAttachmentIdentity\(entry\)/);
  assert.match(load, /pricingAttachmentIdentity/);
  assert.doesNotMatch(load, /filename&&x\.file\?\.size/);
  const identity = block(app, 'function pricingAttachmentIdentity(entry){', 'function pricingMatchFileToRow');
  assert.match(identity, /`tech-pack:\$\{plmId\}`/);
  assert.doesNotMatch(identity, /plmLanguage/);
});

test('Collection-authorized Pricing can read canonical Tech Pack metadata and bytes', () => {
  assert.match(server, /app\.get\('\/api\/model-files',userAccess\.requireAnyArea\('source',\s*'koleksiyon'\)/);
  assert.match(server, /app\.get\('\/api\/model-files\/:id',userAccess\.requireAnyArea\('source',\s*'koleksiyon'\)/);
});

test('stale Tech Pack metadata remains fetchable and is not presented as available', () => {
  const build = block(app, 'async function kolPricingBuildPreflight(rows){', 'function kolPricingPreflightRowsHtml');
  assert.match(build, /tech\?\.status==='stale'/);
  assert.match(build, /fiziksel Tech Pack/);
});
