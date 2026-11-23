'use strict';
// Gerçek Buyer Log (anonim demo veri) Koleksiyon alt satırında Teklif & Onay
// ortalamalarını ve Target'a göre % farkını, Previous Season / LFL / Sezon Etkisi
// kompakt sütununda her kıyasın % değişimini doğrular; sürüm notu görselini üretir.
// Satırlar ve LFL referansı bellek içinde anonim demo değerlerle kurulur (kaydedilmez).
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start();
  try {
    const { page } = app;
    await page.setViewportSize({ width: 1700, height: 900 });
    const order = (season, month, fob, quantity, code) => ({ season, mag: 'DEMO MAG', classification: 'DEMO KLASMAN', inStoreMonth: month, fob, quantity, country: 'CHINA', orderCode: code });
    const references = require('../public/collection-lfl-engine').buildReferences([
      order('W25', '2026-01', 1.6, 4000, 'DEMO-1'), order('W25', '2026-02', 1.7, 3000, 'DEMO-2'), order('W25', '2026-02', 1.5, 2500, 'DEMO-3'), order('W25', '2026-03', 1.8, 1500, 'DEMO-4'),
      order('W26', '2027-01', 1.55, 3000, 'DEMO-5'), order('W26', '2027-01', 1.65, 2000, 'DEMO-6'), order('W26', '2027-01', 1.6, 1000, 'DEMO-7'), order('W26', '2027-01', 1.7, 1500, 'DEMO-8'),
    ]);
    await page.route('**/api/collection-lfl-reference**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'demo', references }) }));
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    await page.evaluate(async () => {
      const base = { season: 'W26', mag: 'DEMO MAG', urunTipi: 'DEMO KLASMAN', inStoreMonth: '2027-02', country: 'China', licensor: 'DTR', durum: 'Order Placed' };
      const rows = [
        { id: 1, plmId: 'DEMO-100', modelKod: 'DM100', colour: 'NAVY', quantity: '2000', targetPrice: '1,55', pricing: { 'DEMO SUPPLIER A': '1,62', 'DEMO SUPPLIER B': '1,70' }, confirmedManufacturer: 'DEMO SUPPLIER A', ...base },
        { id: 2, plmId: 'DEMO-200', modelKod: 'DM200', colour: 'GREY MEL', quantity: '1500', targetPrice: '1,36', pricing: { 'DEMO SUPPLIER B': '1,60' }, confirmedManufacturer: 'DEMO SUPPLIER B', ...base },
        { id: 3, plmId: 'DEMO-300', modelKod: 'DM300', colour: 'BLACK', quantity: '1000', targetPrice: '1,68', pricing: { 'DEMO SUPPLIER C': '1,58' }, confirmedManufacturer: 'DEMO SUPPLIER C', ...base },
        { id: 4, plmId: 'DEMO-400', modelKod: 'DM400', colour: 'ECRU', quantity: '800', targetPrice: '1,46', pricing: { 'DEMO SUPPLIER A': '1,52', 'DEMO SUPPLIER C': '1,49' }, ...base },
      ];
      kolRows = kolNormalizeModelGroups(rows); kolSyncRulePricing({ save: false });
      const keep = new Set(['modelKod', 'quantity', 'targetPrice', 'fob', '__confirmedPrice__', '__previousSeason__', '__lfl__', '__seasonImpact__']);
      kolHiddenCols = new Set([...kolDescriptorCatalog({ all: true }).keys()].filter(key => !keep.has(key))); kolPictureHidden = true;
      BLCollectionLfl.invalidate(); await BLCollectionLfl.ensure({ rebuild: false }); renderKol();
    });
    await page.waitForFunction(() => document.querySelectorAll('#kolTable tbody tr').length === 4 && /Ağ\.% Δ Target/.test(document.querySelector('#kolTable tfoot')?.textContent || ''), null, { timeout: 30000 });
    const footer = await page.$eval('#kolTable tfoot', el => el.textContent);
    // Teklif & Onay: Σ(fiyat×adet)/Σ(target×adet) − 1 = (3240+2400+1580+1192)/(3100+2040+1680+1168) − 1 = +5,3%.
    assert.match(footer, /Ağ\.% Δ Target\s*\+5,3%/);
    for (const label of ['Previous Season', 'LFL', 'Sezon Etkisi']) assert.match(footer, new RegExp(label + ' · Ağ\\.Ort\\.\\$[0-9,]+(?: → \\$[0-9,]+)? [+-]?[0-9,]+%'), label);
    assert.equal(await page.$$eval('#kolTable tfoot .kolBestDelta', els => els.length), 4, 'Quotes & Approval + three reference percentages');
    const colours = await page.evaluate(() => ({ foot: [...document.querySelectorAll('#kolTable tfoot .kolBestDelta')].map(el => [el.classList.contains('isAboveTarget'), getComputedStyle(el).color]), body: Object.fromEntries([...document.querySelectorAll('#kolTable tbody .blCellTag[data-tone="good"], #kolTable tbody .blCellTag[data-tone="bad"]')].map(el => [String(el.dataset.tone === 'bad'), getComputedStyle(el).color])) }));
    for (const [above, colour] of colours.foot) assert.equal(colour, colours.body[String(above)], 'footer % uses the same good/bad colour as the cell chips');
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const box = await page.$eval('#kolTable', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/collection-price-footer-percent.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    const width = Math.min(1700 - Math.max(0, box.x - 4), Math.max(900, Math.ceil(box.width) + 8)), height = Math.max(Math.ceil(box.height) + 16, Math.ceil(width / 3.1));
    await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width, height } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, footer }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
