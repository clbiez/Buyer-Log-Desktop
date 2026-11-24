'use strict';
// Gerçek Buyer Log (anonim demo veri) Koleksiyonunda iki regresyonu doğrular ve
// sürüm notu görselini üretir: (1) alt opsiyonları silinen ana renkte MB tarihi
// yeni değere geçer; (2) ana renkte verilen üretici onayı alt opsiyonlarda onaylı
// (öneri değil) görünür. Demo modeller bellek içinde çizilir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start({ initScript: t => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); } catch (_) {} }, initArg: 'light', deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    const result = await page.evaluate(() => {
      const base = { inStoreMonth: '2026-10', inStore: '2026-10-05', durum: 'Order Placed', targetPrice: '5,50' };
      kolRows = kolNormalizeModelGroups([
        { id: 1, plmId: 'DEMO-600', modelKod: 'DM600', colour: 'NAVY', colourCode: 'N01', quantity: '1200', ...base },
        { id: 2, plmId: 'DEMO-600', modelKod: 'DM600', colour: 'GREY MEL', colourCode: 'G02', quantity: '800', ...base },
        { id: 3, plmId: 'DEMO-600', modelKod: 'DM600', colour: 'ECRU', colourCode: 'E03', quantity: '600', ...base },
        { id: 4, plmId: 'DEMO-500', modelKod: 'DM500', colour: 'BLACK', colourCode: 'B01', quantity: '900', ...base },
        { id: 5, plmId: 'DEMO-500', modelKod: 'DM500', colour: 'RED', colourCode: 'R01', quantity: '500', ...base },
      ]);
      const api = window.BLCollectionModelGroups;
      const p600 = kolRows.find(r => r.id === 1), p500 = kolRows.find(r => r.id === 4);
      kolRows = kolNormalizeModelGroups(api.setSharedValue(kolRows, p600.modelGroupId, 'pricing', { 'DEMO MFR A': '5,20', 'DEMO MFR B': '4,80' }));
      kolRows = kolNormalizeModelGroups(api.setSharedValue(kolRows, p500.modelGroupId, 'inStore', '2026-10-05'));
      kolRows = kolNormalizeModelGroups(api.setSharedValue(kolRows, p500.modelGroupId, 'inStoreMonth', '2026-10'));
      saveKolRows(); renderKol();
      // (2) Ana renkte onay.
      kolToggleConfirmedManufacturer(kolRows.find(r => r.id === 1), 'DEMO MFR A');
      const approvals = [1, 2, 3].map(id => { const c = kolConfirmedDisplay(kolRows.find(r => r.id === id)); return { id, name: c?.name, fallback: c?.isFallback }; });
      // (1) Alt opsiyonu silme (deleteKolSelectedRows ile aynı canlı satır kaldırma) ve MB tarihi girişi.
      kolRows = kolRows.filter(r => r.id !== 5); saveKolRows(); renderKol();
      kolApplyCollectionCellChange({ rowId: 4, key: 'inStore', value: '2027-01-04' });
      const lone = kolRows.find(r => r.id === 4);
      return { approvals, inStore: kolEffectiveValue(lone, 'inStore'), month: kolEffectiveValue(lone, 'inStoreMonth') };
    });
    assert.deepEqual(result.approvals.map(a => [a.name, a.fallback]), [['DEMO MFR A', false], ['DEMO MFR A', false], ['DEMO MFR A', false]]);
    assert.match(String(result.inStore), /^2027-01-04|04\.01\.2027/);
    assert.match(String(result.month), /2027/);
    // Görsel yalnız sonucu gösteren sütunlarla çekilir (bellek içi görünüm ayarı).
    await page.evaluate(() => {
      const keep = new Set(['modelKod', 'colourCode', 'colour', 'inStoreMonth', 'inStore', '__bestPrice__', '__confirmedName__', '__confirmedPrice__', 'durum']);
      kolHiddenCols = new Set([...kolAllOrderedCols().map(c => c.k), ...KOL_SYNTHETIC_COL_KEYS].filter(k => !keep.has(k)));
      kolPictureHidden = true; renderKol();
    });
    await page.waitForSelector('#kolTable tbody tr', { timeout: 30000 });
    const cells = await page.$$eval('#kolTable tbody tr', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    const box = await page.$eval('#kolTable', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/collection-variant-approval.png');
    if (!process.argv.includes('--no-shot')) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1240, box.w + 8), height: 400 } });
    }
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ result, cells, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
