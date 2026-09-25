const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const APP=fs.readFileSync('public/app-main.js','utf8');
const EG=fs.readFileSync('public/email-groups.js','utf8');
const CSS=fs.readFileSync('public/pricing-workspace.css','utf8')+fs.readFileSync('public/app.css','utf8');

test('Settings E-Mail Groups is the single persisted recipient source',()=>{
  assert.match(APP,/function kolManufacturersForPersistence\(\).*email:''/s);
  assert.match(APP,/BLEmailDirectory\?\.emailFor\(name\)/);
  assert.doesNotMatch(APP.slice(APP.indexOf('function prepareEmailLookupEmail'),APP.indexOf('/* --- Konu bazlı')),/PREPARE_EMAIL_MAIL_KEY/);
});

test('E-Mail Groups uses a wide multi-recipient editor with validation and dedup helpers',()=>{
  assert.match(EG,/function parseRecipients\(value\)/);
  assert.match(EG,/function formatRecipients\(list\)/);
  assert.match(EG,/data-eg-recipient-input/);
  assert.match(EG,/Geçersiz e-posta/);
  assert.match(CSS,/\.egRecipientEditor/);
  assert.match(CSS,/\.egRecipientChip/);
});

test('E-Mail Groups is master-detail instead of the old dense card grid',()=>{
  assert.match(EG,/egDirectoryRow/);
  assert.match(EG,/egDetailPane/);
  assert.match(EG,/egRecipientsPanel/);
  assert.match(CSS,/grid-template-columns:minmax\(310px,360px\) minmax\(0,1fr\)/);
});

test('Send to Pricing V3 is a two-panel workflow and does not expose inline e-mail editing',()=>{
  assert.match(APP,/sendPricingTwoPanel/);
  assert.match(APP,/sendPricingRequestPanel/);
  assert.match(APP,/data-manage-email-groups/);
  assert.doesNotMatch(APP.slice(APP.indexOf('const detailHtml = () =>'),APP.indexOf('modal.innerHTML = `',APP.indexOf('const detailHtml = () =>'))),/kolMfrEmail/);
  assert.match(CSS,/\.sendPricingV2 \.sendPricingTwoPanel/);
});

test('Send to Pricing blocks creation when a selected manufacturer has no canonical recipient',()=>{
  assert.match(APP,/const missing=checked\.filter\(m=>!String\(m\.email\|\|''\)\.trim\(\)\)/);
  assert.match(APP,/Settings > E-Mail Groups/);
});


test('Send to Pricing mirrors manufacturers from the canonical E-Mail Groups directory',()=>{
  assert.match(APP,/function prepareEmailMergeDirectoryManufacturers\(\)/);
  const syncBlock=APP.slice(APP.indexOf('function prepareEmailMergeDirectoryManufacturers'),APP.indexOf('function prepareEmailFillFromShared'));
  assert.match(syncBlock,/BLEmailDirectory\.records\(\)/);
  assert.match(syncBlock,/kolManufacturers\.push\(\{name,email:''\}\)/);
  const renderStart=APP.slice(APP.indexOf('function renderKolMfrModal'),APP.indexOf('function renderKolMfrModal')+260);
  assert.match(renderStart,/prepareEmailMergeDirectoryManufacturers\(\);\s*prepareEmailFillFromShared\(\);/);
});

test('Send to Pricing re-mirrors canonical manufacturers after the forced directory refresh',()=>{
  const asyncBlock=APP.slice(APP.indexOf('function prepareEmailFillFromSharedAsync'),APP.indexOf('function renderKolMfrModal'));
  assert.match(asyncBlock,/ensureDirectory\(true\)\.then\(\(\)=>\{\s*prepareEmailMergeDirectoryManufacturers\(\);\s*prepareEmailFillFromShared\(\);/);
});
