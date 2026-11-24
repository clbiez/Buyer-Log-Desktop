'use strict';
// Gerçek Buyer Log (anonim demo veri) Koleksiyonunda durum rozetinin ana model
// satırında ve renk varyantı alt satırlarında aynı yükseklikte kaldığını doğrular
// ve sürüm notu görselini üretir. Demo modeller bellek içinde çizilir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start({ initScript: t => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); localStorage.setItem('bl.user.moderator.lcw.lang.v1', 'en'); } catch (_) {} }, initArg: 'light', deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    await page.evaluate(() => {
      const base = { productMainDefinition: 'Polo Yaka Tshirt', buyingGroup: 'DEMO GROUP', inStoreMonth: '2027-07' };
      kolRows = kolNormalizeModelGroups([
        { id: 1, plmId: 'DEMO-100', modelKod: 'DM100', colour: 'NAVY', colourCode: 'N01', durum: 'Order Placed', ...base },
        { id: 2, plmId: 'DEMO-200', modelKod: 'DM200', colour: 'WHITE', colourCode: 'W01', durum: 'Order Placed', ...base },
        { id: 3, plmId: 'DEMO-200', modelKod: 'DM200', colour: 'GREEN', colourCode: 'G01', durum: 'File Received', ...base },
        { id: 4, plmId: 'DEMO-200', modelKod: 'DM200', colour: 'BLACK', colourCode: 'B01', durum: 'File Received', ...base },
        { id: 5, plmId: 'DEMO-200', modelKod: 'DM200', colour: 'ECRU', colourCode: 'E01', durum: 'File Received', ...base },
      ]);
      const keep = new Set(['modelKod', 'colourCode', 'colour', 'productMainDefinition', 'inStoreMonth', 'durum', 'plmId']);
      kolHiddenCols = new Set([...kolAllOrderedCols().map(c => c.k), ...KOL_SYNTHETIC_COL_KEYS].filter(k => !keep.has(k)));
      kolPictureHidden = true; saveKolRows(); renderKol();
    });
    await page.waitForSelector('#kolTable tbody tr.kolModelGroupVariant td.kolStatusTd select', { timeout: 30000 });
    const badges = await page.$$eval('#kolTable tbody td.kolStatusTd select', els => els.map(s => ({ variant: s.closest('tr').classList.contains('kolModelGroupVariant'), h: Math.round(s.getBoundingClientRect().height) })));
    assert.ok(badges.some(b => b.variant) && badges.some(b => !b.variant), JSON.stringify(badges));
    assert.deepEqual([...new Set(badges.map(b => b.h))], [20], JSON.stringify(badges));
    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    const box = await page.$eval('#kolTable', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/collection-status-badge-height.png');
    if (!process.argv.includes('--no-shot')) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1000, box.w + 8), height: Math.max(380, Math.min(420, box.h + 8)) } });
    }
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ badges, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
