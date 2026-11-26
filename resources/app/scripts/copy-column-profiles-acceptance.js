'use strict';
// Gerçek Buyer Log (anonim demo veri): Koleksiyon ve CP'de seçim çubuğundaki
// "Hassaslar gizli" kopyası hassas sütunları çıkarır; hemen sağındaki kalem hassas
// sütun ayarını açar; "Özel sütunlarla kopyala" kayıtlı sütunları sırasıyla kopyalar.
// Ctrl+C / normal Kopyala tüm görünür sütunları kopyalamaya devam eder.
//   node scripts/copy-column-profiles-acceptance.js [--no-shot]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const headerOf = text => String(text || '').split(/\r?\n/)[0].split('\t');
(async () => {
  const app = await start({ deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const clipboardHeaders = async () => headerOf(await page.evaluate(() => navigator.clipboard.readText()));
    const toast = re => page.waitForFunction(source => new RegExp(source).test(document.body.textContent), re.source, { timeout: 30000 });

    /* ---------- Koleksiyon ---------- */
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    await page.evaluate(() => {
      const base = { productMainDefinition: 'Takım', category: 'KEY ORME TAKIM', season: 'W7', inStoreMonth: '2027-08', inStoreWeek: '2027-W32', retail: '2027-08-20', targetPrice: '7.50' };
      kolRows = kolNormalizeModelGroups([
        { id: 1, plmId: 'DEMO-1001', modelKod: 'DEMO-TKM-01', colour: 'LIGHT GREY', colourCode: '3W9', durum: 'Sent for MB Approval', ...base },
        { id: 2, plmId: 'DEMO-1002', modelKod: 'DEMO-TKM-02', colour: 'NAVY', colourCode: 'N01', durum: 'Order Placed', ...base },
        { id: 3, plmId: 'DEMO-1003', modelKod: 'DEMO-TKM-03', colour: 'ECRU', colourCode: 'E01', durum: 'File Received', ...base },
      ]);
      const keep = new Set(['season', 'inStoreWeek', 'inStoreMonth', 'retail', 'durum', 'plmId', 'modelKod', 'colourCode', 'colour', 'targetPrice', '__confirmedPrice__', '__lfl__']);
      kolHiddenCols = new Set([...kolAllOrderedCols().map(c => c.k), ...KOL_SYNTHETIC_COL_KEYS].filter(k => !keep.has(k)));
      kolPictureHidden = true; saveKolRows(); renderKol();
    });
    await page.waitForSelector('#kolTable tbody tr[data-id="3"]', { timeout: 30000 });
    // Açılış yolu değişmez: modül ilk kullanıma kadar yüklenmez.
    assert.equal(await page.evaluate(() => typeof window.BLCopyColumnProfiles), 'undefined');
    for (const id of [1, 2]) await page.click(`#kolTable tbody tr[data-id="${id}"] .rowChk`);
    await page.waitForSelector('#blSelectionBar:not([hidden]) [data-selection-run="copySafe"]', { timeout: 10000 });
    // Kalem hassas kopya butonunun hemen sağında.
    const next = await page.$eval('#blSelectionBar [data-selection-run="copySafe"]', el => el.nextElementSibling?.dataset.selectionRun);
    assert.equal(next, 'editSensitive');

    // Normal Kopyala: tüm görünür sütunlar (hassaslar dahil).
    await page.click('#blSelectionBar [data-selection-target="kolCopySelectedBtn"]');
    await page.waitForTimeout(400);
    const normal = await clipboardHeaders();
    for (const label of ['Retail Tarihi', 'Model Bütçe Ayı']) assert.ok(normal.some(h => h.includes(label)), 'normal kopya ' + label + ' içermeli: ' + normal);

    // Hassaslar gizli: Retail, MB Week/Month, onaylı fiyat ve LFL çıkar; diğerleri kalır.
    await page.click('#blSelectionBar [data-selection-run="copySafe"]');
    await toast(/2 satır kopyalandı · \d+ hassas sütun gizlendi/);
    const safe = await clipboardHeaders();
    for (const label of ['Retail Tarihi', 'Model Bütçe Hafta', 'Model Bütçe Ayı', 'Onaylı Üretici Fiyatı', 'Hedefe Fark %', 'LFL']) assert.ok(!safe.includes(label), 'hassas sütun kopyada: ' + label + ' → ' + safe);
    assert.ok(safe.length >= 5 && safe.length < normal.length, JSON.stringify({ safe, normal }));

    // Kalem → hassas sütun ayarı; Retail Date hassaslıktan çıkarılır ve kaydedilir.
    // Sürüm notu görseli için alçak pencere: diyalog ve seçim çubuğu aynı karede.
    await page.setViewportSize({ width: 1440, height: 660 });
    await page.waitForTimeout(200);
    await page.click('#blSelectionBar [data-selection-run="editSensitive"]');
    await page.waitForSelector('.blCopyColsCard[role="dialog"]');
    assert.equal(await page.$eval('#blCopyColsTitle', el => el.textContent), 'Hassas sütunlar');
    assert.equal(await page.$eval('.blCopyColsOverlay', el => getComputedStyle(el).position), 'fixed', 'pencere stili yüklenmeli');
    assert.equal(await page.$eval('[data-cc-key="retail"] [data-cc-sensitive]', el => el.getAttribute('aria-pressed')), 'true');
    await page.fill('[data-cc-search]', 'retail');
    await page.waitForTimeout(150);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/copy-column-profiles.png');
    await page.fill('[data-cc-search]', '');
    await page.click('[data-cc-key="retail"] [data-cc-sensitive]');
    // Özel kopya: yalnız Model Kodu, Renk ve Retail Date — bu sırayla.
    await page.click('[data-cc-visible]');
    await page.$$eval('[data-cc-include]', boxes => boxes.forEach(box => { if (box.checked) box.click(); }));
    for (const key of ['retail', 'modelKod', 'colour']) await page.check(`[data-cc-key="${key}"] [data-cc-include]`);
    for (let i = 0; i < 40; i++) { const first = await page.$eval('[data-cc-key]', el => el.dataset.ccKey); if (first === 'modelKod') break; await page.click('[data-cc-key="modelKod"] [data-cc-up]'); }
    await page.$eval('[data-cc-list]', el => { el.scrollTop = 0; });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    if (!process.argv.includes('--no-shot')) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot });
    }
    await page.click('[data-cc-save]');
    await page.waitForSelector('.blCopyColsOverlay', { state: 'detached' });
    const stored = await page.evaluate(() => BLCopyColumnProfiles.getEntry('koleksiyon'));
    assert.deepEqual(stored.sensitiveOff, ['retail']);
    assert.equal(stored.columns[0], 'modelKod');

    await page.click('#blSelectionBar [data-selection-run="copySafe"]');
    await page.waitForTimeout(400);
    assert.ok((await clipboardHeaders()).includes('Retail Tarihi'), 'hassaslıktan çıkan Retail Date artık kopyalanmalı');

    await page.click('#navCopyMenuBtn');
    await page.click('#gridClipboardMenu button:text-is("Özel sütunlarla kopyala")');
    await toast(/2 satır, 3 özel sütunla kopyalandı/);
    const custom = await clipboardHeaders();
    assert.equal(custom.length, 3, JSON.stringify(custom));
    assert.deepEqual(custom, ['Model Adı', 'Renk', 'Retail Tarihi']);

    /* ---------- CP ---------- */
    await page.click('button[data-tab="cp"]');
    await page.waitForFunction(() => document.querySelector('#cpTable tbody tr[data-id]'), null, { timeout: 60000 });
    await page.evaluate(() => { const shown = visibleCols('cp').map(c => c.k); ['Retail Date', 'Ex→Retail', 'In-Store (Model Budget)'].forEach(k => colmgr.cp.hidden.delete(k)); renderCP(); return shown; });
    const ids = await page.$$eval('#cpTable tbody tr[data-id]', rows => rows.slice(0, 2).map(r => r.dataset.id));
    for (const id of ids) await page.click(`#cpTable tbody tr[data-id="${id}"] .rowChk`);
    await page.waitForSelector('#blSelectionBar:not([hidden]) [data-selection-run="copySafe"]', { timeout: 10000 });
    await page.click('#blSelectionBar [data-selection-run="copySafe"]');
    await toast(/2 satır kopyalandı · 3 hassas sütun gizlendi/);
    const cpSafe = await clipboardHeaders();
    const cpLabels = await page.evaluate(() => Object.fromEntries(['Retail Date', 'Ex→Retail', 'In-Store (Model Budget)', 'Model Name'].map(k => [k, tableColumnLabel('cp', CP_COLS.find(c => c.k === k))])));
    for (const key of ['Retail Date', 'Ex→Retail', 'In-Store (Model Budget)']) assert.ok(!cpSafe.includes(cpLabels[key]), 'CP hassas sütun kopyada: ' + key + ' → ' + cpSafe);
    assert.ok(cpSafe.includes(cpLabels['Model Name']), JSON.stringify({ cpSafe, cpLabels }));

    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ normal, safe, custom, cpSafe: cpSafe.length, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
