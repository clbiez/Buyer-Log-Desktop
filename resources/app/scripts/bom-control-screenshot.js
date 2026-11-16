'use strict';
// Gerçek Buyer Log (izole demo veri) içinde CP → Araçlar → BOM Kontrol penceresini
// açar; anonim demo BOM ile ortak etiketten sapan modeli ve kumaş sapmasını
// doğrular, işaretin hatırlandığını kontrol eder ve sürüm notu görselini üretir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const { createStore } = require('../server/lib/plm-bom-store');

const part = (code, name, main, group, category, quantity = 1) => ({ componentCode: code, componentName: name, mainCategoryName: main, categoryGroupName: group, categoryName: category, quantity });
function demoBom(plmId, index) {
  const components = [
    part(index === 4 || index === 11 ? 'FAB-DEMO-77' : 'FAB-DEMO-01', 'Single Jersey 160 gsm', 'Fabric', 'Knit', 'Main Fabric', 0.32 + (index % 3) * 0.02),
    part(index === 2 ? 'LBL-S6-OLD' : 'LBL-DEMO-26', 'Brand Woven Label', 'Trims', 'Label', 'Woven Label'),
    part('CARE-DEMO-1', 'Care Label', 'Trims', 'Label', 'Care Label'),
    part('PR-DEMO-' + String(100 + index), 'Front Print', 'Embellishment', 'Artwork', 'Print'),
  ];
  // Gerçek kayıttaki gibi: süsleme bileşenleri + baskı yerleşimi özeti ayrıca tutulur.
  const decorations = components.filter(item => item.mainCategoryName === 'Embellishment').map(item => ({ ...item, mainCategoryId: 1, categoryId: 21 }));
  const placements = decorations.map(item => ({ componentCode: item.componentCode, placement: 'front_body', count: 1, printType: 'Print', categoryName: 'Print', description: 'FRONT BODY', quantity: 1 }));
  return { plmId, styleId: String(900000 + index), fetchedAt: new Date().toISOString(), components: decorations, placements, hasPrint: true, totalPrintCount: 1, summary: 'Ön 1', placementSummary: 'Ön 1', fullComponents: components, fullComponentCount: components.length, fullCoverage: 'all-normalized' };
}

(async () => {
  const app = await start({});
  try {
    const { page, root } = app;
    await page.evaluate(() => window.switchTab ? window.switchTab('cp') : document.querySelector('[data-tab="cp"]')?.click());
    await page.waitForFunction(() => typeof state !== 'undefined' && state.cp && state.cp.rows && state.cp.rows.length > 0, null, { timeout: 60000 });
    // Demo CP satırlarına anonim PLM ID verilir.
    const ids = await page.evaluate(() => {
      const out = [];
      state.cp.rows.forEach((row, i) => { const id = String(700100 + i); row['PLM ID'] = id; out.push(id); });
      return out;
    });
    createStore(path.join(root, 'data', 'plm-bom.json')).saveResults(ids.map(demoBom));
    await page.evaluate(() => { state.cpSelected.clear(); renderCP(); });
    await page.click('#cpToolsBtn');
    await page.click('#cpBomControlBtn');
    await page.locator('.bomcModal .bomcTable').waitFor({ timeout: 30000 });
    // Kırılım: Kategori.
    const levelValue = await page.evaluate(() => [...document.querySelectorAll('[data-level-add] option')].find(o => /^Category$|^Kategori$/.test(o.textContent.trim()))?.value || '');
    if (levelValue) await page.selectOption('[data-level-add]', levelValue);
    const labelRow = page.locator('.bomcTable tr', { hasText: 'Woven Label' });
    await labelRow.first().waitFor();
    assert.match(await labelRow.first().innerText(), /LBL-S6-OLD/);
    // Kumaşı "Ortak" işaretle: sapmalar hataya döner ve işaret saklanır.
    await page.locator('.bomcTable tr', { hasText: 'Main Fabric' }).locator('[data-mark-value="common"]').click();
    const fabricRow = page.locator('.bomcTable tr', { hasText: 'Main Fabric' });
    assert.match(await fabricRow.innerText(), /FAB-DEMO-77/);
    assert.equal(await fabricRow.locator('.bomcFinding.tone-bad').count() > 0, true);
    const stored = await page.evaluate(() => JSON.parse(BLStorage.getItem('lcw.cp.bomControl.v1') || '{}'));
    assert.equal(Object.values(stored.marks || {}).includes('common'), true);
    assert.equal(stored.levels.length, levelValue ? 1 : 0);
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback]').forEach(el => el.remove()));
    await page.waitForTimeout(300);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/cp-bom-control.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.locator('.bomcModal').screenshot({ path: screenshot });
    // Sağ tık BOM detayı (sapma çipinden açılır): tüm kalemler ve salt okunur işaret.
    await page.locator('.bomcFinding').first().click();
    const full = page.locator('[data-bom-full]');
    await full.waitFor({ timeout: 15000 });
    const fullText = await full.innerText();
    assert.match(fullText, /Main Fabric/);
    assert.match(fullText, /Care Label/);
    assert.match(fullText, /Ortak/);
    const detailShot = path.join(__dirname, '../public/release-notes/next-assets/plm-bom-full-items.png');
    await page.locator('.cpaModal:not(.bomcModal)').screenshot({ path: detailShot });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, models: ids.length, level: levelValue }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
