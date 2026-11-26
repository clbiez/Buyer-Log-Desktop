'use strict';
// Gerçek Buyer Log (anonim demo veri): alttaki seçim çubuğunda "Görsel olarak
// kopyala" CP, Orders ve Koleksiyon'da görünür; CP'de işaretli satırları PNG
// olarak panoya yazar. Sürüm notu görselini üretir.
//   node scripts/selection-bar-image-copy-screenshot.js [--no-shot]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const BAR_BUTTON = '#blSelectionBar [data-selection-image]';
(async () => {
  const app = await start({ deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    // Orders: işaretli satırda çubukta düğme var.
    await page.click('button[data-tab="orders"]');
    await page.waitForFunction(() => document.querySelectorAll('#ordersTable tbody tr[data-id] .rowChk').length > 2, null, { timeout: 120000 });
    await page.locator('#ordersTable tbody tr[data-id] .rowChk').first().click();
    await page.waitForSelector(BAR_BUTTON, { state: 'visible', timeout: 10000 });
    await page.locator('#blSelectionBar .blSelectionDismiss').click();
    // Koleksiyon: işaretli modelde çubukta düğme var.
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    await page.evaluate(() => {
      kolRows = kolNormalizeModelGroups([
        { id: 1, plmId: 'DEMO-1001', modelKod: 'DEMO-TKM-01', colour: 'NAVY', colourCode: 'N01', durum: 'Order Placed', productMainDefinition: 'Takım' },
        { id: 2, plmId: 'DEMO-1002', modelKod: 'DEMO-TKM-02', colour: 'ECRU', colourCode: 'E01', durum: 'File Received', productMainDefinition: 'Takım' },
      ]);
      saveKolRows(); renderKol();
    });
    await page.waitForSelector('#kolTable tbody tr[data-id="2"] .rowChk', { timeout: 30000 });
    await page.click('#kolTable tbody tr[data-id="1"] .rowChk');
    await page.waitForSelector(BAR_BUTTON, { state: 'visible', timeout: 10000 });
    await page.click('#kolTable tbody tr[data-id="1"] .rowChk');
    // CP: 4 işaretli satır → çubuktan görsel kopya.
    await page.click('button[data-tab="cp"]');
    await page.waitForFunction(() => document.querySelectorAll('#cpTable tbody tr[data-id] .rowChk').length > 4, null, { timeout: 120000 });
    for (let i = 0; i < 4; i++) await page.locator('#cpTable tbody tr[data-id] .rowChk').nth(i).click();
    await page.waitForSelector(BAR_BUTTON, { state: 'visible', timeout: 10000 });
    const labels = await page.$$eval('#blSelectionBar .blSelectionAction span', spans => spans.map(s => s.textContent));
    assert.deepEqual(labels, ['Kopyala', 'Görsel olarak kopyala', 'Excel', 'Araçlar']);
    // Önceki adımların bildirimleri kapatılır; görsel çubuğu ve üstündeki satırları gösterir.
    for (const close of await page.$$('.uiFeedbackClose')) await close.click().catch(() => {});
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/selection-bar-image-copy.png');
    if (!process.argv.includes('--no-shot')) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      const bar = await page.$eval('#blSelectionBar', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const viewport = page.viewportSize();
      const width = 1000, height = 420;
      const x = Math.max(0, Math.min(viewport.width - width, Math.round(bar.x + bar.w / 2 - width / 2)));
      const y = Math.max(0, Math.min(viewport.height - height, Math.round(bar.y + bar.h + 16 - height)));
      await page.screenshot({ path: screenshot, clip: { x, y, width, height } });
    }
    await page.click(BAR_BUTTON);
    await page.waitForFunction(() => /4 satır görsel olarak kopyalandı/.test(document.body.textContent), null, { timeout: 60000 });
    const png = await page.evaluate(async () => {
      const items = await navigator.clipboard.read(), blob = await items[0].getType('image/png');
      const bitmap = await createImageBitmap(blob);
      return { types: items[0].types, bytes: blob.size, width: bitmap.width, height: bitmap.height };
    });
    assert.deepEqual(png.types, ['image/png']);
    assert.ok(png.width > 2000 && png.height > 250, JSON.stringify(png));
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ labels, png, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
