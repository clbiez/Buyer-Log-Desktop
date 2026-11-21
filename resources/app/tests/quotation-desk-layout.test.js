'use strict';
// Fiyat Masası · Fiyat Teklifleri: sol grup listesi dar sütunda yatay taşmaz;
// detay başlığındaki ikincil eylemler ortak "Diğer" çekmecesindedir.
// Gerçek tarayıcı kabulü: scripts/quotation-desk-layout-screenshot.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const q = read('public/quotations.js'), css = read('public/pricing-workspace.css'), ui = read('public/ui-components.css');

test('workspace group cards cannot overflow the narrow nav column', () => {
  // Masa listesi tek kaynağa süzülür; kaynak rozeti yalnız eski modalde kalır.
  assert.match(q, /\$\{qWorkspaceMounted\?'':`<span class="quotationSourceBadge">/);
  assert.match(q, /verHistNavDate" title="\$\{qEsc\(qDate\(req\.createdAt\)\)\}">\$\{qEsc\(qDate\(req\.createdAt,!qWorkspaceMounted\)\)\}/);
  assert.match(css, /\.quotationWorkspaceShell \.pricingWorkspaceNav\{overflow-x:hidden;overflow-y:auto\}/);
  assert.match(css, /\.quotationWorkspaceShell \.quotationNavItem\{min-width:0;max-width:100%;overflow:hidden\}/);
  assert.match(css, /\.verHistNavDate\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
});

test('secondary detail actions live in the shared More menu with unchanged hooks', () => {
  const menu = q.slice(q.indexOf('const moreItems='), q.indexOf('host.innerHTML=`<div class="quotationDetailHead">'));
  for (const hook of ['${reopenDraftAction}', 'data-q-open-collection', 'data-q-open-history', 'data-manage-quotation-access', 'data-export-quotation', 'data-delete-quotation']) assert.ok(menu.includes(hook), hook);
  assert.match(q, /class="toolbarMoreWrap quotationMoreWrap"><button type="button" class="tbtn quotationMoreBtn" data-q-more aria-haspopup="true" aria-expanded="false"/);
  assert.match(q, /class="toolbarMoreMenu quotationMoreMenu" data-q-more-menu hidden>\$\{moreItems\}/);
  assert.match(q, /BLLayerSystem\?\.openMenu\?\.\(moreMenu,\{trigger:moreBtn/);
  assert.doesNotMatch(q, /quotationSummaryChip/);
  // Menü yapışkan başlığın altında kalmaz.
  assert.match(ui, /\.quotationDetailHead:has\(\.quotationMoreMenu:not\(\[hidden\]\)\) \{z-index:var\(--ui-z-popover\) !important\}/);
});
