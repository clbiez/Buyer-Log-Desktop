'use strict';
// Gerçek Buyer Log (anonim demo veri) LFL Analizi'nde:
//  1) FOB Değişimi kartının varsayılan olarak Fisher LFL açıldığını, ağırlıklı ortalamanın
//     alt satırda gösterildiğini ve yöntem seçiminin çalıştığını,
//  2) Üretici tablosundaki FOB değişiminin yalnız ortak kırılımlardan hesaplandığını ve
//     ortak kırılımı olmayan üreticide boş kaldığını doğrular; sürüm notu görsellerini üretir.
// Demo veride her kalemin fiyatı %10 artar, güncel dönemde adet ucuz kaleme kayar.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const order = (code, season, inStore, classification, manufacturer, fob, quantity) => ({
  orderCode: code, modelName: `DEMO-${code}`, season, inStore, mag: 'DEMO MAG', mmyg: 'DEMO MMYG', classification, manufacturer,
  country: 'CHINA', buyingGroup: 'DEMO GROUP', buyer: 'DEMO BUYER', fob, quantity, currency: 'USD',
});
const rows = [
  order('D1', 'W6', '2026-07-06', 'DEMO BODY', 'DEMO SUPPLIER A', 1.00, 10000), order('D2', 'W6', '2026-07-13', 'DEMO SWEAT', 'DEMO SUPPLIER B', 4.00, 10000),
  order('D3', 'W6', '2026-08-03', 'DEMO PANT', 'DEMO SUPPLIER A', 2.50, 6000), order('D7', 'W6', '2026-08-10', 'DEMO SWEAT', 'DEMO SUPPLIER C', 4.00, 3000),
  order('D4', 'W7', '2027-07-05', 'DEMO BODY', 'DEMO SUPPLIER A', 1.10, 30000), order('D5', 'W7', '2027-07-12', 'DEMO SWEAT', 'DEMO SUPPLIER B', 4.40, 10000),
  order('D6', 'W7', '2027-08-02', 'DEMO PANT', 'DEMO SUPPLIER A', 2.75, 6000), order('D8', 'W7', '2027-08-09', 'DEMO BODY', 'DEMO SUPPLIER C', 1.10, 3000),
];
const clipOf = async (page, selector, minHeight, viewportWidth = 1400) => {
  await page.$eval(selector, el => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(400);
  const box = await page.$eval(selector, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const x = Math.max(0, box.x - 6), y = Math.max(0, box.y - 6), width = Math.min(viewportWidth - x, Math.max(900, Math.ceil(box.width) + 12));
  return { x, y, width, height: Math.max(minHeight, Math.ceil(width / 3), Math.min(Math.ceil(box.height) + 12, Math.floor(width / 1.25))) };
};
(async () => {
  const app = await start();
  try {
    const { page } = app;
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.route('**/api/lfl**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, meta: { rowCount: rows.length }, source: null, loadedAt: '2026-11-24T09:00:00Z' }) }));
    await page.click('button[data-tab="lfl"]');
    await page.waitForSelector('#lflKpis [data-lfl-method="fisher"]', { timeout: 60000 });
    const read = () => page.$eval('#lflKpis .lflKpi--method', el => ({ value: el.querySelector('.lflKpiValue').textContent, sub: el.querySelector('.lflKpiSub').textContent, pressed: el.querySelector('[aria-pressed="true"]').dataset.lflMethod }));
    const manufacturers = () => page.$$eval('#lflManufacturerVolumeTable tbody tr', trs => trs.map(tr => [...tr.cells].map(td => td.textContent.trim())));
    const fisher = await read(), fisherMfr = await manufacturers();
    assert.equal(fisher.pressed, 'fisher', 'varsayılan yöntem Fisher LFL olmalı');
    assert.match(fisher.value, /10/);
    assert.match(fisher.sub, /Ağırlıklı ort\./); // i18n-ignore
    const rowOf = (table, name) => table.find(cells => cells[0].startsWith(name));
    assert.match(rowOf(fisherMfr, 'DEMO SUPPLIER A').at(-1), /10/);
    assert.equal(rowOf(fisherMfr, 'DEMO SUPPLIER C').at(-1), '');
    // Ekran görüntüleri: varsayılan (Fisher) görünüm.
    const dir = path.join(__dirname, '../public/release-notes/next-assets');
    fs.mkdirSync(dir, { recursive: true });
    await page.mouse.move(5, 5);
    const kpiShot = path.join(dir, 'lfl-fisher-method.png');
    await page.screenshot({ path: kpiShot, clip: await clipOf(page, '#lflKpis', 380) });
    const mfrShot = path.join(dir, 'lfl-manufacturer-like-for-like.png');
    // Üretici kartı geniş ekranda tüm sütunlarıyla görünür.
    await page.setViewportSize({ width: 2800, height: 1000 }); await page.waitForTimeout(600);
    await page.screenshot({ path: mfrShot, clip: await clipOf(page, '.lflManufacturerVolumeCard', 380, 2800) });
    await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(300);
    // Yöntem seçimi: ağırlıklı ortalamaya geçiş.
    await page.click('#lflKpis [data-lfl-method="weighted"]');
    await page.waitForFunction(() => document.querySelector('#lflKpis [data-lfl-method="weighted"]')?.getAttribute('aria-pressed') === 'true');
    const weighted = await read(), weightedMfr = await manufacturers();
    assert.match(weighted.sub, /Fisher LFL: \+10/);
    assert.notEqual(rowOf(weightedMfr, 'DEMO SUPPLIER A').at(-1), rowOf(fisherMfr, 'DEMO SUPPLIER A').at(-1));
    await page.click('#lflKpis [data-lfl-method="fisher"]');
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ kpiShot, mfrShot, fisher, weighted, fisherMfr, weightedMfr }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
