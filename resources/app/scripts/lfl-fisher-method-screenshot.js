'use strict';
// Gerçek Buyer Log (anonim demo veri) LFL Analizi'nde FOB Değişimi kartındaki
// "Ağırlıklı ort. / Fisher LFL" seçimini doğrular ve sürüm notu görselini üretir.
// Demo veride her kalemin fiyatı %10 artar, güncel dönemde adet ucuz kaleme kayar:
// ağırlıklı ortalama karma etkisiyle düşüş, Fisher LFL ise +%10 gösterir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const order = (code, season, inStore, classification, manufacturer, fob, quantity) => ({
  orderCode: code, modelName: `DEMO-${code}`, season, inStore, mag: 'DEMO MAG', mmyg: 'DEMO MMYG', classification, manufacturer,
  country: 'CHINA', buyingGroup: 'DEMO GROUP', buyer: 'DEMO BUYER', fob, quantity, currency: 'USD',
});
const rows = [
  order('D1', 'W6', '2026-07-06', 'DEMO BODY', 'DEMO SUPPLIER A', 1.00, 10000), order('D2', 'W6', '2026-07-13', 'DEMO SWEAT', 'DEMO SUPPLIER B', 4.00, 10000),
  order('D3', 'W6', '2026-08-03', 'DEMO PANT', 'DEMO SUPPLIER A', 2.50, 6000),
  order('D4', 'W7', '2027-07-05', 'DEMO BODY', 'DEMO SUPPLIER A', 1.10, 30000), order('D5', 'W7', '2027-07-12', 'DEMO SWEAT', 'DEMO SUPPLIER B', 4.40, 10000),
  order('D6', 'W7', '2027-08-02', 'DEMO PANT', 'DEMO SUPPLIER A', 2.75, 6000),
];
(async () => {
  const app = await start();
  try {
    const { page } = app;
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.route('**/api/lfl**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, meta: { rowCount: rows.length }, source: null, loadedAt: '2026-11-24T09:00:00Z' }) }));
    await page.click('button[data-tab="lfl"]');
    await page.waitForSelector('#lflKpis [data-lfl-method="fisher"]', { timeout: 60000 });
    const read = () => page.$eval('#lflKpis .lflKpi--method', el => ({ value: el.querySelector('.lflKpiValue').textContent, sub: el.querySelector('.lflKpiSub').textContent, pressed: el.querySelector('[aria-pressed="true"]').dataset.lflMethod }));
    const weighted = await read();
    await page.click('#lflKpis [data-lfl-method="fisher"]');
    await page.waitForFunction(() => document.querySelector('#lflKpis [data-lfl-method="fisher"]')?.getAttribute('aria-pressed') === 'true');
    const fisher = await read();
    assert.equal(weighted.pressed, 'weighted');
    assert.equal(fisher.pressed, 'fisher');
    assert.match(fisher.value, /10/);
    assert.match(fisher.sub, /Ağırlıklı ort\./); // i18n-ignore
    await page.mouse.move(5, 5); await page.waitForTimeout(500);
    await page.$eval('#lflKpis', el => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(400);
    const box = await page.$eval('#lflKpis', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/lfl-fisher-method.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    const x = Math.max(0, box.x - 6), y = Math.max(0, box.y - 6), width = Math.min(1400 - x, Math.ceil(box.width) + 12);
    const height = Math.max(380, Math.ceil(width / 3));
    await page.screenshot({ path: screenshot, clip: { x, y, width, height } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, weighted, fisher }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
