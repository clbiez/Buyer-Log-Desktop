'use strict';
// Gerçek Buyer Log (anonim demo veri) Koleksiyon fiyat panelinde LFL / Previous
// Season / Sezon Etkisi kıyasının Final FOB (Supp. FOB + Royalty + Hologram) ile
// yapıldığını doğrular ve sürüm notu görselini üretir. Koleksiyon satırları,
// lisans kuralı ve LFL referansı bellek içinde anonim demo değerlerle kurulur.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start();
  try {
    const { page } = app;
    await page.setViewportSize({ width: 1700, height: 900 });
    const order = (season, month, fob, quantity, code) => ({ season, mag: 'DEMO MAG', classification: 'DEMO KLASMAN', inStoreMonth: month, fob, quantity, country: 'CHINA', orderCode: code });
    const references = require('../public/collection-lfl-engine').buildReferences([
      order('W25', '2026-01', 9.6, 4000, 'DEMO-1'), order('W25', '2026-02', 9.8, 3000, 'DEMO-2'), order('W25', '2026-02', 10.1, 2500, 'DEMO-3'), order('W25', '2026-03', 10.4, 1500, 'DEMO-4'),
      order('W26', '2027-01', 9.9, 3000, 'DEMO-5'), order('W26', '2027-01', 10.2, 2000, 'DEMO-6'), order('W26', '2027-01', 10, 1000, 'DEMO-7'), order('W26', '2027-01', 9.7, 1500, 'DEMO-8'),
    ]);
    await page.route('**/api/collection-lfl-reference**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'demo', references }) }));
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    const facts = await page.evaluate(async () => {
      const rule = { id: 'demo-rule', opdStart: '2026-01-01', opdEnd: '2027-12-31', seasons: ['W26'], licensor: 'DEMO LICENSOR', license: 'DEMO LICENSE', royalty: 18, trCommission: 3, ydCommission: 2, hologramCost: 0.05 };
      state.overrides.pricingRules = typeof normalizePricingRules === 'function' ? normalizePricingRules([rule]) : [rule];
      const base = { season: 'W26', mag: 'DEMO MAG', urunTipi: 'DEMO KLASMAN', inStoreMonth: '2027-02', country: 'China', confirmedManufacturer: 'DEMO SUPPLIER', durum: 'Order Placed' };
      const rows = [
        { id: 1, plmId: 'DEMO-100', modelKod: 'DM100', colour: 'NAVY', colourCode: 'N01', quantity: '2000', licensor: 'DEMO LICENSOR', lisans: 'DEMO LICENSE', pricing: { 'DEMO SUPPLIER': '8,40' }, ...base },
        { id: 2, plmId: 'DEMO-200', modelKod: 'DM200', colour: 'GREY MEL', colourCode: 'G02', quantity: '1500', licensor: 'DTR', lisans: '', pricing: { 'DEMO SUPPLIER': '9,90' }, ...base },
      ];
      kolRows = kolNormalizeModelGroups(rows); kolSyncRulePricing({ save: false });
      const keep = new Set(['modelKod', 'licensor', 'quantity', 'royalty', 'hologramCost', 'fob', '__confirmedPrice__', '__previousSeason__', '__lfl__', '__seasonImpact__']);
      kolHiddenCols = new Set([...kolDescriptorCatalog({ all: true }).keys()].filter(key => !keep.has(key))); kolPictureHidden = true;
      BLCollectionLfl.invalidate(); await BLCollectionLfl.ensure({ rebuild: false }); renderKol();
      const live = kolRows[0], lfl = BLCollectionLfl.model(live, 'month'), season = BLCollectionLfl.model(live, 'season'), impact = BLCollectionLfl.model(live, 'impact');
      return { fob: live.fob, supp: kolSuppFob(live).price, lfl: lfl.percent, season: season.percent, impactPrice: impact.impact.price, source: lfl.source, dtrLfl: BLCollectionLfl.model(kolRows[1], 'month').percent };
    });
    // 8,40 ÷ (1 − 20%) + 0,05 = 10,55 → FOB sütunu ve tüm kıyaslar bu değeri kullanır; DTR satırında Final FOB = Supp. FOB.
    const prevMonth = (9.8 * 3000 + 10.1 * 2500) / 5500;
    assert.equal(facts.supp, 8.4); assert.equal(facts.impactPrice, 10.55); assert.match(String(facts.fob), /10[.,]55/); assert.match(facts.source, /Final FOB/);
    assert.ok(Math.abs(facts.lfl - (10.55 / prevMonth - 1) * 100) < 1e-9); assert.ok(Math.abs(facts.dtrLfl - (9.9 / prevMonth - 1) * 100) < 1e-9);
    await page.waitForFunction(() => document.querySelectorAll('#kolTable tbody tr').length === 2 && /10[.,]55/.test(document.querySelector('#kolTable').innerText), null, { timeout: 30000 });
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const box = await page.$eval('#kolTable', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/collection-lfl-final-fob.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    const width = Math.min(1700 - Math.max(0, box.x - 4), Math.max(900, Math.ceil(box.width) + 8)), height = Math.max(Math.ceil(box.height) + 16, Math.ceil(width / 3.1));
    await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width, height } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, facts, box }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
