'use strict';
// Gerçek Buyer Log (anonim demo veri) Koleksiyon tablosunda sığmayan Previous
// Season / LFL / Sezon Etkisi hücresinin üzerine gelindiğinde açılan önizleme
// ipucunun ortak 1px sınır + overlay gölgesini taşıdığını doğrular; sürüm notu
// görselini üretir. Satırlar ve LFL referansı bellek içinde kurulur (kaydedilmez).
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start({ deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 720 });
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
      const keep = new Set(['plmId', 'modelKod', 'colour', 'season', 'mag', 'urunTipi', 'country', 'licensor', 'durum', 'quantity', 'targetPrice', 'fob', '__confirmedPrice__', '__previousSeason__', '__lfl__', '__seasonImpact__']);
      kolHiddenCols = new Set([...kolDescriptorCatalog({ all: true }).keys()].filter(key => !keep.has(key))); kolPictureHidden = true;
      BLCollectionLfl.invalidate(); await BLCollectionLfl.ensure({ rebuild: false }); renderKol();
    });
    await page.waitForFunction(() => document.querySelectorAll('#kolTable tbody tr').length === 4, null, { timeout: 30000 });
    // Çok sütun 1280 px'e sığdırılırken kıyas sütunu daralır; önizleme yalnız kırpılan hücrede açılır.
    await page.evaluate(() => [...document.querySelectorAll('#kolTable tbody td')].find(el => el.querySelector('.blCellStackRow')).scrollIntoView({ block: 'nearest', inline: 'center' }));
    await page.waitForTimeout(600);
    const cell = await page.evaluate(() => {
      const td = [...document.querySelectorAll('#kolTable tbody td')].find(el => el.querySelector('.blCellStackRow'));
      const r = td.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(cell.x - 20, cell.y - 20); await page.mouse.move(cell.x, cell.y, { steps: 4 });
    await page.waitForSelector('.kolTextPreviewPopup', { timeout: 5000 });
    await page.waitForTimeout(150);
    const style = await page.$eval('.kolTextPreviewPopup', el => { const s = getComputedStyle(el); return { border: `${s.borderTopWidth} ${s.borderTopStyle}`, shadow: s.boxShadow, text: el.textContent }; });
    assert.equal(style.border, '1px solid', 'hover preview carries the shared frame');
    assert.notEqual(style.shadow, 'none', 'hover preview carries the overlay shadow');
    assert.match(style.text, /LFL/);
    const box = await page.evaluate(() => { const a = document.querySelector('#kolTable').getBoundingClientRect(), b = document.querySelector('.kolTextPreviewPopup').getBoundingClientRect(); return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), right: Math.max(a.right, b.right), bottom: Math.max(a.y + Math.min(a.height, 420), b.bottom) }; });
    const x = Math.max(0, box.x - 4), y = Math.max(0, box.y - 4);
    const width = Math.max(900, Math.ceil(box.right - x) + 8), height = Math.max(360, Math.ceil(box.bottom - y) + 24, Math.ceil(width / 3.1));
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/hover-tooltip-frame.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, clip: { x, y, width: Math.min(width, 1280 - x), height: Math.min(height, 720 - y) } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, style }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
