'use strict';
// Gerçek Buyer Log (izole demo veri) içinde Fiyat Masası → Fiyat Teklifleri ekranını
// açar; sol grup listesinin dar sütunda yatay taşmadığını ve ikincil eylemlerin
// "Diğer" çekmecesinde toplandığını doğrular, sürüm notu görselini üretir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');

const MFRS = ['ALPHA SOURCING', 'BETA APPAREL MILLS PRIVATE LIMITED', 'GAMMA TEXTILE', 'DELTA KNIT', 'EPSILON CREATION', 'ZETA APPARELS LTD.'];
function demoRequest(index, manufacturers, models) {
  return {
    id: 'quotation-demo-' + index, source: 'collection', status: 'active', ownerId: 'moderator',
    createdAt: new Date(Date.UTC(2026, 10, 18 - index * 3, 12, index)).toISOString(),
    manufacturers: manufacturers.map(name => ({ name, email: '' })),
    items: models.flatMap((model, j) => manufacturers.map(name => ({ id: `line-${index}-${j}-${name}`, modelKey: model, modelCode: model, category: 'Sweat', colour: 'RED', fabric: 'Three Thread Brushed', quantity: 3000, targetPrice: '3.45', manufacturer: name, price: name === manufacturers[0] ? '4.10' : '' }))),
  };
}

(async () => {
  const app = await start({});
  try {
    const { page, api } = app;
    const range = (prefix, n) => Array.from({ length: n }, (_, k) => prefix + k);
    for (const request of [demoRequest(0, MFRS, ['DEMO-MODEL-2', 'DEMO-MODEL-3']), demoRequest(1, MFRS.slice(0, 5), range('DEMO-SHORT-', 11)), demoRequest(2, MFRS, range('DEMO-CRAFT-12-', 9)), demoRequest(3, MFRS.slice(0, 1), range('DEMO-SHORT-', 14))]) await api('/api/quotations', request);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.evaluate(() => switchTab('quotations'));
    await page.waitForSelector('#quotationNav .quotationNavItem', { timeout: 60000 });
    await page.waitForTimeout(600);
    const layout = await page.evaluate(() => {
      const list = document.getElementById('quotationNav');
      return { listOverflow: list.scrollWidth - list.clientWidth, items: [...list.querySelectorAll('.quotationNavItem')].map(item => item.scrollWidth - item.clientWidth), sourceBadges: list.querySelectorAll('.quotationSourceBadge').length };
    });
    assert.equal(layout.listOverflow, 0, 'Grup listesi yatay taşmamalı');
    assert.ok(layout.items.every(overflow => overflow === 0), 'Grup kartı sütundan geniş olmamalı');
    assert.equal(layout.sourceBadges, 0);
    await page.click('[data-q-more]');
    const menu = page.locator('[data-q-more-menu]');
    await menu.waitFor({ state: 'visible' });
    for (const selector of ['[data-q-open-collection]', '[data-q-open-history]', '[data-export-quotation]', '[data-delete-quotation]']) assert.equal(await menu.locator(selector).count(), 1, selector);
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback],.toast,.blToast').forEach(el => el.remove()));
    await page.waitForTimeout(400);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/quotation-desk-layout.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, clip: { x: 236, y: 60, width: 1364, height: 560 } });
    await page.keyboard.press('Escape');
    assert.equal(await menu.isHidden(), true);
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, layout }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
