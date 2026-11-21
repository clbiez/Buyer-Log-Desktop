'use strict';
// Gerçek Buyer Log (izole demo veri) içinde Görünüm → "Stil: Sessiz (önizleme)" ile
// Sessiz çalışma alanını açar; CP Tracker'ın gerçek CP satırlarını kanonik alanlarla
// okuduğunu, ana başlık/rapor görünümünü, hızlı filtreyi, seçim toplamını, Genel Bakış
// widget ızgarasını, TR/EN yeniden çizimini ve klasik görünüme dönüşü doğrular;
// sürüm notu görselini üretir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');

(async () => {
  const app = await start({});
  try {
    const { page } = app;
    await page.waitForFunction(() => window.BL_STARTUP_COMPLETE === true || !window.BLBootGuard, null, { timeout: 60000 });
    // Sürüm notu görselinde gerçek kullanıcı adı görünmez: anonim demo adı.
    await page.evaluate(() => { if (state.currentUser) state.currentUser.displayName = 'Demo'; document.getElementById('railAppearanceBtn')?.click(); });
    await page.click('#railSessizBtn');
    await page.locator('#blSessiz').waitFor({ timeout: 30000 });
    await page.click('[data-sl-nav="cp"]');
    await page.waitForFunction(() => document.querySelectorAll('#blSessiz .slRow').length > 0, null, { timeout: 60000 });
    const counts = await page.evaluate(() => ({
      rows: document.querySelectorAll('#blSessiz .slRow').length,
      source: state.cp.rows.length,
      groups: document.querySelectorAll('#blSessiz .slGhb').length,
      cols: document.querySelectorAll('#blSessiz .slHr .slHc').length,
      firstOrder: document.querySelector('#blSessiz .slRow .slCode')?.textContent || ''
    }));
    assert.ok(counts.rows > 0 && counts.rows <= Math.min(300, counts.source), 'CP satırları çizilmeli');
    assert.equal(counts.groups, 7, 'yedi ana başlık');
    assert.equal(counts.cols, 21, 'tablo görünümünde 21 sütun');
    assert.ok(counts.firstOrder.length > 0, 'sipariş kodu kanonik alandan gelir');
    // Seçim toplamı: iki satırın sipariş adedi.
    const qtyCol = await page.evaluate(() => [...document.querySelectorAll('#blSessiz .slHr .slHc')].findIndex(b => /Sipariş|Ordered/.test(b.textContent) && b.classList.contains('r')));
    assert.ok(qtyCol > 0);
    await page.locator('#blSessiz .slRow').nth(0).locator('.slCell').nth(qtyCol).click();
    await page.locator('#blSessiz .slRow').nth(1).locator('.slCell').nth(qtyCol).click({ modifiers: ['Shift'] });
    assert.match(await page.locator('#slFoot').innerText(), /2 hücre|2 cells/);
    // Rapor görünümü: ana başlık başına bir sütun (+ görsel).
    await page.click('[data-sl="report"]');
    const reportCols = await page.locator('#blSessiz .slHr .slHc').count();
    assert.equal(reportCols, 8);
    // Hızlı filtre: ülke.
    await page.click('[data-sl-opt="country"]');
    const country = await page.locator('#blSessiz .slOpt button').nth(1).getAttribute('data-sl-set');
    await page.click('#blSessiz .slOpt button >> nth=1');
    const filtered = await page.evaluate(c => state.cp.rows.filter(r => String(window.BLCanonicalFields.canonicalValue(r, 'cp', 'country') || '') === c).length, country);
    assert.ok(filtered > 0);
    await page.click('[data-sl="clear"]');
    await page.click('[data-sl="table"]');
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback]').forEach(el => el.remove()));
    await page.waitForTimeout(500);
    const assets = path.join(__dirname, '../public/release-notes/next-assets');
    fs.mkdirSync(assets, { recursive: true });
    await page.screenshot({ path: path.join(assets, 'sessiz-workspace-cp.png') });
    // Genel Bakış: widget ızgarası ve sayfalar.
    await page.click('[data-sl-nav="overview"]');
    await page.locator('#blSessiz .slW[data-w="launchpad"]').waitFor();
    assert.ok(await page.locator('#blSessiz .slW').count() >= 5);
    assert.equal(await page.locator('#blSessiz .slPages button').count(), 2);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'sessiz-workspace-overview.png') });
    // Dil değişince yeniden çizilir.
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.documentElement.lang = 'tr'; });
    // Klasik görünüme dönüş.
    await page.click('[data-sl="exit"]');
    assert.equal(await page.locator('#blSessiz').count(), 0);
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ ...counts, reportCols, country, filtered }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
