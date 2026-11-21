'use strict';
// Gerçek Buyer Log (anonim demo veri) Koleksiyon tablosunda satır numarasız
// gutter'ı, renk sayacı/noktasını ve model şeridinin grup seçimini doğrular;
// sürüm notu görselini üretir. Demo veri setinde Koleksiyon kaydı olmadığından
// anonim modeller bellek içinde çizilir (kaydedilmez).
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const theme = process.argv.includes('--dark') ? 'dark' : 'light';
  const app = await start({ initScript: t => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); } catch (_) {} }, initArg: theme });
  try {
    const { page } = app;
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    await page.evaluate(() => {
      const base = { inStoreMonth: '2027-04', durum: 'Order Placed' };
      const rows = [
        { id: 1, plmId: 'DEMO-100', modelKod: 'DM100', colour: 'NAVY', colourCode: 'N01', quantity: '1200', ...base },
        { id: 2, plmId: 'DEMO-100', modelKod: 'DM100', colour: 'GREY MEL', colourCode: 'G02', quantity: '800', ...base },
        { id: 3, plmId: 'DEMO-100', modelKod: 'DM100', colour: 'ECRU', colourCode: 'E03', quantity: '600', ...base },
        { id: 4, plmId: 'DEMO-200', modelKod: 'DM200', colour: 'BLACK', colourCode: 'B01', quantity: '900', ...base },
        { id: 5, plmId: 'DEMO-300', modelKod: 'DM300', colour: 'RED', colourCode: 'R01', quantity: '500', ...base },
        { id: 6, plmId: 'DEMO-300', modelKod: 'DM300', colour: 'GREEN', colourCode: 'G05', quantity: '450', ...base },
        { id: 7, plmId: 'DEMO-400', modelKod: 'DM400', colour: 'Demo 77', colourCode: 'X77', quantity: '300', ...base },
      ];
      kolRows = kolNormalizeModelGroups(rows); kolSelected = new Set(); saveKolRows(); renderKol();
    });
    await page.waitForSelector('#kolTable tbody td[data-kol-rail]', { timeout: 30000 });
    const ids = () => page.evaluate(() => [...kolSelected].map(String).sort());
    const roles = await page.$$eval('#kolTable tbody td.kolSpreadsheetRowGutter', tds => tds.map(td => td.dataset.kolRail));
    assert.deepEqual(roles, ['parent', 'variant', 'variant', 'single', 'parent', 'variant', 'single']);
    assert.equal(await page.$$eval('#kolTable .kolSpreadsheetRowNumber', els => els.length), 0);
    assert.deepEqual(await page.$$eval('#kolTable .kolModelGroupCount', els => els.map(el => el.textContent)), ['3', '2']);
    const dots = await page.$$eval('#kolTable .kolColourDot', els => els.map(el => el.classList.contains('isUnknown') ? '' : getComputedStyle(el).backgroundColor));
    assert.equal(dots.length, 7); assert.equal(dots[6], ''); assert.ok(dots.slice(0, 6).every(Boolean));
    // Sayaç, şeridi bozmaz: sayaç şeridin sağında.
    const geo = await page.$eval('#kolTable tbody td.kolSpreadsheetRowGutter', td => ({ td: td.getBoundingClientRect().x, w: td.getBoundingClientRect().width, count: td.querySelector('.kolModelGroupCount').getBoundingClientRect().x, chkW: td.querySelector('.rowChk').getBoundingClientRect().width }));
    assert.ok(geo.count - geo.td >= geo.chkW, JSON.stringify(geo));
    await page.click('#kolTable .rowChk[data-id="1"]', { force: true });
    assert.deepEqual(await ids(), ['1', '2', '3']);
    await page.click('#kolTable .rowChk[data-id="3"]', { force: true });
    assert.deepEqual(await ids(), ['1', '2']);
    assert.equal(await page.$eval('#kolTable .rowChk[data-id="1"]', el => el.indeterminate), true);
    await page.click('#kolTable .rowChk[data-id="1"]', { force: true });
    assert.deepEqual(await ids(), ['1', '2', '3']);
    await page.click('#kolTable .rowChk[data-id="1"]', { force: true });
    assert.deepEqual(await ids(), []);
    await page.click('#kolTable .rowChk[data-id="4"]', { force: true });
    await page.click('#kolTable .rowChk[data-id="6"]', { force: true });
    await page.click('#kolTable .rowChk[data-id="2"]', { force: true });
    assert.deepEqual(await ids(), ['2', '4', '6']);
    assert.equal(await page.$eval('#kolTable .rowChk[data-id="5"]', el => el.indeterminate), true);
    // Sayaç aç/kapa yapar, seçim değişmez.
    await page.click('#kolTable .kolModelGroupCount[data-kol-group-toggle]');
    await page.waitForFunction(() => document.querySelectorAll('#kolTable tbody tr').length === 5, null, { timeout: 10000 });
    assert.deepEqual(await ids(), ['2', '4', '6']);
    await page.click('#kolTable .kolModelGroupCount[aria-expanded="false"]');
    await page.waitForFunction(() => document.querySelectorAll('#kolTable tbody tr').length === 7, null, { timeout: 10000 });
    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    const box = await page.$eval('#kolTable', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    const name = theme === 'dark' ? 'collection-model-swatch-dark.png' : 'collection-model-swatch-light.png';
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/' + name);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, clip: { x: box.x - 4, y: box.y - 4, width: 1000, height: 430 } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, roles, dots, geo }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
