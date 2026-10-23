'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const html=read('public/index.html'), app=read('public/app-main.js'), q=read('public/quotations.js'), perf=read('public/perf-runtime.js'), access=read('public/user-access-ui.js'), css=read('public/pricing-workspace.css');

test('Pricing Desk is one navigation page; the legacy Pricing History route opens its History tab',()=>{
  // v2026-10-22: Quotations ve Fiyat Geçmişi "Fiyat Masası" menüsünde birleşti.
  assert.match(html,/data-tab="quotations"[^>]*data-i18n-title-en="Pricing Desk"/);assert.doesNotMatch(html,/data-tab="pricinghistory"/);
  assert.match(app,/tab==='pricinghistory'\)return window\.BLPricingDesk\?\.mount\?\.\(document\.getElementById\('pricingHistoryWorkspacePage'\),\{tab:'history'\}\)/);
  assert.match(html,/id="quotationWorkspacePage"/);assert.match(html,/id="pricingHistoryWorkspacePage"/);
  assert.match(app,/tab==='quotations'.*mountWorkspace/s);assert.match(app,/tab==='pricinghistory'.*mountPricingHistory/s);
});

test('new pricing pages inherit Collection authorization instead of inventing a parallel permission schema',()=>{
  assert.match(app,/\(tab==='quotations'\|\|tab==='pricinghistory'\)\?'koleksiyon':tab/);
  assert.match(access,/quotations.*koleksiyon/s);assert.match(access,/pricinghistory.*koleksiyon/s);
});

test('collectionTools loads deterministic pricing engine before quotation workspace code',()=>{
  assert.match(perf,/collectionTools:\['pricing-workspace-engine\.js[^']*','quotations\.js/);
});

test('Send to Pricing is task-specific but reuses the reliable Prepare E-Mail implementation',()=>{
  assert.match(q,/function openSendToPricing\(ctx=\{\}\)/);
  assert.match(q,/renderKolMfrModal\(\{[^}]*pricingTaskV2:true/s);
  assert.match(app,/const pricingTaskV2=!!SRC\.pricingTaskV2/);
  assert.match(app,/topic\.kind==='pricing'/);
  assert.match(app,/Fiyat Talebi Oluştur/);
});

test('Quotations workspace preserves core business actions without KPI strip or decision panel',()=>{
  assert.match(q,/function mountWorkspace\(/);assert.doesNotMatch(q,/pricingWorkspaceDecision|quotationWorkspaceKpis|qRenderWorkspaceDecision/);
  assert.match(q,/class="quotationWorkspaceTopBar"/);assert.match(q,/function qMarkWorkspaceSelectedLine\(/);
  assert.match(css,/\.quotationWorkspaceShell \.quotationTableWrap\{flex:1 1 auto;min-height:0;[^}]*overflow:auto/);
  assert.match(css,/\.quotationWorkspaceShell \.quotationApproveBtn\{[^}]*border-radius:0/);
  assert.match(q,/qToggleApproval\(req,line\)/);assert.match(q,/qToggleDrop\(req,line\)/);
  assert.match(q,/data-manage-quotation-access/);assert.match(q,/data-export-quotation/);assert.match(q,/data-quotation-capacity/);assert.match(q,/data-quotation-note/);
  assert.match(q,/openPricingHistoryWorkspace/);assert.match(q,/qOpenRequestInCollection/);
});

test('Pricing History V2 derives summaries and chart from canonical quotation history instead of a new store',()=>{
  assert.match(q,/function mountPricingHistory\(/);assert.match(q,/qhCollect\(qHistoryRowsFromContext/);
  assert.match(q,/historySummary/);assert.match(q,/pricingHistoryChartSvg/);assert.match(q,/Source Quotation|Kaynak Quotation/);
  assert.doesNotMatch(q,/localStorage[^\n]*pricingHistoryRecords/i);
});

test('Collection is spreadsheet-first: legacy pricing KPI/action bar is cleanup-only and no right summary is rendered',()=>{
  assert.match(q,/function syncCollectionPricingUI\(/);
  assert.match(q,/spreadsheet-first/);
  assert.match(q,/kolPricingActionBar'\)\?\.remove/);
  assert.match(q,/kolPricingSelectionSummary'\)\?\.remove/);
  assert.doesNotMatch(q,/actions\.appendChild\(btn\)/);
  assert.doesNotMatch(css,/\.kolPricingActionBar|\.kolPricingSelectionSummary|\.kolPricingLayout|\.kolPricingSummaryInline/);
});

test('Pricing Workspace CSS remains namespaced and follows compact Buyer Log data-first layout',()=>{
  assert.match(css,/\.pricingWorkspaceShell/);assert.match(css,/\.quotationWorkspaceShell/);assert.match(css,/\.pricingHistoryGrid/);assert.match(css,/\.sendPricingV2/);
  assert.doesNotMatch(css,/(^|\n)\s*(table|button|input|select)\s*\{/);
});


test('Send Reminder targets only active unpriced manufacturer lines and reuses Prepare E-Mail without creating a quotation',()=>{
  assert.match(q,/function qReminderItems\(req\)[\s\S]*req\.status==='closed'[\s\S]*!qItemDropped\(req,item\)[\s\S]*!qValidPrice\(item\.price\)/);
  assert.match(q,/function qOpenReminder\(req\)[\s\S]*qCanEditRequest\(req\)[\s\S]*BLPrepareEmail\?\.openQuotationReminder/);
  assert.match(q,/data-q-send-reminder/);
  assert.match(q,/Send Reminder|Hatırlatma Gönder/);
  assert.match(app,/MAIL_QUOTATION_REMINDER_ID\s*=\s*'general-quotation-reminder'/);
  assert.match(app,/function prepareEmailOpenQuotationReminder\(/);
  const start=app.indexOf('function prepareEmailOpenQuotationReminder('),end=app.indexOf("document.getElementById('kolSendPricingBtn')",start),bridge=app.slice(start,end);
  assert.match(bridge,/defaultTopicKind:'general'/);
  assert.match(bridge,/defaultTopicId:MAIL_QUOTATION_REMINDER_ID/);
  assert.doesNotMatch(bridge,/recordRequest\(/);
});
