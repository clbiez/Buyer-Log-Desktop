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
  assert.match(SERVER, /function registerTransientDraft\(fullPath,filename,ownerId\)/);
  assert.match(SERVER, /ownerId:owner/);
  assert.match(SERVER, /registerTransientDraft\(fullPath,filename,req\.currentUser&&req\.currentUser\.id\)/);
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

test('the actual pricing result modal binds its own reopen button to the matching draft', () => {
  const vm=require('node:vm'),start=APP.indexOf('function kolShowPricingDraftResults('),end=APP.indexOf('\n}',start)+2,calls=[],listeners={};
  const keyboardBindings=[];
  const modal={dataset:{},addEventListener:(name,handler)=>{(listeners[name]||=[]).push(handler);},querySelectorAll:()=>[],querySelector:()=>null},ctx={window:{BLUI:{bindDialogKeyboard:(node,options)=>{keyboardBindings.push({node,options});return()=>{};}}},appLang:'en',document:{getElementById:()=>null,createElement:()=>modal,body:{appendChild:()=>{}}},escapeHtml:String,prepareEmailReopenSingleDraft:(...args)=>calls.push(args)};
  vm.createContext(ctx);vm.runInContext(APP.slice(start,end),ctx);ctx.kolShowPricingDraftResults([{ok:true,manufacturer:'Demo',draftId:'a'.repeat(32),quotationRequestId:'q1'}]);
  assert.equal(keyboardBindings.length,1);assert.equal(keyboardBindings[0].node,modal);assert.equal(typeof keyboardBindings[0].options.onEscape,'function');
  const button={dataset:{reopenPricingDraft:'0'}},event={target:{closest:selector=>selector==='[data-reopen-pricing-draft]'?button:null},preventDefault:()=>{}};listeners.click.forEach(handler=>handler(event));
  assert.equal(calls.length,1);assert.equal(calls[0][0].draftId,'a'.repeat(32));assert.equal(calls[0][1],'q1');assert.equal(calls[0][2],button);
});

test('quotation request captures retry refs only after its record id is known', () => {
  assert.match(APP, /await window\.BL_QUOTATIONS\.recordRequest/);
  assert.match(APP, /prepareEmailRememberPricingDraft\(quotationRequestId,draftRef\)/);
  assert.match(APP, /pricingDraftCount:prepareEmailPricingDraftCount/);
  assert.match(APP, /reopenPricingRequest:prepareEmailReopenPricingRequest/);
  assert.match(APP, /const prepareEmailPricingDraftRegistry=new Map\(\)/);
  assert.doesNotMatch(APP, /buyerlog\.pricingDraftReopen/);
});

test('Quotations exposes the retry action to the request owner and binds it to the mail bridge', () => {
  assert.match(QUOTATIONS, /data-q-reopen-draft/);
  assert.match(QUOTATIONS, /req\.ownerId===qCurrentUserId\(\)/);
  assert.match(QUOTATIONS, /window\.BLPrepareEmail\?\.pricingDraftCount/);
  assert.match(QUOTATIONS, /window\.BLPrepareEmail\?\.reopenPricingRequest/);
  assert.match(QUOTATIONS, /Re-open Draft E-Mail/);
});
