'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const start=app.indexOf('function renderKolMfrModal(');
const modal=app.slice(start,app.indexOf('function prepareEmailOpenQuotationReminder(',start));
const handlerStart=modal.indexOf("modal.querySelector('#kolMfrDeskOnly')");
const handler=modal.slice(handlerStart,modal.indexOf("modal.querySelector('#kolMfrConfirm')",handlerStart));

test('Send to Pricing offers a TR/EN desk-only button that is limited to the pricing V2 dialog',()=>{
  assert.match(modal,/\$\{pricingTaskV2\?`<button type="button" class="tbtn" id="kolMfrDeskOnly"/);
  assert.match(modal,/Send to Pricing Desk Only/);
  assert.match(modal,/Yalnız Fiyat Masası’na Gönder/);
});

test('desk-only action records the quotation request without creating e-mail drafts',()=>{
  assert.ok(handlerStart>0,'desk-only handler must exist');
  assert.match(handler,/BL_QUOTATIONS\.recordRequest\(SRC\.persist\?'collection':'cp',deskRows,checked\)/);
  assert.doesNotMatch(handler,/kolCreatePricingEmailDraft|kolCreatePreparedEmailDraft|pricingPrepareAttachmentPlans|prepareEmailBuildTopicTableWorkbook/);
  assert.match(handler,/if\(!checked\.length\)/,'a manufacturer is still required for model × manufacturer lines');
  assert.match(handler,/if\(!request\)\{[^}]*deskBtn\.disabled=false; return; \}/,'failed save keeps the dialog open');
  assert.ok(handler.indexOf('if(!request)')<handler.indexOf('close();'),'dialog closes only after the request is saved');
  assert.match(handler,/r\.pricing\[m\.name\]='Fiyatlamada'/,'Collection status matches the e-mail flow');
});
