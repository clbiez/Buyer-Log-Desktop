'use strict';
// Gerçek Buyer Log (anonim demo veri): Koleksiyon'da işaretli modeller Kopyala
// menüsündeki "Görsel olarak kopyala" ile panoya PNG olarak gider. Koyu temada
// bile görsel aydınlık temadır. Sürüm notu görselini üretir.
//   node scripts/table-image-copy-screenshot.js [--no-shot]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start({ initScript: t => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); localStorage.setItem('buyerlog.ui.appearance', JSON.stringify({ theme: t, step: 0 })); } catch (_) {} }, initArg: 'light', deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    await page.evaluate(() => {
      const base = { productMainDefinition: 'Takım', category: 'KEY ORME TAKIM', season: 'W7', inStoreMonth: '2027-08' };
      kolRows = kolNormalizeModelGroups([
        { id: 1, plmId: 'DEMO-1001', modelKod: 'DEMO-TKM-01', colour: 'LIGHT GREY', colourCode: '3W9', durum: 'Sent for MB Approval', ...base },
        { id: 2, plmId: 'DEMO-1002', modelKod: 'DEMO-TKM-02', colour: 'NAVY', colourCode: 'N01', durum: 'Order Placed', ...base },
        { id: 3, plmId: 'DEMO-1003', modelKod: 'DEMO-TKM-03', colour: 'ECRU', colourCode: 'E01', durum: 'File Received', ...base },
        { id: 4, plmId: 'DEMO-1004', modelKod: 'DEMO-TKM-04', colour: 'BLACK', colourCode: 'B01', durum: 'Order Placed', ...base },
        { id: 5, plmId: 'DEMO-1005', modelKod: 'DEMO-TKM-05', colour: 'KHAKI', colourCode: 'K02', durum: 'Sent for MB Approval', ...base },
        { id: 6, plmId: 'DEMO-1006', modelKod: 'DEMO-TKM-06', colour: 'BURGUNDY', colourCode: 'R05', durum: 'File Received', ...base },
      ]);
      const keep = new Set(['season', 'inStoreMonth', 'durum', 'productMainDefinition', 'category', 'plmId', 'modelKod', 'colourCode', 'colour']);
      kolHiddenCols = new Set([...kolAllOrderedCols().map(c => c.k), ...KOL_SYNTHETIC_COL_KEYS].filter(k => !keep.has(k)));
      kolPictureHidden = true; saveKolRows(); renderKol();
    });
    await page.waitForSelector('#kolTable tbody tr[data-id="6"]', { timeout: 30000 });
    for (const id of [1, 2]) await page.click(`#kolTable tbody tr[data-id="${id}"] .rowChk`);
    // Kopyalama seçenekleri Koleksiyon'da da Kopyala düğmesinin yanında.
    const adjacent = await page.evaluate(() => document.getElementById('kolCopySelectedBtn')?.nextElementSibling?.id);
    assert.equal(adjacent, 'navCopyMenuBtn');
    await page.click('#navCopyMenuBtn');
    const items = await page.$$eval('#gridClipboardMenu button', buttons => buttons.map(b => b.textContent));
    assert.ok(items.includes('Görsel olarak kopyala'), JSON.stringify(items));
    await page.click('#gridClipboardMenu button:text-is("Görsel olarak kopyala")');
    await page.waitForFunction(() => /2 satır görsel olarak kopyalandı/.test(document.body.textContent), null, { timeout: 30000 });
    const png = await page.evaluate(async () => {
      const items = await navigator.clipboard.read(), blob = await items[0].getType('image/png');
      const bitmap = await createImageBitmap(blob);
      return { types: items[0].types, bytes: blob.size, width: bitmap.width, height: bitmap.height };
    });
    assert.deepEqual(png.types, ['image/png']);
    assert.ok(png.width > 1000 && png.height > 200 && png.height < 600, JSON.stringify(png));
    // Menü açık + başarı bildirimi: sürüm notu görseli (alçak pencere, bildirim karede kalır).
    await page.setViewportSize({ width: 1440, height: 640 });
    await page.waitForTimeout(300);
    await page.click('#navCopyMenuBtn');
    await page.waitForSelector('#gridClipboardMenu');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/table-image-copy.png');
    if (!process.argv.includes('--no-shot')) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      const box = await page.$eval('#kolTableToolbar', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
      const viewport = page.viewportSize();
      const x = Math.max(0, Math.floor(box.x - 8)), y = Math.max(0, Math.floor(box.y - 8));
      await page.screenshot({ path: screenshot, clip: { x, y, width: viewport.width - x, height: viewport.height - y } });
    }
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ items, png, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
