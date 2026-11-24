'use strict';
// Gerçek Buyer Log (anonim demo veri) Koleksiyonunda PLM Sync ön izlemesini
// doğrular ve sürüm notu görselini üretir: Koleksiyon'da var olan modele PLM'den
// yeni opsiyon geldiğinde uyarı çıkar, renkler model model ve varsayılan
// İŞARETSİZ seçtirilir; yalnız işaretlenen renk Koleksiyon'a eklenir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start({ initScript: t => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); } catch (_) {} }, initArg: 'light', deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    await page.evaluate(() => {
      // DM700'ün alt opsiyonları bilerek silinmiş: Koleksiyon'da yalnız NAVY kaldı.
      kolRows = kolNormalizeModelGroups([
        { id: 1, plmId: 'DEMO-700', modelKod: 'DM700', colour: 'NAVY', colourCode: 'N01', season: '27 SS' },
        { id: 2, plmId: 'DEMO-800', modelKod: 'DM800', colour: 'BLACK', colourCode: 'B01', season: '27 SS' },
        { id: 3, plmId: 'DEMO-800', modelKod: 'DM800', colour: 'ECRU', colourCode: 'E03', season: '27 SS' },
      ]);
      kolNextId = 100;
      saveKolRows(); renderKol();
      const parsed = (plmId, modelKod, colour, colourCode) => migrateKolRow({ id: 0, plmId, modelKod, colour, colourCode, season: '27 SS', pricing: {}, pricingSent: {} });
      const plmRows = [
        parsed('DEMO-700', 'DM700', 'NAVY', 'N01'), parsed('DEMO-700', 'DM700', 'GREY MEL', 'G02'), parsed('DEMO-700', 'DM700', 'RED', 'R05'),
        parsed('DEMO-800', 'DM800', 'BLACK', 'B01'), parsed('DEMO-800', 'DM800', 'ECRU', 'E03'), parsed('DEMO-800', 'DM800', 'OLIVE', 'O07'),
      ];
      const summary = kolPlmSyncBuildSummary(kolRows.slice(), plmRows, { failed: [] });
      window.__demoSummary = summary;
      window.__demoChoice = showPlmSyncPreview('all', summary);
    });
    const modal = page.locator('#_plmSyncPreviewModal .plmImportCard');
    await modal.waitFor({ timeout: 15000 });
    const state = await page.evaluate(() => ({
      warn: document.querySelector('[data-plmsync-colourwarn]')?.textContent.trim(),
      models: [...document.querySelectorAll('[data-plmsync-colourmodel]')].map(el => el.dataset.plmsyncColourmodel),
      boxes: [...document.querySelectorAll('[data-plmsync-colour]')].map(box => ({ model: box.dataset.plmsyncModel, label: box.parentElement.textContent.trim(), checked: box.checked })),
    }));
    assert.match(state.warn, /2 modelde PLM’den 3 yeni opsiyon geliyor|2 model\(s\) already in Collection have 3 new option/);
    assert.deepEqual(state.models, ['DEMO-700', 'DEMO-800']);
    assert.equal(state.boxes.length, 3);
    assert.ok(state.boxes.every(box => !box.checked), 'varsayılan hiçbir opsiyon işaretli değil');
    // Kullanıcı yalnız DM800'ün OLIVE rengini seçer.
    await page.locator('[data-plmsync-colour][data-plmsync-model="DEMO-800"]').check();
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback]').forEach(el => el.remove()));
    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/plm-sync-new-colour-choice.png');
    if (!process.argv.includes('--no-shot')) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await modal.screenshot({ path: screenshot });
    }
    await page.click('[data-plmsyncact="apply"]');
    const applied = await page.evaluate(async () => {
      const choice = await window.__demoChoice;
      const added = kolPlmSyncAddNewColours(choice.colours);
      return { picked: choice.colours.map(c => c.colourCode), added: added.map(r => r.colourCode), rows: kolRows.map(r => `${r.plmId}:${r.colourCode}`).sort() };
    });
    assert.deepEqual(applied.picked, ['O07']);
    assert.deepEqual(applied.added, ['O07']);
    assert.deepEqual(applied.rows, ['DEMO-700:N01', 'DEMO-800:B01', 'DEMO-800:E03', 'DEMO-800:O07'], 'silinmiş DM700 opsiyonları geri gelmedi');
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ state, applied, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
