'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const QUOTATIONS = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('pricing draft keeps a bounded temporary retry reference and exposes reopen endpoint', () => {
  assert.match(SERVER, /const EMAIL_DRAFT_REOPEN_TTL_MS = 30 \* 60 \* 1000;/);
  assert.match(SERVER, /const EMAIL_DRAFT_REOPEN_MAX = 80;/);
  assert.match(SERVER, /function registerTransientDraft\(fullPath,filename\)/);
  assert.match(SERVER, /draftId=crypto\.randomBytes\(16\)\.toString\('hex'\)/);
  assert.match(SERVER, /app\.post\('\/api\/email-drafts\/pricing\/reopen'/);
  assert.match(SERVER, /touchTransientDraft\(draftId\)/);
  assert.match(SERVER, /if\(!opened\)payload\.emlBase64=fs\.readFileSync\(item\.fullPath\)\.toString\('base64'\)/);
  assert.match(SERVER, /return res\.json\(\{ok:true,filename,opened:true,transient:true,attachmentBytes,\.\.\.draftRef\}\)/);
});

test('Send to Pricing result offers one-click Re-open Draft E-Mail per generated draft', () => {
  assert.match(APP, /data-reopen-pricing-draft/);
  assert.match(APP, /Re-open Draft E-Mail/);
  assert.match(APP, /Taslak E-Postayı Yeniden Aç/);
  assert.match(APP, /prepareEmailReopenSingleDraft/);
  assert.match(APP, /fetch\('\/api\/email-drafts\/pricing\/reopen'/);
});

test('quotation request captures retry refs only after its record id is known', () => {
  assert.match(APP, /await window\.BL_QUOTATIONS\.recordRequest/);
  assert.match(APP, /prepareEmailRememberPricingDraft\(quotationRequestId,draftRef\)/);
  assert.match(APP, /pricingDraftCount:prepareEmailPricingDraftCount/);
  assert.match(APP, /reopenPricingRequest:prepareEmailReopenPricingRequest/);
  assert.match(APP, /window\.sessionStorage/);
});

test('Quotations exposes the retry action to the request owner and binds it to the mail bridge', () => {
  assert.match(QUOTATIONS, /data-q-reopen-draft/);
  assert.match(QUOTATIONS, /req\.ownerId===qCurrentUserId\(\)/);
  assert.match(QUOTATIONS, /window\.BLPrepareEmail\?\.pricingDraftCount/);
  assert.match(QUOTATIONS, /window\.BLPrepareEmail\?\.reopenPricingRequest/);
  assert.match(QUOTATIONS, /Re-open Draft E-Mail/);
});
